import { div, formatTrim, mul, parseDecimal, type Amount } from "./decimal.js";

export interface ZarQuote {
  amount: string | null;
  quality: "exact" | "estimated" | "unavailable";
  note: string;
}

export function toZar(input: {
  amount: Amount;
  currency: string;
  zarPairs: Record<string, { bid: string; ask: string } | undefined>;
}): ZarQuote {
  if (input.currency === "ZAR") {
    return { amount: formatTrim(input.amount), quality: "exact", note: "Amount is already denominated in ZAR." };
  }
  const direct = input.zarPairs[`${input.currency}ZAR`];
  if (direct?.bid) {
    const zar = mul(input.amount, parseDecimal(direct.bid));
    return {
      amount: formatTrim(zar),
      quality: "estimated",
      note: `Estimated with the ${input.currency}ZAR bid. This is a conversion estimate, not an executed price.`,
    };
  }
  const usdt = input.zarPairs.USDTZAR;
  const via = input.zarPairs[`${input.currency}USDT`];
  if (usdt?.bid && via?.bid) {
    const usd = mul(input.amount, parseDecimal(via.bid));
    const zar = mul(usd, parseDecimal(usdt.bid));
    return {
      amount: formatTrim(zar),
      quality: "estimated",
      note: `Estimated through ${input.currency}USDT and USDTZAR bids.`,
    };
  }
  if (usdt?.bid && input.currency === "USDT") {
    return {
      amount: formatTrim(mul(input.amount, parseDecimal(usdt.bid))),
      quality: "estimated",
      note: "Estimated with the USDTZAR bid.",
    };
  }
  return { amount: null, quality: "unavailable", note: `No ZAR conversion path is available for ${input.currency}.` };
}

export function midNotUsed(bid: Amount, ask: Amount): Amount {
  return div(bid + ask, parseDecimal("2"));
}
