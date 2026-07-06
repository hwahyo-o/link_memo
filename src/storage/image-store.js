function openImageDb() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('IndexedDB 미지원'));
        const request = indexedDB.open('linkMemoImages', 1);
        request.onupgradeneeded = () => {
            const imageDb = request.result;
            if (!imageDb.objectStoreNames.contains('images')) {
                imageDb.createObjectStore('images', { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function imageDbTransaction(mode, handler) {
    const imageDb = await openImageDb();
    return new Promise((resolve, reject) => {
        const transaction = imageDb.transaction('images', mode);
        const request = handler(transaction.objectStore('images'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => imageDb.close();
        transaction.onerror = () => {
            imageDb.close();
            reject(transaction.error);
        };
    });
}

export async function saveImageFile(file, { id, userId, oldImageId = null }) {
    if (!file) return oldImageId;
    await imageDbTransaction('readwrite', store => store.put({
        id,
        userId: userId || 'guest',
        blob: file,
        name: file.name,
        type: file.type,
        createdAt: Date.now()
    }));
    if (oldImageId) deleteImage(oldImageId).catch(() => {});
    return id;
}

export async function getImage(imageId) {
    if (!imageId) return null;
    try {
        return await imageDbTransaction('readonly', store => store.get(imageId));
    } catch (error) {
        console.warn('이미지를 불러오지 못했습니다.', error);
        return null;
    }
}

export async function deleteImage(imageId) {
    if (!imageId) return;
    try {
        await imageDbTransaction('readwrite', store => store.delete(imageId));
    } catch (error) {
        console.warn('이미지를 삭제하지 못했습니다.', error);
    }
}

export async function clearUserImages(userId) {
    if (!userId) return;
    const imageDb = await openImageDb();
    await new Promise((resolve, reject) => {
        const transaction = imageDb.transaction('images', 'readwrite');
        const cursorRequest = transaction.objectStore('images').openCursor();
        cursorRequest.onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) return;
            if (cursor.value?.userId === userId) cursor.delete();
            cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    imageDb.close();
}
