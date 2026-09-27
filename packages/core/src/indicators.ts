import { div, formatTrim, mul, parseDecimal, sub, type Amount } from "./decimal.js";

export interface IndicatorSet {
  sma20: string | null;
  sma50: string | null;
  sampleVolatility: string | null;
  window: number;
  note: string;
}

function mean(values: Amount[]): Amount {
  const total = values.reduce((sum, value) => sum + value, 0n);
  return div(total, parseDecimal(String(values.length)));
}

export function simpleMovingAverage(closes: string[], window: number): string | null {
  if (closes.length < window) return null;
  const slice = closes.slice(-window).map((value) => parseDecimal(value));
  return formatTrim(mean(slice));
}

export function sampleVolatility(closes: string[], window: number): string | null {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(-(window + 1)).map((value) => parseDecimal(value));
  const returns: Amount[] = [];
  for (let i = 1; i < slice.length; i += 1) {
    const previous = slice[i - 1];
    const current = slice[i];
    if (previous === undefined || current === undefined || previous === 0n) return null;
    returns.push(div(sub(current, previous), previous));
  }
  const avg = mean(returns);
  const variance = mean(returns.map((value) => mul(sub(value, avg), sub(value, avg))));
  const stdev = sqrt(variance);
  return formatTrim(stdev, 8);
}

function sqrt(value: Amount): Amount {
  if (value <= 0n) return 0n;
  let guess = value > parseDecimal("1") ? value : parseDecimal("1");
  for (let i = 0; i < 40; i += 1) {
    guess = div(guess + div(value, guess), parseDecimal("2"));
  }
  return guess;
}

export function indicators(closes: string[]): IndicatorSet {
  return {
    sma20: simpleMovingAverage(closes, 20),
    sma50: simpleMovingAverage(closes, 50),
    sampleVolatility: sampleVolatility(closes, 20),
    window: Math.min(closes.length, 50),
    note: "Sample standard deviation of simple returns over the stored window. This is not a forecast and is not annualized.",
  };
}

export function baselineAction(closes: string[], hasPosition: boolean): "BUY" | "SELL" | "HOLD" {
  const sma20 = simpleMovingAverage(closes, 20);
  const sma50 = simpleMovingAverage(closes, 50);
  const last = closes[closes.length - 1];
  if (!sma20 || !sma50 || !last) return "HOLD";
  const lastValue = parseDecimal(last);
  const fast = parseDecimal(sma20);
  const slow = parseDecimal(sma50);
  if (lastValue > fast && fast > slow && !hasPosition) return "BUY";
  if (lastValue < fast && hasPosition) return "SELL";
  return "HOLD";
}
