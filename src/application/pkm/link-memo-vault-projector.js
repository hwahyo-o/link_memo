import {
    canonicalKeyword,
    classifyContentKind,
    colorForContentKind,
    extractKeywords,
    hashText,
    summarizeContent,
    toHashtag
} from "../../domain/pkm/link-memo-keyword-policy.js";

export const GRAPH_INDEX_MANIFEST_PATH = "Link Memo/.graph-index.json";
export const GRAPH_INDEX_SHARD_PREFIX = "Link Memo/.graph-index/";
const ITEMS_PER_SHARD = 300;

const safeSegment = value => String(value || "메모")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "_")
    .trim()
    .slice(0, 100) || "메모";
const singleLine = value => String(value || "").replace(/\s+/g, " ").trim();
const stableId = (...parts) => hashText(parts.map(part => String(part || "")).join("\u001f"));

function imageLines(item, title) {
    const images = Array.isArray(item?.images) ? item.images : item?.imageId || item?.driveImage?.fileId ? [item] : [];
    return images.flatMap(image => {
        const source = image?.driveImage?.fileId
            ? `drive://${image.driveImage.fileId}`
            : image?.imageId
                ? `indexeddb://${image.imageId}`
                : null;
        return source ? [`![${singleLine(image?.name || image?.alt || title || "이미지")}](${source})`] : [];
    });
}

function markdownFor({ item, title, summary, category, subcategory, keywords }) {
    const lines = [
        `# ${title}`,
        "",
        summary ? `> ${summary}` : "",
        "",
        [`#${toHashtag(category)}`, `#${toHashtag(subcategory)}`, ...keywords.map(keyword => `#${toHashtag(keyword)}`)].join(" "),
        ""
    ];
    if (item?.url) lines.push(String(item.url).trim(), "");
    [item?.comment, item?.description, item?.body, item?.note, item?.content]
        .map(value => String(value || "").trim())
        .filter(Boolean)
        .forEach(value => lines.push(value, ""));
    lines.push(...imageLines(item, title));
    return lines.filter((line, index, values) => line || values[index - 1]).join("\n").trimEnd();
}

function parseIndexFiles(files) {
    const items = [];
    for (const file of files || []) {
        if (!file.path?.startsWith(GRAPH_INDEX_SHARD_PREFIX) || file.deleted) continue;
        try {
            const parsed = JSON.parse(file.content);
            if (parsed?.schemaVersion === 2 && Array.isArray(parsed.items)) items.push(...parsed.items);
        } catch {
            // Invalid generated metadata is ignored; source Markdown remains available.
        }
    }
    return items;
}

