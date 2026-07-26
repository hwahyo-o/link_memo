export const PKM_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 2_000_000;
const SUPPORTED_TYPES = new Set(["md", "json", "canvas"]);

export function normalizeVaultPath(value) {
    const path = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
    if (!path || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error("INVALID_VAULT_PATH");
    }
    return path.slice(0, 512);
}

export function inferVaultFileType(path) {
    const extension = normalizeVaultPath(path).split(".").pop()?.toLowerCase();
    return SUPPORTED_TYPES.has(extension) ? extension : "md";
}

export function normalizeVaultFile(value, now = Date.now()) {
    const path = normalizeVaultPath(value?.path);
    const content = typeof value?.content === "string" ? value.content : JSON.stringify(value?.content ?? "", null, 2);
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new Error("VAULT_FILE_TOO_LARGE");
    return {
        path,
        type: SUPPORTED_TYPES.has(value?.type) ? value.type : inferVaultFileType(path),
        content,
        updatedAt: Number(value?.updatedAt || now),
        mutationId: String(value?.mutationId || ""),
        deleted: value?.deleted === true
    };
}

function compareFileClock(left, right) {
    const time = Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0);
    return time || String(left?.mutationId || "").localeCompare(String(right?.mutationId || ""));
}

export function mergeVaultSnapshots(left, right) {
    const files = new Map();
    for (const file of [...(left?.files || []), ...(right?.files || [])]) {
        const normalized = normalizeVaultFile(file);
        const current = files.get(normalized.path);
        if (!current || compareFileClock(normalized, current) >= 0) files.set(normalized.path, normalized);
    }
    return {
        schemaVersion: PKM_SCHEMA_VERSION,
        files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
        updatedAt: Math.max(
            Number(left?.updatedAt || 0),
            Number(right?.updatedAt || 0),
            ...[...files.values()].map(file => Number(file.updatedAt || 0))
        )
    };
}

export function visibleVaultFiles(snapshot) {
    return (snapshot?.files || []).filter(file => !file.deleted);
}
