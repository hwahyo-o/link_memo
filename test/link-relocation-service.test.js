import { describe, expect, it } from "vitest";
import { relocateLink } from "../src/application/memos/link-relocation-service.js";

describe("relocateLink", () => {
    it("keeps link data while moving it to another category and subcategory", () => {
        const linkData = { 업무: [{ id: "a", links: [{ id: "link", text: "이전", url: "https://example.com", images: [{ imageId: "image" }] }] }], 개인: [{ id: "b", links: [] }] };
        const result = relocateLink({ linkData, sourceCategory: "업무", sourceSubcategoryId: "a", linkId: "link", targetCategory: "개인", targetSubcategoryId: "b", text: "변경" });
        expect(result.ok).toBe(true);
        expect(linkData.업무[0].links).toHaveLength(0);
        expect(linkData.개인[0].links[0]).toMatchObject({ text: "변경", url: "https://example.com", images: [{ imageId: "image" }] });
    });
});