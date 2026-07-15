export const MAX_CLOUDFLARE_BACKUPS = 3;
export const BACKUP_SCHEMA_VERSION = 1;

export function createBackupState(value = {}) {
  return {
    version: 1,
    backups: Array.isArray(value.backups) ? value.backups.slice(0, MAX_CLOUDFLARE_BACKUPS) : [],
    events: Array.isArray(value.events) ? value.events.slice(0, 30) : [],
    auto: value.auto || { lastAttemptAt: null, lastSuccessAt: null, lastStatus: "idle", lastError: null }
  };
}

export function addBackupSuccess(state, backup) {
  const next = createBackupState(state);
  const backups = [backup, ...next.backups].sort((a,b) => b.createdAt - a.createdAt);
  const removed = backups.slice(MAX_CLOUDFLARE_BACKUPS);
  next.backups = backups.slice(0, MAX_CLOUDFLARE_BACKUPS);
  next.events = [{ type: "success", reason: backup.reason, createdAt: backup.createdAt, backupId: backup.id }, ...next.events].slice(0,30);
  if (backup.reason === "auto") next.auto = { lastAttemptAt: backup.createdAt, lastSuccessAt: backup.createdAt, lastStatus: "success", lastError: null };
  return { state: next, removed };
}

export function addBackupFailure(state, { reason, createdAt, message }) {
  const next = createBackupState(state);
  next.events = [{ type: "failure", reason, createdAt, message }, ...next.events].slice(0,30);
  if (reason === "auto") next.auto = { lastAttemptAt: createdAt, lastSuccessAt: next.auto.lastSuccessAt || null, lastStatus: "failure", lastError: message };
  return next;
}

export function validateImportedBackup(value, userId) {
  if (!value || value.schemaVersion !== BACKUP_SCHEMA_VERSION || !value.payload) return { ok:false, error:"지원하지 않는 백업 파일입니다." };
  if (value.userId !== userId) return { ok:false, error:"현재 로그인한 계정의 백업 파일만 복원할 수 있습니다." };
  return { ok:true, value:value.payload };
}