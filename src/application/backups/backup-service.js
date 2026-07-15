import { BACKUP_SCHEMA_VERSION } from "../../domain/backups/backup-policy.js";

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2,"0")).join("");
}

export function createBackupService({ cloudRepository }) {
  return {
    configured: () => cloudRepository.configured(),
    async create({ user, backupId, createdAt, reason, payload }) {
      const envelope = { schemaVersion: BACKUP_SCHEMA_VERSION, userId:user.uid, backupId, createdAt, reason, payload };
      const checksum = await digest(envelope);
      const result = await cloudRepository.upload(user, { ...envelope, checksum });
      return { id: backupId, createdAt, reason, checksum, size: result.size || JSON.stringify(envelope).length, sourceBackupId: backupId };
    },
    async load({ user, backupId }) {
      const envelope = await cloudRepository.download(user, backupId);
      const checksum = envelope.checksum;
      const comparable = { ...envelope }; delete comparable.checksum;
      if (!checksum || checksum !== await digest(comparable)) throw new Error("BACKUP_CHECKSUM_INVALID");
      return envelope;
    },
    remove({ user, backupId }) { return cloudRepository.remove(user, backupId); }
  };
}