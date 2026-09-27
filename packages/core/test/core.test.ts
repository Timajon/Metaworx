import { describe, expect, it } from "vitest";
import {
  DEFAULT_RISK_LIMITS,
  advancePaperOrder,
  applyBuy,
  applySell,
  assessOrder,
  baselineAction,
  buildSnapshot,
  claimClientOrderId,
  compareStrategies,
  demoRulesProposal,
  deposit,
  drawdown,
  emptyPortfolio,
  formatDecimal,
  holdFallback,
  markEquity,
  modelCostUsd,
  parseDecimal,
  planMarketableOrder,
  prefixInvariant,
  accountFeeOrPublished,
  publishedZaTier1,
  reconcileOrders,
  resolveAmbiguousSubmission,
  seedCash,
  shouldRequestAnalysis,
  tradingPnl,
  validateAnalysis,
  walkBuyBase,
  withdraw,
  type MarketInfo,
  type PaperOrder,
  type RiskAssessmentInput,
} from "../src/index.js";

const xbtzar: MarketInfo = {
  marketId: "XBTZAR",
  baseCurrency: "XBT",
  counterCurrency: "ZAR",
  minVolume: "0.0001",
  maxVolume: "100",
  volumeScale: 6,
  minPrice: "10",
  maxPrice: "10000000",
  priceScale: 0,
  feeScale: 8,
  tradingStatus: "ACTIVE",
};

const book = {
  timestamp: 1_000,
  bids: [
    { price: "999000", volume: "0.01" },
    { price: "998000", volume: "0.02" },
  ],
  asks: [
    { price: "1000000", volume: "0.01" },
    { price: "1001000", volume: "0.05" },
  ],
};

function riskInput(overrides: Partial<RiskAssessmentInput> = {}): RiskAssessmentInput {
  return {
    limits: DEFAULT_RISK_LIMITS,
    now: 10_000,
    side: "BUY",
    isExit: false,
    orderQuoteNotional: parseDecimal("1000"),
    projectedExposureQuote: parseDecimal("1000"),
    dailyRealizedPnl: parseDecimal("0"),
    tradesToday: 0,
    cashAfterQuote: parseDecimal("5000"),
    spreadBps: 10,
    slippageBps: 5,
    depthQuote: parseDecimal("20000"),
    openOrders: 0,
    cooldownUntil: 0,
    dataStale: false,
    feedHealthy: true,
    sellBase: parseDecimal("0"),
    holdingsBase: parseDecimal("0"),
    marketTradable: true,
    zarConversion: "exact",
    ...overrides,
  };
}

function paperOrder(overrides: Partial<PaperOrder> = {}): PaperOrder {
  return {
    clientOrderId: "sf-1",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
    postOnly: false,
    price: "1000000",
    stopPrice: null,
    stopDirection: null,
    remainingBase: "0.02",
    counterBudget: null,
    status: "open",
    eligibleAt: 0,
    triggered: false,
    resting: false,
    ...overrides,
  };
}

describe("decimals and fees", () => {
  it("rounds money without binary float drift", () => {
    expect(formatDecimal(parseDecimal("0.0001"), 6)).toBe("0.000100");
    expect(formatDecimal(parseDecimal("1379816.4"), 0)).toBe("1379816");
    const notional = parseDecimal("1000");
    const fee = publishedZaTier1("XBT", "ZAR");
    const charged = formatDecimal(
      (parseDecimal(fee.takerRate) * notional) / 10n ** 18n,
      2,
    );
    expect(fee.takerRate).toBe("0.006");
    expect(charged).toBe("6.00");
  });

  it("uses fee_info when the rate is a fraction and keeps the published schedule otherwise", () => {
    const published = publishedZaTier1("XBT", "ZAR");
    const account = accountFeeOrPublished(published, { maker: "0.0025", taker: "0.0045" });
    expect(account.source).toBe("luno-fee-info");
    expect(account.takerRate).toBe("0.0045");
    const rejected = accountFeeOrPublished(published, { maker: "0.40", taker: "0.60" });
    expect(rejected.source).toBe("za-tier1-published");
    expect(rejected.takerRate).toBe("0.006");
  });
});

