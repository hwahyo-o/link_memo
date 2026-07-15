import { describe, expect, it } from "vitest";
import { getLatestKstBackupSlot, getNextKstBackupSlot, getKstSlotKey } from "../src/domain/backups/backup-schedule-policy.js";

describe("KST backup schedule", () => {
  it("uses fixed 4-hour slots in Korean time", () => {
    const now = Date.parse("2026-07-15T02:30:00+09:00");
    expect(getKstSlotKey(getLatestKstBackupSlot(now))).toBe("2026-07-15T00:00+09:00");
    expect(getKstSlotKey(getNextKstBackupSlot(now))).toBe("2026-07-15T04:00+09:00");
  });
  it("rolls the 20:00 slot to midnight on the next Korean day", () => {
    const now = Date.parse("2026-07-15T21:00:00+09:00");
    expect(getKstSlotKey(getNextKstBackupSlot(now))).toBe("2026-07-16T00:00+09:00");
  });
});
