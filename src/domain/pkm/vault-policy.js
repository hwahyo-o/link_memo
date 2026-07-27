export const PKM_SCHEMA_VERSION = 1;
export const MAX_VAULT_FILE_BYTES = 2_000_000;
export const MAX_VAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_VAULT_PATH_LENGTH = 512;
const SUPPORTED_TYPES = new Set(["md", "json", "canvas"]);

export function normalizeVaultPath(value) {
    const path = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
    if (!path || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error("INVALID_VAULT_PATH");
    }
    if (path.length > MAX_VAULT_PATH_LENGTH) throw new Error("VAULT_PATH_TOO_LONG");
    return path;
}

export function normalizeVaultTimestamp(value, now = Date.now()) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp < 0) return now;
    return Math.min(Math.trunc(timestamp), Math.min(Number.MAX_SAFE_INTEGER - 1, now + MAX_VAULT_CLOCK_SKEW_MS));
}

export function inferVaultFileType(path) {
    const extension = normalizeVaultPath(path).split(".").pop()?.toLowerCase();
    return SUPPORTED_TYPES.has(extension) ? extension : "md";
}

export function normalizeVaultFile(value, now = Date.now()) {
    const path = normalizeVaultPath(value?.path);
    const content = typeof value?.content === "string" ? value.content : JSON.stringify(value?.content ?? "", null, 2);
    if (new TextEncoder().encode(content).byteLength > MAX_VAULT_FILE_BYTES) throw new Error("VAULT_FILE_TOO_LARGE");
    return {
        path,
        type: SUPPORTED_TYPES.has(value?.type) ? value.type : inferVaultFileType(path),
        content,
        updatedAt: normalizeVaultTimestamp(value?.updatedAt, now),
        mutationId: String(value?.mutationId || "").slice(0, 256),
        deleted: value?.deleted === true
    };
}

function compareFileClock(left, right) {
    const time = Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0);
    return time || String(left?.mutationId || "").localeCompare(String(right?.mutationId || ""));
}

export function mergeVaultSnapshots(left, right, now = Date.now()) {
    const files = new Map();
    for (const file of [...(left?.files || []), ...(right?.files || [])]) {
        const normalized = normalizeVaultFile(file, now);
        const current = files.get(normalized.path);
        if (!current || compareFileClock(normalized, current) >= 0) files.set(normalized.path, normalized);
    }
    return {
        schemaVersion: PKM_SCHEMA_VERSION,
        files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
        updatedAt: Math.max(
            normalizeVaultTimestamp(left?.updatedAt ?? 0, now),
            normalizeVaultTimestamp(right?.updatedAt ?? 0, now),
            ...[...files.values()].map(file => Number(file.updatedAt || 0))
        )
    };
}

export function visibleVaultFiles(snapshot) {
    return (snapshot?.files || []).filter(file => !file.deleted);
}