export function projectMainMemoToVaultFiles(payload) {
    const files = [];
    const items = [];
    const usedPaths = new Set();
    let newest = Number(payload?.updatedAt || 0);

    for (const [categoryName, subcategories] of Object.entries(payload?.linkData || {})) {
        const category = singleLine(categoryName) || "미분류";
        const categoryId = `category:${stableId(category)}`;
        for (const subcategoryValue of subcategories || []) {
            const subcategory = singleLine(subcategoryValue?.title || subcategoryValue?.id) || "메모";
            const subcategoryId = `subcategory:${stableId(categoryId, subcategoryValue?.id || subcategory)}`;
            for (const [index, item] of (subcategoryValue?.links || []).entries()) {
                const title = singleLine(item?.text || item?.title) || `메모 ${index + 1}`;
                const sourceId = String(item?.id || item?.uuid || item?.createdAt || stableId(subcategoryId, title, item?.url, item?.comment, index));
                const kind = classifyContentKind(item);
                const summary = summarizeContent(item);
                const keywords = extractKeywords({ item, title, category, subcategory });
                const basePath = `Link Memo/${safeSegment(category)}/${safeSegment(subcategory)}/${safeSegment(sourceId)}.md`;
                let path = basePath;
                if (usedPaths.has(path)) path = basePath.replace(/\.md$/, `-${stableId(sourceId, index)}.md`);
                usedPaths.add(path);
                const content = markdownFor({ item, title, summary, category, subcategory, keywords });
                const updatedAt = Number(item?.updatedAt || subcategoryValue?.updatedAt || payload?.updatedAt || 0);
                newest = Math.max(newest, updatedAt);
                files.push({
                    path,
                    type: "md",
                    content,
                    updatedAt,
                    mutationId: String(item?.mutationId || `link-memo:${sourceId}`)
                });
                items.push({
                    id: `item:${stableId(categoryId, subcategoryId, sourceId)}`,
                    sourceId,
                    path,
                    title,
                    summary,
                    category: { id: categoryId, label: category, tag: toHashtag(category), color: "#F6E7FF" },
                    subcategory: { id: subcategoryId, label: subcategory, tag: toHashtag(subcategory), color: "#B9BFFF" },
                    contentKind: kind,
                    color: colorForContentKind(kind),
                    facets: {
                        link: kind.includes("link"),
                        image: kind.includes("image"),
                        text: kind === "text" || kind.includes("text")
                    },
                    keywords,
                    keywordKeys: keywords.map(canonicalKeyword),
                    generatedContentHash: hashText(content),
                    sourceUpdatedAt: updatedAt
                });
            }
        }
    }

    const shardPaths = [];
    for (let offset = 0; offset < items.length; offset += ITEMS_PER_SHARD) {
        const path = `${GRAPH_INDEX_SHARD_PREFIX}${String(offset / ITEMS_PER_SHARD + 1).padStart(5, "0")}.json`;
        const content = JSON.stringify({ schemaVersion: 2, items: items.slice(offset, offset + ITEMS_PER_SHARD) });
        shardPaths.push(path);
        files.push({ path, type: "json", content, updatedAt: newest, mutationId: `link-memo-index:${hashText(content)}` });
    }
    const manifest = JSON.stringify({ schemaVersion: 2, shardPaths, itemCount: items.length });
    files.push({
        path: GRAPH_INDEX_MANIFEST_PATH,
        type: "json",
        content: manifest,
        updatedAt: newest,
        mutationId: `link-memo-manifest:${hashText(manifest)}`
    });
    return files;
}

export function reconcileLinkMemoProjection(snapshot, projectedFiles, now = Date.now()) {
    const currentFiles = snapshot?.files || [];
    const currentByPath = new Map(currentFiles.map(file => [file.path, file]));
    const previousItems = parseIndexFiles(currentFiles);
    const nextItems = parseIndexFiles(projectedFiles);
    const previousByPath = new Map(previousItems.map(item => [item.path, item]));
    const nextPaths = new Set(nextItems.map(item => item.path));
    const conflicts = [];
    const files = [];

    for (const file of projectedFiles) {
        const current = currentByPath.get(file.path);
        const previous = previousByPath.get(file.path);
        if (file.type === "md" && current && previous && hashText(current.content) !== previous.generatedContentHash) {
            conflicts.push(file.path);
            continue;
        }
        files.push(file);
    }
    for (const previous of previousItems) {
        if (nextPaths.has(previous.path)) continue;
        const current = currentByPath.get(previous.path);
        if (!current || current.deleted || hashText(current.content) !== previous.generatedContentHash) continue;
        files.push({
            ...current,
            content: "",
            deleted: true,
            updatedAt: Math.max(now, Number(current.updatedAt || 0) + 1),
            mutationId: `link-memo-delete:${now}:${hashText(previous.path)}`
        });
    }
    for (const current of currentFiles) {
        if (!current.path?.startsWith(GRAPH_INDEX_SHARD_PREFIX) || current.deleted) continue;
        if (!projectedFiles.some(file => file.path === current.path)) {
            files.push({
                ...current,
                content: "",
                deleted: true,
                updatedAt: Math.max(now, Number(current.updatedAt || 0) + 1),
                mutationId: `link-memo-index-delete:${now}:${hashText(current.path)}`
            });
        }
    }
    return { files, conflicts };
}

export function readLinkMemoGraphItems(files) {
    return parseIndexFiles(files);
}
