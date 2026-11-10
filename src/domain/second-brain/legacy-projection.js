const SECOND_BRAIN_ROOT = "Second Brain/";

const LEGACY_EXTENSION_KINDS = new Map([
    ["md", "note"],
    ["canvas", "canvas"],
    ["json", "structured"]
]);

export function isSecondBrainPath(path) {
    return String(path || "").startsWith(SECOND_BRAIN_ROOT);
}

function extensionOf(path) {
    const segment = String(path || "").split("/").pop() || "";
    return segment.includes(".") ? segment.split(".").pop().toLowerCase() : "";
}

function titleFromMarkdown(content, path) {
    const heading = String(content || "").match(/^#\s+(.+)$/m);
    if (heading) return heading[1].trim();
    const fileName = String(path || "").split("/").pop() || "가져온 자료";
    return fileName.replace(/\.[^.]+$/, "") || "가져온 자료";
}

function stableClock(left, right) {
    const timeDifference = Number(left.updatedAt || 0) - Number(right.updatedAt || 0);
    if (timeDifference) return timeDifference;
    return String(left.mutationId || "").localeCompare(String(right.mutationId || ""));
}

export function projectLegacyVaultFiles(files) {
    const latestByPath = new Map();
    for (const file of Array.isArray(files) ? files : []) {
        if (!file?.path || file.deleted === true) continue;
        if (isSecondBrainPath(file.path)) continue;
        const current = latestByPath.get(file.path);
        if (!current || stableClock(file, current) >= 0) latestByPath.set(file.path, file);
    }

    return [...latestByPath.values()]
        .map(file => {
            const kind = LEGACY_EXTENSION_KINDS.get(extensionOf(file.path));
            if (!kind) return null;
            const content = typeof file.content === "string" ? file.content : "";
            const markdown = kind === "note";
            return {
                id: `legacy:${file.path}`,
                schemaVersion: 1,
                kind,
                title: markdown ? titleFromMarkdown(content, file.path) : titleFromMarkdown("", file.path),
                bodyMarkdown: markdown ? content : "",
                legacyContent: markdown ? null : content,
                legacyPath: file.path,
                state: "processed",
                tags: [],
                areaIds: [],
                projectIds: [],
                relatedIds: [],
                attachmentIds: [],
                capturedAt: Number(file.updatedAt || 0),
                updatedAt: Number(file.updatedAt || 0),
                mutationId: String(file.mutationId || ""),
                deleted: false,
                projectionOnly: true
            };
        })
        .filter(Boolean);
}
