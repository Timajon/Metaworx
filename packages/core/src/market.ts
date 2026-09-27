import { cmp, formatDecimal, parseDecimal, quantize, type Amount } from "./decimal.js";
import type { MarketInfo } from "./types.js";

export interface QuantityCheck {
  ok: boolean;
  reason?: string;
  quantized: string;
}

export function checkVolume(market: MarketInfo, volume: Amount): QuantityCheck {
  const quantized = quantize(volume, market.volumeScale, "down");
  const min = parseDecimal(market.minVolume);
  const max = parseDecimal(market.maxVolume);
  if (quantized < min) {
    return { ok: false, reason: `Volume ${formatDecimal(quantized, market.volumeScale)} is below minimum ${market.minVolume}`, quantized: formatDecimal(quantized, Math.max(market.volumeScale, 0)) };
  }
  if (quantized > max) {
    return { ok: false, reason: `Volume exceeds maximum ${market.maxVolume}`, quantized: formatDecimal(quantized, Math.max(market.volumeScale, 0)) };
  }
  return { ok: true, quantized: formatDecimal(quantized, Math.max(market.volumeScale, 0)) };
}

export function checkPrice(market: MarketInfo, price: Amount): QuantityCheck {
  const quantized = quantize(price, market.priceScale, "half-up");
  const min = parseDecimal(market.minPrice);
  const max = parseDecimal(market.maxPrice);
  if (quantized < min) {
    return { ok: false, reason: `Price is below minimum ${market.minPrice}`, quantized: formatDecimal(quantized, Math.max(market.priceScale, 0)) };
  }
  if (quantized > max) {
    return { ok: false, reason: `Price exceeds maximum ${market.maxPrice}`, quantized: formatDecimal(quantized, Math.max(market.priceScale, 0)) };
  }
  return { ok: true, quantized: formatDecimal(quantized, Math.max(market.priceScale, 0)) };
}

export function pricesWithin(market: MarketInfo, price: Amount, reference: Amount, maxDistanceBps: number): boolean {
  if (reference === 0n) return false;
  const distance = price > reference ? price - reference : reference - price;
  const bps = (distance * 10_000n) / reference;
  return cmp(bps, BigInt(Math.floor(maxDistanceBps))) <= 0;
}

export function isSpotMarket(market: MarketInfo): boolean {
  return market.tradingStatus === "ACTIVE" || market.tradingStatus === "POST_ONLY";
}
