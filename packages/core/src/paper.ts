import { add, formatTrim, mul, parseDecimal, sub, type Amount } from "./decimal.js";
import { walkBuyBase, walkBuyCounter, walkSellBase, type WalkFill } from "./book.js";
import type { OrderBook, OrderStatus, OrderType, Side, TimeInForce } from "./types.js";

export interface PaperOrder {
  clientOrderId: string;
  side: Side;
  type: OrderType;
  timeInForce: TimeInForce;
  postOnly: boolean;
  price: string | null;
  stopPrice: string | null;
  stopDirection: "ABOVE" | "BELOW" | null;
  remainingBase: string;
  counterBudget: string | null;
  status: OrderStatus;
  eligibleAt: number;
  triggered: boolean;
  resting: boolean;
}

export interface PaperFill extends WalkFill {
  feeQuote: string;
}

export interface PaperStep {
  order: PaperOrder;
  fills: PaperFill[];
  feeQuote: Amount;
  reason?: string;
}

export function advancePaperOrder(
  order: PaperOrder,
  book: OrderBook,
  now: number,
  takerFeeRate: Amount,
  makerFeeRate: Amount,
  lastTrade: string | null = null,
): PaperStep {
  if (isTerminal(order.status)) return { order, fills: [], feeQuote: 0n };
  if (now < order.eligibleAt) {
    return { order: { ...order, status: "delayed" }, fills: [], feeQuote: 0n };
  }
  let working = { ...order };
  if (working.type === "STOP_LIMIT" && !working.triggered) {
    const triggered = stopTriggered(working, lastTrade);
    if (!triggered) {
      return { order: { ...working, status: "awaiting_trigger" }, fills: [], feeQuote: 0n };
    }
    working = { ...working, triggered: true, status: "open" };
  }

  if (!working.resting) {
    const aggressive = matchAggressive(working, book);
    if (working.postOnly && aggressive.fills.length > 0) {
      return {
        order: { ...working, status: "cancelled", remainingBase: working.remainingBase },
        fills: [],
        feeQuote: 0n,
        reason: "Post-only order would have taken liquidity and was cancelled.",
      };
    }
    if (working.timeInForce === "FOK" && aggressive.incomplete) {
      return {
        order: { ...working, status: "cancelled" },
        fills: [],
        feeQuote: 0n,
        reason: "Fill-or-kill order could not be filled completely.",
      };
    }
    const priced = applyFee(aggressive.fills, takerFeeRate);
    if (working.type === "MARKET" && working.side === "BUY" && working.counterBudget) {
      const got = priced.fills.reduce((sum, fill) => add(sum, parseDecimal(fill.base)), 0n);
      return {
        order: { ...working, remainingBase: "0", counterBudget: "0", status: got > 0n ? "filled" : "cancelled", resting: false },
        fills: priced.fills,
        feeQuote: priced.fee,
        reason: got > 0n ? undefined : "Market buy found no ask liquidity.",
      };
    }
    const filledBase = priced.fills.reduce((sum, fill) => add(sum, parseDecimal(fill.base)), 0n);
    const remaining = sub(parseDecimal(working.remainingBase || "0"), filledBase);
    const nextRemaining = remaining > 0n ? remaining : 0n;
    if (working.type === "MARKET" || working.timeInForce === "IOC") {
      const status: OrderStatus = filledBase > 0n && nextRemaining === 0n ? "filled" : "cancelled";
      return {
        order: { ...working, remainingBase: formatTrim(nextRemaining), status, resting: false },
        fills: priced.fills,
        feeQuote: priced.fee,
        reason: nextRemaining > 0n ? "Unfilled immediate remainder was cancelled." : undefined,
      };
    }
    const status: OrderStatus = nextRemaining === 0n ? "filled" : filledBase > 0n ? "partial" : "open";
    return {
      order: { ...working, remainingBase: formatTrim(nextRemaining), status, resting: nextRemaining > 0n },
      fills: priced.fills,
      feeQuote: priced.fee,
    };
  }

  const passive = matchResting(working, book);
  const priced = applyFee(passive, makerFeeRate);
  const filledBase = priced.fills.reduce((sum, fill) => add(sum, parseDecimal(fill.base)), 0n);
  if (filledBase === 0n) return { order: working, fills: [], feeQuote: 0n };
  const remaining = sub(parseDecimal(working.remainingBase), filledBase);
  const nextRemaining = remaining > 0n ? remaining : 0n;
  const status: OrderStatus = nextRemaining === 0n ? "filled" : "partial";
  return {
    order: { ...working, remainingBase: formatTrim(nextRemaining), status, resting: nextRemaining > 0n },
    fills: priced.fills,
    feeQuote: priced.fee,
  };
}

