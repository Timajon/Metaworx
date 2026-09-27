import { ANALYSIS_JSON_SCHEMA, assertSnapshotHasNoSecrets, modelCostUsd } from "@signalforge/core";

const SYSTEM_PROMPT = [
  "You are the analysis component of SignalForge, a spot-only Luno trading terminal.",
  "You never place orders and you never ask for exchange credentials.",
  "Return only the required JSON object.",
  "Prefer HOLD when the snapshot is thin, stale, or the spread and depth do not support a trade.",
  "Buys lift asks and sells hit bids. Do not treat the midpoint as executable.",
  "Any numeric score you return is uncalibrated and is not a probability of profit.",
  "Do not invent prices, volumes, or fills that are not supported by the snapshot.",
  "Suggested base volume must respect min_volume, max_volume, and permitted_actions.",
  "Spot markets only. No leverage, margin, or short selling.",
].join(" ");

export interface GrokUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  estimatedCostUsd: string;
  costKnown: boolean;
  costNote: string;
}

export interface GrokResult {
  raw: unknown;
  model: string;
  usage: GrokUsage;
}

export async function requestGrokAnalysis(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  snapshot: unknown;
  secrets: string[];
  fetchImpl?: typeof fetch;
}): Promise<GrokResult> {
  assertSnapshotHasNoSecrets(input.snapshot, input.secrets);
  const response = await (input.fetchImpl ?? fetch)(`${input.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
      "x-grok-conv-id": `signalforge-${(input.snapshot as { market?: { id?: string } }).market?.id ?? "market"}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input.snapshot) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "market_analysis",
          strict: true,
          schema: ANALYSIS_JSON_SCHEMA,
        },
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`xAI API returned ${response.status}`);
  }
  const body = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    model?: string;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("xAI API returned an empty analysis");
  const raw = JSON.parse(content) as unknown;
  assertSnapshotHasNoSecrets(raw, input.secrets);
  const promptTokens = body.usage?.prompt_tokens ?? 0;
  const completionTokens = body.usage?.completion_tokens ?? 0;
  const cachedTokens = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const model = body.model || input.model;
  const cost = modelCostUsd({ model: input.model, promptTokens, cachedTokens, completionTokens });
  return {
    raw,
    model,
    usage: {
      promptTokens,
      completionTokens,
      cachedTokens,
      estimatedCostUsd: cost.known ? cost.usd : "0",
      costKnown: cost.known,
      costNote: cost.note,
    },
  };
}
