export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

const DOCUMENT_TYPES = new Map([
    [".pdf", "application/pdf"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
]);

function extensionOf(name) {
    const match = String(name || "").toLowerCase().match(/\\.[^.]+$/);
    return match?.[0] || "";
}

export function validateDocumentAttachment(file) {
    if (!file || typeof file !== "object") {
        return { ok: false, error: "DOCUMENT_FILE_REQUIRED" };
    }

    const name = String(file.name || "").trim();
    if (!name || name.length > 180) return { ok: false, error: "DOCUMENT_NAME_INVALID" };

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
    if (uploadState === "uploaded" && !providerFileId) throw new Error("DOCUMENT_ATTACHMENT_FILE_ID_REQUIRED");

    const checksum = String(value.sha256 || "").trim().toLowerCase();
    if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) throw new Error("DOCUMENT_ATTACHMENT_CHECKSUM_INVALID");

    return {
        schemaVersion: 1,
        id,
        itemId,
        ...validation.value,
        sha256: checksum || null,
        provider: "drive",
        providerFileId,
        uploadState,
        extractState: String(value.extractState || "pending"),
        createdAt: Number.isFinite(Number(value.createdAt)) ? Math.trunc(Number(value.createdAt)) : now,
        updatedAt: Number.isFinite(Number(value.updatedAt)) ? Math.trunc(Number(value.updatedAt)) : now,
        mutationId: String(value.mutationId || "").trim().slice(0, 256),
        deleted: value.deleted === true
    };
}