function matchAggressive(order: PaperOrder, book: OrderBook): { fills: WalkFill[]; incomplete: boolean } {
  const limit = order.price ? parseDecimal(order.price) : undefined;
  if (order.side === "BUY" && order.type === "MARKET" && order.counterBudget) {
    const walked = walkBuyCounter(book.asks, parseDecimal(order.counterBudget), limit);
    return { fills: walked.fills, incomplete: walked.base === 0n };
  }
  const wanted = parseDecimal(order.remainingBase);
  if (order.side === "BUY") {
    const walked = walkBuyBase(book.asks, wanted, limit);
    return { fills: walked.fills, incomplete: walked.incomplete };
  }
  const walked = walkSellBase(book.bids, wanted, order.type === "MARKET" ? undefined : limit);
  return { fills: walked.fills, incomplete: walked.incomplete };
}

function matchResting(order: PaperOrder, book: OrderBook): WalkFill[] {
  if (!order.price) return [];
  const limit = parseDecimal(order.price);
  const remaining = parseDecimal(order.remainingBase);
  if (order.side === "BUY") {
    const crossed = book.asks
      .map((level) => ({ price: parseDecimal(level.price), volume: parseDecimal(level.volume) }))
      .filter((level) => level.price < limit && level.volume > 0n)
      .sort((a, b) => (a.price < b.price ? -1 : 1));
    return takeAtLimit(order.price, remaining, crossed, "maker");
  }
  const crossed = book.bids
    .map((level) => ({ price: parseDecimal(level.price), volume: parseDecimal(level.volume) }))
    .filter((level) => level.price > limit && level.volume > 0n)
    .sort((a, b) => (a.price > b.price ? -1 : 1));
  return takeAtLimit(order.price, remaining, crossed, "maker");
}

function takeAtLimit(limitPrice: string, remaining: Amount, levels: { volume: Amount }[], liquidity: "maker"): WalkFill[] {
  const fills: WalkFill[] = [];
  let left = remaining;
  for (const level of levels) {
    if (left <= 0n) break;
    const take = level.volume < left ? level.volume : left;
    fills.push({
      price: limitPrice,
      base: formatTrim(take),
      counter: formatTrim(mul(parseDecimal(limitPrice), take)),
      liquidity,
    });
    left = sub(left, take);
  }
  return fills;
}

function applyFee(fills: WalkFill[], rate: Amount): { fills: PaperFill[]; fee: Amount } {
  let fee = 0n;
  const priced = fills.map((fill) => {
    const part = mul(parseDecimal(fill.counter), rate);
    fee = add(fee, part);
    return { ...fill, feeQuote: formatTrim(part) };
  });
  return { fills: priced, fee };
}

function stopTriggered(order: PaperOrder, lastTrade: string | null): boolean {
  if (!lastTrade || !order.stopPrice || !order.stopDirection) return false;
  const last = parseDecimal(lastTrade);
  const stop = parseDecimal(order.stopPrice);
  if (order.stopDirection === "BELOW") return last <= stop;
  if (order.stopDirection === "ABOVE") return last >= stop;
  return false;
}

function isTerminal(status: OrderStatus): boolean {
  return status === "filled" || status === "cancelled" || status === "rejected" || status === "not_placed";
}

export function executableBuyPrice(book: OrderBook): string | null {
  return book.asks[0]?.price ?? null;
}

export function executableSellPrice(book: OrderBook): string | null {
  return book.bids[0]?.price ?? null;
}
