import synonymGroups from "./keyword-synonyms.json";
import { CONTENT_KIND_COLORS } from "./graph-node-policy.js";

const STOP_WORDS = new Set([
    "그리고", "그러나", "하지만", "또는", "대한", "위한", "위해", "하는", "있는", "없는",
    "내용", "관련", "버튼", "참고", "보기", "this", "that", "with", "from", "into", "http", "https", "www"
]);
const KIND_LABELS = Object.freeze({
    text: "텍스트",
    link: "링크",
    image: "이미지",
    "link-image": "링크이미지",
    "link-text": "링크텍스트",
    "image-text": "이미지텍스트",
    "link-image-text": "링크이미지텍스트"
});

export const normalizeKeyword = value => String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "");

const synonymIndex = new Map();
for (const [canonical, variants] of Object.entries(synonymGroups)) {
    const key = normalizeKeyword(canonical);
    [canonical, ...(variants || [])].forEach(value => synonymIndex.set(normalizeKeyword(value), key));
}

export const canonicalKeyword = value => {
    const normalized = normalizeKeyword(value);
    return synonymIndex.get(normalized) || normalized;
};

export function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export const toHashtag = value => String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]+/gu, "") || "미분류";

function textParts(item) {
    return [item?.comment, item?.description, item?.body, item?.note, item?.content]
        .map(value => String(value || "").trim())
        .filter(Boolean);
}

function imageEntries(item) {
    if (Array.isArray(item?.images)) return item.images.filter(Boolean);
    return item?.imageId || item?.driveImage?.fileId ? [item] : [];
}

export function classifyContentKind(item) {
    const hasLink = /^https?:\/\//i.test(String(item?.url || "").trim());
    const hasImage = imageEntries(item).length > 0;
    const hasText = textParts(item).length > 0;
    if (hasLink && hasImage && hasText) return "link-image-text";
    if (hasLink && hasImage) return "link-image";
    if (hasLink && hasText) return "link-text";
    if (hasImage && hasText) return "image-text";
    if (hasLink) return "link";
    if (hasImage) return "image";
    return "text";
}

export const colorForContentKind = kind => CONTENT_KIND_COLORS[kind] || CONTENT_KIND_COLORS.text;

function tokenize(value) {
    return String(value || "").normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || [];
}

function urlTokens(value) {
    try {
        const url = new URL(String(value || ""));
        return tokenize(`${url.hostname.replace(/^www\./, "")} ${url.pathname.replaceAll("/", " ")}`);
    } catch {
        return [];
    }
}

function scoreTokens(scores, display, values, weight) {
    values.forEach(raw => {
        const normalized = normalizeKeyword(raw);
        if (!normalized || normalized.length < 2 || STOP_WORDS.has(normalized) || /^\d+$/.test(normalized)) return;
        scores.set(normalized, (scores.get(normalized) || 0) + weight);
        if (!display.has(normalized)) display.set(normalized, String(raw).replace(/^#+/, ""));
    });
}

export function summarizeContent(item, maxLength = 180) {
    const source = textParts(item).join(" ").replace(/\s+/g, " ").trim();
    if (!source) {
        const names = imageEntries(item).map(image => image?.name || image?.alt).filter(Boolean);
        return names[0] || String(item?.url || "").trim();
    }
    const [firstSentence = source] = source.split(/(?<=[.!?。！？])\s+/u);
    return firstSentence.length <= maxLength ? firstSentence : `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`;
}

export function extractKeywords({ item, title, category, subcategory, min = 3, max = 7 }) {
    const scores = new Map();
    const display = new Map();
    const body = textParts(item).join(" ");
    const imageNames = imageEntries(item).flatMap(image => [image?.name, image?.alt]).filter(Boolean);
    const explicitTags = [...`${title} ${body}`.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].map(match => match[2]);

    scoreTokens(scores, display, explicitTags, 12);
    scoreTokens(scores, display, tokenize(title), 7);
    scoreTokens(scores, display, tokenize(body), 2);
    scoreTokens(scores, display, urlTokens(item?.url), 3);
    scoreTokens(scores, display, imageNames.flatMap(tokenize), 3);

    const selected = [...scores.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([key]) => display.get(key) || key)
        .filter((value, index, values) => values.findIndex(candidate => canonicalKeyword(candidate) === canonicalKeyword(value)) === index)
        .slice(0, max);

    const fallbacks = [title, category, subcategory, KIND_LABELS[classifyContentKind(item)]];
    for (const fallback of fallbacks) {
        if (selected.length >= min) break;
        const tag = toHashtag(fallback);
        if (!selected.some(value => canonicalKeyword(value) === canonicalKeyword(tag))) selected.push(tag);
    }
    return selected.slice(0, max);
}
