import { createHash, randomBytes } from "node:crypto";
import {
  DEFAULT_RISK_LIMITS,
  add,
  advancePaperOrder,
  aggregateCandles,
  applyBuy,
  applySell,
  assessOrder,
  buildSnapshot,
  canonicalSnapshot,
  checkVolume,
  claimClientOrderId,
  compareStrategies,
  demoRulesProposal,
  describeLimits,
  drawdown,
  emptyPortfolio,
  div,
  formatTrim,
  holdFallback,
  indicators,
  isSpotMarket,
  markEquity,
  mul,
  parseDecimal,
  planMarketableOrder,
  accountFeeOrPublished,
  publishedZaTier1,
  reconcileOrders,
  seedCash,
  shouldRequestAnalysis,
  spreadBps,
  topDepth,
  tradingPnl,
  unrealizedPnl,
  validateAnalysis,
  walkBuyCounter,
  walkSellBase,
  toZar,
  type Amount,
  type MarketInfo,
  type OrderBook,
  type PaperOrder,
  type RiskLimits,
  type Ticker,
  type TradePrint,
} from "@signalforge/core";
import type { RemoteOrderRef } from "@signalforge/core";
import { submitWithReconcile } from "./live.js";
import type { Store, OrderRow } from "./store.js";

export interface MarketGateway {
  getMarkets(): Promise<MarketInfo[]>;
  getTickers(): Promise<Ticker[]>;
  getOrderBook(pair: string): Promise<OrderBook>;
  getTrades(pair: string): Promise<TradePrint[]>;
  getCandles?(pair: string, since: number, duration: number): Promise<{ timestamp: number; open: string; high: string; low: string; close: string; volume: string }[] | null>;
  getBalances?(): Promise<{ currency: string; balance: string; available: string; accountId: string; name?: string }[]>;
  getFeeInfo?(pair: string): Promise<{ maker: string; taker: string } | null>;
  listOpenOrders?(pair: string): Promise<RemoteOrderRef[]>;
  getOrderByClientId?(clientOrderId: string): Promise<RemoteOrderRef | null>;
  postLimitOrder?(fields: Record<string, string>): Promise<{ orderId: string }>;
  postMarketOrder?(fields: Record<string, string>): Promise<{ orderId: string }>;
  cancelOrder?(orderId: string): Promise<boolean>;
}

export interface Analyst {
  configured: boolean;
  model: string;
  analyze(snapshot: unknown): Promise<{
    raw: unknown;
    model: string;
    usage: { promptTokens: number; completionTokens: number; cachedTokens: number; estimatedCostUsd: string; costKnown: boolean; costNote: string };
  }>;
}

export interface TraderOptions {
  demo: boolean;
  lunoKeyId: string | null;
  lunoKeySecret: string | null;
  xaiKey: string | null;
  analysisIntervalMs: number;
  analysisMoveBps: number;
  paperSeedZar: string;
  paperDelayMs: number;
  now?: () => number;
}

interface PaperState {
  cashZar: string;
  seed: string;
  deposits: string;
  withdrawals: string;
  realized: string;
  fees: string;
  grokCostUsd: string;
  peakEquity: string;
  positions: Record<string, { qty: string; avgCost: string; realized: string; fees: string }>;
  failures: number;
  lossStreak: number;
  cooldownUntil: number;
  day: string;
  tradesToday: number;
  dailyRealized: string;
  feeNote: string;
}

interface ManualRequest {
  marketId: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  baseVolume?: string;
  quoteBudget?: string;
  price?: string;
  timeInForce?: "GTC" | "IOC" | "FOK";
  postOnly?: boolean;
  confirmLive?: boolean;
  clientOrderId?: string;
  source?: string;
  isExit?: boolean;
}

export class Trader {
  private tickers: Ticker[] = [];
  private book: OrderBook | null = null;
  private trades: TradePrint[] = [];
  private feedError: string | null = null;
  private feedOkAt = 0;
  private stale = true;
  private marketsAt = 0;
  private inflight = new Set<string>();
  private exchangeBalances: { currency: string; balance: string; available: string }[] = [];
  private candles: { timestamp: number; open: string; high: string; low: string; close: string; volume: string; source: string }[] = [];
  private candleSource = "No candle history yet";
  private feeCache = new Map<string, { maker: string; taker: string; at: number }>();

