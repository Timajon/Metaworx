import { parseDecimal, type Amount } from "./decimal.js";

export type PairClass = "zar-stable" | "zar-crypto" | "crypto-crypto" | "unclassified";

export interface FeeQuote {
  makerRate: string;
  takerRate: string;
  source: "luno-fee-info" | "za-tier1-published" | "conservative-unverified";
  note: string;
}

const ZAR_STABLES = new Set(["USDT", "USDC"]);

export function classifyPair(base: string, counter: string): PairClass {
  if (counter === "ZAR" && ZAR_STABLES.has(base)) return "zar-stable";
  if (counter === "ZAR") return "zar-crypto";
  const fiat = new Set(["ZAR", "ZARU", "MYR", "NGN", "IDR", "UGX", "KES", "AUD", "GBP", "EUR"]);
  if (!fiat.has(base) && !fiat.has(counter)) return "crypto-crypto";
  return "unclassified";
}

/**
 * South Africa tier 1 (R0–R20,000 30-day volume), published by Luno.
 * Other regions and higher tiers differ. Authenticated /api/1/fee_info replaces this.
 * https://guide.luno.com/hc/en-gb/articles/14158595648541-Luno-fees-and-limits-in-South-Africa
 */
export function publishedZaTier1(base: string, counter: string): FeeQuote {
  const pairClass = classifyPair(base, counter);
  if (pairClass === "zar-stable") {
    return {
      makerRate: "-0.0001",
      takerRate: "0.002",
      source: "za-tier1-published",
      note: "South Africa tier-1 USDT/ZAR or USDC/ZAR schedule. A negative maker rate is a rebate. Replace with /api/1/fee_info for the account.",
    };
  }
  if (pairClass === "zar-crypto") {
    return {
      makerRate: "0.004",
      takerRate: "0.006",
      source: "za-tier1-published",
      note: "South Africa tier-1 other crypto/ZAR schedule (maker 0.40%, taker 0.60%). Replace with /api/1/fee_info for the account.",
    };
  }
  if (pairClass === "crypto-crypto") {
    return {
      makerRate: "0.0008",
      takerRate: "0.001",
      source: "za-tier1-published",
      note: "South Africa tier-1 crypto/crypto schedule. This may not match non-ZA accounts. Replace with /api/1/fee_info.",
    };
  }
  return {
    makerRate: "0.006",
    takerRate: "0.006",
    source: "conservative-unverified",
    note: "No published tier-1 cell for this pair class. Using 0.60%, the highest South Africa tier-1 taker rate, until /api/1/fee_info is available. This is a conservative assumption, not the account's actual fee.",
  };
}

export function rateAmount(rate: string): Amount {
  return parseDecimal(rate);
}

/** Prefer the account's fee_info rates. Rates outside ±5% are treated as unusable and the published schedule is kept. */
export function accountFeeOrPublished(published: FeeQuote, account: { maker: string; taker: string }): FeeQuote {
  const maker = parseDecimal(account.maker);
  const taker = parseDecimal(account.taker);
  const bound = parseDecimal("0.05");
  if (maker > bound || maker < -bound || taker > bound || taker < -bound) return published;
  return {
    makerRate: account.maker,
    takerRate: account.taker,
    source: "luno-fee-info",
    note: "Account fee from GET /api/1/fee_info.",
  };
}
