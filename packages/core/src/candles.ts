import { add, formatTrim, parseDecimal } from "./decimal.js";

export interface DerivedCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: "derived-from-observations";
}

export function aggregateCandles(
  points: { ts: number; price: string; volume?: string }[],
  durationSec: number,
): DerivedCandle[] {
  if (durationSec <= 0) throw new Error("Candle duration must be positive");
  const buckets = new Map<number, DerivedCandle>();
  const ordered = [...points].sort((a, b) => a.ts - b.ts);
  for (const point of ordered) {
    const bucket = Math.floor(point.ts / 1000 / durationSec) * durationSec * 1000;
    const existing = buckets.get(bucket);
    const price = parseDecimal(point.price);
    if (!existing) {
      buckets.set(bucket, {
        timestamp: bucket,
        open: point.price,
        high: point.price,
        low: point.price,
        close: point.price,
        volume: point.volume ?? "0",
        source: "derived-from-observations",
      });
      continue;
    }
    if (price > parseDecimal(existing.high)) existing.high = point.price;
    if (price < parseDecimal(existing.low)) existing.low = point.price;
    existing.close = point.price;
    if (point.volume) {
      existing.volume = formatTrim(add(parseDecimal(existing.volume), parseDecimal(point.volume)));
    }
  }
  return [...buckets.values()];
}
