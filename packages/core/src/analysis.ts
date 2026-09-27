import { z } from "zod";
import { formatTrim, parseDecimal, type Amount } from "./decimal.js";
import { checkPrice, checkVolume, pricesWithin } from "./market.js";
import type { MarketInfo } from "./types.js";

export const analysisSchema = z
  .object({
    action: z.enum(["BUY", "SELL", "HOLD"]),
    rationale: z.string().min(1).max(2000),
    evidence: z.array(z.string().min(1).max(500)).max(12),
    entry_conditions: z.array(z.string().min(1).max(500)).max(8),
    invalidation_conditions: z.array(z.string().min(1).max(500)).max(8),
    exit_conditions: z.object({
      stop_loss_price: z.string().nullable(),
      take_profit_price: z.string().nullable(),
      notes: z.string().max(1000),
    }),
    suggested_base_volume: z.string().nullable(),
    data_limitations: z.array(z.string().min(1).max(500)).max(12),
    expires_at: z.string().datetime({ offset: true }).or(z.string().datetime()),
    uncalibrated_score: z.number().nullable(),
  })
  .strict();

export type AnalysisProposal = z.infer<typeof analysisSchema>;

export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["BUY", "SELL", "HOLD"], description: "Spot action. HOLD when evidence is weak." },
    rationale: { type: "string", description: "Brief rationale. Do not claim a probability of profit." },
    evidence: { type: "array", items: { type: "string" }, description: "Evidence present in the snapshot." },
    entry_conditions: { type: "array", items: { type: "string" }, description: "Explanatory entry conditions. The engine does not execute free text." },
    invalidation_conditions: { type: "array", items: { type: "string" } },
    exit_conditions: {
      type: "object",
      additionalProperties: false,
      properties: {
        stop_loss_price: { type: ["string", "null"], description: "Decimal price string or null." },
        take_profit_price: { type: ["string", "null"], description: "Decimal price string or null." },
        notes: { type: "string" },
      },
      required: ["stop_loss_price", "take_profit_price", "notes"],
    },
    suggested_base_volume: { type: ["string", "null"], description: "Base-asset size as a decimal string, or null." },
    data_limitations: { type: "array", items: { type: "string" } },
    expires_at: { type: "string", description: "ISO-8601 expiry. Must be within 60 minutes of the snapshot." },
    uncalibrated_score: {
      type: ["number", "null"],
      description: "Optional uncalibrated model score. Not a probability of profit.",
    },
  },
  required: [
    "action",
    "rationale",
    "evidence",
    "entry_conditions",
    "invalidation_conditions",
    "exit_conditions",
    "suggested_base_volume",
    "data_limitations",
    "expires_at",
    "uncalibrated_score",
  ],
} as const;

export interface SnapshotInput {
  capturedAtMs: number;
  market: MarketInfo;
  bid: string;
  ask: string;
  last: string;
  spreadBps: number | null;
  volume24h: string | null;
  bidDepthQuote: string;
  askDepthQuote: string;
  closes: string[];
  sma20: string | null;
  sma50: string | null;
  volatility: string | null;
  positionBase: string;
  avgCost: string | null;
  permittedActions: SideAction[];
  limits: Record<string, string | number>;
  warnings: string[];
  stale: boolean;
  defaultOrderBase: string | null;
}

export type SideAction = "BUY" | "SELL" | "HOLD";

export function buildSnapshot(input: SnapshotInput): Record<string, unknown> {
  const history = input.closes.slice(-30).map((last, index) => ({
    index,
    last,
  }));
  return {
    schema: "signalforge.snapshot.v1",
    captured_at: new Date(input.capturedAtMs).toISOString(),
    market: {
      id: input.market.marketId,
      base: input.market.baseCurrency,
      counter: input.market.counterCurrency,
      status: input.market.tradingStatus,
    },
    price: {
      bid: input.bid,
      ask: input.ask,
      last: input.last,
      spread_bps: input.spreadBps,
      executable_note: "Buys pay the ask side and sells hit the bid. Midpoint is not an executable price.",
    },
    recent_closes: history,
    depth_top5_quote: { bid: input.bidDepthQuote, ask: input.askDepthQuote },
    volume_24h: input.volume24h,
    indicators: {
      sma20: input.sma20,
      sma50: input.sma50,
      sample_volatility: input.volatility,
      volatility_note: "Unannualized sample volatility of stored observations. Not a forecast.",
    },
    position: { base_qty: input.positionBase, avg_cost: input.avgCost },
    permitted_actions: input.permittedActions,
    risk_limits: input.limits,
    data_quality: { stale: input.stale, warnings: input.warnings },
    constraints: {
      spot_only: true,
      leverage: false,
      short_selling: false,
      min_volume: input.market.minVolume,
      max_volume: input.market.maxVolume,
      min_price: input.market.minPrice,
      max_price: input.market.maxPrice,
      price_scale: input.market.priceScale,
      volume_scale: input.market.volumeScale,
      default_order_base: input.defaultOrderBase,
    },
  };
}

