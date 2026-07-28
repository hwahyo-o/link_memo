import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controller = readFileSync(new URL("../src/presentation/app-controller.js", import.meta.url), "utf8");

describe("guest local-only session wiring", () => {
    it("initializes a new guest as a ready local session", () => {
        expect(controller).toContain("if (!restoredLocal) initializeGuestMemoSession()");
        expect(controller).toContain('dataLoadState = "ready"');
    });

    it("promotes local data when an anonymous account is linked", () => {
        expect(controller).toContain("const linkedFromGuest = isGuestSession(currentUser) && usesRemotePersistence(user)");
        expect(controller).toContain("void activateLinkedAccount(user)");
        expect(controller).toContain("await flushMemoSync({ allowCreate: true, throwOnError: true })");
    });

    it("guards every memo remote-entry point with the session policy", () => {
        expect(controller).toContain("if (!usesRemotePersistence(currentUser)) return;");
        expect(controller).toContain("if (!usesRemotePersistence(currentUser) || isDeletingAccount) return;");
    });
});
