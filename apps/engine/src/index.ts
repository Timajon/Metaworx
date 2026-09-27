import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { heartbeatLock, migrate, openDatabase, releaseLock, tryAcquireLock } from "./db.js";
import { readConfig, redact } from "./env.js";
import { requestGrokAnalysis } from "./grok.js";
import { startHttp } from "./http.js";
import { LunoClient } from "./luno.js";
import { Store } from "./store.js";
import { Trader, type Analyst } from "./trader.js";

const ownerId = randomUUID();
const config = readConfig();
mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
const db = openDatabase(path.resolve(config.dbPath));
const migrationDir = fileURLToPath(new URL("../migrations", import.meta.url));
migrate(db, migrationDir);
if (!tryAcquireLock(db, ownerId, Date.now(), 20_000)) {
  console.error("Another SignalForge engine is already running. This process will not submit orders.");
  process.exit(1);
}

const luno = new LunoClient({
  baseUrl: config.lunoApiBase,
  credentials: config.lunoKeyId && config.lunoKeySecret ? { keyId: config.lunoKeyId, keySecret: config.lunoKeySecret } : null,
});
const secrets = [config.lunoKeySecret, config.xaiKey, config.accessToken].filter((value): value is string => Boolean(value));
const analyst: Analyst = {
  configured: Boolean(config.xaiKey),
  model: config.xaiModel,
  async analyze(snapshot) {
    if (!config.xaiKey) throw new Error("XAI_API_KEY is not configured");
    return requestGrokAnalysis({
      apiKey: config.xaiKey,
      baseUrl: config.xaiBase,
      model: config.xaiModel,
      snapshot,
      secrets,
    });
  },
};
const trader = new Trader(new Store(db), luno, analyst, {
  demo: config.demo,
  lunoKeyId: config.lunoKeyId,
  lunoKeySecret: config.lunoKeySecret,
  xaiKey: config.xaiKey,
  analysisIntervalMs: config.analysisIntervalMs,
  analysisMoveBps: config.analysisMoveBps,
  paperSeedZar: config.paperSeedZar,
  paperDelayMs: config.paperDelayMs,
});

const heartbeat = setInterval(() => heartbeatLock(db, ownerId, Date.now()), 5_000);
const loop = setInterval(() => {
  trader.tick().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "tick failed";
    console.error(redact(message, secrets));
  });
}, 3_000);
void trader.tick().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "initial tick failed";
  console.error(redact(message, secrets));
});

const http = await startHttp({ trader, bind: config.bind, port: config.port, accessToken: config.accessToken });
console.log(`SignalForge engine listening on http://${config.bind}:${http.port} (${config.demo ? "demo" : "credentialed"}, ${trader.mode()})`);

function shutdown(): void {
  clearInterval(heartbeat);
  clearInterval(loop);
  releaseLock(db, ownerId);
  void http.close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
