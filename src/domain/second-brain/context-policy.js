const MAX_CONTEXT_NAME_LENGTH = 120;
const MAX_CONTEXT_DESCRIPTION_BYTES = 20_000;

export function normalizeSecondBrainContext(value, type, now = Date.now()) {
    if (!value || typeof value !== "object") throw new Error("SECOND_BRAIN_CONTEXT_INVALID");
    if (!["area", "project"].includes(type)) throw new Error("SECOND_BRAIN_CONTEXT_TYPE_INVALID");
    const id = String(value.id || "").trim();
    if (!id || id.length > 128) throw new Error("SECOND_BRAIN_CONTEXT_ID_INVALID");
    const name = String(value.name || "").trim();
    if (!name || name.length > MAX_CONTEXT_NAME_LENGTH) throw new Error("SECOND_BRAIN_CONTEXT_NAME_INVALID");
    const description = String(value.description || "").trim();
    if (new TextEncoder().encode(description).byteLength > MAX_CONTEXT_DESCRIPTION_BYTES) {
        throw new Error("SECOND_BRAIN_CONTEXT_DESCRIPTION_TOO_LARGE");
    }
    const state = String(value.state || "active");
    if (!["active", "archived"].includes(state)) throw new Error("SECOND_BRAIN_CONTEXT_STATE_INVALID");
    const updatedAt = Number(value.updatedAt);
    const capturedAt = Number(value.createdAt);
    return {
        schemaVersion: 1,
        id,
        type,
        name,
        description,
        state,
        createdAt: Number.isFinite(capturedAt) && capturedAt >= 0 ? Math.trunc(capturedAt) : now,
        updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? Math.trunc(updatedAt) : now,
        mutationId: String(value.mutationId || "").trim().slice(0, 256),
        deleted: value.deleted === true
    };
}
