import { describe, expect, it, vi } from "vitest";
import { readViewportProfile, subscribeNonPcViewport } from "./viewport-profile.js";

describe("viewport profile", () => {
    it("reads the CSS viewport width", () => {
        expect(readViewportProfile({ innerWidth: 768 })).toEqual({ viewportWidth: 768 });
    });

    it("subscribes and unsubscribes from breakpoint changes", () => {
        const addEventListener = vi.fn();
        const removeEventListener = vi.fn();
        const matchMedia = vi.fn(() => ({ matches: true, addEventListener, removeEventListener }));
        const listener = vi.fn();
        const unsubscribe = subscribeNonPcViewport(listener, { matchMedia });
        expect(matchMedia).toHaveBeenCalledWith("(max-width: 1024px)");
        expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
        unsubscribe();
        expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    });
});
