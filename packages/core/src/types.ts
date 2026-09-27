export type TradingMode = "paper" | "assisted_live" | "automatic_live";

export type Side = "BUY" | "SELL";

export type OrderType = "LIMIT" | "MARKET" | "STOP_LIMIT";

export type TimeInForce = "GTC" | "IOC" | "FOK";

export type OrderStatus =
  | "pending_confirm"
  | "delayed"
  | "awaiting_trigger"
  | "submitting"
  | "ambiguous"
  | "open"
  | "partial"
  | "filled"
  | "cancelled"
  | "rejected"
  | "not_placed";

export interface MarketInfo {
  marketId: string;
  baseCurrency: string;
  counterCurrency: string;
  minVolume: string;
  maxVolume: string;
  volumeScale: number;
  minPrice: string;
  maxPrice: string;
  priceScale: number;
  feeScale: number;
  tradingStatus: string;
}

export interface Level {
  price: string;
  volume: string;
}

export interface TradePrint {
  price: string;
  volume: string;
  isBuy: boolean;
  timestamp: number;
}

export interface OrderBook {
  bids: Level[];
  asks: Level[];
  timestamp: number;
  status?: string;
}

export interface Ticker {
  pair: string;
  bid: string;
  ask: string;
  lastTrade: string;
  rolling24HourVolume: string;
  status: string;
  timestamp: number;
}

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
