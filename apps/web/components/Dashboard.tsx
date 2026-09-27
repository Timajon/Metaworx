"use client";

import { useEffect, useState } from "react";

type Mode = "paper" | "assisted_live" | "automatic_live";

interface WatchItem {
  id: string;
  base: string;
  counter: string;
  status: string;
  bid: string | null;
  ask: string | null;
  last: string | null;
  volume24h: string | null;
  zar: { amount: string | null; quality: string; note: string };
}

interface Candle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface Analysis {
  id: number;
  ts: number;
  source: string;
  model: string | null;
  action: string | null;
  status: string;
  reason: string | null;
  expiresAt: number | null;
  costUsd: string | null;
  costNote: string | null;
  proposal: {
    rationale?: string;
    evidence?: string[];
    entry_conditions?: string[];
    invalidation_conditions?: string[];
    exit_conditions?: { stop_loss_price: string | null; take_profit_price: string | null; notes: string };
    data_limitations?: string[];
    uncalibrated_score?: number | null;
  } | null;
}

interface Dash {
  now: number;
  demo: boolean;
  mode: Mode;
  paused: boolean;
  modeNote: string;
  feed: { status: string; ageMs: number | null; source: string; lastError: string | null; stale: boolean };
  connections: { lunoPublic: string; lunoAuth: string; grok: string; stream: string };
  warnings: string[];
  selectedMarket: string;
  markets: WatchItem[];
  book: { bids: { price: string; volume: string }[]; asks: { price: string; volume: string }[]; spreadBps: number | null; timestamp: number } | null;
  trades: { price: string; volume: string; isBuy: boolean; timestamp: number }[];
  candles: { source: string; items: Candle[] };
  balances: { currency: string; balance: string; available: string; source: string }[];
  positions: { marketId: string; qty: string; avgCost: string; unrealized: string | null; mark: string | null }[];
  exposure: { used: string; max: string; currency: string };
  analyses: Analysis[];
  proposals: { id: number; market_id: string; side: string; price: string | null; base_volume: string; status: string; reason: string | null }[];
  orders: { client_order_id: string; side: string; order_type: string; status: string; price: string | null; filled_base: string; base_volume: string; fee_quote: string; source: string; mode: string }[];
  performance: {
    equity: string;
    tradingPnl: string;
    realized: string;
    unrealized: string | null;
    fees: string;
    drawdown: string;
    grokCostUsd: string;
    grokCostNote: string;
    deposits: string;
    withdrawals: string;
    seed: string;
    comparison: { note?: string; strategy?: { equity: string }[]; baseline?: { equity: string }[]; buyHold?: { equity: string }[] };
  };
  risk: {
    limits: Record<string, string | number>;
    summary: string;
    saved: boolean;
    tradesToday: number;
    dailyRealized: string;
    cooldownUntil: number;
  };
  account: { keyHint: string | null; permittedMarkets: string[]; maxExposure: string; permissions: string };
  executionNote: string;
}

async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/proxy/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload;
}

