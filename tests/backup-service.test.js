import { describe, expect, it } from "vitest";
import { createBackupService } from "../src/application/backups/backup-service.js";

function createFakeCloudRepository() {
  const objects = new Map();
  return {
    objects,
    configured: () => true,
    async upload(_user, envelope) {
      objects.set(envelope.backupId, structuredClone(envelope));
      return {
        backupId: envelope.backupId,
        createdAt: envelope.createdAt,
        reason: envelope.reason,
        checksum: envelope.checksum,
        payloadChecksum: envelope.payloadChecksum,
        size: JSON.stringify(envelope).length
      };
    },
    async download(_user, backupId) {
      const value = objects.get(backupId);
      if (!value) throw new Error("BACKUP_NOT_FOUND");
      return structuredClone(value);
    },
    async remove(_user, backupId) {
      objects.delete(backupId);
    }
  };
}

describe("backup payload comparison", () => {
  it("treats the first backup as changed", async () => {
    const service = createBackupService({ cloudRepository: createFakeCloudRepository() });
    const result = await service.compare({
      user: { uid: "user-1" },
      latestBackup: null,
      payload: { categories: ["업무"], linkData: {} }
    });
    expect(result.changed).toBe(true);
    expect(result.payloadChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not upload when the latest payload is identical", async () => {
    const repository = createFakeCloudRepository();
    const service = createBackupService({ cloudRepository: repository });
    const user = { uid: "user-1" };
    const payload = { categories: ["업무"], linkData: { 업무: [] }, uiPreferences: { darkMode: false } };
    const comparison = await service.compare({ user, latestBackup: null, payload });
    const descriptor = await service.create({
      user,
      backupId: "backup_test_identical",
      createdAt: 100,
      reason: "manual",
      payload,
      payloadChecksum: comparison.payloadChecksum
    });

    const result = await service.compare({
      user,
      latestBackup: descriptor,
      payload: { uiPreferences: { darkMode: false }, linkData: { 업무: [] }, categories: ["업무"] }
    });

    expect(result.changed).toBe(false);
    expect(repository.objects.size).toBe(1);
  });

  it("detects a real data change", async () => {
    const repository = createFakeCloudRepository();
    const service = createBackupService({ cloudRepository: repository });
    const user = { uid: "user-1" };
    const initial = { categories: ["업무"], linkData: { 업무: [] } };
    const first = await service.compare({ user, latestBackup: null, payload: initial });
    const descriptor = await service.create({
      user,
      backupId: "backup_test_changed",
      createdAt: 100,
      reason: "auto",
      payload: initial,
      payloadChecksum: first.payloadChecksum
    });

    const result = await service.compare({
      user,
      latestBackup: descriptor,
      payload: { categories: ["업무", "개인"], linkData: { 업무: [], 개인: [] } }
    });

    expect(result.changed).toBe(true);
  });

  it("can compare a legacy descriptor by loading its R2 envelope", async () => {
    const repository = createFakeCloudRepository();
    const service = createBackupService({ cloudRepository: repository });
    const user = { uid: "user-1" };
    const payload = { categories: ["업무"], linkData: { 업무: [] } };
    const comparison = await service.compare({ user, latestBackup: null, payload });
    const descriptor = await service.create({
      user,
      backupId: "backup_test_legacy",
      createdAt: 100,
      reason: "manual",
      payload,
      payloadChecksum: comparison.payloadChecksum
    });
    delete descriptor.payloadChecksum;

    const result = await service.compare({ user, latestBackup: descriptor, payload });
    expect(result.changed).toBe(false);
  });
});
