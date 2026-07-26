export function createMetadataCache({ worker }) {
    const cache = new Map();
    const pending = new Map();
    let requestSequence = 0;

    worker.addEventListener("message", event => {
        if (event.data?.type !== "metadata-result") return;
        const request = pending.get(event.data.requestId);
        if (!request) return;
        pending.delete(event.data.requestId);
        event.data.entries.forEach(entry => cache.set(entry.path, entry));
        request.resolve(event.data.entries);
    });

    return {
        async index(files) {
            const requestId = `metadata_${++requestSequence}`;
            const result = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
            worker.postMessage({ type: "parse-metadata", requestId, files });
            return result;
        },
        get(path) {
            return cache.get(path) || null;
        },
        values() {
            return [...cache.values()];
        },
        clear() {
            cache.clear();
        }
    };
}