  constructor(
    private readonly store: Store,
    private readonly luno: MarketGateway,
    private readonly analyst: Analyst,
    private readonly options: TraderOptions,
  ) {
    if (this.options.demo && this.store.getSetting("mode") && this.store.getSetting("mode") !== "paper") {
      this.store.setSetting("mode", "paper");
    }
    this.ensurePaper();
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  mode(): "paper" | "assisted_live" | "automatic_live" {
    const value = this.store.getSetting("mode");
    if (value === "assisted_live" || value === "automatic_live") return this.options.demo ? "paper" : value;
    return "paper";
  }

  paused(): boolean {
    return this.store.getSetting("paused") === "1";
  }

  risk(): RiskLimits {
    const raw = this.store.getSetting("risk");
    if (!raw) return DEFAULT_RISK_LIMITS;
    return { ...DEFAULT_RISK_LIMITS, ...JSON.parse(raw) } as RiskLimits;
  }

  selected(): string {
    return this.store.getSetting("selected_market") ?? "XBTZAR";
  }

  async tick(): Promise<void> {
    const now = this.now();
    await this.refreshMarkets(now);
    try {
      this.tickers = await this.luno.getTickers();
      this.feedOkAt = now;
      this.feedError = null;
    } catch (error) {
      this.feedError = error instanceof Error ? error.message : "Ticker request failed";
    }
    const marketId = this.selected();
    try {
      this.book = await this.luno.getOrderBook(marketId);
      this.trades = await this.luno.getTrades(marketId);
      this.feedOkAt = now;
    } catch (error) {
      this.feedError = error instanceof Error ? error.message : "Order book request failed";
    }
    const ticker = this.tickers.find((item) => item.pair === marketId) ?? null;
    const bookTs = this.book?.timestamp ?? 0;
    const tickerTs = ticker?.timestamp ?? 0;
    const newest = Math.max(bookTs, tickerTs);
    this.stale = !this.book || !ticker || now - newest > this.risk().staleAfterMs || (this.feedError !== null && now - this.feedOkAt > this.risk().staleAfterMs);
    if (this.book && ticker) {
      const spread = spreadBps(this.book);
      this.store.insertObservation({
        marketId,
        ts: now,
        bid: ticker.bid,
        ask: ticker.ask,
        last: ticker.lastTrade,
        volume24h: ticker.rolling24HourVolume,
        spreadBps: spread === null ? "" : spread.toFixed(4),
        bookJson: JSON.stringify({ bids: this.book.bids.slice(0, 8), asks: this.book.asks.slice(0, 8) }),
        source: "rest",
      });
      await this.loadCandles(marketId, now);
    }
    if (this.book) await this.advancePaper(now, this.book, ticker?.lastTrade ?? null);
    await this.refreshFee(marketId);
    await this.reconcileLive(marketId);
    await this.fireStops(ticker, this.book);
    if (this.book && ticker) await this.maybeAnalyze(marketId, ticker, this.book, now);
    if (ticker) {
      const paper = this.paper();
      const marked = this.equity(paper, new Map(this.tickers.map((item) => [item.pair, item])));
      if (marked > parseDecimal(paper.peakEquity || "0")) {
        paper.peakEquity = formatTrim(marked);
        this.savePaper(paper);
      }
    }
    if (this.options.lunoKeyId && this.luno.getBalances) {
      try {
        this.exchangeBalances = await this.luno.getBalances();
      } catch (error) {
        this.feedError = error instanceof Error ? error.message : "Balance request failed";
      }
    }
  }

  async placeManual(request: ManualRequest): Promise<{ ok: boolean; error?: string; orderId?: number }> {
    return this.execute({ ...request, source: request.source ?? "manual" });
  }

  preview(request: ManualRequest): { ok: boolean; error?: string; estimate?: { base: string; quote: string; fee: string; slippageBps: number; average: string | null } } {
    const prepared = this.prepare(request);
    if (!prepared.ok) return prepared;
    return {
      ok: true,
      estimate: {
        base: formatTrim(prepared.base),
        quote: formatTrim(prepared.quote),
        fee: formatTrim(prepared.fee),
        slippageBps: prepared.slippageBps,
        average: prepared.average ? formatTrim(prepared.average) : null,
      },
    };
  }

  saveRisk(limits: RiskLimits): void {
    this.store.setSetting("risk", JSON.stringify({ ...DEFAULT_RISK_LIMITS, ...limits, limitCurrency: "ZAR" }));
    this.store.setSetting("risk_saved_at", String(this.now()));
  }

  setPaused(paused: boolean): void {
    this.store.setSetting("paused", paused ? "1" : "0");
  }

  selectMarket(marketId: string): void {
    const market = this.store.listMarkets().find((item) => item.marketId === marketId);
    if (!market) throw new Error("Unknown market. Refresh discovery before selecting it.");
    this.store.setSetting("selected_market", marketId);
  }

  setMode(mode: "paper" | "assisted_live" | "automatic_live", confirmation?: string, keyHint?: string): { account: string; markets: string[]; exposure: string } {
    if (mode === "paper") {
      this.store.setSetting("mode", "paper");
      return { account: "paper", markets: [], exposure: this.risk().maxExposureQuote };
    }
    if (this.options.demo) {
      throw new Error("Demo mode cannot enable live trading. Set SIGNALFORGE_DEMO=0 only after credentials and risk limits are ready.");
    }
    if (!this.options.lunoKeyId || !this.options.lunoKeySecret) throw new Error("Live trading requires a Luno API key id and secret on the server.");
    if (!this.store.getSetting("risk_saved_at")) throw new Error("Save risk limits before enabling live trading.");
    if (confirmation !== "ENABLE LIVE TRADING") throw new Error("Confirmation phrase must be ENABLE LIVE TRADING.");
    const hint = this.options.lunoKeyId.slice(-4);
    if (keyHint !== hint) throw new Error("The key hint does not match the configured Luno API key.");
    this.store.setSetting("mode", mode);
    this.store.setSetting("live_confirmed_at", String(this.now()));
    const markets = this.permittedMarkets();
    return { account: `Luno key …${hint}`, markets, exposure: `${this.risk().maxExposureQuote} ZAR` };
  }

  async cancel(clientOrderId: string): Promise<{ ok: boolean; error?: string }> {
    const order = this.store.orderByClientId(clientOrderId);
    if (!order) return { ok: false, error: "Order not found" };
    if (order.mode === "paper" || order.order_type === "BACKEND_STOP") {
      this.store.updateOrder(order.id, { status: "cancelled" });
      return { ok: true };
    }
    if (!order.exchange_order_id || !this.luno.cancelOrder) return { ok: false, error: "Exchange order id is not known yet. It was not cancelled." };
    const success = await this.luno.cancelOrder(order.exchange_order_id);
    if (!success) return { ok: false, error: "Luno did not confirm cancellation." };
    this.store.updateOrder(order.id, { status: "cancelled" });
    return { ok: true };
  }

  async cancelOpen(): Promise<{ cancelled: number }> {
    let cancelled = 0;
    for (const order of this.store.openOrders()) {
      const result = await this.cancel(order.client_order_id);
      if (result.ok) cancelled += 1;
    }
    return { cancelled };
  }

  async sellHoldings(marketId: string, confirmation: string): Promise<{ ok: boolean; error?: string }> {
    if (confirmation !== "SELL HOLDINGS") return { ok: false, error: "Type SELL HOLDINGS to sell the paper or live position. Cancelling orders does not do this." };
    const qty = this.positionQty(marketId);
    if (qty <= 0n) return { ok: false, error: "No holdings to sell." };
    return this.execute({
      marketId,
      side: "SELL",
      type: "MARKET",
      baseVolume: formatTrim(qty),
      source: "sell-holdings",
      isExit: true,
      confirmLive: true,
    });
  }

  async confirmProposal(id: number): Promise<{ ok: boolean; error?: string }> {
    const proposal = this.store.proposal(id);
    if (!proposal || proposal.status !== "pending") return { ok: false, error: "Proposal is not pending." };
    const result = await this.execute({
      marketId: proposal.market_id,
      side: proposal.side === "SELL" ? "SELL" : "BUY",
      type: "LIMIT",
      baseVolume: proposal.base_volume,
      price: proposal.price ?? undefined,
      timeInForce: "IOC",
      confirmLive: true,
      source: "grok-confirmed",
    });
    this.store.resolveProposal(id, result.ok ? "confirmed" : "failed");
    return result;
  }

  rejectProposal(id: number): void {
    this.store.resolveProposal(id, "rejected");
  }

  view(): Record<string, unknown> {
    const now = this.now();
    const marketId = this.selected();
    const markets = this.store.listMarkets();
    const tickerByPair = new Map(this.tickers.map((ticker) => [ticker.pair, ticker]));
    const zarPairs: Record<string, { bid: string; ask: string } | undefined> = {};
    for (const ticker of this.tickers) {
      if (ticker.pair.endsWith("ZAR") || ticker.pair.endsWith("USDT")) zarPairs[ticker.pair] = { bid: ticker.bid, ask: ticker.ask };
    }
    const paper = this.paper();
    const selectedTicker = tickerByPair.get(marketId);
    const bid = selectedTicker ? parseDecimal(selectedTicker.bid) : 0n;
    const equity = this.equity(paper, tickerByPair);
    const peak = parseDecimal(paper.peakEquity || "0");
    const nextPeak = equity > peak ? equity : peak;
    const watch = markets
      .filter((market) => market.counterCurrency === "ZAR" || market.marketId === marketId)
      .map((market) => {
        const ticker = tickerByPair.get(market.marketId);
        const last = ticker ? parseDecimal(ticker.lastTrade) : 0n;
        const zar = ticker ? toZar({ amount: last, currency: market.counterCurrency, zarPairs }) : { amount: null, quality: "unavailable" as const, note: "No ticker" };
        return {
          id: market.marketId,
          base: market.baseCurrency,
          counter: market.counterCurrency,
          status: market.tradingStatus,
          bid: ticker?.bid ?? null,
          ask: ticker?.ask ?? null,
          last: ticker?.lastTrade ?? null,
          volume24h: ticker?.rolling24HourVolume ?? null,
          ageMs: ticker ? now - ticker.timestamp : null,
          zar: ticker && market.counterCurrency === "ZAR" ? { amount: ticker.lastTrade, quality: "exact", note: "Quoted in ZAR." } : zar,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const observations = this.store.recentObservations(marketId, 180).slice().reverse();
    const analyses = this.store.recentAnalyses(30);
    const comparison = this.comparison(observations, analyses);
    const positionRows = Object.entries(paper.positions)
      .filter(([, position]) => parseDecimal(position.qty) > 0n)
      .map(([id, position]) => {
        const market = markets.find((item) => item.marketId === id);
        const mark = tickerByPair.get(id)?.bid ?? null;
        const unrealized = mark ? formatTrim(unrealizedPnl({ ...emptyPortfolio(), qty: parseDecimal(position.qty), avgCost: parseDecimal(position.avgCost) }, parseDecimal(mark))) : null;
        return { marketId: id, qty: position.qty, avgCost: position.avgCost, unrealized, mark, counter: market?.counterCurrency ?? "" };
      });
    return {
      now,
      product: "SignalForge",
      demo: this.options.demo,
      mode: this.mode(),
      paused: this.paused(),
      modeNote: this.options.demo
        ? "DEMO MODE. Public Luno data and a simulated ZAR wallet. Live trading is unavailable."
        : this.mode() === "paper"
          ? "PAPER. Orders are simulated against the live book and are not sent to Luno."
          : this.mode() === "assisted_live"
            ? "ASSISTED LIVE. Strategy orders wait for confirmation. Manual live orders still require an explicit confirm."
            : "AUTOMATIC LIVE. The backend can submit orders inside the saved risk limits.",
      feed: {
        status: this.feedError && this.stale ? "down" : this.stale ? "stale" : "healthy",
        ageMs: this.feedOkAt ? now - this.feedOkAt : null,
        source: "Luno REST order book and tickers",
        lastError: this.feedError,
        stale: this.stale,
        bookTimestamp: this.book?.timestamp ?? null,
      },
      connections: {
        lunoPublic: this.feedError ? "error" : this.tickers.length ? "connected" : "starting",
        lunoAuth: this.options.lunoKeyId ? "configured" : "not configured",
        grok: this.analyst.configured ? `configured (${this.analyst.model})` : "not configured — demo rules engine",
        stream: this.options.lunoKeyId ? "available when the engine holds the market socket" : "requires API credentials; REST polling is in use",
      },
      warnings: this.warnings(paper),
      selectedMarket: marketId,
      markets: watch,
      book: this.book
        ? { bids: this.book.bids.slice(0, 12), asks: this.book.asks.slice(0, 12), spreadBps: spreadBps(this.book), timestamp: this.book.timestamp }
        : null,
      trades: this.trades.slice(0, 30),
      candles: { source: this.candleSource, items: this.candles },
      balances: this.mode() === "paper" || this.options.demo
        ? [{ currency: "ZAR", balance: paper.cashZar, available: paper.cashZar, source: "paper" }]
        : this.exchangeBalances.map((row) => ({ ...row, source: "luno" })),
      positions: positionRows,
      exposure: {
        used: formatTrim(this.exposure(paper, tickerByPair)),
        max: this.risk().maxExposureQuote,
        currency: "ZAR",
      },
      analyses: analyses.map((row) => ({
        id: row.id,
        ts: row.ts,
        source: row.source,
        model: row.model,
        action: row.action,
        status: row.status,
        reason: row.reject_reason,
        expiresAt: row.expires_at,
        costUsd: row.estimated_cost_usd,
        costNote: row.cost_note,
        proposal: row.raw_json ? safeParse(row.raw_json) : null,
      })),
      proposals: this.store.recentProposals(),
      orders: this.store.listOrders(40),
      fills: this.store.recentFills(40),
      performance: {
        equity: formatTrim(equity),
        tradingPnl: formatTrim(tradingPnl(this.asPortfolio(paper, marketId), bid)),
        realized: paper.realized,
        unrealized: selectedTicker ? formatTrim(unrealizedPnl(this.asPortfolio(paper, marketId), bid)) : null,
        fees: paper.fees,
        drawdown: formatTrim(drawdown(equity, nextPeak === 0n ? equity : nextPeak)),
        grokCostUsd: paper.grokCostUsd,
        grokCostNote: "Estimated from published xAI token prices. Unknown models are excluded rather than guessed.",
        deposits: paper.deposits,
        withdrawals: paper.withdrawals,
        seed: paper.seed,
        comparison,
      },
      risk: {
        limits: this.risk(),
        summary: describeLimits(this.risk()),
        saved: Boolean(this.store.getSetting("risk_saved_at")),
        tradesToday: paper.tradesToday,
        dailyRealized: paper.dailyRealized,
        cooldownUntil: paper.cooldownUntil,
        failures: paper.failures,
      },
      account: {
        keyHint: this.options.lunoKeyId ? `…${this.options.lunoKeyId.slice(-4)}` : null,
        permittedMarkets: this.permittedMarkets(),
        maxExposure: `${this.risk().maxExposureQuote} ZAR`,
        permissions: "Requested key permissions are view balance, view orders, and create orders only. Withdrawals are not implemented.",
      },
      executionNote:
        "Luno supports limit, market, and stop-limit orders. SignalForge can place stop-limit orders on the exchange in live mode. Paper and fallback exits are backend-managed: they need this process to stay online and cannot guarantee the fill price.",
    };
  }

  private async refreshMarkets(now: number): Promise<void> {
    if (this.marketsAt && now - this.marketsAt < 60_000) return;
    const markets = await this.luno.getMarkets();
    this.store.upsertMarkets(markets, now);
    this.marketsAt = now;
    if (!this.store.getSetting("selected_market") && markets.some((market) => market.marketId === "XBTZAR")) {
      this.store.setSetting("selected_market", "XBTZAR");
    }
  }

  private async maybeAnalyze(marketId: string, ticker: Ticker, book: OrderBook, now: number): Promise<void> {
    const last = this.store.latestAnalysis(marketId);
    const price = parseDecimal(ticker.lastTrade);
    const due = shouldRequestAnalysis({
      nowMs: now,
      lastAtMs: last?.ts ?? null,
      lastPrice: last ? priceFromSnapshot(last.snapshot_json) : null,
      price,
      intervalMs: this.options.analysisIntervalMs,
      moveBps: this.options.analysisMoveBps,
      inFlight: false,
      expiresAtMs: last?.expires_at ?? null,
    });
    if (!due) return;
    const market = this.market(marketId);
    if (!market) return;
    const closes = this.store.recentObservations(marketId, 60).map((row) => row.last_trade).reverse();
    const stats = indicators(closes);
    const holdings = this.positionQty(marketId);
    const snapshot = buildSnapshot({
      capturedAtMs: now,
      market,
      bid: ticker.bid,
      ask: ticker.ask,
      last: ticker.lastTrade,
      spreadBps: spreadBps(book),
      volume24h: ticker.rolling24HourVolume,
      bidDepthQuote: formatTrim(topDepth(book.bids, 5)),
      askDepthQuote: formatTrim(topDepth(book.asks, 5)),
      closes,
      sma20: stats.sma20,
      sma50: stats.sma50,
      volatility: stats.sampleVolatility,
      positionBase: formatTrim(holdings),
      avgCost: this.paper().positions[marketId]?.avgCost ?? null,
      permittedActions: holdings > 0n ? ["BUY", "SELL", "HOLD"] : ["BUY", "HOLD"],
      limits: { ...this.risk() },
      warnings: this.stale ? ["Book or ticker is stale."] : [],
      stale: this.stale,
      defaultOrderBase: market.minVolume,
    });
    const hash = createHash("sha256").update(canonicalSnapshot(snapshot)).digest("hex");
    if (last && last.input_hash === hash && last.expires_at && last.expires_at > now && last.status === "accepted") return;
    if (this.stale) {
      const fallback = holdFallback("Market data is stale, so no model was called and the action is HOLD.", now);
      this.store.insertAnalysis(analysisRecord(marketId, now, "hold-fallback", null, snapshot, fallback, "rejected", fallback.rationale, hash));
      return;
    }
    let raw: unknown;
    let source = "demo-rules";
    let model: string | null = null;
    let usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedCostUsd: "0", costKnown: true, costNote: "No model call." };
    try {
      if (!this.analyst.configured) {
        raw = demoRulesProposal({
          nowMs: now,
          closes,
          sma20: stats.sma20,
          sma50: stats.sma50,
          hasPosition: holdings > 0n,
          stale: false,
          spreadBps: spreadBps(book),
          minVolume: market.minVolume,
        });
      } else {
        const response = await this.analyst.analyze(snapshot);
        raw = response.raw;
        source = "grok";
        model = response.model;
        usage = response.usage;
      }
    } catch {
      raw = holdFallback("The analysis API failed. The action defaults to HOLD. Existing orders stay under deterministic management.", now);
      source = "hold-fallback";
    }
    const validated = validateAnalysis(raw, {
      nowMs: now,
      capturedAtMs: now,
      stale: false,
      market,
      last: price,
      permitted: holdings > 0n ? ["BUY", "SELL", "HOLD"] : ["BUY", "HOLD"],
      holdingsBase: holdings,
      maxAgeMs: this.risk().staleAfterMs,
    });
    if (!validated.ok) {
      const fallback = holdFallback(validated.reason, now);
      this.store.insertAnalysis(analysisRecord(marketId, now, source === "grok" ? "grok" : source, model, snapshot, fallback, "rejected", validated.reason, hash, usage));
      return;
    }
    const id = this.store.insertAnalysis(analysisRecord(marketId, now, source, model, snapshot, validated.proposal, "accepted", null, hash, usage));
    if (usage.costKnown && usage.estimatedCostUsd !== "0") {
      const paper = this.paper();
      paper.grokCostUsd = formatTrim(add(parseDecimal(paper.grokCostUsd || "0"), parseDecimal(usage.estimatedCostUsd)));
      this.savePaper(paper);
    }
    if (validated.proposal.action === "HOLD" || this.paused()) return;
    if (this.mode() === "assisted_live") {
      const desired = validated.proposal.suggested_base_volume ?? market.minVolume;
      this.store.insertProposal({
        analysisId: id,
        marketId,
        side: validated.proposal.action,
        price: ticker.ask,
        baseVolume: desired,
        reason: validated.proposal.rationale,
      });
      return;
    }
    const desired = parseDecimal(validated.proposal.suggested_base_volume ?? market.minVolume);
    const planned = planMarketableOrder({
      side: validated.proposal.action,
      book,
      market,
      desiredBase: desired,
      maxSlippageBps: this.risk().maxSlippageBps,
      feeRate: this.feeRate(market, "taker"),
    });
    if (!planned.ok) return;
    await this.execute({
      marketId,
      side: planned.plan.side,
      type: "LIMIT",
      baseVolume: planned.plan.baseVolume,
      price: planned.plan.limitPrice,
      timeInForce: "IOC",
      confirmLive: true,
      source: source === "grok" ? "grok" : "demo-rules",
      isExit: validated.proposal.action === "SELL",
    });
    if (validated.proposal.action === "BUY" && validated.proposal.exit_conditions.stop_loss_price) {
      this.armBackendStop(marketId, validated.proposal.exit_conditions.stop_loss_price, this.positionQty(marketId));
    }
  }

  private async execute(request: ManualRequest): Promise<{ ok: boolean; error?: string; orderId?: number }> {
    const prepared = this.prepare(request);
    if (!prepared.ok) return prepared;
    const mode = this.mode();
    if (mode !== "paper" && !request.confirmLive) {
      return { ok: false, error: "Live submission requires confirmLive. Automatic strategy orders set this only after risk checks." };
    }
    const clientOrderId = request.clientOrderId ?? newClientId();
    const known = this.store.knownClientIds();
    if (claimClientOrderId(known, this.inflight, clientOrderId) === "duplicate") {
      return { ok: false, error: "Duplicate client order id. The existing order was kept and nothing new was submitted." };
    }
    const now = this.now();
    const orderId = this.store.insertOrder({
      client_order_id: clientOrderId,
      exchange_order_id: null,
      market_id: request.marketId,
      mode,
      side: request.side,
      order_type: request.type,
      time_in_force: request.timeInForce ?? (request.type === "MARKET" ? "IOC" : "GTC"),
      post_only: request.postOnly ? 1 : 0,
      price: request.price ?? (prepared.average ? formatTrim(prepared.average) : null),
      stop_price: null,
      stop_direction: null,
      base_volume: formatTrim(prepared.base),
      remaining_base: formatTrim(prepared.base),
      counter_budget: request.quoteBudget ?? formatTrim(prepared.quote),
      filled_base: "0",
      filled_counter: "0",
      fee_quote: "0",
      status: mode === "paper" ? "delayed" : "submitting",
      source: request.source ?? "manual",
      is_exit: request.isExit ? 1 : 0,
      eligible_at: now + (mode === "paper" ? this.options.paperDelayMs : 0),
      created_at: now,
      updated_at: now,
      last_error: null,
    });
    if (mode === "paper") {
      if (this.book) await this.advancePaper(now, this.book, this.tickers.find((ticker) => ticker.pair === request.marketId)?.lastTrade ?? null);
      this.inflight.delete(clientOrderId);
      return { ok: true, orderId };
    }
    const outcome = await submitWithReconcile({
      clientOrderId,
      post: async () => {
        if (request.type === "MARKET") {
          if (!this.luno.postMarketOrder) throw new Error("Market orders are not available on this gateway");
          const fields: Record<string, string> = { pair: request.marketId, type: request.side, client_order_id: clientOrderId };
          if (request.side === "BUY") fields.counter_volume = request.quoteBudget ?? formatTrim(prepared.quote);
          else fields.base_volume = formatTrim(prepared.base);
          return this.luno.postMarketOrder(fields);
        }
        if (!this.luno.postLimitOrder || !request.price) throw new Error("Limit orders require a price");
        return this.luno.postLimitOrder({
          pair: request.marketId,
          type: request.side === "BUY" ? "BID" : "ASK",
          volume: formatTrim(prepared.base),
          price: request.price,
          time_in_force: request.timeInForce ?? "GTC",
          post_only: request.postOnly ? "true" : "false",
          client_order_id: clientOrderId,
        });
      },
      lookup: async () => {
        if (!this.luno.getOrderByClientId) throw new Error("Lookup unavailable");
        return this.luno.getOrderByClientId(clientOrderId);
      },
    });
    this.inflight.delete(clientOrderId);
    this.store.updateOrder(orderId, {
      status: outcome.status === "open" || outcome.status === "duplicate" ? "open" : outcome.status,
      exchange_order_id: outcome.exchangeOrderId ?? null,
      last_error: outcome.reason ?? null,
    });
    if (outcome.status === "rejected") {
      const paper = this.paper();
      paper.failures += 1;
      if (paper.failures >= this.risk().failuresBeforeCooldown) paper.cooldownUntil = this.now() + this.risk().failureCooldownMs;
      this.savePaper(paper);
    }
    return { ok: outcome.status === "open" || outcome.status === "duplicate", error: outcome.reason, orderId };
  }

  private prepare(request: ManualRequest):
    | { ok: false; error: string }
    | { ok: true; base: Amount; quote: Amount; fee: Amount; slippageBps: number; average: Amount | null; market: MarketInfo } {
    if (this.paused() && !request.isExit) {
      return { ok: false, error: "New trades are paused. Resume trading before submitting another order." };
    }
    const market = this.market(request.marketId);
    if (!market) return { ok: false, error: "Market is not in the discovered Luno market list." };
    if (this.mode() === "paper" && market.counterCurrency !== "ZAR") {
      return { ok: false, error: "The paper wallet is funded in ZAR. Choose a ZAR market or use a funded live account for this pair." };
    }
    if (!this.book || this.selected() !== request.marketId) return { ok: false, error: "Order book for this market is not loaded." };
    if (!isSpotMarket(market)) return { ok: false, error: "Market is not open for spot trading." };
    if (market.tradingStatus === "POST_ONLY" && !request.postOnly) return { ok: false, error: "Market is in post-only mode." };
    const feeRate = this.feeRate(market, request.postOnly ? "maker" : "taker");
    let base = 0n;
    let quote = 0n;
    let slippageBps = 0;
    let average: Amount | null = null;
    if (request.side === "BUY" && request.type === "MARKET") {
      const budget = parseDecimal(request.quoteBudget ?? "0");
      const walked = walkBuyCounter(this.book.asks, budget);
      base = walked.base;
      quote = walked.counter;
      slippageBps = walked.slippageBps;
      average = walked.averagePrice;
    } else if (request.side === "SELL" && request.type === "MARKET") {
      base = parseDecimal(request.baseVolume ?? "0");
      const walked = walkSellBase(this.book.bids, base);
      base = walked.base;
      quote = walked.counter;
      slippageBps = walked.slippageBps;
      average = walked.averagePrice;
    } else {
      base = parseDecimal(request.baseVolume ?? "0");
      const limit = request.price ? parseDecimal(request.price) : null;
      if (!limit) return { ok: false, error: "Limit orders require a price." };
      const walked = request.side === "BUY" ? walkBuyCounter(this.book.asks, mul(limit, base), limit) : walkSellBase(this.book.bids, base, limit);
      quote = walked.counter > 0n ? walked.counter : mul(limit, base);
      slippageBps = walked.slippageBps;
      average = walked.averagePrice ?? limit;
      if (walked.base > 0n) base = request.timeInForce === "GTC" ? parseDecimal(request.baseVolume ?? "0") : walked.base;
    }
    const checked = checkVolume(market, base);
    if (!checked.ok) return { ok: false, error: checked.reason ?? "Volume rejected" };
    const fee = mul(quote, feeRate);
    const paper = this.paper();
    const tickerMap = new Map(this.tickers.map((ticker) => [ticker.pair, ticker]));
    const live = this.mode() !== "paper";
    const exposure = live ? this.liveExposure() : this.exposure(paper, tickerMap);
    const cash = live ? this.exchangeAmount(market.counterCurrency) : parseDecimal(paper.cashZar);
    const assessment = assessOrder({
      limits: this.risk(),
      now: this.now(),
      side: request.side,
      isExit: Boolean(request.isExit),
      orderQuoteNotional: quote,
      projectedExposureQuote: request.side === "BUY" ? add(exposure, quote) : exposure,
      dailyRealizedPnl: parseDecimal(paper.dailyRealized || "0"),
      tradesToday: paper.tradesToday,
      cashAfterQuote: request.side === "BUY" ? cash - quote - (fee > 0n ? fee : 0n) : cash,
      spreadBps: spreadBps(this.book),
      slippageBps,
      depthQuote: topDepth(request.side === "BUY" ? this.book.asks : this.book.bids, 5),
      openOrders: this.store.openOrders().length,
      cooldownUntil: paper.cooldownUntil,
      dataStale: this.stale,
      feedHealthy: !this.stale && !this.feedError,
      sellBase: request.side === "SELL" ? base : 0n,
      holdingsBase: live ? this.exchangeAmount(market.baseCurrency) : this.positionQty(request.marketId),
      marketTradable: isSpotMarket(market),
      zarConversion: market.counterCurrency === "ZAR" ? "exact" : "unavailable",
    });
    if (!assessment.ok) return { ok: false, error: assessment.reasons.join(" ") };
    return { ok: true, base, quote, fee, slippageBps, average, market };
  }

  private async advancePaper(now: number, book: OrderBook, lastTrade: string | null): Promise<void> {
    for (const order of this.store.openOrders()) {
      if (order.mode !== "paper" || order.order_type === "BACKEND_STOP") continue;
      if (order.market_id !== this.selected()) continue;
      const paperOrder: PaperOrder = {
        clientOrderId: order.client_order_id,
        side: order.side === "SELL" ? "SELL" : "BUY",
        type: order.order_type === "MARKET" ? "MARKET" : "LIMIT",
        timeInForce: order.time_in_force === "FOK" || order.time_in_force === "IOC" ? order.time_in_force : "GTC",
        postOnly: order.post_only === 1,
        price: order.price,
        stopPrice: order.stop_price,
        stopDirection: order.stop_direction === "ABOVE" || order.stop_direction === "BELOW" ? order.stop_direction : null,
        remainingBase: order.remaining_base,
        counterBudget: order.counter_budget,
        status: order.status as PaperOrder["status"],
        eligibleAt: order.eligible_at,
        triggered: false,
        resting: order.status === "open" || order.status === "partial",
      };
      const market = this.market(order.market_id);
      const taker = market ? this.feeRate(market, "taker") : parseDecimal("0.006");
      const maker = market ? this.feeRate(market, "maker") : parseDecimal("0.004");
      const step = advancePaperOrder(paperOrder, book, now, taker, maker, lastTrade);
      if (step.fills.length === 0 && step.order.status === order.status) continue;
      this.applyFills(order, step.fills, step.order.status, step.reason ?? null);
    }
  }

  private applyFills(order: OrderRow, fills: { price: string; base: string; counter: string; feeQuote: string; liquidity: string }[], status: string, error: string | null): void {
    let paper = this.paper();
    let portfolio = this.asPortfolio(paper, order.market_id);
    let filledBase = parseDecimal(order.filled_base);
    let filledCounter = parseDecimal(order.filled_counter);
    let fees = parseDecimal(order.fee_quote);
    for (const fill of fills) {
      const qty = parseDecimal(fill.base);
      const price = parseDecimal(fill.price);
      const counter = parseDecimal(fill.counter);
      const fee = parseDecimal(fill.feeQuote);
      const rate = counter === 0n ? 0n : div(fee, counter);
      const before = portfolio.realized;
      portfolio = order.side === "SELL" ? applySell(portfolio, qty, price, rate) : applyBuy(portfolio, qty, price, rate);
      const delta = portfolio.realized - before;
      paper = this.bumpDaily(paper, delta);
      filledBase = add(filledBase, qty);
      filledCounter = add(filledCounter, counter);
      fees = add(fees, fee);
      this.store.insertFill({ orderId: order.id, ts: this.now(), price: fill.price, base: fill.base, counter: fill.counter, fee: fill.feeQuote, liquidity: fill.liquidity });
      this.store.insertLedger({ ts: this.now(), currency: "ZAR", amount: order.side === "BUY" ? `-${fill.counter}` : fill.counter, kind: "trade", ref: order.client_order_id });
      if (fee !== 0n) this.store.insertLedger({ ts: this.now(), currency: "ZAR", amount: fee > 0n ? `-${fill.feeQuote}` : fill.feeQuote, kind: "fee", ref: order.client_order_id });
    }
    paper = this.writePortfolio(paper, order.market_id, portfolio);
    if (!order.is_exit && fills.length > 0) {
      paper.tradesToday += 1;
    }
    this.savePaper(paper);
    this.store.updateOrder(order.id, {
      status,
      remaining_base: status === "filled" ? "0" : formatTrim(parseDecimal(order.base_volume) - filledBase > 0n ? parseDecimal(order.base_volume) - filledBase : 0n),
      filled_base: formatTrim(filledBase),
      filled_counter: formatTrim(filledCounter),
      fee_quote: formatTrim(fees),
      last_error: error,
    });
  }

  private async reconcileLive(marketId: string): Promise<void> {
    if (!this.options.lunoKeyId) return;
    const live = this.store.openOrders().filter((order) => order.mode !== "paper" && order.market_id === marketId);
    for (const order of live) {
      if (order.status !== "ambiguous" && order.status !== "submitting") continue;
      if (!this.luno.getOrderByClientId) continue;
      try {
        const remote = await this.luno.getOrderByClientId(order.client_order_id);
        if (!remote) this.store.updateOrder(order.id, { status: "not_placed", last_error: "No exchange order after an ambiguous submit. Not retried." });
        else this.store.updateOrder(order.id, { status: remote.baseFilled !== "0" ? "partial" : "open", exchange_order_id: remote.exchangeOrderId, filled_base: remote.baseFilled });
      } catch {
        this.store.updateOrder(order.id, { status: "ambiguous", last_error: "Lookup failed. Order remains ambiguous and will not be duplicated." });
      }
    }
    if (!this.luno.listOpenOrders) return;
    try {
      const remote = await this.luno.listOpenOrders(marketId);
      const local = this.store.openOrders().filter((order) => order.mode !== "paper" && order.status !== "ambiguous" && order.status !== "submitting");
      const result = reconcileOrders(
        local.map((order) => ({
          clientOrderId: order.client_order_id,
          exchangeOrderId: order.exchange_order_id,
          status: order.status as "open",
          baseVolume: order.base_volume,
          filledBase: order.filled_base,
        })),
        remote,
      );
      for (const update of result.updates) {
        const order = this.store.orderByClientId(update.clientOrderId);
        if (!order || update.submit) continue;
        this.store.updateOrder(order.id, { status: update.status, exchange_order_id: update.exchangeOrderId, filled_base: update.filledBase });
      }
    } catch (error) {
      this.feedError = error instanceof Error ? error.message : "Order reconciliation failed";
    }
  }

  private async fireStops(ticker: Ticker | null, book: OrderBook | null): Promise<void> {
    if (!ticker || !book || this.stale) return;
    const last = parseDecimal(ticker.lastTrade);
    for (const order of this.store.openOrders()) {
      if (order.order_type !== "BACKEND_STOP" || order.status !== "awaiting_trigger" || !order.stop_price) continue;
      const stop = parseDecimal(order.stop_price);
      const hit = order.stop_direction === "ABOVE" ? last >= stop : last <= stop;
      if (!hit) continue;
      this.store.updateOrder(order.id, { status: "cancelled", last_error: "Stop triggered. A separate exit order was requested." });
      await this.execute({
        marketId: order.market_id,
        side: "SELL",
        type: "MARKET",
        baseVolume: order.remaining_base,
        source: "backend-stop",
        isExit: true,
        confirmLive: true,
      });
    }
  }

  private armBackendStop(marketId: string, stopPrice: string, qty: Amount): void {
    if (qty <= 0n) return;
    if (this.store.openOrders().some((order) => order.order_type === "BACKEND_STOP" && order.market_id === marketId)) return;
    const now = this.now();
    this.store.insertOrder({
      client_order_id: newClientId(),
      exchange_order_id: null,
      market_id: marketId,
      mode: this.mode(),
      side: "SELL",
      order_type: "BACKEND_STOP",
      time_in_force: "IOC",
      post_only: 0,
      price: null,
      stop_price: stopPrice,
      stop_direction: "BELOW",
      base_volume: formatTrim(qty),
      remaining_base: formatTrim(qty),
      counter_budget: null,
      filled_base: "0",
      filled_counter: "0",
      fee_quote: "0",
      status: "awaiting_trigger",
      source: "backend-stop",
      is_exit: 1,
      eligible_at: now,
      created_at: now,
      updated_at: now,
      last_error: "Backend-managed stop. It runs only while this engine is connected and does not guarantee price.",
    });
  }

  private async loadCandles(marketId: string, now: number): Promise<void> {
    if (this.luno.getCandles && this.options.lunoKeyId) {
      try {
        const candles = await this.luno.getCandles(marketId, now - 24 * 60 * 60 * 1000, 300);
        if (candles && candles.length) {
          this.candles = candles.map((candle) => ({ ...candle, source: "luno" }));
          this.candleSource = "Luno GET /api/exchange/1/candles (authenticated).";
          return;
        }
      } catch {
        this.candleSource = "Exchange candles unavailable. Chart uses candles derived from stored ticker observations.";
      }
    }
    const points = this.store.recentObservations(marketId, 240).map((row) => ({ ts: row.ts, price: row.last_trade })).reverse();
    this.candles = aggregateCandles(points, 60);
    this.candleSource = this.options.lunoKeyId
      ? "Derived from stored observations because exchange candles failed."
      : "Derived from polled tickers. Luno candles require authentication and returned 401 without a key.";
  }

  private comparison(
    observations: { ts: number; bid: string | null; ask: string | null; last_trade: string | null; book_json: string }[],
    analyses: { ts: number; action: string | null; status: string }[],
  ): unknown {
    const points = observations.filter((row) => row.bid && row.ask && row.last_trade);
    if (points.length < 2) return { note: "Not enough stored observations to compare strategies.", strategy: [], baseline: [], buyHold: [] };
    const actions = points.map((point) => {
      const prior = [...analyses].reverse().filter((row) => row.ts <= point.ts && row.status === "accepted" && row.action);
      const action = prior.length ? prior[prior.length - 1]?.action : "HOLD";
      return action === "BUY" || action === "SELL" ? action : "HOLD";
    });
    try {
      return compareStrategies({
        points: points.map((point) => {
          const book = safeParse(point.book_json) as { bids?: { price: string; volume: string }[]; asks?: { price: string; volume: string }[] } | null;
          return {
            ts: point.ts,
            bid: point.bid ?? "0",
            ask: point.ask ?? "0",
            last: point.last_trade ?? "0",
            bids: book?.bids,
            asks: book?.asks,
          };
        }),
        strategyActions: actions,
        seed: this.options.paperSeedZar,
        orderNotional: this.risk().maxOrderQuote,
        feeRate: publishedZaTier1("XBT", "ZAR").takerRate,
      });
    } catch (error) {
      return { note: error instanceof Error ? error.message : "Comparison failed", strategy: [], baseline: [], buyHold: [] };
    }
  }

  private market(marketId: string): MarketInfo | null {
    return this.store.listMarkets().find((market) => market.marketId === marketId) ?? null;
  }

  private permittedMarkets(): string[] {
    return this.store
      .listMarkets()
      .filter((market) => market.counterCurrency === "ZAR" && market.tradingStatus === "ACTIVE")
      .map((market) => market.marketId);
  }

  private async refreshFee(marketId: string): Promise<void> {
    if (!this.options.lunoKeyId || !this.luno.getFeeInfo) return;
    const cached = this.feeCache.get(marketId);
    if (cached && this.now() - cached.at < 15 * 60 * 1000) return;
    try {
      const info = await this.luno.getFeeInfo(marketId);
      if (info) this.feeCache.set(marketId, { maker: info.maker, taker: info.taker, at: this.now() });
    } catch {
      // Keep the published schedule. A fee lookup must not mark the public book unhealthy.
    }
  }

  private feeRate(market: MarketInfo, kind: "taker" | "maker"): Amount {
    const published = publishedZaTier1(market.baseCurrency, market.counterCurrency);
    const cached = this.feeCache.get(market.marketId);
    const quote = cached ? accountFeeOrPublished(published, cached) : published;
    const paper = this.paper();
    if (paper.feeNote !== quote.note) {
      paper.feeNote = quote.note;
      this.savePaper(paper);
    }
    return parseDecimal(kind === "taker" ? quote.takerRate : quote.makerRate);
  }

  private positionQty(marketId: string): Amount {
    return parseDecimal(this.paper().positions[marketId]?.qty ?? "0");
  }

  private exchangeAmount(currency: string): Amount {
    const row = this.exchangeBalances.find((balance) => balance.currency === currency);
    return parseDecimal(row?.available ?? "0");
  }

  private liveExposure(): Amount {
    let total = 0n;
    for (const row of this.exchangeBalances) {
      if (row.currency === "ZAR") continue;
      const ticker = this.tickers.find((item) => item.pair === `${row.currency}ZAR`);
      if (!ticker) continue;
      total = add(total, mul(parseDecimal(row.available), parseDecimal(ticker.bid)));
    }
    return total;
  }

  private exposure(paper: PaperState, tickers: Map<string, Ticker>): Amount {
    let total = 0n;
    for (const [marketId, position] of Object.entries(paper.positions)) {
      const ticker = tickers.get(marketId);
      if (!ticker) continue;
      total = add(total, mul(parseDecimal(position.qty), parseDecimal(ticker.bid)));
    }
    return total;
  }

  private equity(paper: PaperState, tickers: Map<string, Ticker>): Amount {
    return add(parseDecimal(paper.cashZar), this.exposure(paper, tickers));
  }

  private ensurePaper(): PaperState {
    const existing = this.store.getSetting("paper");
    if (existing) return JSON.parse(existing) as PaperState;
    const seeded = seedCash(emptyPortfolio(), parseDecimal(this.options.paperSeedZar));
    const state: PaperState = {
      cashZar: formatTrim(seeded.cashQuote),
      seed: formatTrim(seeded.seed),
      deposits: "0",
      withdrawals: "0",
      realized: "0",
      fees: "0",
      grokCostUsd: "0",
      peakEquity: formatTrim(seeded.cashQuote),
      positions: {},
      failures: 0,
      lossStreak: 0,
      cooldownUntil: 0,
      day: new Date(this.now()).toISOString().slice(0, 10),
      tradesToday: 0,
      dailyRealized: "0",
      feeNote: "",
    };
    this.savePaper(state);
    this.store.insertLedger({ ts: this.now(), currency: "ZAR", amount: state.seed, kind: "paper_seed", note: "Simulated starting cash. Excluded from trading P&L." });
    return state;
  }

  private paper(): PaperState {
    return this.ensurePaper();
  }

  private savePaper(state: PaperState): void {
    this.store.setSetting("paper", JSON.stringify(state));
  }

  private asPortfolio(paper: PaperState, marketId: string) {
    const position = paper.positions[marketId] ?? { qty: "0", avgCost: "0", realized: "0", fees: "0" };
    return {
      cashQuote: parseDecimal(paper.cashZar),
      qty: parseDecimal(position.qty),
      avgCost: parseDecimal(position.avgCost),
      realized: parseDecimal(paper.realized),
      fees: parseDecimal(paper.fees),
      deposits: parseDecimal(paper.deposits),
      withdrawals: parseDecimal(paper.withdrawals),
      seed: parseDecimal(paper.seed),
    };
  }

  private writePortfolio(paper: PaperState, marketId: string, portfolio: ReturnType<Trader["asPortfolio"]>): PaperState {
    const current = paper.positions[marketId] ?? { qty: "0", avgCost: "0", realized: "0", fees: "0" };
    const tickers = new Map(this.tickers.map((ticker) => [ticker.pair, ticker]));
    const equity = add(portfolio.cashQuote, this.exposure({ ...paper, cashZar: formatTrim(portfolio.cashQuote), positions: { ...paper.positions, [marketId]: { ...current, qty: formatTrim(portfolio.qty) } } }, tickers));
    const peak = parseDecimal(paper.peakEquity || "0");
    return {
      ...paper,
      cashZar: formatTrim(portfolio.cashQuote),
      realized: formatTrim(portfolio.realized),
      fees: formatTrim(portfolio.fees),
      peakEquity: formatTrim(equity > peak ? equity : peak),
      positions: {
        ...paper.positions,
        [marketId]: { ...current, qty: formatTrim(portfolio.qty), avgCost: formatTrim(portfolio.avgCost) },
      },
    };
  }

  private bumpDaily(paper: PaperState, delta: Amount): PaperState {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const same = paper.day === day;
    const daily = add(parseDecimal(same ? paper.dailyRealized || "0" : "0"), delta);
    let lossStreak = delta < 0n ? paper.lossStreak + 1 : 0;
    let cooldownUntil = paper.cooldownUntil;
    if (lossStreak >= this.risk().lossesBeforeCooldown) cooldownUntil = this.now() + this.risk().lossCooldownMs;
    return { ...paper, day, dailyRealized: formatTrim(daily), lossStreak, cooldownUntil, tradesToday: same ? paper.tradesToday : 0 };
  }

  private warnings(paper: PaperState): string[] {
    const warnings = [
      "Grok output is an untrusted proposal. Orders are submitted only after deterministic validation and risk checks.",
      "Model scores are uncalibrated and are not a probability of profit.",
      "Backend-managed stops need a running engine and cannot guarantee execution price.",
      paper.feeNote || publishedZaTier1("XBT", "ZAR").note,
    ];
    if (!this.analyst.configured) warnings.push("xAI API key is not configured. The analysis feed is the local demo rules engine, not Grok.");
    if (this.options.demo) warnings.push("Demo mode ignores live-trading switches.");
    if (this.stale) warnings.push("Market data is stale. New orders are paused.");
    return warnings;
  }
}

function newClientId(): string {
  return `sf${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

function analysisRecord(
  marketId: string,
  now: number,
  source: string,
  model: string | null,
  snapshot: unknown,
  proposal: { action: string; expires_at: string },
  status: string,
  reason: string | null,
  hash: string,
  usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedCostUsd: "0", costNote: "No model call." },
) {
  return {
    market_id: marketId,
    ts: now,
    source,
    model,
    snapshot_json: JSON.stringify(snapshot),
    raw_json: JSON.stringify(proposal),
    action: proposal.action,
    status,
    reject_reason: reason,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    cached_tokens: usage.cachedTokens,
    estimated_cost_usd: usage.estimatedCostUsd,
    cost_note: usage.costNote,
    expires_at: Date.parse(proposal.expires_at),
    input_hash: hash,
  };
}

function priceFromSnapshot(snapshotJson: string): Amount | null {
  try {
    const snapshot = JSON.parse(snapshotJson) as { price?: { last?: string } };
    return snapshot.price?.last ? parseDecimal(snapshot.price.last) : null;
  } catch {
    return null;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
