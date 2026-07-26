import { mergeVaultSnapshots, normalizeVaultFile, normalizeVaultPath, PKM_SCHEMA_VERSION } from "../../domain/pkm/vault-policy.js";

export function createVault({ deviceId = crypto.randomUUID?.() || `device_${Date.now()}` } = {}) {
    let snapshot = { schemaVersion: PKM_SCHEMA_VERSION, files: [], updatedAt: 0 };
    let sequence = 0;
    const queues = new Map();
    const listeners = new Set();

    const emit = change => listeners.forEach(listener => listener(structuredClone(snapshot), change));
    const replace = value => {
        snapshot = mergeVaultSnapshots(null, value);
        emit({ type: "replace" });
        return structuredClone(snapshot);
    };
    const read = path => snapshot.files.find(file => file.path === normalizeVaultPath(path) && !file.deleted) || null;

    async function process(path, task) {
        const normalizedPath = normalizeVaultPath(path);
        const previous = queues.get(normalizedPath) || Promise.resolve();
        const run = previous.catch(() => {}).then(() => task(read(normalizedPath)));
        const tracked = run.finally(() => {
            if (queues.get(normalizedPath) === tracked) queues.delete(normalizedPath);
        });
        queues.set(normalizedPath, tracked);
        return run;
    }

    async function write(path, content, type) {
        return process(path, () => {
            const now = Date.now();
            const next = normalizeVaultFile({
                path,
                content,
                type,
                updatedAt: now,
                mutationId: `${deviceId}:${++sequence}:${now}`
            });
            snapshot = mergeVaultSnapshots(snapshot, { files: [next], updatedAt: now });
            emit({ type: "write", path: next.path });
            return structuredClone(next);
        });
    }

    async function remove(path) {
        return process(path, current => {
            if (!current) return false;
            const now = Date.now();
            const tombstone = { ...current, content: "", deleted: true, updatedAt: now, mutationId: `${deviceId}:${++sequence}:${now}` };
            snapshot = mergeVaultSnapshots(snapshot, { files: [tombstone], updatedAt: now });
            emit({ type: "remove", path: current.path });
            return true;
        });
    }

    return {
        process,
        read: path => structuredClone(read(path)),
        list: () => snapshot.files.filter(file => !file.deleted).map(structuredClone),
        snapshot: () => structuredClone(snapshot),
        replace,
        merge(value) {
            snapshot = mergeVaultSnapshots(snapshot, value);
            emit({ type: "merge" });
            return structuredClone(snapshot);
        },
        write,
        remove,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        pending: () => queues.size
    };
}
