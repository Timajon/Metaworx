import { cmp, parseDecimal } from "./decimal.js";

export interface LocalOrderRef {
  clientOrderId: string;
  exchangeOrderId: string | null;
  status: "submitting" | "ambiguous" | "open" | "partial" | "filled" | "cancelled" | "not_placed" | "rejected";
  baseVolume: string;
  filledBase: string;
}

export interface RemoteOrderRef {
  clientOrderId: string | null;
  exchangeOrderId: string;
  status: "AWAITING" | "PENDING" | "COMPLETE" | "UNKNOWN";
  baseFilled: string;
  limitVolume: string | null;
}

export interface ReconcileUpdate {
  clientOrderId: string;
  status: LocalOrderRef["status"];
  exchangeOrderId: string | null;
  filledBase: string;
  submit: false;
}

export interface ReconcileResult {
  updates: ReconcileUpdate[];
  adopted: RemoteOrderRef[];
}

export function reconcileOrders(local: LocalOrderRef[], remote: RemoteOrderRef[]): ReconcileResult {
  const byClient = new Map<string, RemoteOrderRef>();
  const byExchange = new Map<string, RemoteOrderRef>();
  for (const order of remote) {
    if (order.clientOrderId) byClient.set(order.clientOrderId, order);
    byExchange.set(order.exchangeOrderId, order);
  }
  const seen = new Set<string>();
  const updates: ReconcileUpdate[] = [];
  for (const order of local) {
    if (order.status === "filled" || order.status === "cancelled" || order.status === "rejected" || order.status === "not_placed") {
      continue;
    }
    const match =
      (order.exchangeOrderId ? byExchange.get(order.exchangeOrderId) : undefined) ?? byClient.get(order.clientOrderId);
    if (!match) {
      if (order.status === "ambiguous" || order.status === "submitting") {
        updates.push({
          clientOrderId: order.clientOrderId,
          status: "ambiguous",
          exchangeOrderId: order.exchangeOrderId,
          filledBase: order.filledBase,
          submit: false,
        });
      }
      continue;
    }
    seen.add(match.exchangeOrderId);
    const filled = match.baseFilled;
    let status: LocalOrderRef["status"] = order.status === "ambiguous" || order.status === "submitting" ? "open" : order.status;
    if (match.status === "COMPLETE") {
      const limit = parseDecimal(match.limitVolume ?? order.baseVolume);
      const got = parseDecimal(filled || "0");
      status = got <= 0n ? "cancelled" : cmp(got, limit) < 0 ? "cancelled" : "filled";
    } else if (match.status === "AWAITING" || match.status === "PENDING") {
      status = parseDecimal(filled || "0") > 0n ? "partial" : "open";
    }
    updates.push({
      clientOrderId: order.clientOrderId,
      status,
      exchangeOrderId: match.exchangeOrderId,
      filledBase: filled,
      submit: false,
    });
  }
  const adopted = remote.filter((order) => !seen.has(order.exchangeOrderId) && !local.some((item) => item.clientOrderId === order.clientOrderId));
  return { updates, adopted };
}

export type LookupOutcome = "found" | "missing" | "unknown";

export function resolveAmbiguousSubmission(outcome: LookupOutcome): {
  status: "open" | "not_placed" | "ambiguous";
  retrySameId: false;
  mayRetryNewId: boolean;
} {
  if (outcome === "found") return { status: "open", retrySameId: false, mayRetryNewId: false };
  if (outcome === "missing") return { status: "not_placed", retrySameId: false, mayRetryNewId: true };
  return { status: "ambiguous", retrySameId: false, mayRetryNewId: false };
}

export function claimClientOrderId(known: ReadonlySet<string>, inflight: Set<string>, clientOrderId: string): "ok" | "duplicate" {
  if (known.has(clientOrderId) || inflight.has(clientOrderId)) return "duplicate";
  inflight.add(clientOrderId);
  return "ok";
}
