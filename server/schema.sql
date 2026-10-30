-- マイプランナー通知サーバーのデータベース（Cloudflare D1）
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  subscription TEXT,
  created_at INTEGER NOT NULL,
  schedule_at INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
  device_id TEXT NOT NULL,
  nid TEXT NOT NULL,
  at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  sent_at INTEGER,
  PRIMARY KEY (device_id, nid)
);
CREATE INDEX IF NOT EXISTS notifications_due ON notifications (sent_at, at);

-- Google カレンダー連携（段階3-2）。このサーバーの利用者は1人なので、Google アカウントも1つだけ持つ。
CREATE TABLE IF NOT EXISTS google_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_expires INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
