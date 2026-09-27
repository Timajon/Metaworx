import { add, div, formatTrim, mul, parseDecimal, type Amount } from "./decimal.js";
import { walkBuyBase, walkSellBase } from "./book.js";
import { checkVolume } from "./market.js";
import type { MarketInfo, OrderBook } from "./types.js";

export interface OrderPlan {
  side: "BUY" | "SELL";
  type: "LIMIT";
  timeInForce: "IOC";
  postOnly: false;
  limitPrice: string;
  baseVolume: string;
  expectedQuote: string;
  slippageBps: number;
  feeQuote: string;
}

export function planMarketableOrder(input: {
  side: "BUY" | "SELL";
  book: OrderBook;
  market: MarketInfo;
  desiredBase: Amount;
  maxSlippageBps: number;
  feeRate: Amount;
}): { ok: true; plan: OrderPlan } | { ok: false; reason: string } {
  const bestAsk = input.book.asks[0] ? parseDecimal(input.book.asks[0].price) : null;
  const bestBid = input.book.bids[0] ? parseDecimal(input.book.bids[0].price) : null;
  if (input.side === "BUY") {
    if (!bestAsk) return { ok: false, reason: "No ask liquidity." };
    const limit = add(bestAsk, div(mul(bestAsk, parseDecimal(String(input.maxSlippageBps))), parseDecimal("10000")));
    const walked = walkBuyBase(input.book.asks, input.desiredBase, limit);
    if (walked.base <= 0n || walked.averagePrice === null) return { ok: false, reason: "Book cannot fill any size inside the slippage limit." };
    const checked = checkVolume(input.market, walked.base);
    if (!checked.ok) return { ok: false, reason: checked.reason ?? "Fill is below the minimum volume." };
    const fee = mul(walked.counter, input.feeRate);
    return {
      ok: true,
      plan: {
        side: "BUY",
        type: "LIMIT",
        timeInForce: "IOC",
        postOnly: false,
        limitPrice: formatTrim(limit),
        baseVolume: checked.quantized,
        expectedQuote: formatTrim(walked.counter),
        slippageBps: walked.slippageBps,
        feeQuote: formatTrim(fee),
      },
    };
  }
  if (!bestBid) return { ok: false, reason: "No bid liquidity." };
  const slip = div(mul(bestBid, parseDecimal(String(input.maxSlippageBps))), parseDecimal("10000"));
  const limit = bestBid > slip ? bestBid - slip : 0n;
  const walked = walkSellBase(input.book.bids, input.desiredBase, limit);
  if (walked.base <= 0n || walked.averagePrice === null) return { ok: false, reason: "Book cannot fill any size inside the slippage limit." };
  const checked = checkVolume(input.market, walked.base);
  if (!checked.ok) return { ok: false, reason: checked.reason ?? "Fill is below the minimum volume." };
  const fee = mul(walked.counter, input.feeRate);
  return {
    ok: true,
    plan: {
      side: "SELL",
      type: "LIMIT",
      timeInForce: "IOC",
      postOnly: false,
      limitPrice: formatTrim(limit),
      baseVolume: checked.quantized,
      expectedQuote: formatTrim(walked.counter),
      slippageBps: walked.slippageBps,
      feeQuote: formatTrim(fee),
    },
  };
}
