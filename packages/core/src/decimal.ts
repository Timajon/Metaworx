const SCALE = 18;
const POW = 10n ** BigInt(SCALE);

export type Amount = bigint;

export function parseDecimal(input: string): Amount {
  const trimmed = input.trim();
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid decimal: ${input}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] ?? "0";
  const frac = match[3] ?? "";
  let base = whole + frac.slice(0, SCALE).padEnd(SCALE, "0");
  base = base.replace(/^0+(?=\d)/, "");
  let value = BigInt(base);
  const extra = frac.slice(SCALE);
  if (extra.length > 0 && (extra[0] ?? "0") >= "5") {
    value += 1n;
  }
  return value * sign;
}

export function quantize(value: Amount, scale: number, mode: "half-up" | "down"): Amount {
  const stepExp = SCALE - scale;
  if (stepExp <= 0) return value;
  const step = 10n ** BigInt(stepExp);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const units = mode === "down" ? abs / step : (abs + step / 2n) / step;
  const rounded = units * step;
  return negative ? -rounded : rounded;
}

export function formatDecimal(value: Amount, scale: number): string {
  const digits = Math.max(0, scale);
  const rounded = quantize(value, digits, "half-up");
  const negative = rounded < 0n;
  const abs = negative ? -rounded : rounded;
  const raw = abs.toString().padStart(SCALE + 1, "0");
  const intPart = raw.slice(0, raw.length - SCALE).replace(/^0+(?=\d)/, "");
  const frac = digits > 0 ? raw.slice(raw.length - SCALE, raw.length - SCALE + digits) : "";
  const body = digits > 0 ? `${intPart}.${frac}` : intPart;
  return negative && rounded !== 0n ? `-${body}` : body;
}

export function formatTrim(value: Amount, maxScale = 12): string {
  const text = formatDecimal(value, maxScale);
  if (!text.includes(".")) return text;
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function add(a: Amount, b: Amount): Amount {
  return a + b;
}

export function sub(a: Amount, b: Amount): Amount {
  return a - b;
}

export function mul(a: Amount, b: Amount): Amount {
  const product = a * b;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + POW / 2n) / POW;
  return negative ? -rounded : rounded;
}

export function div(a: Amount, b: Amount): Amount {
  if (b === 0n) throw new Error("Division by zero");
  const product = a * POW;
  const negative = (product < 0n) !== (b < 0n);
  const absProduct = product < 0n ? -product : product;
  const absDivisor = b < 0n ? -b : b;
  const rounded = (absProduct + absDivisor / 2n) / absDivisor;
  return negative ? -rounded : rounded;
}

export function cmp(a: Amount, b: Amount): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function min(a: Amount, b: Amount): Amount {
  return a < b ? a : b;
}

export function max(a: Amount, b: Amount): Amount {
  return a > b ? a : b;
}

export function abs(value: Amount): Amount {
  return value < 0n ? -value : value;
}

export function isZero(value: Amount): boolean {
  return value === 0n;
}

export function isPositive(value: Amount): boolean {
  return value > 0n;
}

export function ratioBps(numerator: Amount, denominator: Amount): number {
  if (denominator === 0n) return Number.POSITIVE_INFINITY;
  const scaled = (abs(numerator) * 10_000_000n) / abs(denominator);
  return Number(scaled) / 1000;
}
