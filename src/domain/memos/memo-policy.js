import { hasLinkImages } from "./image-attachment-policy.js";

// Domain: 화면과 저장 방식에 독립적인 메모 입력 및 표시 규칙입니다.
export function normalizeMemoInput({ text, url, comment, hasImage = false }) {
    const normalizedText = String(text ?? "").trim();
    const rawUrl = String(url ?? "").trim();
    const normalizedUrl = normalizeHttpUrl(rawUrl);
    const originalComment = String(comment ?? "");
    const hasComment = originalComment.trim().length > 0;

    if (!normalizedText) return { ok: false, error: "버튼에 표시될 텍스트를 입력해주세요." };
    if (rawUrl && !normalizedUrl) return { ok: false, error: "링크는 HTTP 또는 HTTPS 주소만 입력할 수 있습니다." };
    if (!normalizedUrl && !hasImage && !hasComment) return { ok: false, error: "링크, 이미지 또는 코멘트 중 하나를 입력해주세요." };

    return { ok: true, value: { text: normalizedText, url: normalizedUrl, comment: originalComment } };
}

export function normalizeHttpUrl(value) {
    const rawUrl = String(value ?? "").trim();
    if (!rawUrl) return "";
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    try {
        const parsed = new URL(candidate);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
        return "";
    }
}

export function isCommentOnlyMemo(item) {
    return Boolean(item?.comment?.trim()) && !item?.url && !hasLinkImages(item);
}

export const COLLAPSED_COMMENT_LINE_THRESHOLD = 3;

export function countCommentLines(value) {
    const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
    return normalized ? normalized.split("\n").length : 0;
}

export const LONG_COMMENT_BREAK_THRESHOLD = COLLAPSED_COMMENT_LINE_THRESHOLD - 1;
export const countLineBreaks = value => Math.max(0, countCommentLines(value) - 1);
export const hasLongComment = value => countCommentLines(value) >= COLLAPSED_COMMENT_LINE_THRESHOLD;

export function getCommentDisplayMode(item) {
    if (!item?.comment?.trim()) return "none";
    if (!hasLongComment(item.comment)) return "inline";
    return hasLinkImages(item) ? "modal-only" : "accordion";
}

export function getMemoPreviewKind(item) {
    const hasImage = hasLinkImages(item);
    const hasComment = Boolean(item?.comment?.trim());
    if (hasImage && hasComment) return "combined";
    if (hasLongComment(item?.comment)) return "text";
    if (hasImage) return "image";
    return "none";
}
