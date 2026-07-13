function createLruBlobCache({ maxEntries = 24, maxBytes = 30 * 1024 * 1024 } = {}) {
    const blobs = new Map();
    const pending = new Map();
    let bytes = 0;

    const touch = key => {
        const value = blobs.get(key);
        if (!value) return null;
        blobs.delete(key);
        blobs.set(key, value);
        return value.blob;
    };

    const put = (key, blob) => {
        const previous = blobs.get(key);
        if (previous) bytes -= previous.size;
        blobs.set(key, { blob, size: blob.size || 0 });
        bytes += blob.size || 0;
        while (blobs.size > maxEntries || bytes > maxBytes) {
            const [oldestKey, oldest] = blobs.entries().next().value;
            blobs.delete(oldestKey);
            bytes -= oldest.size;
        }
        return blob;
    };

    return {
        async getOrLoad(key, loader) {
            const cached = touch(key);
            if (cached) return cached;
            if (!pending.has(key)) {
                pending.set(key, Promise.resolve(loader()).then(blob => put(key, blob)).finally(() => pending.delete(key)));
            }
            return pending.get(key);
        },
        clear() {
            blobs.clear();
            pending.clear();
            bytes = 0;
        }
    };
}

// Infrastructure: Firebase 인증 토큰으로 서버를 호출합니다. Drive 토큰은 브라우저에 저장하지 않습니다.
export function createDriveBackendImageRepository({ auth, baseUrl = import.meta.env.VITE_DRIVE_BACKEND_URL } = {}) {
    const cache = createLruBlobCache();

    async function authorizedFetch(path, options = {}) {
        if (!baseUrl) throw new Error("DRIVE_BACKEND_URL_MISSING");
        const user = auth?.currentUser;
        if (!user) throw new Error("DRIVE_BACKEND_AUTH_REQUIRED");
        const idToken = await user.getIdToken();
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
            ...options,
            headers: { Authorization: `Bearer ${idToken}`, ...(options.headers || {}) }
        });
        if (!response.ok) {
            const error = new Error(`DRIVE_BACKEND_FAILED_${response.status}`);
            error.status = response.status;
            throw error;
        }
        return response;
    }

    return {
        async connect(authorizationCode) {
            const response = await authorizedFetch("/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ authorizationCode })
            });
            return response.json();
        },
        async restoreSession() {
            const response = await authorizedFetch("/session");
            return response.json();
        },
        async upload(file) {
            const response = await authorizedFetch("/upload", {
                method: "POST",
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                    "X-Link-Memo-File-Name": encodeURIComponent(file.name || `image-${Date.now()}`)
                },
                body: file
            });
            return response.json();
        },
        async download(fileId) {
            return cache.getOrLoad(fileId, async () => {
                const response = await authorizedFetch(`/image/${encodeURIComponent(fileId)}`);
                return response.blob();
            });
        },
        prefetch(fileId) {
            if (!fileId) return Promise.resolve();
            return this.download(fileId).catch(() => null);
        },
        async remove(fileId) {
            if (!fileId) return;
            await authorizedFetch(`/image/${encodeURIComponent(fileId)}`, { method: "DELETE" });
        },
        clearCache() {
            cache.clear();
        }
    };
}
