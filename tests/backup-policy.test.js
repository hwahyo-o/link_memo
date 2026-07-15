import { describe, expect, it } from "vitest";
import { addBackupSuccess, addBackupUnchanged, createBackupState, validateImportedBackup } from "../src/domain/backups/backup-policy.js";

describe("Cloudflare backup retention", () => {
  it("keeps only the three newest successful backups", () => {
    let state = createBackupState();
    const removed = [];
    for (const createdAt of [1, 2, 3, 4]) {
      const result = addBackupSuccess(state, { id: `backup_test_${createdAt}`, createdAt, reason: "manual", size: 1 });
      state = result.state;
      removed.push(...result.removed.map(item => item.id));
    }
    expect(state.backups.map(item => item.id)).toEqual(["backup_test_4", "backup_test_3", "backup_test_2"]);
    expect(removed).toEqual(["backup_test_1"]);
  });

  it("records the successful automatic slot", () => {
    const result = addBackupSuccess(createBackupState(), { id: "backup_slot_1", createdAt: 10, scheduledFor: 1234, reason: "auto", size: 1 });
    expect(result.state.auto.lastScheduledFor).toBe(1234);
  });

  it("records an unchanged automatic comparison without creating a backup descriptor", () => {
    const state = addBackupUnchanged(createBackupState(), {
      reason: "auto",
      createdAt: 20,
      scheduledFor: 5678
    });
    expect(state.backups).toEqual([]);
    expect(state.auto.lastStatus).toBe("unchanged");
    expect(state.auto.lastScheduledFor).toBe(5678);
  });

  it("does not allow another account's backup file to be restored", () => {
    expect(validateImportedBackup({ schemaVersion: 1, userId: "other", payload: {} }, "current").ok).toBe(false);
  });
});