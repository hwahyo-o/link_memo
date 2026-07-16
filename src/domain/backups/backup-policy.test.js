import { describe, expect, it } from "vitest";
import { addBackupSuccess, createBackupState, getBackupList } from "./backup-policy.js";

describe("backup policy", () => {
  it("migrates legacy backups into separate manual and automatic catalogs", () => {
    const state = createBackupState({
      backups: [
        { id: "manual", reason: "manual", createdAt: 10 },
        { id: "auto", reason: "auto", createdAt: 20 }
      ]
    });

    expect(state.manualBackups.map(backup => backup.id)).toEqual(["manual"]);
    expect(state.autoBackups.map(backup => backup.id)).toEqual(["auto"]);
    expect(getBackupList(state).map(backup => backup.id)).toEqual(["auto", "manual"]);
  });

  it("keeps the latest three backups for each type", () => {
    let state = createBackupState();
    for (let createdAt = 1; createdAt <= 4; createdAt += 1) {
      state = addBackupSuccess(state, { id: `auto-${createdAt}`, reason: "auto", createdAt }).state;
      state = addBackupSuccess(state, { id: `manual-${createdAt}`, reason: "manual", createdAt }).state;
    }

    expect(state.autoBackups.map(backup => backup.id)).toEqual(["auto-4", "auto-3", "auto-2"]);
    expect(state.manualBackups.map(backup => backup.id)).toEqual(["manual-4", "manual-3", "manual-2"]);
    expect(getBackupList(state).map(backup => backup.id)).toEqual([
      "auto-4", "manual-4", "auto-3", "manual-3", "auto-2", "manual-2"
    ]);
  });

  it("removes only the stale backup of the same type", () => {
    const state = createBackupState({
      autoBackups: [
        { id: "auto-3", reason: "auto", createdAt: 3 },
        { id: "auto-2", reason: "auto", createdAt: 2 },
        { id: "auto-1", reason: "auto", createdAt: 1 }
      ],
      manualBackups: [{ id: "manual-1", reason: "manual", createdAt: 1 }]
    });
    const result = addBackupSuccess(state, { id: "auto-4", reason: "auto", createdAt: 4 });

    expect(result.removed.map(backup => backup.id)).toEqual(["auto-1"]);
    expect(result.state.manualBackups.map(backup => backup.id)).toEqual(["manual-1"]);
  });
});
