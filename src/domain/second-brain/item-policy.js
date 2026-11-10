const SCHEMA_VERSION = 1;
const MAX_BODY_BYTES = 2_000_000;
const MAX_TITLE_LENGTH = 300;
const MAX_ID_LENGTH = 128;
const MAX_RELATION_COUNT = 100;
const MAX_TAG_LENGTH = 80;
const ALLOWED_KINDS = new Set(["note", "link", "image", "document", "daily", "canvas", "structured"]);
const ALLOWED_STATES = new Set(["inbox", "processed", "archived"]);
const LEGACY_KINDS = new Set(["canvas", "structured"]);

function requireText(value, errorCode, maxLength = MAX_ID_LENGTH) {
    const text = String(value || "").trim();
    if (!text || text.length > maxLength) throw new Error(errorCode);
    return text;
}

function normalizeTextList(values, maxLength, errorCode) {
    if (!Array.isArray(values)) return [];
    if (values.length > MAX_RELATION_COUNT) throw new Error(errorCode);
    return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
        .map(value => {
            if (value.length > maxLength) throw new Error(errorCode);
            return value;
        });
}

function normalizeOptionalUrl(value) {
    if (!value) return null;
    let url;
    try {
        url = new URL(String(value).trim());
    } catch {
        throw new Error("SECOND_BRAIN_URL_INVALID");
    }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("SECOND_BRAIN_URL_INVALID");
    return url.toString();
}

function normalizeTimestamp(value, fallback) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp < 0) return fallback;
    return Math.trunc(timestamp);
}

function assertBodySize(bodyMarkdown) {
    const size = new TextEncoder().encode(bodyMarkdown).byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("SECOND_BRAIN_BODY_TOO_LARGE");
}

export function normalizeSecondBrainItem(value, now = Date.now()) {
    if (!value || typeof value !== "object") throw new Error("SECOND_BRAIN_ITEM_INVALID");

    const kind = String(value.kind || "");
    if (!ALLOWED_KINDS.has(kind)) throw new Error("SECOND_BRAIN_KIND_INVALID");

    const legacyPath = value.legacyPath ? requireText(value.legacyPath, "SECOND_BRAIN_LEGACY_PATH_INVALID", 512) : null;
    const id = requireText(value.id, "SECOND_BRAIN_ID_INVALID", legacyPath ? 520 : MAX_ID_LENGTH);
    if (LEGACY_KINDS.has(kind) && !legacyPath) throw new Error("SECOND_BRAIN_LEGACY_KIND_REQUIRED");

    const state = String(value.state || "inbox");
    if (!ALLOWED_STATES.has(state)) throw new Error("SECOND_BRAIN_STATE_INVALID");

    const title = requireText(value.title, "SECOND_BRAIN_TITLE_REQUIRED", MAX_TITLE_LENGTH);
    const bodyMarkdown = typeof value.bodyMarkdown === "string" ? value.bodyMarkdown : "";
    assertBodySize(bodyMarkdown);

    const sourceUrl = normalizeOptionalUrl(value.sourceUrl);
    if (kind === "link" && !sourceUrl) throw new Error("SECOND_BRAIN_LINK_URL_REQUIRED");

    const updatedAt = normalizeTimestamp(value.updatedAt, now);
    const capturedAt = normalizeTimestamp(value.capturedAt, updatedAt);
    const mutationId = String(value.mutationId || "").trim().slice(0, 256);

    return {
        schemaVersion: SCHEMA_VERSION,
        id,
        kind,
        title,
        bodyMarkdown,
        sourceUrl,
        sourceLabel: String(value.sourceLabel || "").trim().slice(0, MAX_TITLE_LENGTH),
        tags: normalizeTextList(value.tags, MAX_TAG_LENGTH, "SECOND_BRAIN_TAGS_INVALID"),
        areaIds: normalizeTextList(value.areaIds, MAX_ID_LENGTH, "SECOND_BRAIN_AREAS_INVALID"),
        projectIds: normalizeTextList(value.projectIds, MAX_ID_LENGTH, "SECOND_BRAIN_PROJECTS_INVALID"),
        relatedIds: normalizeTextList(value.relatedIds, MAX_ID_LENGTH, "SECOND_BRAIN_RELATIONS_INVALID"),
        attachmentIds: normalizeTextList(value.attachmentIds, MAX_ID_LENGTH, "SECOND_BRAIN_ATTACHMENTS_INVALID"),
        state,
        capturedAt,
        updatedAt,
        mutationId,
        legacyPath,
        deleted: value.deleted === true
    };
}

export const secondBrainPolicy = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    maxBodyBytes: MAX_BODY_BYTES,
    maxTitleLength: MAX_TITLE_LENGTH,
    maxRelationCount: MAX_RELATION_COUNT
});