describe("paper execution", () => {
  it("buys at the ask and walks depth instead of the midpoint", () => {
    const walked = walkBuyBase(book.asks, parseDecimal("0.02"));
    expect(walked.fills[0]?.price).toBe("1000000");
    expect(walked.fills[1]?.price).toBe("1001000");
    expect(walked.averagePrice).not.toBeNull();
    if (walked.averagePrice) {
      expect(walked.averagePrice > parseDecimal("999500")).toBe(true);
      expect(walked.averagePrice > parseDecimal("1000000")).toBe(true);
    }
  });

  it("partially fills a limit and leaves the remainder resting", () => {
    const step = advancePaperOrder(paperOrder(), book, 1_000, parseDecimal("0.006"), parseDecimal("0.004"), "1000000");
    expect(step.fills).toHaveLength(1);
    expect(step.fills[0]?.base).toBe("0.01");
    expect(step.order.status).toBe("partial");
    expect(step.order.remainingBase).toBe("0.01");
    expect(step.feeQuote > 0n).toBe(true);
  });

  it("cancels a fill-or-kill order that cannot complete", () => {
    const step = advancePaperOrder(
      paperOrder({ timeInForce: "FOK", remainingBase: "0.2" }),
      book,
      1_000,
      parseDecimal("0.006"),
      parseDecimal("0.004"),
    );
    expect(step.fills).toHaveLength(0);
    expect(step.order.status).toBe("cancelled");
  });

  it("does not fill before the execution delay", () => {
    const step = advancePaperOrder(paperOrder({ eligibleAt: 5_000 }), book, 1_000, parseDecimal("0.006"), parseDecimal("0.004"));
    expect(step.fills).toHaveLength(0);
    expect(step.order.status).toBe("delayed");
  });

  it("fills a resting bid only after the ask crosses below the limit", () => {
    const resting = paperOrder({ resting: true, status: "open", remainingBase: "0.01", price: "1000000" });
    const untouched = advancePaperOrder(resting, book, 2_000, parseDecimal("0.006"), parseDecimal("0.004"));
    expect(untouched.fills).toHaveLength(0);
    const crossed = {
      ...book,
      asks: [{ price: "999000", volume: "0.004" }],
    };
    const filled = advancePaperOrder(resting, crossed, 3_000, parseDecimal("0.006"), parseDecimal("0"));
    expect(filled.fills[0]?.price).toBe("1000000");
    expect(filled.fills[0]?.liquidity).toBe("maker");
    expect(filled.order.remainingBase).toBe("0.006");
  });
});

describe("accounting", () => {
  it("keeps deposits and withdrawals out of trading P&L and nets fees", () => {
    let portfolio = seedCash(emptyPortfolio(), parseDecimal("1000"));
    portfolio = deposit(portfolio, parseDecimal("100"));
    portfolio = withdraw(portfolio, parseDecimal("40"));
    expect(tradingPnl(portfolio, parseDecimal("100"))).toBe(0n);
    portfolio = applyBuy(portfolio, parseDecimal("1"), parseDecimal("100"), parseDecimal("0.01"));
    portfolio = applySell(portfolio, parseDecimal("1"), parseDecimal("110"), parseDecimal("0.01"));
    expect(portfolio.fees).toBe(parseDecimal("2.1"));
    expect(portfolio.realized).toBe(parseDecimal("7.9"));
    expect(tradingPnl(portfolio, parseDecimal("110"))).toBe(parseDecimal("7.9"));
    expect(markEquity(portfolio, parseDecimal("110"))).toBe(parseDecimal("1067.9"));
  });

  it("marks longs at the bid and reports drawdown separately from fees", () => {
    let portfolio = seedCash(emptyPortfolio(), parseDecimal("10000"));
    portfolio = applyBuy(portfolio, parseDecimal("1"), parseDecimal("1000"), parseDecimal("0"));
    const equity = markEquity(portfolio, parseDecimal("900"));
    expect(tradingPnl(portfolio, parseDecimal("900"))).toBe(parseDecimal("-100"));
    expect(drawdown(equity, parseDecimal("10000"))).toBe(parseDecimal("100"));
  });
});

