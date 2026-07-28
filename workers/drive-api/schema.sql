CREATE TABLE IF NOT EXISTS drive_credentials (
  uid TEXT PRIMARY KEY NOT NULL,
  refresh_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  drive_email TEXT NOT NULL,
  folder_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drive_reconciliation_state (
  uid TEXT PRIMARY KEY NOT NULL,
  last_completed_month TEXT,
  reset_cleanup_month TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  running_month TEXT,
  running_job TEXT,
  lease_until INTEGER,
  next_page_token TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(uid) REFERENCES drive_credentials(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS drive_reconciliation_status_idx
ON drive_reconciliation_state(status, lease_until);
