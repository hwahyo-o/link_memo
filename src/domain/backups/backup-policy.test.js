import { describe, expect, it } from "vitest";
import { addBackupSuccess, createBackupState } from "./backup-policy.js";

describe("backup policy", () => {
  it("keeps manual and automatic backups together in newest-first order", () => {
    const state = createBackupState({
      backups: [
        { id: "manual-old", reason: "manual", createdAt: 10 },
        { id: "auto-new", reason: "auto", createdAt: 30 },
        { id: "manual-mid", reason: "manual", createdAt: 20 }
      ]
    });

    expect(state.backups.map(backup => backup.id)).toEqual(["auto-new", "manual-mid", "manual-old"]);
  });

  it("retains the newest three catalog entries and returns stale objects", () => {
    const initial = createBackupState({
      backups: [
        { id: "old", reason: "auto", createdAt: 1 },
        { id: "mid", reason: "manual", createdAt: 2 },
        { id: "new", reason: "auto", createdAt: 3 }
      ]
    });
    const result = addBackupSuccess(initial, { id: "latest", reason: "manual", createdAt: 4 });

    expect(result.state.backups.map(backup => backup.id)).toEqual(["latest", "new", "mid"]);
    expect(result.removed.map(backup => backup.id)).toEqual(["old"]);
  });
});
