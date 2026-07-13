CREATE TABLE IF NOT EXISTS drive_credentials (
  uid TEXT PRIMARY KEY NOT NULL,
  refresh_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  drive_email TEXT NOT NULL,
  folder_id TEXT,
  updated_at INTEGER NOT NULL
);
