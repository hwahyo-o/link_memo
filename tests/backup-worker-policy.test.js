import { describe, expect, it } from "vitest";
import backupWorker, {
  hasValidFirebaseAuthTime,
  isAnonymousFirebaseToken,
  selectStaleBackupIds
} from "../cloudflare-backup-worker/src/index.js";

describe("Cloudflare Worker Firebase token policy", () => {
  it("exposes the deployed API contract without authentication", async () => {
    const env = { FIREBASE_PROJECT_ID: "project", ALLOWED_ORIGINS: "https://app.test", BACKUPS: {} };
    const response = await backupWorker.fetch(new Request("https://worker.test/v1/health"), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ service: "link-memo-backup", apiVersion: 1, ready: true });
  });

  it("reports an incomplete runtime configuration", async () => {
    const response = await backupWorker.fetch(new Request("https://worker.test/v1/health"), {});
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ready: false });
  });

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
