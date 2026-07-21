import { describe, expect, it } from "vitest";
import {
  hasValidFirebaseAuthTime,
  isAnonymousFirebaseToken,
  selectStaleBackupIds
} from "../cloudflare-backup-worker/src/index.js";

describe("Cloudflare Worker Firebase token policy", () => {
  it("rejects anonymous sign-in providers", () => {
    expect(isAnonymousFirebaseToken({
      firebase: { sign_in_provider: "anonymous" }
    })).toBe(true);
    expect(isAnonymousFirebaseToken({
      firebase: { sign_in_provider: "google.com" }
    })).toBe(false);
  });

  it("requires a valid authentication time in the past", () => {
    const now = Date.parse("2026-07-15T09:00:00Z");
    expect(hasValidFirebaseAuthTime({ auth_time: now / 1000 - 60 }, now)).toBe(true);
    expect(hasValidFirebaseAuthTime({}, now)).toBe(false);
    expect(hasValidFirebaseAuthTime({ auth_time: now / 1000 + 120 }, now)).toBe(false);
  });

  it("enforces three manual and three automatic backups independently", () => {
    const backups = [1, 2, 3, 4].flatMap(createdAt => [
      { id: `manual-${createdAt}`, reason: "manual", createdAt },
      { id: `auto-${createdAt}`, reason: "auto", createdAt }
    ]);
    expect(selectStaleBackupIds(backups).sort()).toEqual(["auto-1", "manual-1"]);
  });
});
