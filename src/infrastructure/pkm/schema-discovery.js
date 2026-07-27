import { appId, db, doc, getDoc } from "../../services/firebase-client.js";

function requestValue(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function inspectDatabase(name) {
    const database = await requestValue(indexedDB.open(name));
    const stores = [];
    try {
        for (const storeName of database.objectStoreNames) {
            const transaction = database.transaction(storeName, "readonly");
            const sample = await requestValue(transaction.objectStore(storeName).getAll(undefined, 3));
            stores.push({
                name: storeName,
                sampleKeys: [...new Set(sample.flatMap(value => value && typeof value === "object" ? Object.keys(value) : []))]
            });
        }
    } finally {
        database.close();
    }
    return { name, stores };
}

export async function discoverLocalSchemas() {
    const databases = typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : [{ name: "linkMemoData" }, { name: "linkMemoImages" }, { name: "pkm_index_db" }];
    const names = [...new Set(databases.map(item => item.name).filter(Boolean))];
    return Promise.all(names.map(inspectDatabase));
}

export async function discoverMainMemoPayload(userId, { database = db, applicationId = appId } = {}) {
    if (!database || !userId) return null;
    const snapshot = await getDoc(doc(database, "artifacts", applicationId, "users", userId, "memoData", "main"));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
        keys: Object.keys(data),
        payload: data
    };
}

export function mainMemoToVaultFiles(payload) {
    const files = [];
    const safeSegment = value => String(value || "메모").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+$/, "_").slice(0, 100);
    const usedPaths = new Set();
    for (const [category, subcategories] of Object.entries(payload?.linkData || {})) {
        for (const subcategory of subcategories || []) {
            const lines = [`# ${subcategory.title || "메모"}`, "", `카테고리: #${category.replace(/\s+/g, "_")}`, ""];
            for (const link of subcategory.links || []) {
                if (link.text) lines.push(`## ${link.text}`);
                if (link.url) lines.push(link.url);
                if (link.comment) lines.push("", link.comment);
                const images = Array.isArray(link.images) ? link.images : link.imageId ? [link] : [];
                images.forEach(image => {
                    const source = image?.driveImage?.fileId
                        ? `drive://${image.driveImage.fileId}`
                        : image?.imageId
                            ? `indexeddb://${image.imageId}`
                            : null;
                    if (source) lines.push(`![${image.name || link.text || "이미지"}](${source})`);
                });
                lines.push("");
            }
            const folder = `Link Memo/${safeSegment(category)}`;
            const base = safeSegment(subcategory.title || subcategory.id);
            let path = `${folder}/${base}.md`;
            if (usedPaths.has(path)) path = `${folder}/${base}-${safeSegment(subcategory.id).slice(-8)}.md`;
            usedPaths.add(path);
            files.push({
                path,
                type: "md",
                content: lines.join("\n"),
                updatedAt: Number(subcategory.updatedAt || payload.updatedAt || 0),
                mutationId: String(subcategory.mutationId || "link-memo-import")
            });
        }
    }
    return files;
}
