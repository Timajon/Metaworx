import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadEnvFile(file = path.resolve(process.cwd(), ".env")): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export interface AppConfig {
  demo: boolean;
  bind: string;
  port: number;
  dbPath: string;
  accessToken: string | null;
  lunoKeyId: string | null;
  lunoKeySecret: string | null;
  lunoApiBase: string;
  lunoWsBase: string;
  xaiKey: string | null;
  xaiBase: string;
  xaiModel: string;
  analysisIntervalMs: number;
  analysisMoveBps: number;
  paperSeedZar: string;
  paperDelayMs: number;
}

export function readConfig(): AppConfig {
  loadEnvFile();
  return {
    demo: (process.env.SIGNALFORGE_DEMO ?? "1") !== "0",
    bind: process.env.SIGNALFORGE_BIND ?? "127.0.0.1",
    port: Number(process.env.SIGNALFORGE_PORT ?? 8787),
    dbPath: process.env.SIGNALFORGE_DB ?? "./data/signalforge.sqlite",
    accessToken: blankToNull(process.env.SIGNALFORGE_ACCESS_TOKEN),
    lunoKeyId: blankToNull(process.env.LUNO_API_KEY_ID),
    lunoKeySecret: blankToNull(process.env.LUNO_API_KEY_SECRET),
    lunoApiBase: process.env.LUNO_API_BASE ?? "https://api.luno.com",
    lunoWsBase: process.env.LUNO_WS_BASE ?? "wss://ws.luno.com",
    xaiKey: blankToNull(process.env.XAI_API_KEY),
    xaiBase: process.env.XAI_BASE_URL ?? "https://api.x.ai/v1",
    xaiModel: process.env.XAI_MODEL ?? "grok-4.6",
    analysisIntervalMs: Number(process.env.ANALYSIS_INTERVAL_MS ?? 900_000),
    analysisMoveBps: Number(process.env.ANALYSIS_MOVE_BPS ?? 50),
    paperSeedZar: process.env.PAPER_SEED_ZAR ?? "100000",
    paperDelayMs: Number(process.env.PAPER_DELAY_MS ?? 300),
  };
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function redact(text: string, secrets: string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret && secret.length > 4) output = output.split(secret).join("[redacted]");
  }
  return output;
}
