export function createMetadataCache({ worker }) {
    const cache = new Map();
    const pending = new Map();
    let requestSequence = 0;
    let active = null;
    let queued = null;

    const createRequest = files => {
        const requestId = `metadata_${++requestSequence}`;
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        return { requestId, files, promise, resolve, reject };
    };

    const dispatch = request => {
        active = request;
        pending.set(request.requestId, request);
        worker.postMessage({ type: "parse-metadata", requestId: request.requestId, files: request.files });
    };

    worker.addEventListener("message", event => {
        if (event.data?.type !== "metadata-result") return;
        const request = pending.get(event.data.requestId);
        if (!request) return;
        pending.delete(event.data.requestId);
        event.data.entries.forEach(entry => cache.set(entry.path, entry));
        request.resolve(event.data.entries);
        if (active?.requestId === request.requestId) active = null;
        if (queued) {
            const next = queued;
            queued = null;
            dispatch(next);
        }
    });
    worker.addEventListener("error", error => {
        for (const request of pending.values()) request.reject(error);
        queued?.reject(error);
        pending.clear();
        active = null;
        queued = null;
    });

    return {
        async index(files) {
            if (active) {
                if (!queued) queued = createRequest(files);
                else queued.files = files;
                return queued.promise;
            }
            const request = createRequest(files);
            dispatch(request);
            return request.promise;
        },
        get(path) {
            return cache.get(path) || null;
        },
        values() {
            return [...cache.values()];
        },
        clear() {
            cache.clear();
            for (const request of pending.values()) request.resolve([]);
            queued?.resolve([]);
            pending.clear();
            active = null;
            queued = null;
        }
    };
}
