import { describe, expect, it } from "vitest";
import {
    countCommentLines,
    getCommentDisplayMode,
    getMemoPreviewKind,
    hasLongComment
} from "./memo-policy.js";

const withImage = item => ({ ...item, images: [{ id: "image-1", imageId: "stored-image-1" }] });

describe("comment display policy", () => {
    it("normalizes line endings and counts explicit blank lines", () => {
        expect(countCommentLines("한 줄")).toBe(1);
        expect(countCommentLines("첫 줄\r\n둘째 줄")).toBe(2);
        expect(countCommentLines("첫 줄\r\n\r\n셋째 줄")).toBe(3);
        expect(countCommentLines("   ")).toBe(0);
    });

    it("keeps one or two logical lines inline", () => {
        expect(getCommentDisplayMode({ comment: "한 줄" })).toBe("inline");
        expect(getCommentDisplayMode({ comment: "첫 줄\n둘째 줄", url: "https://example.com" })).toBe("inline");
        expect(hasLongComment("첫 줄\n둘째 줄")).toBe(false);
    });

    it("uses an accordion for text-only comments with at least three lines", () => {
        const item = { comment: "첫 줄\n둘째 줄\n셋째 줄", url: "https://example.com" };
        expect(getCommentDisplayMode(item)).toBe("accordion");
        expect(hasLongComment(item.comment)).toBe(true);
        expect(getMemoPreviewKind(item)).toBe("text");
    });

    it("hides long image comments inline while preserving the combined modal", () => {
        const item = withImage({ comment: "첫 줄\n둘째 줄\n셋째 줄" });
        expect(getCommentDisplayMode(item)).toBe("modal-only");
        expect(getMemoPreviewKind(item)).toBe("combined");
    });

    it("shows a one-line image comment inline and in the combined modal", () => {
        const item = withImage({ comment: "한 줄" });
        expect(getCommentDisplayMode(item)).toBe("inline");
        expect(getMemoPreviewKind(item)).toBe("combined");
    });
});
