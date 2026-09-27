# SignalForge

SignalForge is a Luno spot trading terminal. A persistent Node.js engine polls Luno, asks Grok for a structured market view through the official xAI API, and applies deterministic risk checks before any order. The default mode is paper trading. Nothing switches to live trading on its own.

The Next.js dashboard talks only to the engine. Luno and xAI credentials stay in the engine process.

## What was verified

These calls were made against the public Luno API while building this project:

- `GET https://api.luno.com/api/exchange/1/markets` returns the live market list, including ZAR pairs such as `XBTZAR`, `ETHZAR`, and `USDTZAR`, with `min_volume`, `max_volume`, `price_scale`, and `volume_scale`.
- `GET https://api.luno.com/api/1/ticker?pair=XBTZAR` returns bid, ask, last trade, 24h volume, and status without authentication.
- `GET https://api.luno.com/api/1/orderbook_top?pair=XBTZAR` returns aggregated depth without authentication.
- `GET https://api.luno.com/api/exchange/1/candles` returns **401** without authentication. Charts fall back to candles built from stored ticker observations until a key is configured.

Documentation used:

- Luno REST and streaming API: https://www.luno.com/en/developers/api
- Luno South Africa exchange fee tiers: https://guide.luno.com/hc/en-gb/articles/14158595648541-Luno-fees-and-limits-in-South-Africa
- xAI models and prices: https://docs.x.ai/developers/models
- Grok 4.6: https://docs.x.ai/developers/grok-4-6
- Structured outputs: https://docs.x.ai/developers/model-capabilities/text/structured-outputs

Luno spot orders implemented from that API:

- Limit: `POST /api/1/postorder` with `BID` or `ASK`, `GTC`, `IOC`, or `FOK`, optional `post_only`, and optional `stop_price` plus `stop_direction`.
- Market: `POST /api/1/marketorder`. Buys send `counter_volume`. Sells send `base_volume`.
- Cancel: `POST /api/1/stoporder`.
- Reconciliation: `GET /api/exchange/3/order?client_order_id=` and `GET /api/exchange/2/listorders`.
- Streaming: `wss://ws.luno.com/api/1/stream/:pair` after an API key handshake. Demo mode uses REST because the stream requires credentials.
- Rate limits recorded from the docs: 300 REST calls per minute, 50 simultaneous streaming sessions. The client stays under 240 REST calls per minute.

No leverage, margin, or short selling is implemented. `SPOT_MARGIN` exists as an account type in the balances API and is ignored.

Grok is called with `POST https://api.x.ai/v1/chat/completions` and `response_format.type = json_schema`. The default model is `grok-4.6`, which is on the published price table. Structured-output examples on the xAI docs also mention `grok-4.7`, which was not on the price table retrieved here, so its cost is shown as unavailable instead of invented. There is no separate Grok bot interface in this repository; analysis is the official API only.

## Setup

Requirements: Node.js 22.

```bash
cp .env.example .env
npm install
npm run build
npm test
npm start
```

- Engine: http://127.0.0.1:8787
- Dashboard: http://127.0.0.1:3000
- Android app: `apps/android` (see below)

Development, with reload:

```bash
npm run dev
```

Demo mode is the default (`SIGNALFORGE_DEMO=1`). It uses public Luno market data and a simulated ZAR wallet. It does not send orders.

## Credentials

Create a Luno API key with only these permissions:

- View balance (`Perm_R_Balance = 1`)
- View orders (`Perm_R_Orders = 32`)
- Create orders (`Perm_W_Orders = 64`)

The bitmask is `97`. Do not enable send or withdrawal permissions. Luno's "Trading access" preset includes "Send to any address"; do not use that preset.

```bash
LUNO_API_KEY_ID=
LUNO_API_KEY_SECRET=
XAI_API_KEY=
SIGNALFORGE_DEMO=0
```

Keep `.env` off the server that the browser can read. The dashboard proxy never receives the Luno secret.

Live trading also requires:

1. `SIGNALFORGE_DEMO=0`
2. Saved risk limits in the dashboard
3. The phrase `ENABLE LIVE TRADING`
4. The last four characters of the Luno key id

