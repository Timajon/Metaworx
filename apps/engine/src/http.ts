import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_RISK_LIMITS, type RiskLimits } from "@signalforge/core";
import type { Trader } from "./trader.js";

export function startHttp(input: {
  trader: Trader;
  bind: string;
  port: number;
  accessToken: string | null;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      if (!authorized(request, input.bind, input.accessToken)) {
        send(response, 401, { error: "Unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      if (request.method === "GET" && path === "/api/health") {
        send(response, 200, { ok: true, mode: input.trader.mode() });
        return;
      }
      if (request.method === "GET" && path === "/api/dashboard") {
        send(response, 200, input.trader.view());
        return;
      }
      if (request.method === "POST" && path === "/api/mode") {
        const body = await readJson<{ mode?: "paper" | "assisted_live" | "automatic_live"; confirmation?: string; keyHint?: string }>(request);
        const mode = body.mode ?? "paper";
        const result = input.trader.setMode(mode, body.confirmation, body.keyHint);
        send(response, 200, { ok: true, mode: input.trader.mode(), ...result });
        return;
      }
      if (request.method === "POST" && path === "/api/risk") {
        const body = await readJson<Partial<RiskLimits>>(request);
        input.trader.saveRisk({ ...DEFAULT_RISK_LIMITS, ...body, limitCurrency: "ZAR" });
        send(response, 200, { ok: true, limits: input.trader.risk() });
        return;
      }
      if (request.method === "POST" && path === "/api/pause") {
        const body = await readJson<{ paused?: boolean }>(request);
        input.trader.setPaused(Boolean(body.paused));
        send(response, 200, { ok: true, paused: input.trader.paused() });
        return;
      }
      if (request.method === "POST" && path === "/api/market") {
        const body = await readJson<{ marketId?: string }>(request);
        if (!body.marketId) throw new Error("marketId is required");
        input.trader.selectMarket(body.marketId);
        send(response, 200, { ok: true, selectedMarket: input.trader.selected() });
        return;
      }
      if (request.method === "POST" && path === "/api/orders/preview") {
        const body = await readJson<Parameters<Trader["preview"]>[0]>(request);
        send(response, 200, input.trader.preview(body));
        return;
      }
      if (request.method === "POST" && path === "/api/orders") {
        const body = await readJson<Parameters<Trader["placeManual"]>[0]>(request);
        send(response, 200, await input.trader.placeManual(body));
        return;
      }
      if (request.method === "POST" && path === "/api/controls/cancel-open") {
        send(response, 200, await input.trader.cancelOpen());
        return;
      }
      if (request.method === "POST" && path === "/api/controls/sell-holdings") {
        const body = await readJson<{ marketId?: string; confirmation?: string }>(request);
        if (!body.marketId) throw new Error("marketId is required");
        send(response, 200, await input.trader.sellHoldings(body.marketId, body.confirmation ?? ""));
        return;
      }
      const cancel = /^\/api\/orders\/([^/]+)\/cancel$/.exec(path);
      if (request.method === "POST" && cancel?.[1]) {
        send(response, 200, await input.trader.cancel(decodeURIComponent(cancel[1])));
        return;
      }
      const confirm = /^\/api\/proposals\/(\d+)\/confirm$/.exec(path);
      if (request.method === "POST" && confirm?.[1]) {
        send(response, 200, await input.trader.confirmProposal(Number(confirm[1])));
        return;
      }
      const reject = /^\/api\/proposals\/(\d+)\/reject$/.exec(path);
      if (request.method === "POST" && reject?.[1]) {
        input.trader.rejectProposal(Number(reject[1]));
        send(response, 200, { ok: true });
        return;
      }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : "Request failed" });
    }
  });
  return new Promise((resolve) => {
    server.listen(input.port, input.bind, () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

function authorized(request: IncomingMessage, bind: string, accessToken: string | null): boolean {
  const remote = request.socket.remoteAddress ?? "";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const localBind = bind === "127.0.0.1" || bind === "localhost" || bind === "::1";
  if (accessToken) {
    return request.headers.authorization === `Bearer ${accessToken}`;
  }
  return localBind && loopback;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(payload);
}
