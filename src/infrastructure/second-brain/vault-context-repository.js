import { normalizeSecondBrainContext } from "../../domain/second-brain/context-policy.js";

const CONTEXT_DIRECTORY = Object.freeze({
    area: "Second Brain/areas",
    project: "Second Brain/projects"
});

function contextPath(type, id) {
    const directory = CONTEXT_DIRECTORY[type];
    if (!directory) throw new Error("SECOND_BRAIN_CONTEXT_TYPE_INVALID");
    return `${directory}/${encodeURIComponent(id)}.json`;
}

function parseContext(file, type) {
    const context = normalizeSecondBrainContext(JSON.parse(file.content), type);
    if (contextPath(type, context.id) !== file.path) throw new Error("SECOND_BRAIN_CONTEXT_PATH_MISMATCH");
    return context;
}

export function createVaultSecondBrainContextRepository({
    vault,
    userId,
    getCurrentUserId = () => userId,
    deviceId = crypto.randomUUID?.() || `second-brain-context-${Date.now()}`
} = {}) {
    if (!vault?.read || !vault?.list || !vault?.write) throw new Error("SECOND_BRAIN_VAULT_REQUIRED");
    const ownerId = String(userId || "").trim();
    if (!ownerId) throw new Error("SECOND_BRAIN_USER_REQUIRED");
    let sequence = 0;

    function assertOwner() {
        if (String(getCurrentUserId?.() || "").trim() !== ownerId) throw new Error("SECOND_BRAIN_USER_MISMATCH");
    }

    function readFile(type, id) {
        assertOwner();
        const file = vault.read(contextPath(type, String(id || "").trim()));
        if (!file) return null;
        try {
            const context = parseContext(file, type);
            assertOwner();
            return context;
        } catch (error) {
            throw Object.assign(new Error(error.message || "SECOND_BRAIN_CONTEXT_INVALID"), { cause: error, path: file.path });
        }
    }

    async function save(value, type) {
        assertOwner();
        const id = String(value?.id || "").trim();
        const existing = id ? readFile(type, id) : null;
        const now = Math.max(Date.now(), Number(existing?.updatedAt || 0) + 1);
        const context = normalizeSecondBrainContext({
            ...existing,
            ...value,
            id: id || crypto.randomUUID(),
            type,
            createdAt: value?.createdAt ?? existing?.createdAt ?? now,
            updatedAt: now,
            mutationId: `${deviceId}:${++sequence}:${now}`
        }, type, now);
        assertOwner();
        await vault.write(contextPath(type, context.id), JSON.stringify(context), "json");
        assertOwner();
        return context;
    }

    return {
        async list(type, { includeArchived = false, includeDeleted = false } = {}) {
            assertOwner();
            const directory = CONTEXT_DIRECTORY[type];
            if (!directory) throw new Error("SECOND_BRAIN_CONTEXT_TYPE_INVALID");
            const contexts = [];
            const invalid = [];
            for (const file of vault.list().filter(entry => entry.path.startsWith(`${directory}/`) && entry.path.endsWith(".json"))) {
                try {
                    const context = parseContext(file, type);
                    if (includeDeleted || !context.deleted) {
                        if (includeArchived || context.state === "active") contexts.push(context);
                    }
                } catch (error) {
                    invalid.push({ path: file.path, error: error.message || "SECOND_BRAIN_CONTEXT_INVALID" });
                }
            }
            assertOwner();
            return { contexts: contexts.sort((left, right) => left.name.localeCompare(right.name, "ko")), invalid };
        },

        async get(type, id) {
            return readFile(type, id);
        },

        save,

        async archive(type, id, archived = true) {
            const context = readFile(type, id);
            if (!context) return null;
            return save({ ...context, state: archived ? "archived" : "active" }, type);
        }
    };
}
