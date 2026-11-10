export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

const DOCUMENT_TYPES = new Map([
    [".pdf", "application/pdf"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
]);

function extensionOf(name) {
    const match = String(name || "").toLowerCase().match(/\.[^.]+$/);
    return match?.[0] || "";
}

function hasUnsafeFileName(name) {
    return name.includes("/") || name.includes(String.fromCharCode(92))
        || [...name].some(character => character.charCodeAt(0) < 32);
}

export function validateDocumentAttachment(file) {
    if (!file || typeof file !== "object") {
        return { ok: false, error: "DOCUMENT_FILE_REQUIRED" };
    }

    const name = String(file.name || "").trim();
    if (!name || name.length > 180 || hasUnsafeFileName(name)) {
        return { ok: false, error: "DOCUMENT_NAME_INVALID" };
    }

    const expectedMimeType = DOCUMENT_TYPES.get(extensionOf(name));
    if (!expectedMimeType) return { ok: false, error: "DOCUMENT_TYPE_UNSUPPORTED" };

    const mimeType = String(file.type || "").toLowerCase();
    if (mimeType !== expectedMimeType) return { ok: false, error: "DOCUMENT_MIME_MISMATCH" };

    const sizeBytes = Number(file.size);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return { ok: false, error: "DOCUMENT_SIZE_INVALID" };
    if (sizeBytes > MAX_DOCUMENT_BYTES) return { ok: false, error: "DOCUMENT_TOO_LARGE" };

    return { ok: true, value: { name, mimeType, sizeBytes } };
}

export function normalizeDocumentAttachment(value, now = Date.now()) {
    if (!value || typeof value !== "object") throw new Error("DOCUMENT_ATTACHMENT_INVALID");

    const validation = validateDocumentAttachment({
        name: value.name,
        type: value.mimeType,
        size: value.sizeBytes
    });
    if (!validation.ok) throw new Error(validation.error);

    const id = String(value.id || "").trim();
    const itemId = String(value.itemId || "").trim();
    if (!id || id.length > 128) throw new Error("DOCUMENT_ATTACHMENT_ID_INVALID");
    if (!itemId || itemId.length > 128) throw new Error("DOCUMENT_ATTACHMENT_ITEM_ID_INVALID");

    const uploadState = String(value.uploadState || "queued");
    if (!["queued", "uploading", "uploaded", "failed"].includes(uploadState)) {
        throw new Error("DOCUMENT_ATTACHMENT_STATE_INVALID");
    }

    const providerFileId = String(value.providerFileId || "").trim() || null;
    if (providerFileId && providerFileId.length > 256) throw new Error("DOCUMENT_ATTACHMENT_FILE_ID_INVALID");

    const checksum = String(value.sha256 || "").trim().toLowerCase();
    if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) throw new Error("DOCUMENT_ATTACHMENT_CHECKSUM_INVALID");
    if (uploadState === "uploaded" && (!providerFileId || !checksum)) {
        throw new Error("DOCUMENT_ATTACHMENT_UPLOAD_RECEIPT_REQUIRED");
    }

    const extractState = String(value.extractState || "pending");
    if (!["pending", "ready", "partial", "failed", "unsupported"].includes(extractState)) {
        throw new Error("DOCUMENT_ATTACHMENT_EXTRACT_STATE_INVALID");
    }

    const createdAt = Number(value.createdAt);
    const updatedAt = Number(value.updatedAt);

    return {
        schemaVersion: 1,
        id,
        itemId,
        ...validation.value,
        sha256: checksum || null,
        provider: "drive",
        providerFileId,
        uploadState,
        extractState,
        createdAt: Number.isFinite(createdAt) && createdAt >= 0 ? Math.trunc(createdAt) : now,
        updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? Math.trunc(updatedAt) : now,
        mutationId: String(value.mutationId || "").trim().slice(0, 256),
        deleted: value.deleted === true
    };
}