Assisted live queues each strategy order for confirmation. Automatic live can submit inside those limits. Restarting the engine keeps the saved mode; it does not upgrade paper to live by itself. Selling holdings is a separate control and requires the phrase `SELL HOLDINGS`. Cancelling open orders does not sell the position.

If the engine binds anything other than loopback, set `SIGNALFORGE_ACCESS_TOKEN`. The web UI then requires that token and refuses to start for a non-local host without it. The Android app sends the same token and refuses to save a public `http://` URL.

## Trading behaviour

- Paper orders wait for `PAPER_DELAY_MS` (default 300) and then match the current book. Buys lift asks. Sells hit bids. Partial depth, IOC/FOK, post-only, and maker/taker fees are applied. Midpoint fills are not used.
- Until `GET /api/1/fee_info` succeeds, fees use the published South Africa tier-1 schedule and are labelled as such. Other regions differ.
- Grok is called on an interval (`ANALYSIS_INTERVAL_MS`, default 15 minutes) or after a move of `ANALYSIS_MOVE_BPS` (default 50). Identical unexpired snapshots are cached. It never sees credentials and never posts orders.
- Malformed, stale, expired, or out-of-range model output becomes HOLD.
- If the book or ticker is older than the stale limit, new orders pause.
- Pause new trades rejects new entries, including the order ticket. Explicit sell-holdings and backend stops still run.
- A timed-out submit is looked up by `client_order_id` before any retry. A missing order may be retried only with a new id. A failed lookup stays ambiguous.
- One SQLite lock prevents a second engine from submitting orders.
- Stop-limit orders are a documented Luno limit-order feature. Backend-managed stops are used for paper trading and as a fallback. They require this process to stay online and do not guarantee price.
- ZAR markets are exact. Other currencies are converted only when a bid path such as `USDTZAR` exists, and the UI labels that as an estimate.

## Tests

```bash
npm test
```

The suite covers decimal precision, ask-side paper fills, partial fills, fill-or-kill, execution delay, accounting versus deposits, risk limits, stale data, the pause control, invalid Grok payloads, ambiguous submit reconciliation, duplicate client ids, restart recovery, the single-engine lock, and look-ahead-safe strategy comparison. Live tests use an in-memory gateway. They do not place real orders.

## Android app

The APK is a client for the engine. It does not embed Luno or xAI keys, and it does not place orders by itself. Trading still runs in the Node process.

On the machine that runs the engine:

```bash
# .env
SIGNALFORGE_BIND=0.0.0.0
SIGNALFORGE_ACCESS_TOKEN=choose-a-long-random-token
```

Restart with `npm start`. On the phone, enter `http://<lan-address>:8787` and that token. An emulator uses `http://10.0.2.2:8787`. HTTP is accepted only for localhost and private LAN addresses. A public host must use HTTPS.

Build a debug APK (Android SDK 35, JDK 17+):

```bash
cd apps/android
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew testDebugUnitTest assembleDebug
```

The installable file is `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Install it with `adb install -r` that path. The debug build is signed with the local debug keystore.

## Limitations

- Candles, fees, balances, and order history need a Luno key. Demo charts are derived from polled tickers.
- The paper wallet is ZAR only. Non-ZAR markets can be watched; paper orders on them are rejected.
- Published ZA tier-1 fees are an estimate until `fee_info` returns the account's rate.
- Paper resting orders assume a crossed book fills the displayed size. Queue position is not modelled.
- Streaming state is implemented and tested, but the running engine uses authenticated REST so a dropped socket cannot submit a duplicate from a second view of the book. The stream helper is ready for a credentialed follow-up.
- Grok confidence is not calibrated against outcomes. The comparison panel replays stored observations; it is not a promise of profit.
- `node:sqlite` prints an experimental warning on Node 22.
- Withdrawals, sends, beneficiaries, margin, and leverage are intentionally absent.
- The Android package is a debug APK signed with the local debug keystore. It is a client of the engine, not a second trading process.
