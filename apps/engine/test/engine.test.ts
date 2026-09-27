import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketInfo, RemoteOrderRef } from "@signalforge/core";
import { migrate, openDatabase, tryAcquireLock } from "../src/db.js";
import { TimeoutError } from "../src/luno.js";
import { Store } from "../src/store.js";
import { Trader, type Analyst, type MarketGateway } from "../src/trader.js";
import { applySnapshot, applyUpdate, emptyStream, streamBook } from "../src/stream.js";

const market: MarketInfo = {
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

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

function book(timestamp: number) {
  return {
    timestamp,
    bids: [
      { price: "999000", volume: "0.02" },
      { price: "998000", volume: "0.02" },
    ],
    asks: [
      { price: "1000000", volume: "0.02" },
      { price: "1001000", volume: "0.05" },
    ],
  };
}

function gateway(options?: { timestamp?: number; onPost?: () => never; lookup?: RemoteOrderRef | null }): MarketGateway & { posts: number } {
  const api: MarketGateway & { posts: number } = {
    posts: 0,
    async getMarkets() {
      return [market];
    },
    async getTickers() {
      const timestamp = options?.timestamp ?? Date.now();
      return [{ pair: "XBTZAR", bid: "999000", ask: "1000000", lastTrade: "1000000", rolling24HourVolume: "8", status: "ACTIVE", timestamp }];
    },
    async getOrderBook() {
      return book(options?.timestamp ?? Date.now());
    },
    async getTrades() {
      return [];
    },
    async getBalances() {
      return [
        { currency: "ZAR", balance: "50000", available: "50000", accountId: "1" },
        { currency: "XBT", balance: "0", available: "0", accountId: "2" },
      ];
    },
    async getFeeInfo() {
      return null;
    },
    async listOpenOrders() {
      return [];
    },
    async getOrderByClientId(clientOrderId: string) {
      return options?.lookup ? { ...options.lookup, clientOrderId } : null;
    },
    async postLimitOrder() {
      api.posts += 1;
      if (options?.onPost) return options.onPost();
      return { orderId: "BX-LIVE" };
    },
    async postMarketOrder() {
      api.posts += 1;
      if (options?.onPost) return options.onPost();
      return { orderId: "BX-MKT" };
    },
    async cancelOrder() {
      return true;
    },
  };
  return api;
}

const analyst: Analyst = {
  configured: false,
  model: "demo-rules",
  async analyze() {
    throw new Error("demo");
  },
};

function createTrader(luno: MarketGateway, extra?: { analyst?: Analyst; demo?: boolean; key?: string }) {
  const dir = mkdtempSync(path.join(tmpdir(), "signalforge-"));
  const db = openDatabase(path.join(dir, "test.sqlite"));
  migrate(db, migrations);
  const store = new Store(db);
  const trader = new Trader(store, luno, extra?.analyst ?? analyst, {
    demo: extra?.demo ?? true,
    lunoKeyId: extra?.key ?? null,
    lunoKeySecret: extra?.key ? "secret-value" : null,
    xaiKey: null,
    analysisIntervalMs: 900_000,
    analysisMoveBps: 50,
    paperSeedZar: "100000",
    paperDelayMs: 0,
  });
  return { trader, store, db };
}

describe("engine trading controls", () => {
  const closers: { close: () => void }[] = [];
  afterEach(() => {
    for (const closer of closers) closer.close();
    closers.length = 0;
  });

  it("paper-buys at the ask, charges a fee, and refuses a second client id", async () => {
    const luno = gateway();
    const { trader, store, db } = createTrader(luno);
    closers.push({ close: () => db.close() });
    await trader.tick();
    const placed = await trader.placeManual({ marketId: "XBTZAR", side: "BUY", type: "MARKET", quoteBudget: "1000" });
    expect(placed.ok).toBe(true);
    const view = trader.view() as { positions: { qty: string }[]; performance: { fees: string; tradingPnl: string } };
    expect(Number(view.positions[0]?.qty)).toBeCloseTo(0.001, 6);
    expect(Number(view.performance.fees)).toBeGreaterThan(0);
    const again = await trader.placeManual({
      marketId: "XBTZAR",
      side: "BUY",
      type: "MARKET",
      quoteBudget: "1000",
      clientOrderId: store.listOrders()[0]?.client_order_id,
    });
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/Duplicate/);
    expect(luno.posts).toBe(0);
  });

  it("pause blocks new orders and still allows an explicit exit", async () => {
    const { trader, db } = createTrader(gateway());
    closers.push({ close: () => db.close() });
    await trader.tick();
    const buy = await trader.placeManual({ marketId: "XBTZAR", side: "BUY", type: "MARKET", quoteBudget: "1000" });
    expect(buy.ok).toBe(true);
    trader.setPaused(true);
    const blocked = await trader.placeManual({ marketId: "XBTZAR", side: "BUY", type: "MARKET", quoteBudget: "500" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/paused/i);
    const exit = await trader.placeManual({ marketId: "XBTZAR", side: "SELL", type: "MARKET", baseVolume: "0.0005", isExit: true });
    expect(exit.ok).toBe(true);
    expect(exit.error).toBeUndefined();
  });

  it("pauses new orders when market data is stale", async () => {
    const { trader, db } = createTrader(gateway({ timestamp: Date.now() - 60_000 }));
    closers.push({ close: () => db.close() });
    await trader.tick();
    const placed = await trader.placeManual({ marketId: "XBTZAR", side: "BUY", type: "MARKET", quoteBudget: "1000" });
    expect(placed.ok).toBe(false);
    expect(placed.error).toMatch(/stale/i);
  });

  it("rejects a malformed Grok payload and does not create an order", async () => {
    const bad: Analyst = {
      configured: true,
      model: "grok-4.6",
      async analyze() {
        return {
          raw: { action: "YOLO" },
          model: "grok-4.6",
          usage: { promptTokens: 10, completionTokens: 5, cachedTokens: 0, estimatedCostUsd: "0.00004", costKnown: true, costNote: "test" },
        };
      },
    };
    const { trader, store, db } = createTrader(gateway(), { analyst: bad });
    closers.push({ close: () => db.close() });
    await trader.tick();
    expect(store.listOrders()).toHaveLength(0);
    expect(store.recentAnalyses(1)[0]?.status).toBe("rejected");
    expect(store.recentAnalyses(1)[0]?.action).toBe("HOLD");
  });

  it("reconciles an ambiguous live submit without posting twice", async () => {
    const luno = gateway({
      onPost: () => {
        throw new TimeoutError();
      },
      lookup: { clientOrderId: null, exchangeOrderId: "BX-FOUND", status: "PENDING", baseFilled: "0.001", limitVolume: "0.001" },
    });
    const { trader, store, db } = createTrader(luno, { demo: false, key: "abcd1234wxyz" });
    closers.push({ close: () => db.close() });
    trader.saveRisk(trader.risk());
    trader.setMode("automatic_live", "ENABLE LIVE TRADING", "wxyz");
    await trader.tick();
    const placed = await trader.placeManual({
      marketId: "XBTZAR",
      side: "BUY",
      type: "LIMIT",
      baseVolume: "0.001",
      price: "1000000",
      timeInForce: "IOC",
      confirmLive: true,
      clientOrderId: "sfambiguous1",
    });
    expect(placed.ok).toBe(true);
    expect(luno.posts).toBe(1);
    expect(store.orderByClientId("sfambiguous1")?.exchange_order_id).toBe("BX-FOUND");
    const duplicate = await trader.placeManual({
      marketId: "XBTZAR",
      side: "BUY",
      type: "LIMIT",
      baseVolume: "0.001",
      price: "1000000",
      confirmLive: true,
      clientOrderId: "sfambiguous1",
    });
    expect(duplicate.ok).toBe(false);
    expect(luno.posts).toBe(1);
  });

  it("recovers an ambiguous order on restart without submitting it again", async () => {
    const luno = gateway({
      lookup: { clientOrderId: "sfrestart1", exchangeOrderId: "BX-RESTART", status: "PENDING", baseFilled: "0.4", limitVolume: "1" },
    });
    const { trader, store, db } = createTrader(luno, { demo: false, key: "abcd1234wxyz" });
    closers.push({ close: () => db.close() });
    const now = Date.now();
    store.insertOrder({
      client_order_id: "sfrestart1",
      exchange_order_id: null,
      market_id: "XBTZAR",
      mode: "automatic_live",
      side: "BUY",
      order_type: "LIMIT",
      time_in_force: "GTC",
      post_only: 0,
      price: "1000000",
      stop_price: null,
      stop_direction: null,
      base_volume: "1",
      remaining_base: "1",
      counter_budget: null,
      filled_base: "0",
      filled_counter: "0",
      fee_quote: "0",
      status: "ambiguous",
      source: "grok",
      is_exit: 0,
      eligible_at: now,
      created_at: now,
      updated_at: now,
      last_error: "timeout",
    });
    trader.setPaused(true);
    await trader.tick();
    const order = store.orderByClientId("sfrestart1");
    expect(order?.status).toBe("partial");
    expect(order?.exchange_order_id).toBe("BX-RESTART");
    expect(order?.filled_base).toBe("0.4");
    expect(luno.posts).toBe(0);
  });

  it("lets only one engine hold the order lock", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "signalforge-lock-"));
    const db = openDatabase(path.join(dir, "lock.sqlite"));
    closers.push({ close: () => db.close() });
    migrate(db, migrations);
    expect(tryAcquireLock(db, "a", 1_000, 20_000)).toBe(true);
    expect(tryAcquireLock(db, "b", 2_000, 20_000)).toBe(false);
    expect(tryAcquireLock(db, "b", 30_000, 20_000)).toBe(true);
  });

  it("resyncs the Luno stream when the sequence skips", () => {
    const snapshot = applySnapshot({
      sequence: "10",
      asks: [{ id: "a1", price: "100", volume: "1" }],
      bids: [{ id: "b1", price: "99", volume: "2" }],
      status: "ACTIVE",
      timestamp: 1,
    });
    const next = applyUpdate(snapshot, {
      sequence: "11",
      create_update: { order_id: "a2", type: "ASK", price: "101", volume: "0.5" },
      trade_updates: [{ base: "0.25", maker_order_id: "b1" }],
    });
    expect(next.resync).toBe(false);
    expect(streamBook(next.state).bids[0]?.volume).toBe("1.75");
    const skipped = applyUpdate(next.state, { sequence: "13" });
    expect(skipped.resync).toBe(true);
    expect(applyUpdate(emptyStream(), { sequence: "1" }).resync).toBe(true);
  });
});
