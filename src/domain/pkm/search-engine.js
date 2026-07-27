function normalize(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase();
}

export function tokenizeSearch(query) {
    return normalize(query).trim().split(/\s+/).filter(Boolean);
}

export function searchMetadata(metadataEntries, query, mode = "AND") {
    const tokens = tokenizeSearch(query);
    if (!tokens.length) return [];
    const useAnd = mode !== "OR";
    return metadataEntries.filter(entry => {
        const haystack = normalize([
            entry.title,
            entry.content,
            ...(entry.tags || []),
            ...(entry.comments || []),
            ...(entry.links || [])
        ].join("\n"));
        return useAnd ? tokens.every(token => haystack.includes(token)) : tokens.some(token => haystack.includes(token));
    });
}
