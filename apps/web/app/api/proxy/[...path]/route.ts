import { NextResponse } from "next/server";

async function forward(request: Request, path: string[]) {
  const base = process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:8787";
  const incoming = new URL(request.url);
  const target = `${base}/api/${path.join("/")}${incoming.search}`;
  const headers = new Headers();
  if (process.env.SIGNALFORGE_ACCESS_TOKEN) {
    headers.set("authorization", `Bearer ${process.env.SIGNALFORGE_ACCESS_TOKEN}`);
  }
  const init: RequestInit = { method: request.method, headers, cache: "no-store" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("content-type", "application/json");
    init.body = await request.text();
  }
  try {
    const response = await fetch(target, init);
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "SignalForge engine is not reachable." }, { status: 502 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return forward(request, params.path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  return forward(request, params.path);
}
