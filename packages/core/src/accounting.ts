import { add, div, formatTrim, mul, sub, type Amount } from "./decimal.js";

export interface Portfolio {
  cashQuote: Amount;
  qty: Amount;
  avgCost: Amount;
  realized: Amount;
  fees: Amount;
  deposits: Amount;
  withdrawals: Amount;
  seed: Amount;
}

export function emptyPortfolio(): Portfolio {
  return {
    cashQuote: 0n,
    qty: 0n,
    avgCost: 0n,
    realized: 0n,
    fees: 0n,
    deposits: 0n,
    withdrawals: 0n,
    seed: 0n,
  };
}

export function seedCash(portfolio: Portfolio, amount: Amount): Portfolio {
  return { ...portfolio, cashQuote: add(portfolio.cashQuote, amount), seed: add(portfolio.seed, amount) };
}

export function deposit(portfolio: Portfolio, amount: Amount): Portfolio {
  if (amount <= 0n) throw new Error("Deposit must be positive");
  return { ...portfolio, cashQuote: add(portfolio.cashQuote, amount), deposits: add(portfolio.deposits, amount) };
}

export function withdraw(portfolio: Portfolio, amount: Amount): Portfolio {
  if (amount <= 0n) throw new Error("Withdrawal must be positive");
  if (portfolio.cashQuote < amount) throw new Error("Withdrawal exceeds cash");
  return {
    ...portfolio,
    cashQuote: sub(portfolio.cashQuote, amount),
    withdrawals: add(portfolio.withdrawals, amount),
  };
}

export function applyBuy(portfolio: Portfolio, qty: Amount, price: Amount, feeRate: Amount): Portfolio {
  if (qty <= 0n) throw new Error("Buy quantity must be positive");
  const counter = mul(qty, price);
  const fee = mul(counter, feeRate);
  const cost = add(counter, fee);
  if (portfolio.cashQuote < cost) throw new Error("Buy exceeds cash");
  const newQty = add(portfolio.qty, qty);
  const avgCost = div(add(mul(portfolio.avgCost, portfolio.qty), cost), newQty);
  return {
    ...portfolio,
    cashQuote: sub(portfolio.cashQuote, cost),
    qty: newQty,
    avgCost,
    fees: add(portfolio.fees, fee),
  };
}

export function applySell(portfolio: Portfolio, qty: Amount, price: Amount, feeRate: Amount): Portfolio {
  if (qty <= 0n) throw new Error("Sell quantity must be positive");
  if (qty > portfolio.qty) throw new Error("Sell exceeds holdings");
  const counter = mul(qty, price);
  const fee = mul(counter, feeRate);
  const proceeds = sub(counter, fee);
  const realizedDelta = sub(proceeds, mul(portfolio.avgCost, qty));
  const newQty = sub(portfolio.qty, qty);
  return {
    ...portfolio,
    cashQuote: add(portfolio.cashQuote, proceeds),
    qty: newQty,
    avgCost: newQty === 0n ? 0n : portfolio.avgCost,
    realized: add(portfolio.realized, realizedDelta),
    fees: add(portfolio.fees, fee),
  };
}

export function markEquity(portfolio: Portfolio, bid: Amount): Amount {
  return add(portfolio.cashQuote, mul(portfolio.qty, bid));
}

export function unrealizedPnl(portfolio: Portfolio, bid: Amount): Amount {
  if (portfolio.qty === 0n) return 0n;
  return mul(sub(bid, portfolio.avgCost), portfolio.qty);
}

export function tradingPnl(portfolio: Portfolio, bid: Amount): Amount {
  return sub(add(markEquity(portfolio, bid), portfolio.withdrawals), add(portfolio.seed, portfolio.deposits));
}

export function drawdown(equity: Amount, peak: Amount): Amount {
  return equity >= peak ? 0n : sub(peak, equity);
}

export function portfolioView(portfolio: Portfolio, bid: Amount): {
  equity: string;
  realized: string;
  unrealized: string;
  fees: string;
  tradingPnl: string;
  cash: string;
  qty: string;
} {
  return {
    equity: formatTrim(markEquity(portfolio, bid)),
    realized: formatTrim(portfolio.realized),
    unrealized: formatTrim(unrealizedPnl(portfolio, bid)),
    fees: formatTrim(portfolio.fees),
    tradingPnl: formatTrim(tradingPnl(portfolio, bid)),
    cash: formatTrim(portfolio.cashQuote),
    qty: formatTrim(portfolio.qty),
  };
}
