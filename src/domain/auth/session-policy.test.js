import { describe, expect, it } from "vitest";
import { isGuestSession, usesRemotePersistence } from "./session-policy.js";

describe("session persistence policy", () => {
    it("keeps anonymous sessions local-only", () => {
        const guest = { uid: "guest", isAnonymous: true };
        expect(isGuestSession(guest)).toBe(true);
        expect(usesRemotePersistence(guest)).toBe(false);
    });

    it("requires remote durability for registered sessions", () => {
        expect(isGuestSession({ uid: "user", isAnonymous: false })).toBe(false);
        expect(usesRemotePersistence({ uid: "user", isAnonymous: false })).toBe(true);
        expect(usesRemotePersistence(null)).toBe(false);
    });
});
