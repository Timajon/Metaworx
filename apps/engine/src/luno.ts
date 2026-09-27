import {
  parseDecimal,
  type MarketInfo,
  type OrderBook,
  type Ticker,
  type TradePrint,
} from "@signalforge/core";
import type { RemoteOrderRef } from "@signalforge/core";

export class LunoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  constructor() {
    super("Luno request timed out before a response was received");
  }
}

export interface LunoCredentials {
  keyId: string;
  keySecret: string;
}

export interface LunoBalance {
  accountId: string;
  currency: string;
  balance: string;
  available: string;
  name: string;
}

export interface LunoClientOptions {
  baseUrl: string;
  credentials: LunoCredentials | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class LunoClient {
  private readonly stamps: number[] = [];

  constructor(private readonly options: LunoClientOptions) {}

  async getMarkets(): Promise<MarketInfo[]> {
    const body = await this.get<{ markets: RawMarket[] }>("/api/exchange/1/markets");
    return body.markets.map(mapMarket);
  }

  async getTickers(): Promise<Ticker[]> {
    const body = await this.get<{ tickers: RawTicker[] }>("/api/1/tickers");
    return body.tickers.map((ticker) => ({
      pair: ticker.pair,
      bid: ticker.bid,
      ask: ticker.ask,
      lastTrade: ticker.last_trade,
      rolling24HourVolume: ticker.rolling_24_hour_volume,
      status: ticker.status,
      timestamp: ticker.timestamp,
    }));
  }

  async getOrderBook(pair: string): Promise<OrderBook> {
    const body = await this.get<RawBook>(`/api/1/orderbook_top?pair=${encodeURIComponent(pair)}`);
    return {
      bids: body.bids ?? [],
      asks: body.asks ?? [],
      timestamp: body.timestamp,
    };
  }

  async getTrades(pair: string): Promise<TradePrint[]> {
    const body = await this.get<{ trades: { price: string; volume: string; is_buy: boolean; timestamp: number }[] }>(
      `/api/1/trades?pair=${encodeURIComponent(pair)}`,
    );
    return (body.trades ?? []).map((trade) => ({
      price: trade.price,
      volume: trade.volume,
      isBuy: trade.is_buy,
      timestamp: trade.timestamp,
    }));
  }

  async getCandles(pair: string, since: number, duration: number): Promise<{ timestamp: number; open: string; high: string; low: string; close: string; volume: string }[] | null> {
    if (!this.options.credentials) return null;
    const body = await this.get<{ candles: { timestamp: number; open: string; high: string; low: string; close: string; volume: string }[] }>(
      `/api/exchange/1/candles?pair=${encodeURIComponent(pair)}&since=${since}&duration=${duration}`,
      true,
    );
    return body.candles ?? [];
  }

  async getBalances(): Promise<LunoBalance[]> {
    const body = await this.get<{ balance: { account_id: string; asset: string; balance: string; reserved: string; unconfirmed: string; name?: string }[] }>(
      "/api/1/balance",
      true,
    );
    return (body.balance ?? []).map((row) => {
      const reserved = parseDecimal(row.reserved || "0");
      const total = parseDecimal(row.balance || "0");
      const available = total > reserved ? total - reserved : 0n;
      return {
        accountId: String(row.account_id),
        currency: row.asset,
        balance: row.balance,
        available: available === total ? row.balance : trimScaled(available),
        name: row.name ?? row.asset,
      };
    });
  }

  async getFeeInfo(pair: string): Promise<{ maker: string; taker: string } | null> {
    if (!this.options.credentials) return null;
    const body = await this.get<{ taker_fee: string; maker_fee: string }>(`/api/1/fee_info?pair=${encodeURIComponent(pair)}`, true);
    return { maker: body.maker_fee, taker: body.taker_fee };
  }

  async listOpenOrders(pair: string): Promise<RemoteOrderRef[]> {
    const body = await this.get<{ orders: RawOrderV2[] }>(`/api/exchange/2/listorders?pair=${encodeURIComponent(pair)}&closed=false`, true);
    return (body.orders ?? []).map(mapRemote);
  }

  async getOrderByClientId(clientOrderId: string): Promise<RemoteOrderRef | null> {
    const url = `/api/exchange/3/order?client_order_id=${encodeURIComponent(clientOrderId)}`;
    try {
      const body = await this.get<RawOrderV2>(url, true);
      return mapRemote(body);
    } catch (error) {
      if (error instanceof LunoError && (error.status === 404 || error.code === "ErrOrderNotFound")) return null;
      throw error;
    }
  }

  async postLimitOrder(fields: Record<string, string>): Promise<{ orderId: string }> {
    const body = await this.post<{ order_id: string }>("/api/1/postorder", fields);
    return { orderId: body.order_id };
  }

  async postMarketOrder(fields: Record<string, string>): Promise<{ orderId: string }> {
    const body = await this.post<{ order_id: string }>("/api/1/marketorder", fields);
    return { orderId: body.order_id };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const body = await this.post<{ success: boolean }>("/api/1/stoporder", { order_id: orderId });
    return Boolean(body.success);
  }

  private async get<T>(pathname: string, auth = false): Promise<T> {
    return this.request<T>(pathname, { method: "GET" }, auth);
  }

  private async post<T>(pathname: string, fields: Record<string, string>): Promise<T> {
    const body = new URLSearchParams(fields);
    return this.request<T>(
      pathname,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
      true,
    );
  }

  private async request<T>(pathname: string, init: RequestInit, auth: boolean): Promise<T> {
    this.acquire();
    const headers = new Headers(init.headers);
    if (auth) {
      if (!this.options.credentials) throw new LunoError("Authenticated Luno call requires API credentials", 401, "ErrUnauthorised");
      const token = Buffer.from(`${this.options.credentials.keyId}:${this.options.credentials.keySecret}`).toString("base64");
      headers.set("authorization", `Basic ${token}`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl}${pathname}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = text ? safeJson(text) : {};
      if (!response.ok) {
        const record = parsed as { error?: string; error_code?: string };
        throw new LunoError(record.error || text || response.statusText, response.status, record.error_code ?? null);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new TimeoutError();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private acquire(): void {
    const now = Date.now();
    while (this.stamps.length > 0 && this.stamps[0] !== undefined && now - this.stamps[0] >= 60_000) this.stamps.shift();
    if (this.stamps.length >= 240) {
      throw new LunoError("Local rate limit guard held this call under Luno's 300 requests per minute cap", 429, "ErrTooManyRequests");
    }
    this.stamps.push(now);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function trimScaled(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const raw = abs.toString().padStart(19, "0");
  const intPart = raw.slice(0, raw.length - 18).replace(/^0+(?=\d)/, "");
  const frac = raw.slice(raw.length - 18).replace(/0+$/, "");
  const body = frac ? `${intPart}.${frac}` : intPart;
  return negative ? `-${body}` : body;
}

interface RawMarket {
  market_id: string;
  base_currency: string;
  counter_currency: string;
  min_volume: string;
  max_volume: string;
  volume_scale: number;
  min_price: string;
  max_price: string;
  price_scale: number;
  fee_scale: number;
  trading_status: string;
}

function mapMarket(market: RawMarket): MarketInfo {
  return {
    marketId: market.market_id,
    baseCurrency: market.base_currency,
    counterCurrency: market.counter_currency,
    minVolume: market.min_volume,
    maxVolume: market.max_volume,
    volumeScale: market.volume_scale,
    minPrice: market.min_price,
    maxPrice: market.max_price,
    priceScale: market.price_scale,
    feeScale: market.fee_scale,
    tradingStatus: market.trading_status,
  };
}

interface RawTicker {
  pair: string;
  bid: string;
  ask: string;
  last_trade: string;
  rolling_24_hour_volume: string;
  status: string;
  timestamp: number;
}

interface RawBook {
  bids: { price: string; volume: string }[];
  asks: { price: string; volume: string }[];
  timestamp: number;
}

interface RawOrderV2 {
  order_id: string;
  client_order_id?: string;
  status?: string;
  state?: string;
  base?: string;
  limit_volume?: string;
  pair?: string;
}

function mapRemote(order: RawOrderV2): RemoteOrderRef {
  const status = (order.status ?? order.state ?? "UNKNOWN").toUpperCase();
  const normalized = status === "AWAITING" || status === "PENDING" || status === "COMPLETE" ? status : "UNKNOWN";
  return {
    clientOrderId: order.client_order_id ?? null,
    exchangeOrderId: order.order_id,
    status: normalized,
    baseFilled: order.base || "0",
    limitVolume: order.limit_volume ?? null,
  };
}