export default function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const [ticket, setTicket] = useState({ side: "BUY", type: "MARKET", quoteBudget: "1000", baseVolume: "0.001", price: "" });
  const [livePhrase, setLivePhrase] = useState("");
  const [keyHint, setKeyHint] = useState("");
  const [sellPhrase, setSellPhrase] = useState("");

  async function refresh() {
    try {
      const payload = (await api("dashboard")) as Dash;
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Engine unreachable");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, []);

  async function act(path: string, body?: unknown) {
    try {
      const result = await api(path, body ?? {}) as { ok?: boolean; error?: string; orderId?: number; paused?: boolean };
      setNotice(describeResult(result));
      await refresh();
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Action failed", kind: "error" });
    }
  }

  if (!data) {
    return <main className="shell"><header className="top"><div className="brand"><strong>SIGNALFORGE</strong><span>{error ?? "Connecting to the engine…"}</span></div></header></main>;
  }

  const modeClass = data.mode === "automatic_live" ? "automatic_live" : data.mode === "assisted_live" ? "assisted_live" : "paper";
  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <strong>SIGNALFORGE</strong>
          <span>Luno spot terminal · {data.demo ? "demo" : "credentialed"} · feed {data.feed.status}{data.feed.ageMs !== null ? ` · ${Math.max(0, Math.round(data.feed.ageMs / 1000))}s` : ""}</span>
        </div>
        <div className={`mode ${modeClass}`}>{data.mode.replaceAll("_", " ").toUpperCase()}</div>
      </header>
      <div className="layout">
        <section className="panel watch">
          <h2>ZAR markets</h2>
          <div className="scroll">
            {data.markets.filter((market) => market.counter === "ZAR").slice(0, 40).map((market) => (
              <button key={market.id} className={market.id === data.selectedMarket ? "active" : ""} onClick={() => void act("market", { marketId: market.id })}>
                <b>{market.base}/{market.counter}</b>
                <span className="num">{market.last ?? "—"}</span>
                <span className="muted">{market.zar.quality === "exact" ? "ZAR" : market.zar.quality}</span>
                <span className="muted">{market.status}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="stack">
          <div className="panel">
            <div className="row">
              <h2>{data.selectedMarket}</h2>
              <span className="muted">{data.candles.source}</span>
            </div>
            <CandleChart candles={data.candles.items} />
            <p className="warning">{data.modeNote}</p>
          </div>
          <div className="panel">
            <div className="row"><h2>Book and trades</h2><span className="muted">Spread {data.book?.spreadBps?.toFixed(2) ?? "—"} bps</span></div>
            <div className="book">
              <div>
                {(data.book?.bids ?? []).slice(0, 8).map((level) => <div className="level" key={`b-${level.price}`}><span className="bid num">{level.price}</span><span className="num">{level.volume}</span></div>)}
              </div>
              <div>
                {(data.book?.asks ?? []).slice(0, 8).map((level) => <div className="level" key={`a-${level.price}`}><span className="ask num">{level.price}</span><span className="num">{level.volume}</span></div>)}
              </div>
            </div>
            <div className="trades" style={{ marginTop: 10 }}>
              {data.trades.slice(0, 6).map((trade) => <div className="trade" key={`${trade.timestamp}-${trade.price}-${trade.volume}`}><span className={trade.isBuy ? "bid" : "ask"}>{trade.isBuy ? "buy" : "sell"} {trade.price}</span><span className="num">{trade.volume}</span></div>)}
            </div>
          </div>
          <div className="panel">
            <h2>Order ticket</h2>
            <div className="form">
              <div className="split">
                <select value={ticket.side} onChange={(event) => setTicket({ ...ticket, side: event.target.value })}><option>BUY</option><option>SELL</option></select>
                <select value={ticket.type} onChange={(event) => setTicket({ ...ticket, type: event.target.value })}><option>MARKET</option><option>LIMIT</option></select>
              </div>
              {ticket.type === "MARKET" && ticket.side === "BUY" ? <input value={ticket.quoteBudget} onChange={(event) => setTicket({ ...ticket, quoteBudget: event.target.value })} placeholder="ZAR budget" /> : <input value={ticket.baseVolume} onChange={(event) => setTicket({ ...ticket, baseVolume: event.target.value })} placeholder="Base volume" />}
              {ticket.type === "LIMIT" ? <input value={ticket.price} onChange={(event) => setTicket({ ...ticket, price: event.target.value })} placeholder="Limit price" /> : null}
              <button className="primary" onClick={() => void act("orders", { marketId: data.selectedMarket, ...ticket, confirmLive: data.mode !== "paper" })}>Submit {data.mode === "paper" ? "paper" : "live"} order</button>
              {notice ? <div className={notice.kind === "error" ? "error" : "ok"}>{notice.text}</div> : null}
            </div>
          </div>
        </section>
        <section className="stack">
          <div className="panel">
            <h2>Analysis</h2>
            <div className="muted">{data.connections.grok}</div>
            <div className="scroll">
              {data.analyses.slice(0, 6).map((item) => (
                <article className="analysis" key={item.id}>
                  <div className="row"><b>{item.action}</b><span className="tag">{item.source}</span></div>
                  <div className="muted">{new Date(item.ts).toLocaleString()} · {item.status}{item.model ? ` · ${item.model}` : ""}</div>
                  <p>{item.proposal?.rationale ?? item.reason}</p>
                  <div className="muted">Cost {item.costUsd ?? "0"} USD · {item.costNote}</div>
                  {item.proposal?.uncalibrated_score != null ? <div className="warning">Uncalibrated score {item.proposal.uncalibrated_score}. This is not a probability of profit.</div> : null}
                  <div className="muted">Expires {item.expiresAt ? new Date(item.expiresAt).toLocaleTimeString() : "—"}</div>
                </article>
              ))}
            </div>
            {data.proposals.filter((item) => item.status === "pending").map((item) => (
              <div key={item.id} className="row" style={{ marginTop: 8 }}>
                <span>{item.side} {item.base_volume} {item.market_id}</span>
                <span>
                  <button onClick={() => void act(`proposals/${item.id}/confirm`)}>Confirm</button>
                  <button onClick={() => void act(`proposals/${item.id}/reject`)}>Reject</button>
                </span>
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>Controls</h2>
            <div className="form">
              <button onClick={() => void act("pause", { paused: !data.paused })}>{data.paused ? "Resume new trades" : "Pause new trades"}</button>
              <button onClick={() => void act("controls/cancel-open")}>Cancel open orders</button>
              <input value={sellPhrase} onChange={(event) => setSellPhrase(event.target.value)} placeholder="Type SELL HOLDINGS" />
              <button className="danger" onClick={() => void act("controls/sell-holdings", { marketId: data.selectedMarket, confirmation: sellPhrase })}>Sell holdings</button>
              <input value={livePhrase} onChange={(event) => setLivePhrase(event.target.value)} placeholder="Type ENABLE LIVE TRADING" />
              <input value={keyHint} onChange={(event) => setKeyHint(event.target.value)} placeholder="Last 4 of Luno key id" />
              <div className="split">
                <button onClick={() => void act("mode", { mode: "paper" })}>Paper</button>
                <button onClick={() => void act("mode", { mode: "assisted_live", confirmation: livePhrase, keyHint })}>Assisted</button>
              </div>
              <button className="danger" onClick={() => void act("mode", { mode: "automatic_live", confirmation: livePhrase, keyHint })}>Automatic live</button>
              <div className="warning">{data.executionNote}</div>
            </div>
          </div>
        </section>
      </div>
      <section className="cards">
        <div className="panel">
          <h2>Balances and exposure</h2>
          {data.balances.map((balance) => <div className="row" key={balance.currency}><span>{balance.currency} ({balance.source})</span><b className="num">{balance.available}</b></div>)}
          {data.positions.map((position) => <div key={position.marketId} className="muted">{position.marketId} {position.qty} @ {position.avgCost} · uPnL {position.unrealized ?? "—"}</div>)}
          <div className="stat num">{data.exposure.used} / {data.exposure.max} {data.exposure.currency}</div>
        </div>
        <div className="panel">
          <h2>Paper performance</h2>
          <div className="muted">Trading P&L excludes the {data.performance.seed} ZAR seed, deposits {data.performance.deposits}, and withdrawals {data.performance.withdrawals}.</div>
          <div className="stat num">{data.performance.tradingPnl}</div>
          <div className="muted">Realized {data.performance.realized} · Unrealized {data.performance.unrealized ?? "—"} · Fees {data.performance.fees} · Drawdown {data.performance.drawdown}</div>
          <div className="muted">Grok API cost {data.performance.grokCostUsd} USD. {data.performance.grokCostNote}</div>
          <div className="muted">{data.performance.comparison.note}</div>
          <div className="muted">Latest equity — strategy {lastEquity(data.performance.comparison.strategy)} · baseline {lastEquity(data.performance.comparison.baseline)} · buy & hold {lastEquity(data.performance.comparison.buyHold)}</div>
        </div>
        <div className="panel">
          <h2>Orders and fills</h2>
          <div className="scroll">
            {data.orders.slice(0, 8).map((order) => <div key={order.client_order_id} className="row"><span>{order.side} {order.order_type} {order.status}</span><span className="num">{order.filled_base}/{order.base_volume}</span></div>)}
          </div>
        </div>
        <div className="panel">
          <h2>Risk and connection</h2>
          <div className="muted">{data.risk.summary}</div>
          <div className="muted">Trades today {data.risk.tradesToday} · daily realized {data.risk.dailyRealized} · limits {data.risk.saved ? "saved" : "not saved"}</div>
          <div className="muted">Luno {data.connections.lunoPublic} · auth {data.connections.lunoAuth} · {data.connections.stream}</div>
          <div className="muted">{data.account.permissions}</div>
          {data.warnings.slice(0, 3).map((warning) => <div key={warning} className="warning">{warning}</div>)}
          <button onClick={() => void act("risk", data.risk.limits)}>Save displayed risk limits</button>
        </div>
      </section>
    </main>
  );
}

function describeResult(result: { ok?: boolean; error?: string; orderId?: number; paused?: boolean }): { text: string; kind: "ok" | "error" } {
  if (result.ok === false || result.error) return { text: result.error ?? "Rejected", kind: "error" };
  if (result.orderId) return { text: `Order ${result.orderId} accepted`, kind: "ok" };
  if (typeof result.paused === "boolean") return { text: result.paused ? "New trades paused" : "New trades resumed", kind: "ok" };
  return { text: "Saved", kind: "ok" };
}

function lastEquity(series: { equity: string }[] | undefined): string {
  if (!series || series.length === 0) return "—";
  return series[series.length - 1]?.equity ?? "—";
}

function CandleChart({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) return <div className="chart" />;
  const closes = candles.map((candle) => Number(candle.close));
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const width = 640;
  const height = 220;
  const step = width / (closes.length - 1);
  const points = closes.map((close, index) => `${index * step},${height - ((close - min) / span) * (height - 16) - 8}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price chart">
      <polyline fill="none" stroke="#8eb6ff" strokeWidth="2" points={points} />
    </svg>
  );
}
