import { formatTrim, parseDecimal } from "@signalforge/core";
import type { Level } from "@signalforge/core";

export interface StreamOrder {
  id: string;
  price: string;
  volume: string;
  type: "BID" | "ASK";
}

export interface StreamState {
  sequence: bigint | null;
  orders: Map<string, StreamOrder>;
  status: string;
  timestamp: number;
  trades: { price: string; volume: string; isBuy: boolean; timestamp: number }[];
}

export function emptyStream(): StreamState {
  return { sequence: null, orders: new Map(), status: "UNKNOWN", timestamp: 0, trades: [] };
}

export function applySnapshot(
  raw: {
    sequence: string;
    asks?: { id: string; price: string; volume: string }[];
    bids?: { id: string; price: string; volume: string }[];
    status?: string;
    timestamp?: number;
  },
): StreamState {
  const orders = new Map<string, StreamOrder>();
  for (const ask of raw.asks ?? []) orders.set(ask.id, { id: ask.id, price: ask.price, volume: ask.volume, type: "ASK" });
  for (const bid of raw.bids ?? []) orders.set(bid.id, { id: bid.id, price: bid.price, volume: bid.volume, type: "BID" });
  return {
    sequence: BigInt(raw.sequence),
    orders,
    status: raw.status ?? "ACTIVE",
    timestamp: raw.timestamp ?? Date.now(),
    trades: [],
  };
}

export function applyUpdate(
  state: StreamState,
  message: {
    sequence: string;
    create_update?: { order_id: string; type: "BID" | "ASK"; price: string; volume: string } | null;
    delete_update?: { order_id: string } | null;
    trade_updates?: { base: string; counter?: string; maker_order_id: string }[] | null;
    status_update?: { status: string } | null;
    timestamp?: number;
  },
): { state: StreamState; resync: boolean } {
  if (state.sequence === null) return { state, resync: true };
  const sequence = BigInt(message.sequence);
  if (sequence !== state.sequence + 1n) return { state, resync: true };
  const orders = new Map(state.orders);
  if (message.create_update) {
    const created = message.create_update;
    orders.set(created.order_id, {
      id: created.order_id,
      price: created.price,
      volume: created.volume,
      type: created.type,
    });
  }
  if (message.delete_update) orders.delete(message.delete_update.order_id);
  const trades = [...state.trades];
  for (const trade of message.trade_updates ?? []) {
    const maker = orders.get(trade.maker_order_id);
    if (!maker) return { state, resync: true };
    const next = parseDecimal(maker.volume) - parseDecimal(trade.base);
    if (next <= 0n) orders.delete(maker.id);
    else orders.set(maker.id, { ...maker, volume: formatTrim(next) });
    trades.push({
      price: maker.price,
      volume: trade.base,
      isBuy: maker.type === "ASK",
      timestamp: message.timestamp ?? Date.now(),
    });
  }
  if (message.status_update?.status) {
    state = { ...state, status: message.status_update.status };
  }
  return {
    resync: false,
    state: {
      sequence,
      orders,
      status: message.status_update?.status ?? state.status,
      timestamp: message.timestamp ?? state.timestamp,
      trades: trades.slice(-100),
    },
  };
}

export function streamBook(state: StreamState): { bids: Level[]; asks: Level[] } {
  const bids = new Map<string, bigint>();
  const asks = new Map<string, bigint>();
  for (const order of state.orders.values()) {
    const target = order.type === "BID" ? bids : asks;
    target.set(order.price, (target.get(order.price) ?? 0n) + parseDecimal(order.volume));
  }
  const toLevels = (map: Map<string, bigint>, desc: boolean): Level[] =>
    [...map.entries()]
      .map(([price, volume]) => ({ price, volume: formatTrim(volume) }))
      .sort((a, b) => {
        const left = parseDecimal(a.price);
        const right = parseDecimal(b.price);
        return desc ? (left > right ? -1 : 1) : left < right ? -1 : 1;
      });
  return { bids: toLevels(bids, true), asks: toLevels(asks, false) };
}