export function assertSnapshotHasNoSecrets(snapshot: unknown, secrets: string[]): void {
  const text = JSON.stringify(snapshot);
  for (const secret of secrets) {
    if (secret && secret.length >= 6 && text.includes(secret)) {
      throw new Error("Analysis snapshot contains secret material");
    }
  }
}

export interface ValidationContext {
  nowMs: number;
  capturedAtMs: number;
  stale: boolean;
  market: MarketInfo;
  last: Amount;
  permitted: SideAction[];
  holdingsBase: Amount;
  maxAgeMs: number;
}

export type ValidationResult =
  | { ok: true; proposal: AnalysisProposal }
  | { ok: false; reason: string };

export function validateAnalysis(raw: unknown, ctx: ValidationContext): ValidationResult {
  if (ctx.stale || ctx.nowMs - ctx.capturedAtMs > ctx.maxAgeMs) {
    return { ok: false, reason: "Snapshot is stale. Analysis was rejected and the action defaults to HOLD." };
  }
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `Malformed analysis: ${parsed.error.issues.map((issue) => issue.message).join("; ")}` };
  }
  const proposal = parsed.data;
  if (!ctx.permitted.includes(proposal.action)) {
    return { ok: false, reason: `Action ${proposal.action} is not currently permitted.` };
  }
  const expires = Date.parse(proposal.expires_at);
  if (!Number.isFinite(expires)) {
    return { ok: false, reason: "Analysis expiry is not a valid timestamp." };
  }
  if (expires <= ctx.nowMs) {
    return { ok: false, reason: "Analysis is already expired." };
  }
  if (expires > ctx.capturedAtMs + 60 * 60 * 1000) {
    return { ok: false, reason: "Analysis expiry is more than 60 minutes after the snapshot." };
  }
  if (proposal.suggested_base_volume) {
    let volume: Amount;
    try {
      volume = parseDecimal(proposal.suggested_base_volume);
    } catch {
      return { ok: false, reason: "Suggested volume is not a decimal string." };
    }
    const checked = checkVolume(ctx.market, volume);
    if (!checked.ok) return { ok: false, reason: checked.reason ?? "Suggested volume is out of range." };
    if (proposal.action === "SELL" && volume > ctx.holdingsBase) {
      return { ok: false, reason: "Suggested sell volume exceeds available holdings." };
    }
  }
  if (proposal.action === "SELL" && ctx.holdingsBase <= 0n) {
    return { ok: false, reason: "SELL is not permitted without holdings." };
  }
  for (const priceText of [proposal.exit_conditions.stop_loss_price, proposal.exit_conditions.take_profit_price]) {
    if (!priceText) continue;
    let price: Amount;
    try {
      price = parseDecimal(priceText);
    } catch {
      return { ok: false, reason: "Exit price is not a decimal string." };
    }
    const checked = checkPrice(ctx.market, price);
    if (!checked.ok) return { ok: false, reason: checked.reason ?? "Exit price is out of range." };
    if (!pricesWithin(ctx.market, price, ctx.last, 5_000)) {
      return { ok: false, reason: "Exit price is more than 50% away from the last trade." };
    }
  }
  if (proposal.action === "BUY" && proposal.exit_conditions.stop_loss_price) {
    const stop = parseDecimal(proposal.exit_conditions.stop_loss_price);
    if (stop >= ctx.last) return { ok: false, reason: "Stop-loss for a long entry must be below the last trade." };
  }
  if (proposal.action === "BUY" && proposal.exit_conditions.take_profit_price) {
    const target = parseDecimal(proposal.exit_conditions.take_profit_price);
    if (target <= ctx.last) return { ok: false, reason: "Take-profit for a long entry must be above the last trade." };
  }
  return { ok: true, proposal };
}

export function holdFallback(reason: string, nowMs: number): AnalysisProposal {
  return {
    action: "HOLD",
    rationale: reason,
    evidence: ["Analysis service failed or returned an unusable proposal. Deterministic fallback is HOLD."],
    entry_conditions: [],
    invalidation_conditions: [],
    exit_conditions: { stop_loss_price: null, take_profit_price: null, notes: "No new exit was attached because the proposal was rejected." },
    suggested_base_volume: null,
    data_limitations: [reason],
    expires_at: new Date(nowMs + 5 * 60 * 1000).toISOString(),
    uncalibrated_score: null,
  };
}

