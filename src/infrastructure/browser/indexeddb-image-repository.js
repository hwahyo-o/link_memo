// Infrastructure: 브라우저 로컬 IndexedDB에 이미지 Blob을 보관합니다.
function openImageDb() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) return reject(new Error("IndexedDB 미지원"));
        const request = indexedDB.open("linkMemoImages", 1);
        request.onupgradeneeded = () => {
            const imageDb = request.result;
            if (!imageDb.objectStoreNames.contains("images")) {
                imageDb.createObjectStore("images", { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function transaction(mode, handler) {
    const imageDb = await openImageDb();
    return new Promise((resolve, reject) => {
        const dbTransaction = imageDb.transaction("images", mode);
        const request = handler(dbTransaction.objectStore("images"));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        dbTransaction.oncomplete = () => imageDb.close();
        dbTransaction.onerror = () => {
            imageDb.close();
            reject(dbTransaction.error);
        };
    });
}

export const imageRepository = {
    async save(file, { id, userId, oldImageId = null }) {
        if (!file) return oldImageId;
        await transaction("readwrite", store => store.put({
            id,
            userId: userId || "guest",
            blob: file,
            name: file.name,
            type: file.type,
            createdAt: Date.now()
        }));
        if (oldImageId) this.delete(oldImageId).catch(() => {});
        return id;
    },

    async get(imageId) {
        if (!imageId) return null;
        try {
            return await transaction("readonly", store => store.get(imageId));
        } catch (error) {
            console.warn("이미지를 불러오지 못했습니다.", error);
            return null;
        }
    },

    async delete(imageId) {
        if (!imageId) return;
        try {
            await transaction("readwrite", store => store.delete(imageId));
        } catch (error) {
            console.warn("이미지를 삭제하지 못했습니다.", error);
        }
    },

    async clearByUser(userId) {
        if (!userId) return;
        const imageDb = await openImageDb();
        await new Promise((resolve, reject) => {
            const dbTransaction = imageDb.transaction("images", "readwrite");
            const cursorRequest = dbTransaction.objectStore("images").openCursor();
            cursorRequest.onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor) return;
                if (cursor.value?.userId === userId) cursor.delete();
                cursor.continue();
            };
            cursorRequest.onerror = () => reject(cursorRequest.error);
            dbTransaction.oncomplete = resolve;
            dbTransaction.onerror = () => reject(dbTransaction.error);
        });
        imageDb.close();
    }
};
