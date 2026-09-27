import { add, formatTrim, mul, parseDecimal, sub, type Amount } from "./decimal.js";
import { applyBuy, applySell, drawdown, emptyPortfolio, markEquity, seedCash, tradingPnl, type Portfolio } from "./accounting.js";
import { baselineAction } from "./indicators.js";
import { bestAsk, bestBid, walkBuyCounter, walkSellBase } from "./book.js";
import type { Level } from "./types.js";

export interface EvalPoint {
  ts: number;
  bid: string;
  ask: string;
  last: string;
  bids?: Level[];
  asks?: Level[];
}

export interface EvalAccount {
  portfolio: Portfolio;
  peak: Amount;
  maxDrawdown: Amount;
  entered: boolean;
  actions: string[];
}

export interface EvalSeriesPoint {
  ts: number;
  equity: string;
  tradingPnl: string;
  fees: string;
  drawdown: string;
  action: string;
}

export interface EvalComparison {
  strategy: EvalSeriesPoint[];
  baseline: EvalSeriesPoint[];
  buyHold: EvalSeriesPoint[];
  note: string;
}

export function emptyEval(seed: Amount): EvalAccount {
  return { portfolio: seedCash(emptyPortfolio(), seed), peak: seed, maxDrawdown: 0n, entered: false, actions: [] };
}

export function stepEvalAccount(
  account: EvalAccount,
  action: "BUY" | "SELL" | "HOLD",
  point: EvalPoint,
  feeRate: Amount,
  orderNotional: Amount,
): EvalAccount {
  let portfolio = account.portfolio;
  let entered = account.entered;
  if (action === "BUY" && portfolio.qty === 0n) {
    const budget = portfolio.cashQuote < orderNotional ? portfolio.cashQuote : orderNotional;
    const asks = point.asks ?? [{ price: point.ask, volume: "1000000000" }];
    const walked = walkBuyCounter(asks, budget);
    if (walked.base > 0n && walked.averagePrice !== null) {
      portfolio = applyBuy(portfolio, walked.base, walked.averagePrice, feeRate);
      entered = true;
    }
  } else if (action === "SELL" && portfolio.qty > 0n) {
    const bids = point.bids ?? [{ price: point.bid, volume: "1000000000" }];
    const walked = walkSellBase(bids, portfolio.qty);
    if (walked.base > 0n && walked.averagePrice !== null) {
      const sold = walked.base > portfolio.qty ? portfolio.qty : walked.base;
      portfolio = applySell(portfolio, sold, walked.averagePrice, feeRate);
    }
  }
  const bid = bestBid({ bids: point.bids ?? [{ price: point.bid, volume: "0" }], asks: [], timestamp: point.ts }) ?? parseDecimal(point.bid);
  const equity = markEquity(portfolio, bid);
  const peak = equity > account.peak ? equity : account.peak;
  const dd = drawdown(equity, peak);
  return {
    portfolio,
    peak,
    maxDrawdown: dd > account.maxDrawdown ? dd : account.maxDrawdown,
    entered,
    actions: [...account.actions, action],
  };
}

export function compareStrategies(input: {
  points: EvalPoint[];
  strategyActions: ("BUY" | "SELL" | "HOLD")[];
  seed: string;
  orderNotional: string;
  feeRate: string;
}): EvalComparison {
  if (input.strategyActions.length !== input.points.length) {
    throw new Error("Strategy actions must align one-to-one with observations");
  }
  const seed = parseDecimal(input.seed);
  const notional = parseDecimal(input.orderNotional);
  const fee = parseDecimal(input.feeRate);
  let strategy = emptyEval(seed);
  let baseline = emptyEval(seed);
  let buyHold = emptyEval(seed);
  const strategySeries: EvalSeriesPoint[] = [];
  const baselineSeries: EvalSeriesPoint[] = [];
  const buyHoldSeries: EvalSeriesPoint[] = [];
  const closes: string[] = [];
  for (let i = 0; i < input.points.length; i += 1) {
    const point = input.points[i];
    const strategyAction = input.strategyActions[i];
    if (!point || !strategyAction) break;
    closes.push(point.last);
    const baselineDecision = baselineAction(closes, baseline.portfolio.qty > 0n);
    const buyHoldDecision: "BUY" | "SELL" | "HOLD" = i === 0 ? "BUY" : "HOLD";
    strategy = stepEvalAccount(strategy, strategyAction, point, fee, notional);
    baseline = stepEvalAccount(baseline, baselineDecision, point, fee, notional);
    buyHold = stepEvalAccount(buyHold, buyHoldDecision, point, fee, notional);
    strategySeries.push(pointView(point, strategy, strategyAction));
    baselineSeries.push(pointView(point, baseline, baselineDecision));
    buyHoldSeries.push(pointView(point, buyHold, buyHoldDecision));
  }
  return {
    strategy: strategySeries,
    baseline: baselineSeries,
    buyHold: buyHoldSeries,
    note: "Simulated on stored observations only, in time order, using executable bid/ask or book depth when present. The same fee rate and order notional are applied to each path. This is not evidence of future profitability.",
  };
}

function pointView(point: EvalPoint, account: EvalAccount, action: string): EvalSeriesPoint {
  const bid = parseDecimal(point.bid);
  return {
    ts: point.ts,
    equity: formatTrim(markEquity(account.portfolio, bid)),
    tradingPnl: formatTrim(tradingPnl(account.portfolio, bid)),
    fees: formatTrim(account.portfolio.fees),
    drawdown: formatTrim(account.maxDrawdown),
    action,
  };
}

export function prefixInvariant(closes: string[]): ("BUY" | "SELL" | "HOLD")[] {
  const actions: ("BUY" | "SELL" | "HOLD")[] = [];
  let hasPosition = false;
  for (let i = 0; i < closes.length; i += 1) {
    const action = baselineAction(closes.slice(0, i + 1), hasPosition);
    actions.push(action);
    if (action === "BUY") hasPosition = true;
    if (action === "SELL") hasPosition = false;
  }
  return actions;
}

export function exposureQuote(qty: Amount, bid: Amount): Amount {
  return mul(qty, bid);
}

export function cashAfterBuy(cash: Amount, spent: Amount): Amount {
  return sub(cash, spent);
}

export function addAmount(a: Amount, b: Amount): Amount {
  return add(a, b);
}