export function demoRulesProposal(input: {
  nowMs: number;
  closes: string[];
  sma20: string | null;
  sma50: string | null;
  hasPosition: boolean;
  stale: boolean;
  spreadBps: number | null;
  minVolume: string;
}): AnalysisProposal {
  const expires = new Date(input.nowMs + 15 * 60 * 1000).toISOString();
  if (input.stale || input.spreadBps === null) {
    return {
      action: "HOLD",
      rationale: "Demo rules engine is not the xAI API. Data is stale or the spread is unavailable, so the action is HOLD.",
      evidence: ["Demo rules only. No Grok request was sent."],
      entry_conditions: ["Fresh bid and ask are required."],
      invalidation_conditions: ["Any stale book invalidates a demo entry."],
      exit_conditions: { stop_loss_price: null, take_profit_price: null, notes: "No demo exit while data is stale." },
      suggested_base_volume: null,
      data_limitations: ["This proposal was produced locally because the xAI API is not configured or was not called."],
      expires_at: expires,
      uncalibrated_score: null,
    };
  }
  const last = input.closes[input.closes.length - 1];
  let action: SideAction = "HOLD";
  if (last && input.sma20 && input.sma50) {
    const lastValue = parseDecimal(last);
    const fast = parseDecimal(input.sma20);
    const slow = parseDecimal(input.sma50);
    if (lastValue > fast && fast > slow && !input.hasPosition) action = "BUY";
    else if (lastValue < fast && input.hasPosition) action = "SELL";
  }
  return {
    action,
    rationale:
      action === "HOLD"
        ? "Demo rules engine (not Grok): price is not extended versus the stored moving averages, or there is nothing to sell."
        : `Demo rules engine (not Grok): ${action} from last trade versus SMA20 and SMA50 on stored observations.`,
    evidence: [
      `SMA20 ${input.sma20 ?? "unavailable"}`,
      `SMA50 ${input.sma50 ?? "unavailable"}`,
      `Spread ${input.spreadBps.toFixed(2)} bps`,
    ],
    entry_conditions: ["Last trade above both moving averages for a buy. This text is not executed directly."],
    invalidation_conditions: ["A move back through SMA20 invalidates the demo long."],
    exit_conditions: {
      stop_loss_price: null,
      take_profit_price: null,
      notes: "Demo rules do not invent stop prices. Risk exits use configured limits.",
    },
    suggested_base_volume: action === "HOLD" ? null : input.minVolume,
    data_limitations: ["Local deterministic rules. Not an xAI Grok response and not a probability of profit."],
    expires_at: expires,
    uncalibrated_score: null,
  };
}

export function canonicalSnapshot(snapshot: unknown): string {
  return JSON.stringify(snapshot);
}

export function shouldRequestAnalysis(input: {
  nowMs: number;
  lastAtMs: number | null;
  lastPrice: Amount | null;
  price: Amount;
  intervalMs: number;
  moveBps: number;
  inFlight: boolean;
  expiresAtMs: number | null;
}): boolean {
  if (input.inFlight) return false;
  if (input.lastAtMs === null) return true;
  if (input.expiresAtMs !== null && input.expiresAtMs <= input.nowMs) return true;
  if (input.nowMs - input.lastAtMs >= input.intervalMs) return true;
  if (input.lastPrice && input.lastPrice > 0n) {
    const delta = input.price > input.lastPrice ? input.price - input.lastPrice : input.lastPrice - input.price;
    const bps = Number((delta * 10_000n) / input.lastPrice);
    if (bps >= input.moveBps) return true;
  }
  return false;
}

export function modelCostUsd(input: {
  model: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}): { usd: string; known: boolean; note: string } {
  const price = MODEL_PRICES[input.model];
  if (!price) {
    return {
      usd: "0",
      known: false,
      note: `No published token price is recorded for ${input.model}. Cost is shown as unavailable rather than estimated.`,
    };
  }
  const long = input.promptTokens >= price.threshold;
  const inputRate = long ? price.longInput : price.input;
  const cachedRate = long ? price.longCached : price.cachedInput;
  const outputRate = long ? price.longOutput : price.output;
  const uncached = Math.max(0, input.promptTokens - input.cachedTokens);
  const usd = (uncached * inputRate + input.cachedTokens * cachedRate + input.completionTokens * outputRate) / 1_000_000;
  return {
    usd: formatTrim(parseDecimal(usd.toFixed(8)), 8),
    known: true,
    note: long
      ? "Long-context published rate applied to the whole request."
      : "Published rate for prompts under the long-context threshold. Actual invoices can differ.",
  };
}

export const MODEL_PRICES: Record<
  string,
  { input: number; cachedInput: number; output: number; longInput: number; longCached: number; longOutput: number; threshold: number }
> = {
  "grok-4.6": { input: 2, cachedInput: 0.5, output: 6, longInput: 4, longCached: 1, longOutput: 12, threshold: 200_000 },
  "grok-4.5": { input: 2, cachedInput: 0.3, output: 6, longInput: 4, longCached: 0.6, longOutput: 12, threshold: 200_000 },
  "grok-4.3": { input: 1.25, cachedInput: 0.2, output: 2.5, longInput: 2.5, longCached: 0.4, longOutput: 5, threshold: 200_000 },
  "grok-4.20-0309-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5, longInput: 2.5, longCached: 0.4, longOutput: 5, threshold: 200_000 },
  "grok-4.20-0309-non-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5, longInput: 2.5, longCached: 0.4, longOutput: 5, threshold: 200_000 },
  "grok-build-0.1": { input: 1, cachedInput: 0.2, output: 2, longInput: 2, longCached: 0.4, longOutput: 4, threshold: 200_000 },
  "grok-4.20-multi-agent-0309": { input: 1.25, cachedInput: 0.2, output: 2.5, longInput: 2.5, longCached: 0.4, longOutput: 5, threshold: 200_000 },
};
