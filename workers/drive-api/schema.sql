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

CREATE TABLE IF NOT EXISTS drive_document_storage (
  uid TEXT PRIMARY KEY NOT NULL,
  folder_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drive_document_uploads (
  id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  session_ciphertext TEXT NOT NULL,
  session_iv TEXT NOT NULL,
  next_offset INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS drive_document_uploads_attachment_idx
ON drive_document_uploads(uid, attachment_id);

CREATE INDEX IF NOT EXISTS drive_document_uploads_uid_created_idx
ON drive_document_uploads(uid, created_at);

CREATE TABLE IF NOT EXISTS drive_document_files (
  file_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS drive_document_files_uid_idx
ON drive_document_files(uid);

CREATE UNIQUE INDEX IF NOT EXISTS drive_document_files_attachment_idx
ON drive_document_files(uid, attachment_id);
