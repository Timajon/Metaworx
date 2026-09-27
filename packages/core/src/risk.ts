import type { Amount } from "./decimal.js";
import { formatTrim } from "./decimal.js";
import type { Side } from "./types.js";

export interface RiskLimits {
  maxOrderQuote: string;
  maxExposureQuote: string;
  maxDailyLossQuote: string;
  maxTradesPerDay: number;
  minCashReserveQuote: string;
  maxSpreadBps: number;
  maxSlippageBps: number;
  minDepthQuote: string;
  maxOpenOrders: number;
  failureCooldownMs: number;
  lossCooldownMs: number;
  staleAfterMs: number;
  failuresBeforeCooldown: number;
  lossesBeforeCooldown: number;
  limitCurrency: "ZAR";
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxOrderQuote: "2000",
  maxExposureQuote: "10000",
  maxDailyLossQuote: "500",
  maxTradesPerDay: 20,
  minCashReserveQuote: "1000",
  maxSpreadBps: 80,
  maxSlippageBps: 30,
  minDepthQuote: "5000",
  maxOpenOrders: 5,
  failureCooldownMs: 15 * 60 * 1000,
  lossCooldownMs: 15 * 60 * 1000,
  staleAfterMs: 15_000,
  failuresBeforeCooldown: 3,
  lossesBeforeCooldown: 3,
  limitCurrency: "ZAR",
};

export interface RiskAssessmentInput {
  limits: RiskLimits;
  now: number;
  side: Side;
  isExit: boolean;
  orderQuoteNotional: Amount;
  projectedExposureQuote: Amount;
  dailyRealizedPnl: Amount;
  tradesToday: number;
  cashAfterQuote: Amount;
  spreadBps: number | null;
  slippageBps: number;
  depthQuote: Amount;
  openOrders: number;
  cooldownUntil: number;
  dataStale: boolean;
  feedHealthy: boolean;
  sellBase: Amount;
  holdingsBase: Amount;
  marketTradable: boolean;
  zarConversion: "exact" | "estimated" | "unavailable";
}

export interface RiskAssessment {
  ok: boolean;
  reasons: string[];
}

export function assessOrder(input: RiskAssessmentInput): RiskAssessment {
  const reasons: string[] = [];
  const limits = input.limits;
  if (!input.feedHealthy || input.dataStale) {
    reasons.push("Market data is stale or the exchange feed is unhealthy. New orders are paused.");
  }
  if (!input.marketTradable) {
    reasons.push("Market is not in an ACTIVE or POST_ONLY trading status.");
  }
  if (input.zarConversion === "unavailable") {
    reasons.push("ZAR conversion is unavailable, so exposure limits cannot be enforced.");
  }
  if (input.now < input.cooldownUntil && !input.isExit) {
    reasons.push("Cooldown is active after repeated failures or losses. New risk-increasing orders are blocked.");
  }
  if (input.side === "SELL" && input.sellBase > input.holdingsBase) {
    reasons.push("Sell size exceeds available holdings. Short selling is not supported.");
  }
  if (!input.isExit && input.tradesToday >= limits.maxTradesPerDay) {
    reasons.push("Daily trade frequency limit reached.");
  }
  const maxLoss = -parseLimit(limits.maxDailyLossQuote);
  if (!input.isExit && input.dailyRealizedPnl <= maxLoss) {
    reasons.push("Daily loss limit reached. New entries are blocked. Risk-reducing exits still require fresh data.");
  }
  if (input.orderQuoteNotional > parseLimit(limits.maxOrderQuote)) {
    reasons.push(`Order notional exceeds maximum ${limits.maxOrderQuote} ${limits.limitCurrency}.`);
  }
  if (input.side === "BUY" && input.projectedExposureQuote > parseLimit(limits.maxExposureQuote)) {
    reasons.push(`Projected exposure exceeds maximum ${limits.maxExposureQuote} ${limits.limitCurrency}.`);
  }
  if (input.side === "BUY" && input.cashAfterQuote < parseLimit(limits.minCashReserveQuote)) {
    reasons.push(`Order would leave less than the ${limits.minCashReserveQuote} ${limits.limitCurrency} cash reserve.`);
  }
  if (input.spreadBps === null || input.spreadBps > limits.maxSpreadBps) {
    reasons.push(`Spread is above the maximum of ${limits.maxSpreadBps} bps.`);
  }
  if (input.slippageBps > limits.maxSlippageBps) {
    reasons.push(`Estimated slippage is above the maximum of ${limits.maxSlippageBps} bps.`);
  }
  if (input.depthQuote < parseLimit(limits.minDepthQuote)) {
    reasons.push(`Visible depth is below the minimum of ${limits.minDepthQuote} ${limits.limitCurrency}.`);
  }
  if (!input.isExit && input.openOrders >= limits.maxOpenOrders) {
    reasons.push("Maximum number of open orders reached.");
  }
  return { ok: reasons.length === 0, reasons };
}

function parseLimit(value: string): Amount {
  return parseDecimalSafe(value);
}

function parseDecimalSafe(value: string): Amount {
  const trimmed = value.trim();
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new Error(`Invalid limit decimal: ${value}`);
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] ?? "0";
  const frac = (match[3] ?? "").slice(0, 18).padEnd(18, "0");
  return BigInt((whole + frac).replace(/^0+(?=\d)/, "")) * sign;
}

export function describeLimits(limits: RiskLimits): string {
  return `Max order ${limits.maxOrderQuote} ${limits.limitCurrency}, max exposure ${limits.maxExposureQuote} ${limits.limitCurrency}, max daily loss ${limits.maxDailyLossQuote} ${limits.limitCurrency}.`;
}

export function formatQuote(value: Amount): string {
  return formatTrim(value);
}
