export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const KST_BACKUP_HOURS = [0, 4, 8, 12, 16, 20];

function kstDateParts(timestamp) {
  const date = new Date(timestamp + KST_OFFSET_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), hour: date.getUTCHours() };
}

function slotTimestamp({ year, month, day, hour }) {
  return Date.UTC(year, month, day, hour, 0, 0, 0) - KST_OFFSET_MS;
}

export function getLatestKstBackupSlot(now = Date.now()) {
  const parts = kstDateParts(now);
  const hour = [...KST_BACKUP_HOURS].reverse().find(value => value <= parts.hour);
  return slotTimestamp({ ...parts, hour: hour ?? 0 });
}

export function getNextKstBackupSlot(now = Date.now()) {
  const parts = kstDateParts(now);
  const hour = KST_BACKUP_HOURS.find(value => slotTimestamp({ ...parts, hour: value }) > now);
  if (hour !== undefined) return slotTimestamp({ ...parts, hour });
  const tomorrow = new Date(Date.UTC(parts.year, parts.month, parts.day + 1));
  return slotTimestamp({ year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth(), day: tomorrow.getUTCDate(), hour: 0 });
}

export function getKstSlotKey(timestamp) {
  const parts = kstDateParts(timestamp);
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:00+09:00`;
}
