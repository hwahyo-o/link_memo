import { describe, expect, it } from "vitest";
import { NON_PC_MEDIA_QUERY, isNonPcDevice } from "./device-policy.js";

describe("non-PC viewport policy", () => {
    it.each([320, 640, 768, 1024])("classifies %ipx as non-PC", viewportWidth => {
        expect(isNonPcDevice({ viewportWidth })).toBe(true);
    });

    it.each([1025, 1280, 1440])("classifies %ipx as PC", viewportWidth => {
        expect(isNonPcDevice({ viewportWidth })).toBe(false);
    });

    it("exports the same breakpoint for browser subscriptions", () => {
        expect(NON_PC_MEDIA_QUERY).toBe("(max-width: 1024px)");
    });

    it("does not infer a device class when width is unavailable", () => {
        expect(isNonPcDevice({})).toBe(false);
    });
});
