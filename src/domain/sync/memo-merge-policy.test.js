import { describe, expect, it } from "vitest";
import { mergeMemoPayloads, prepareLocalMemoPayload } from "./memo-merge-policy.js";

function payload(text, updatedAt) {
    return {
        categories: ["업무"],
        linkData: { 업무: [{ id: "sub-1", title: "기본", isOpen: true, links: [{ id: "link-1", text, url: "", updatedAt }] }] },
        uiPreferences: {}, driveConnection: {}, backupInfo: null, backupState: {}
    };
}

describe("memo merge policy", () => {
    it("keeps the newest entity regardless of which device syncs last", () => {
        const older = prepareLocalMemoPayload(null, payload("PC", 100), { now: 100, deviceId: "pc" });
        const newer = prepareLocalMemoPayload(older, payload("Mobile", 200), { now: 200, deviceId: "mobile" });
        expect(mergeMemoPayloads(newer, older).linkData.업무[0].links[0].text).toBe("Mobile");
        expect(mergeMemoPayloads(older, newer).linkData.업무[0].links[0].text).toBe("Mobile");
    });

    it("keeps tombstones so stale devices cannot resurrect deleted links", () => {
        const initial = prepareLocalMemoPayload(null, payload("memo", 100), { now: 100, deviceId: "pc" });
        const deleted = prepareLocalMemoPayload(initial, { ...initial, linkData: { 업무: [{ ...initial.linkData.업무[0], links: [] }] } }, { now: 200, deviceId: "pc" });
        expect(mergeMemoPayloads(initial, deleted).linkData.업무[0].links).toEqual([]);
    });

    it("merges independent edits from different devices", () => {
        const initial = prepareLocalMemoPayload(null, payload("one", 100), { now: 100, deviceId: "seed" });
        const mobileValue = structuredClone(initial);
        mobileValue.linkData.업무[0].links.push({ id: "link-2", text: "two", url: "" });
        const mobile = prepareLocalMemoPayload(initial, mobileValue, { now: 200, deviceId: "mobile" });
        const pcValue = structuredClone(initial);
        pcValue.linkData.업무[0].links[0].text = "one edited";
        const pc = prepareLocalMemoPayload(initial, pcValue, { now: 210, deviceId: "pc" });
        const merged = mergeMemoPayloads(mobile, pc);
        expect(merged.linkData.업무[0].links.map(link => link.text).sort()).toEqual(["one edited", "two"]);
    });
});
