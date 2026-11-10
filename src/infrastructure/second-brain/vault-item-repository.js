import { normalizeSecondBrainItem } from "../../domain/second-brain/item-policy.js";

const ITEM_DIRECTORY = "Second Brain/items";
const MAX_VAULT_FILE_BYTES = 2_000_000;

function itemPath(id) {
    return `${ITEM_DIRECTORY}/${encodeURIComponent(id)}.json`;
}

function parseItemFile(file) {
    let value;
    try {
        value = JSON.parse(file.content);
    } catch (cause) {
        throw Object.assign(new Error("SECOND_BRAIN_ITEM_JSON_INVALID"), { cause, path: file.path });
    }
    const item = normalizeSecondBrainItem(value);
    if (itemPath(item.id) !== file.path) throw new Error("SECOND_BRAIN_ITEM_PATH_MISMATCH");
    return item;
}

export function createVaultSecondBrainItemRepository({
    vault,
    userId,
    getCurrentUserId = () => userId,
    deviceId = crypto.randomUUID?.() || `second-brain-${Date.now()}`
} = {}) {
    if (!vault?.read || !vault?.list || !vault?.write) throw new Error("SECOND_BRAIN_VAULT_REQUIRED");
    const ownerId = String(userId || "").trim();
    if (!ownerId) throw new Error("SECOND_BRAIN_USER_REQUIRED");
    let sequence = 0;

    function assertOwner() {
        if (String(getCurrentUserId?.() || "").trim() !== ownerId) {
            throw new Error("SECOND_BRAIN_USER_MISMATCH");
        }
    }

    async function read(id) {
        assertOwner();
        const path = itemPath(String(id || "").trim());
        const file = vault.read(path);
        const item = file ? parseItemFile(file) : null;
        assertOwner();
        return item;
    }

    async function saveItem(value) {
        const id = String(value?.id || "").trim();
        if (!id) throw new Error("SECOND_BRAIN_ID_INVALID");
        const existing = await read(id);
        const now = Math.max(Date.now(), Number(existing?.updatedAt || 0) + 1);
        const item = normalizeSecondBrainItem({
            ...existing,
            ...value,
            id,
            capturedAt: value?.capturedAt ?? existing?.capturedAt ?? now,
            updatedAt: now,
            mutationId: `${deviceId}:${++sequence}:${now}`
        }, now);
        const content = JSON.stringify(item);
        if (new TextEncoder().encode(content).byteLength > MAX_VAULT_FILE_BYTES) {
            throw new Error("SECOND_BRAIN_ITEM_TOO_LARGE_FOR_VAULT");
        }
        assertOwner();
        await vault.write(itemPath(item.id), content, "json");
        assertOwner();
        return item;
    }

    return {
        async get(id) {
            return read(id);
        },

        async list({ includeDeleted = false } = {}) {
            assertOwner();
            const items = [];
            const invalid = [];
            for (const file of vault.list().filter(record => record.path.startsWith(`${ITEM_DIRECTORY}/`) && record.path.endsWith(".json"))) {
                try {
                    const item = parseItemFile(file);
                    if (includeDeleted || !item.deleted) items.push(item);
                } catch (error) {
                    invalid.push({ path: file.path, error: error.message || "SECOND_BRAIN_ITEM_INVALID" });
                }
            }
            assertOwner();
            return { items, invalid };
        },

        save: saveItem,

        async remove(id) {
            const item = await read(id);
            if (!item || item.deleted) return false;
            await saveItem({ ...item, deleted: true });
            return true;
        },

        async restore(id) {
            const item = await read(id);
            if (!item || !item.deleted) return item;
            return saveItem({ ...item, deleted: false });
        }
    };
}
