import { describe, expect, it } from "vitest";
import { isNonPcDevice } from "./device-policy.js";

describe("non-PC device policy", () => {
    it.each([
        ["Android phone", { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel) Mobile" }],
        ["Android tablet", { userAgent: "Mozilla/5.0 (Linux; Android 15; SM-X900)" }],
        ["iPhone", { platform: "iPhone" }],
        ["iPad", { platform: "iPad" }],
        ["iPad desktop UA", { platform: "MacIntel", maxTouchPoints: 5 }],
        ["userAgentData mobile", { mobileHint: true, platform: "Linux" }]
    ])("classifies %s as non-PC", (_, profile) => {
        expect(isNonPcDevice(profile)).toBe(true);
    });

    it.each([
        ["Windows touch laptop", { platform: "Win32", maxTouchPoints: 10, userAgent: "Windows NT 10.0" }],
        ["macOS", { platform: "MacIntel", maxTouchPoints: 0 }],
        ["Linux desktop", { platform: "Linux x86_64" }],
        ["Chromebook", { platform: "CrOS" }]
    ])("keeps %s in the PC class", (_, profile) => {
        expect(isNonPcDevice(profile)).toBe(false);
    });
});
