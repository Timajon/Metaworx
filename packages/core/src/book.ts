import { add, div, formatTrim, isZero, mul, parseDecimal, sub, type Amount } from "./decimal.js";
import type { Level, OrderBook } from "./types.js";

export interface WalkFill {
  price: string;
  base: string;
  counter: string;
  liquidity: "taker" | "maker";
}

export interface WalkResult {
  fills: WalkFill[];
  base: Amount;
  counter: Amount;
  incomplete: boolean;
  averagePrice: Amount | null;
  bestPrice: Amount | null;
  slippageBps: number;
}

function sortAsks(levels: Level[]): { price: Amount; volume: Amount }[] {
  return levels
    .map((level) => ({ price: parseDecimal(level.price), volume: parseDecimal(level.volume) }))
    .filter((level) => level.volume > 0n && level.price > 0n)
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
}

function sortBids(levels: Level[]): { price: Amount; volume: Amount }[] {
  return levels
    .map((level) => ({ price: parseDecimal(level.price), volume: parseDecimal(level.volume) }))
    .filter((level) => level.volume > 0n && level.price > 0n)
    .sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0));
}

function finish(fills: WalkFill[], base: Amount, counter: Amount, incomplete: boolean, best: Amount | null, side: "BUY" | "SELL"): WalkResult {
  const average = base > 0n ? div(counter, base) : null;
  let slippageBps = 0;
  if (average !== null && best !== null && best > 0n) {
    const worse = side === "BUY" ? (average > best ? average - best : 0n) : best > average ? best - average : 0n;
    slippageBps = Number((worse * 10_000_000n) / best) / 1000;
  }
  return { fills, base, counter, incomplete, averagePrice: average, bestPrice: best, slippageBps };
}

export function walkBuyBase(asks: Level[], baseWanted: Amount, limitPrice?: Amount): WalkResult {
  const levels = sortAsks(asks);
  const best = levels[0]?.price ?? null;
  let remaining = baseWanted;
  let base = 0n;
  let counter = 0n;
  const fills: WalkFill[] = [];
  for (const level of levels) {
    if (remaining <= 0n) break;
    if (limitPrice !== undefined && level.price > limitPrice) break;
    const take = level.volume < remaining ? level.volume : remaining;
    const spent = mul(level.price, take);
    fills.push({
      price: formatTrim(level.price),
      base: formatTrim(take),
      counter: formatTrim(spent),
      liquidity: "taker",
    });
    base = add(base, take);
    counter = add(counter, spent);
    remaining = sub(remaining, take);
  }
  return finish(fills, base, counter, remaining > 0n, best, "BUY");
}

export function walkBuyCounter(asks: Level[], counterBudget: Amount, limitPrice?: Amount): WalkResult {
  const levels = sortAsks(asks);
  const best = levels[0]?.price ?? null;
  let remaining = counterBudget;
  let base = 0n;
  let counter = 0n;
  const fills: WalkFill[] = [];
  for (const level of levels) {
    if (remaining <= 0n) break;
    if (limitPrice !== undefined && level.price > limitPrice) break;
    const levelCost = mul(level.price, level.volume);
    const takeBase = levelCost <= remaining ? level.volume : div(remaining, level.price);
    if (takeBase <= 0n) break;
    const spent = mul(level.price, takeBase);
    const used = spent > remaining ? remaining : spent;
    fills.push({
      price: formatTrim(level.price),
      base: formatTrim(takeBase),
      counter: formatTrim(used),
      liquidity: "taker",
    });
    base = add(base, takeBase);
    counter = add(counter, used);
    remaining = sub(remaining, used);
  }
  return finish(fills, base, counter, remaining > 0n && base === 0n, best, "BUY");
}

export function walkSellBase(bids: Level[], baseWanted: Amount, limitPrice?: Amount): WalkResult {
  const levels = sortBids(bids);
  const best = levels[0]?.price ?? null;
  let remaining = baseWanted;
  let base = 0n;
  let counter = 0n;
  const fills: WalkFill[] = [];
  for (const level of levels) {
    if (remaining <= 0n) break;
    if (limitPrice !== undefined && level.price < limitPrice) break;
    const take = level.volume < remaining ? level.volume : remaining;
    const received = mul(level.price, take);
    fills.push({
      price: formatTrim(level.price),
      base: formatTrim(take),
      counter: formatTrim(received),
      liquidity: "taker",
    });
    base = add(base, take);
    counter = add(counter, received);
    remaining = sub(remaining, take);
  }
  return finish(fills, base, counter, remaining > 0n, best, "SELL");
}

export function topDepth(levels: Level[], count: number): Amount {
  const parsed = levels.slice(0, count);
  return parsed.reduce((sum, level) => add(sum, mul(parseDecimal(level.price), parseDecimal(level.volume))), 0n);
}

export function spreadBps(book: OrderBook): number | null {
  const bid = book.bids[0] ? parseDecimal(book.bids[0].price) : null;
  const ask = book.asks[0] ? parseDecimal(book.asks[0].price) : null;
  if (bid === null || ask === null || bid <= 0n || ask <= 0n) return null;
  const mid = div(add(bid, ask), parseDecimal("2"));
  if (isZero(mid)) return null;
  return Number(((ask - bid) * 10_000_000n) / mid) / 1000;
}

export function bestBid(book: OrderBook): Amount | null {
  const price = book.bids[0]?.price;
  return price ? parseDecimal(price) : null;
}

export function bestAsk(book: OrderBook): Amount | null {
  const price = book.asks[0]?.price;
  return price ? parseDecimal(price) : null;
}
