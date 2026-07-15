import { describe, expect, it } from "vitest";
import { addBackupSuccess, createBackupState, validateImportedBackup } from "../src/domain/backups/backup-policy.js";

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

  it("does not allow another account's backup file to be restored", () => {
    expect(validateImportedBackup({ schemaVersion: 1, userId: "other", payload: {} }, "current").ok).toBe(false);
  });
});