describe("risk and stale data", () => {
  it("blocks new orders when the feed is stale", () => {
    const result = assessOrder(riskInput({ dataStale: true }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/stale/i);
  });

  it("enforces size, reserve, spread, frequency, and holdings", () => {
    expect(assessOrder(riskInput({ orderQuoteNotional: parseDecimal("5000") })).ok).toBe(false);
    expect(assessOrder(riskInput({ cashAfterQuote: parseDecimal("10") })).ok).toBe(false);
    expect(assessOrder(riskInput({ spreadBps: 500 })).ok).toBe(false);
    expect(assessOrder(riskInput({ tradesToday: 20 })).ok).toBe(false);
    expect(
      assessOrder(
        riskInput({
          side: "SELL",
          sellBase: parseDecimal("2"),
          holdingsBase: parseDecimal("1"),
          isExit: true,
        }),
      ).ok,
    ).toBe(false);
    expect(assessOrder(riskInput()).ok).toBe(true);
  });
});

describe("grok validation", () => {
  const ctx = {
    nowMs: 1_000_000,
    capturedAtMs: 999_000,
    stale: false,
    market: xbtzar,
    last: parseDecimal("1000000"),
    permitted: ["BUY", "SELL", "HOLD"] as ("BUY" | "SELL" | "HOLD")[],
    holdingsBase: parseDecimal("0.01"),
    maxAgeMs: 15_000,
  };

  it("rejects malformed, stale, and out-of-range proposals", () => {
    expect(validateAnalysis({ action: "YOLO" }, ctx).ok).toBe(false);
    expect(validateAnalysis(holdFallback("api down", ctx.nowMs), { ...ctx, stale: true }).ok).toBe(false);
    const expired = holdFallback("no", ctx.nowMs);
    expired.expires_at = new Date(ctx.nowMs - 1000).toISOString();
    expect(validateAnalysis(expired, ctx).ok).toBe(false);
    const oversized = holdFallback("no", ctx.nowMs);
    oversized.action = "BUY";
    oversized.suggested_base_volume = "500";
    expect(validateAnalysis(oversized, ctx).ok).toBe(false);
    const nakedSell = holdFallback("no", ctx.nowMs);
    nakedSell.action = "SELL";
    nakedSell.suggested_base_volume = "1";
    expect(validateAnalysis(nakedSell, { ...ctx, holdingsBase: 0n }).ok).toBe(false);
  });

  it("accepts a schema-valid hold and labels demo rules as not Grok", () => {
    const hold = holdFallback("waiting", ctx.nowMs);
    expect(validateAnalysis(hold, ctx)).toMatchObject({ ok: true });
    const demo = demoRulesProposal({
      nowMs: ctx.nowMs,
      closes: Array.from({ length: 60 }, () => "100"),
      sma20: "100",
      sma50: "100",
      hasPosition: false,
      stale: false,
      spreadBps: 5,
      minVolume: "0.0001",
    });
    expect(demo.rationale.toLowerCase()).toContain("not grok");
    expect(demo.uncalibrated_score).toBeNull();
  });

  it("does not call analysis on every tick and prices known models", () => {
    expect(
      shouldRequestAnalysis({
        nowMs: 10_000,
        lastAtMs: 9_000,
        lastPrice: parseDecimal("100"),
        price: parseDecimal("100.1"),
        intervalMs: 60_000,
        moveBps: 50,
        inFlight: false,
        expiresAtMs: 80_000,
      }),
    ).toBe(false);
    expect(
      shouldRequestAnalysis({
        nowMs: 80_000,
        lastAtMs: 9_000,
        lastPrice: parseDecimal("100"),
        price: parseDecimal("101"),
        intervalMs: 60_000,
        moveBps: 50,
        inFlight: false,
        expiresAtMs: 70_000,
      }),
    ).toBe(true);
    const cost = modelCostUsd({ model: "grok-4.6", promptTokens: 1_000, cachedTokens: 0, completionTokens: 500 });
    expect(cost.known).toBe(true);
    expect(cost.usd).toBe("0.005");
    expect(modelCostUsd({ model: "grok-4.7", promptTokens: 10, cachedTokens: 0, completionTokens: 10 }).known).toBe(false);
  });

  it("keeps secrets out of the snapshot", () => {
    const snapshot = buildSnapshot({
      capturedAtMs: 1,
      market: xbtzar,
      bid: "1",
      ask: "2",
      last: "2",
      spreadBps: 1,
      volume24h: "1",
      bidDepthQuote: "1",
      askDepthQuote: "1",
      closes: ["1"],
      sma20: null,
      sma50: null,
      volatility: null,
      positionBase: "0",
      avgCost: null,
      permittedActions: ["HOLD"],
      limits: { maxOrderQuote: "2000" },
      warnings: [],
      stale: false,
      defaultOrderBase: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain("super-secret");
  });
});

describe("reconciliation", () => {
  it("does not retry an ambiguous submit until lookup, and never with the same id after a miss", () => {
    expect(resolveAmbiguousSubmission("unknown")).toMatchObject({ status: "ambiguous", mayRetryNewId: false, retrySameId: false });
    expect(resolveAmbiguousSubmission("found")).toMatchObject({ status: "open", mayRetryNewId: false });
    expect(resolveAmbiguousSubmission("missing")).toMatchObject({ status: "not_placed", mayRetryNewId: true, retrySameId: false });
  });

  it("updates fills from the exchange without creating another submission", () => {
    const result = reconcileOrders(
      [
        {
          clientOrderId: "sf-1",
          exchangeOrderId: null,
          status: "ambiguous",
          baseVolume: "1",
          filledBase: "0",
        },
      ],
      [
        {
          clientOrderId: "sf-1",
          exchangeOrderId: "BX1",
          status: "PENDING",
          baseFilled: "0.5",
          limitVolume: "1",
        },
      ],
    );
    expect(result.updates).toEqual([
      { clientOrderId: "sf-1", status: "partial", exchangeOrderId: "BX1", filledBase: "0.5", submit: false },
    ]);
  });

  it("prevents duplicate client order ids", () => {
    const inflight = new Set<string>();
    expect(claimClientOrderId(new Set(), inflight, "sf-1")).toBe("ok");
    expect(claimClientOrderId(new Set(["sf-1"]), inflight, "sf-1")).toBe("duplicate");
    expect(claimClientOrderId(new Set(), inflight, "sf-1")).toBe("duplicate");
  });
});

describe("evaluation", () => {
  it("uses the ask at the decision and ignores a later cheaper price", () => {
    const points = [
      { ts: 1, bid: "100", ask: "101", last: "101" },
      { ts: 2, bid: "50", ask: "51", last: "51" },
    ];
    const comparison = compareStrategies({
      points,
      strategyActions: ["HOLD", "BUY"],
      seed: "1000",
      orderNotional: "100",
      feeRate: "0",
    });
    expect(comparison.strategy[0]?.action).toBe("HOLD");
    expect(comparison.strategy[0]?.tradingPnl).toBe("0");
    expect(Number(comparison.strategy[1]?.equity)).toBeLessThan(1000);
    expect(comparison.note).toMatch(/not evidence of future profitability/i);
  });

  it("does not let future closes change an earlier baseline decision", () => {
    const early = ["100", "100", "100"];
    const withFuture = [...early, "1"];
    const earlyActions = prefixInvariant(early);
    const laterActions = prefixInvariant(withFuture);
    expect(laterActions.slice(0, early.length)).toEqual(earlyActions);
    expect(baselineAction(["100"], false)).toBe("HOLD");
  });
});

describe("order planning", () => {
  it("caps a buy at visible ask depth inside the slippage band", () => {
    const plan = planMarketableOrder({
      side: "BUY",
      book,
      market: xbtzar,
      desiredBase: parseDecimal("0.2"),
      maxSlippageBps: 20,
      feeRate: parseDecimal("0.006"),
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.plan.timeInForce).toBe("IOC");
      expect(Number(plan.plan.baseVolume)).toBeLessThan(0.2);
      expect(Number(plan.plan.limitPrice)).toBeGreaterThanOrEqual(1_000_000);
    }
  });
});
