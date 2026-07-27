export const MAX_VAULT_CHUNK_BYTES = 320_000;

const encoder = new TextEncoder();

function safeEnd(value, start, end) {
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) return end - 1;
    return end;
}

function takeChunk(value, start) {
    let low = start + 1;
    let high = Math.min(value.length, start + MAX_VAULT_CHUNK_BYTES);
    let best = start;
    while (low <= high) {
        const candidate = Math.floor((low + high) / 2);
        const middle = safeEnd(value, start, candidate);
        const bytes = encoder.encode(value.slice(start, middle)).byteLength;
        if (bytes <= MAX_VAULT_CHUNK_BYTES) {
            if (middle > best) best = middle;
            low = candidate + 1;
        } else {
            high = candidate - 1;
        }
    }
    if (best === start) throw new Error("PKM_VAULT_CHUNK_ENCODING_FAILED");
    return best;
}

export function encodeVaultFiles(files) {
    const payload = JSON.stringify(files || []);
    const chunks = [];
    for (let start = 0; start < payload.length;) {
        const end = takeChunk(payload, start);
        chunks.push(payload.slice(start, end));
        start = end;
    }
    return chunks.length ? chunks : ["[]"];
}

export function decodeVaultFileChunks(chunks) {
    if (chunks.every(chunk => typeof chunk?.payloadPart === "string")) {
        const files = JSON.parse(chunks.map(chunk => chunk.payloadPart).join(""));
        if (!Array.isArray(files)) throw new Error("PKM_REMOTE_PAYLOAD_INVALID");
        return files;
    }
    return chunks.flatMap(chunk => chunk?.files || []);
}
