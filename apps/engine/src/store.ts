import type { DatabaseSync } from "node:sqlite";
import type { MarketInfo } from "@signalforge/core";

export interface OrderRow {
  id: number;
  client_order_id: string;
  exchange_order_id: string | null;
  market_id: string;
  mode: string;
  side: string;
  order_type: string;
  time_in_force: string;
  post_only: number;
  price: string | null;
  stop_price: string | null;
  stop_direction: string | null;
  base_volume: string;
  remaining_base: string;
  counter_budget: string | null;
  filled_base: string;
  filled_counter: string;
  fee_quote: string;
  status: string;
  source: string;
  is_exit: number;
  eligible_at: number;
  created_at: number;
  updated_at: number;
  last_error: string | null;
}

export interface AnalysisRow {
  id: number;
  market_id: string;
  ts: number;
  source: string;
  model: string | null;
  snapshot_json: string;
  raw_json: string | null;
  action: string | null;
  status: string;
  reject_reason: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  estimated_cost_usd: string | null;
  cost_note: string | null;
  expires_at: number | null;
  input_hash: string | null;
}

export class Store {
  constructor(readonly db: DatabaseSync) {}

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }

  upsertMarkets(markets: MarketInfo[], now: number): void {
    const stmt = this.db.prepare(`INSERT INTO markets (
      market_id, base_currency, counter_currency, min_volume, max_volume, volume_scale,
      min_price, max_price, price_scale, fee_scale, trading_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_id) DO UPDATE SET
      base_currency = excluded.base_currency,
      counter_currency = excluded.counter_currency,
      min_volume = excluded.min_volume,
      max_volume = excluded.max_volume,
      volume_scale = excluded.volume_scale,
      min_price = excluded.min_price,
      max_price = excluded.max_price,
      price_scale = excluded.price_scale,
      fee_scale = excluded.fee_scale,
      trading_status = excluded.trading_status,
      updated_at = excluded.updated_at`);
    this.db.exec("BEGIN");
    try {
      for (const market of markets) {
        stmt.run(
          market.marketId,
          market.baseCurrency,
          market.counterCurrency,
          market.minVolume,
          market.maxVolume,
          market.volumeScale,
          market.minPrice,
          market.maxPrice,
          market.priceScale,
          market.feeScale,
          market.tradingStatus,
          now,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listMarkets(): MarketInfo[] {
    const rows = this.db.prepare("SELECT * FROM markets ORDER BY market_id").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      marketId: String(row.market_id),
      baseCurrency: String(row.base_currency),
      counterCurrency: String(row.counter_currency),
      minVolume: String(row.min_volume),
      maxVolume: String(row.max_volume),
      volumeScale: Number(row.volume_scale),
      minPrice: String(row.min_price),
      maxPrice: String(row.max_price),
      priceScale: Number(row.price_scale),
      feeScale: Number(row.fee_scale),
      tradingStatus: String(row.trading_status),
    }));
  }

  insertObservation(row: {
    marketId: string;
    ts: number;
    bid: string;
    ask: string;
    last: string;
    volume24h: string;
    spreadBps: string;
    bookJson: string;
    source: string;
  }): void {
    this.db.prepare(
      `INSERT INTO observations (market_id, ts, bid, ask, last_trade, volume_24h, spread_bps, book_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.marketId, row.ts, row.bid, row.ask, row.last, row.volume24h, row.spreadBps, row.bookJson, row.source);
  }

  recentObservations(marketId: string, limit: number): { ts: number; bid: string; ask: string; last_trade: string; book_json: string }[] {
    return this.db
      .prepare(
        `SELECT ts, bid, ask, last_trade, book_json FROM observations
         WHERE market_id = ? ORDER BY ts DESC LIMIT ?`,
      )
      .all(marketId, limit) as { ts: number; bid: string; ask: string; last_trade: string; book_json: string }[];
  }

  insertAnalysis(row: Omit<AnalysisRow, "id">): number {
    const result = this.db.prepare(
      `INSERT INTO analyses (
        market_id, ts, source, model, snapshot_json, raw_json, action, status, reject_reason,
        prompt_tokens, completion_tokens, cached_tokens, estimated_cost_usd, cost_note, expires_at, input_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.market_id,
      row.ts,
      row.source,
      row.model,
      row.snapshot_json,
      row.raw_json,
      row.action,
      row.status,
      row.reject_reason,
      row.prompt_tokens,
      row.completion_tokens,
      row.cached_tokens,
      row.estimated_cost_usd,
      row.cost_note,
      row.expires_at,
      row.input_hash,
    );
    return Number(result.lastInsertRowid);
  }

  latestAnalysis(marketId: string): AnalysisRow | null {
    return (this.db.prepare("SELECT * FROM analyses WHERE market_id = ? ORDER BY id DESC LIMIT 1").get(marketId) as AnalysisRow | undefined) ?? null;
  }

  recentAnalyses(limit: number): AnalysisRow[] {
    return this.db.prepare("SELECT * FROM analyses ORDER BY id DESC LIMIT ?").all(limit) as unknown as AnalysisRow[];
  }

  insertOrder(row: Omit<OrderRow, "id">): number {
    const result = this.db.prepare(
      `INSERT INTO orders (
        client_order_id, exchange_order_id, market_id, mode, side, order_type, time_in_force, post_only,
        price, stop_price, stop_direction, base_volume, remaining_base, counter_budget, filled_base,
        filled_counter, fee_quote, status, source, is_exit, eligible_at, created_at, updated_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.client_order_id,
      row.exchange_order_id,
      row.market_id,
      row.mode,
      row.side,
      row.order_type,
      row.time_in_force,
      row.post_only,
      row.price,
      row.stop_price,
      row.stop_direction,
      row.base_volume,
      row.remaining_base,
      row.counter_budget,
      row.filled_base,
      row.filled_counter,
      row.fee_quote,
      row.status,
      row.source,
      row.is_exit,
      row.eligible_at,
      row.created_at,
      row.updated_at,
      row.last_error,
    );
    return Number(result.lastInsertRowid);
  }

  updateOrder(id: number, patch: Partial<OrderRow>): void {
    const current = this.orderById(id);
    if (!current) throw new Error(`Order ${id} not found`);
    const next = { ...current, ...patch, updated_at: Date.now() };
    this.db.prepare(
      `UPDATE orders SET exchange_order_id = ?, remaining_base = ?, filled_base = ?, filled_counter = ?,
       fee_quote = ?, status = ?, updated_at = ?, last_error = ? WHERE id = ?`,
    ).run(next.exchange_order_id, next.remaining_base, next.filled_base, next.filled_counter, next.fee_quote, next.status, next.updated_at, next.last_error, id);
  }

  orderById(id: number): OrderRow | null {
    return (this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined) ?? null;
  }

  orderByClientId(clientOrderId: string): OrderRow | null {
    return (this.db.prepare("SELECT * FROM orders WHERE client_order_id = ?").get(clientOrderId) as OrderRow | undefined) ?? null;
  }

  listOrders(limit = 100): OrderRow[] {
    return this.db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT ?").all(limit) as unknown as OrderRow[];
  }

  openOrders(): OrderRow[] {
    return this.db
      .prepare(
        `SELECT * FROM orders WHERE status IN ('pending_confirm', 'delayed', 'awaiting_trigger', 'submitting', 'ambiguous', 'open', 'partial')
         ORDER BY id ASC`,
      )
      .all() as unknown as OrderRow[];
  }

  insertFill(row: { orderId: number; ts: number; price: string; base: string; counter: string; fee: string; liquidity: string }): void {
    this.db.prepare(
      `INSERT INTO fills (order_id, ts, price, base_volume, counter_volume, fee_quote, liquidity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.orderId, row.ts, row.price, row.base, row.counter, row.fee, row.liquidity);
  }

  recentFills(limit = 50): { id: number; order_id: number; ts: number; price: string; base_volume: string; counter_volume: string; fee_quote: string; liquidity: string }[] {
    return this.db.prepare("SELECT * FROM fills ORDER BY id DESC LIMIT ?").all(limit) as never;
  }

  insertLedger(row: { ts: number; currency: string; amount: string; kind: string; ref?: string; note?: string }): void {
    this.db.prepare("INSERT INTO ledger (ts, currency, amount, kind, ref, note) VALUES (?, ?, ?, ?, ?, ?)").run(
      row.ts,
      row.currency,
      row.amount,
      row.kind,
      row.ref ?? null,
      row.note ?? null,
    );
  }

  insertProposal(row: { analysisId: number | null; marketId: string; side: string; price: string | null; baseVolume: string; reason: string }): number {
    const result = this.db.prepare(
      `INSERT INTO proposals (analysis_id, market_id, side, price, base_volume, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(row.analysisId, row.marketId, row.side, row.price, row.baseVolume, row.reason, Date.now());
    return Number(result.lastInsertRowid);
  }

  recentProposals(limit = 20): { id: number; market_id: string; side: string; price: string | null; base_volume: string; status: string; reason: string | null; created_at: number }[] {
    return this.db.prepare("SELECT * FROM proposals ORDER BY id DESC LIMIT ?").all(limit) as never;
  }

  proposal(id: number): { id: number; market_id: string; side: string; price: string | null; base_volume: string; status: string } | null {
    return (this.db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as never) ?? null;
  }

  resolveProposal(id: number, status: string): void {
    this.db.prepare("UPDATE proposals SET status = ?, resolved_at = ? WHERE id = ?").run(status, Date.now(), id);
  }

  knownClientIds(): Set<string> {
    const rows = this.db.prepare("SELECT client_order_id FROM orders").all() as { client_order_id: string }[];
    return new Set(rows.map((row) => row.client_order_id));
  }
}
