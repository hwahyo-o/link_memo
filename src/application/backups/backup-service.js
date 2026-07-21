import { BACKUP_SCHEMA_VERSION } from "../../domain/backups/backup-policy.js";

function normalizeForChecksum(value) {
  if (Array.isArray(value)) return value.map(normalizeForChecksum);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter(key => value[key] !== undefined)
        .sort()
        .map(key => [key, normalizeForChecksum(value[key])])
    );
  }
  return value;
}

async function digest(value, { stable = false } = {}) {
  const serialized = JSON.stringify(stable ? normalizeForChecksum(value) : value);
  const bytes = new TextEncoder().encode(serialized);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, "0")).join("");
}

export function createBackupService({ cloudRepository }) {
  const loadEnvelope = async (user, backupId) => {
    const envelope = await cloudRepository.download(user, backupId);
    const checksum = envelope.checksum;
    const comparable = { ...envelope };
    delete comparable.checksum;
    if (!checksum || checksum !== await digest(comparable)) throw new Error("BACKUP_CHECKSUM_INVALID");
    return envelope;
  };

  return {
    configured: () => cloudRepository.configured(),

    async compare({ user, latestBackup, payload }) {
      const payloadChecksum = await digest(payload, { stable: true });
      if (!latestBackup?.id) return { changed: true, payloadChecksum, latestPayloadChecksum: null };

      let latestPayloadChecksum = latestBackup.payloadChecksum || null;
      if (!latestPayloadChecksum) {
        try {
          const envelope = await loadEnvelope(user, latestBackup.id);
          latestPayloadChecksum = envelope.payloadChecksum || await digest(envelope.payload, { stable: true });
        } catch (error) {
          if (error?.message !== "BACKUP_NOT_FOUND") throw error;
        }
      }

      return {
        changed: !latestPayloadChecksum || latestPayloadChecksum !== payloadChecksum,
        payloadChecksum,
        latestPayloadChecksum
      };
    },

    async create({ user, backupId, createdAt, reason, payload, payloadChecksum = null }) {
      const resolvedPayloadChecksum = payloadChecksum || await digest(payload, { stable: true });
      const envelope = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        userId: user.uid,
        backupId,
        createdAt,
        reason,
        payload,
        payloadChecksum: resolvedPayloadChecksum
      };
      const checksum = await digest(envelope);
      const result = await cloudRepository.upload(user, { ...envelope, checksum });
      return {
        id: result.backupId || backupId,
        createdAt: Number(result.createdAt || createdAt),
        reason: result.reason || reason,
        checksum: result.checksum || checksum,
        payloadChecksum: result.payloadChecksum || resolvedPayloadChecksum,
        size: result.size || JSON.stringify(envelope).length,
        sourceBackupId: result.backupId || backupId
      };
    },

    load({ user, backupId }) {
      return loadEnvelope(user, backupId);
    },

    remove({ user, backupId }) {
      return cloudRepository.remove(user, backupId);
    },

    async list({ user }) {
      const result = await cloudRepository.list(user);
      return Array.isArray(result.backups) ? result.backups : [];
    },

    async saveCheckpoint({ user, payload, updatedAt = Date.now() }) {
      return cloudRepository.saveCheckpoint(user, { schemaVersion: BACKUP_SCHEMA_VERSION, userId: user.uid, updatedAt, payload });
    },

    loadCheckpoint({ user }) {
      return cloudRepository.loadCheckpoint(user);
    },

    saveCheckpointKeepalive({ user, payload, updatedAt = Date.now() }) {
      return cloudRepository.saveCheckpointKeepalive({ schemaVersion: BACKUP_SCHEMA_VERSION, userId: user.uid, updatedAt, payload });
    }
  };
}
