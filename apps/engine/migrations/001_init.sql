CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS markets (
  market_id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  counter_currency TEXT NOT NULL,
  min_volume TEXT NOT NULL,
  max_volume TEXT NOT NULL,
  volume_scale INTEGER NOT NULL,
  min_price TEXT NOT NULL,
  max_price TEXT NOT NULL,
  price_scale INTEGER NOT NULL,
  fee_scale INTEGER NOT NULL,
  trading_status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  bid TEXT,
  ask TEXT,
  last_trade TEXT,
  volume_24h TEXT,
  spread_bps TEXT,
  book_json TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_obs_market_ts ON observations (market_id, ts);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  model TEXT,
  snapshot_json TEXT NOT NULL,
  raw_json TEXT,
  action TEXT,
  status TEXT NOT NULL,
  reject_reason TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd TEXT,
  cost_note TEXT,
  expires_at INTEGER,
  input_hash TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_order_id TEXT NOT NULL UNIQUE,
  exchange_order_id TEXT,
  market_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  time_in_force TEXT NOT NULL,
  post_only INTEGER NOT NULL DEFAULT 0,
  price TEXT,
  stop_price TEXT,
  stop_direction TEXT,
  base_volume TEXT NOT NULL,
  remaining_base TEXT NOT NULL,
  counter_budget TEXT,
  filled_base TEXT NOT NULL DEFAULT '0',
  filled_counter TEXT NOT NULL DEFAULT '0',
  fee_quote TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  is_exit INTEGER NOT NULL DEFAULT 0,
  eligible_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  price TEXT NOT NULL,
  base_volume TEXT NOT NULL,
  counter_volume TEXT NOT NULL,
  fee_quote TEXT NOT NULL,
  liquidity TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  price TEXT,
  base_volume TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS engine_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_id TEXT NOT NULL,
  heartbeat_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS equity_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  equity TEXT NOT NULL,
  trading_pnl TEXT NOT NULL,
  fees TEXT NOT NULL,
  drawdown TEXT NOT NULL
);
