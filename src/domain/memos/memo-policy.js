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
    return Boolean(item?.comment?.trim()) && !item?.url && !item?.imageId;
}

export const LONG_COMMENT_BREAK_THRESHOLD = 10;
export const countLineBreaks = value => (String(value ?? "").match(/\n/g) || []).length;
export const hasLongComment = (value, threshold = LONG_COMMENT_BREAK_THRESHOLD) => countLineBreaks(value) >= threshold;

export function getMemoPreviewKind(item) {
    const hasImage = Boolean(item?.imageId);
    const hasText = hasLongComment(item?.comment);
    if (hasImage && hasText) return "combined";
    if (hasText) return "text";
    if (hasImage) return "image";
    return "none";
}
