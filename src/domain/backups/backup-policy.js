export const MAX_CLOUDFLARE_BACKUPS = 3;
export const BACKUP_SCHEMA_VERSION = 1;

function normalizeBackups(value) {
  const unique = new Map();
  for (const backup of Array.isArray(value) ? value : []) {
    if (backup?.id && !unique.has(backup.id)) unique.set(backup.id, backup);
  }
  return [...unique.values()]
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
    .slice(0, MAX_CLOUDFLARE_BACKUPS);
}

export function createBackupState(value = {}) {
  return {
    version: 1,
    backups: normalizeBackups(value.backups),
    events: Array.isArray(value.events) ? value.events.slice(0, 30) : [],
    auto: value.auto || { lastAttemptAt: null, lastSuccessAt: null, lastStatus: "idle", lastError: null, lastScheduledFor: null }
  };
}

export function addBackupSuccess(state, backup) {
  const next = createBackupState(state);
  const backups = normalizeBackups([backup, ...next.backups]);
  const removed = [...next.backups, backup].filter(candidate => !backups.some(saved => saved.id === candidate.id));
  next.backups = backups;
  next.events = [{ type: "success", reason: backup.reason, createdAt: backup.createdAt, backupId: backup.id }, ...next.events].slice(0, 30);
  if (backup.reason === "auto") next.auto = { lastAttemptAt: backup.createdAt, lastSuccessAt: backup.createdAt, lastStatus: "success", lastError: null, lastScheduledFor: backup.scheduledFor || next.auto.lastScheduledFor || null };
  return { state: next, removed };
}

export function validateImportedBackup(value, userId) {
  if (!value || value.schemaVersion !== BACKUP_SCHEMA_VERSION || !value.payload) return { ok:false, error:"지원하지 않는 백업 파일입니다." };
  if (value.userId !== userId) return { ok:false, error:"현재 로그인한 계정의 백업 파일만 복원할 수 있습니다." };
  return { ok:true, value:value.payload };
}
