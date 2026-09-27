import { resolveAmbiguousSubmission, type RemoteOrderRef } from "@signalforge/core";
import { LunoError, TimeoutError } from "./luno.js";

export interface SubmissionOutcome {
  status: "open" | "ambiguous" | "not_placed" | "rejected" | "duplicate";
  exchangeOrderId?: string;
  reason?: string;
  mayRetryNewId: boolean;
}

export async function submitWithReconcile(input: {
  clientOrderId: string;
  post: () => Promise<{ orderId: string }>;
  lookup: () => Promise<RemoteOrderRef | null>;
}): Promise<SubmissionOutcome> {
  try {
    const created = await input.post();
    return { status: "open", exchangeOrderId: created.orderId, mayRetryNewId: false };
  } catch (error) {
    if (error instanceof TimeoutError || (error instanceof Error && (error as { code?: string }).code === "TIMEOUT")) {
      return finishLookup(input.lookup);
    }
    if (error instanceof LunoError && (error.status === 409 || error.code === "ErrDuplicateClientOrderID")) {
      const looked = await finishLookup(input.lookup);
      if (looked.status === "open") return { ...looked, status: "duplicate" };
      return { status: "duplicate", mayRetryNewId: false, reason: "Luno already has this client order id. No second order was submitted." };
    }
    const message = error instanceof Error ? error.message : "Order rejected";
    return { status: "rejected", mayRetryNewId: false, reason: message };
  }
}

async function finishLookup(lookup: () => Promise<RemoteOrderRef | null>): Promise<SubmissionOutcome> {
  try {
    const remote = await lookup();
    const decision = resolveAmbiguousSubmission(remote ? "found" : "missing");
    return {
      status: decision.status,
      exchangeOrderId: remote?.exchangeOrderId,
      mayRetryNewId: decision.mayRetryNewId,
      reason: decision.status === "not_placed" ? "The exchange has no order for this client id. A retry must use a new id." : undefined,
    };
  } catch {
    const decision = resolveAmbiguousSubmission("unknown");
    return {
      status: decision.status,
      mayRetryNewId: decision.mayRetryNewId,
      reason: "Submission timed out and the exchange lookup also failed. The order stays ambiguous and will not be retried.",
    };
  }
}
