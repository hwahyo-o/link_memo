const META_VERSION = 1;
const SECTION_KEYS = ["categories", "uiPreferences", "driveConnection", "backupInfo", "backupState"];

const clone = value => value === undefined ? undefined : structuredClone(value);
const comparable = value => JSON.stringify(value ?? null);
const changed = (left, right) => comparable(left) !== comparable(right);

function nextClock(now, mutationId, previous = {}) {
    return {
        updatedAt: Math.max(Number(now || 0), Number(previous.updatedAt || 0) + 1),
        mutationId
    };
}

function compareClock(left = {}, right = {}) {
    const timeDifference = Number(left.updatedAt || 0) - Number(right.updatedAt || 0);
    if (timeDifference) return timeDifference;
    return String(left.mutationId || "").localeCompare(String(right.mutationId || ""));
}

function entityClock(entity, fallback = {}) {
    return {
        updatedAt: Number(entity?.updatedAt || fallback.updatedAt || 0),
        mutationId: entity?.mutationId || fallback.mutationId || ""
    };
}

function indexPayload(payload = {}) {
    const subcategories = new Map();
    const links = new Map();
    for (const [category, values] of Object.entries(payload.linkData || {})) {
        (values || []).forEach((subcategory, subcategoryOrder) => {
            if (!subcategory?.id) return;
            const { links: items = [], ...details } = subcategory;
            subcategories.set(subcategory.id, { ...details, category, order: subcategoryOrder });
            items.forEach((link, linkOrder) => {
                if (link?.id) links.set(link.id, { ...link, subcategoryId: subcategory.id, order: linkOrder });
            });
        });
    }
    return { subcategories, links };
}

function stripPlacement(value, kind) {
    if (!value) return value;
    const copy = { ...value };
    delete copy.updatedAt;
    delete copy.mutationId;
    if (kind === "subcategory") {
        delete copy.category;
        delete copy.order;
    } else {
        delete copy.subcategoryId;
        delete copy.order;
    }
    return copy;
}

function normalizeMeta(value = {}) {
    return {
        version: META_VERSION,
        deviceId: value.deviceId || null,
        sections: { ...(value.sections || {}) },
        tombstones: {
            subcategories: { ...(value.tombstones?.subcategories || {}) },
            links: { ...(value.tombstones?.links || {}) }
        }
    };
}

export function prepareLocalMemoPayload(previousPayload, nextPayload, { now = Date.now(), deviceId, sequence = 0 } = {}) {
    const previous = previousPayload || {};
    const result = clone(nextPayload || {});
    const meta = normalizeMeta(previous.syncMeta);
    const mutationId = `${deviceId || "device"}:${sequence}:${now}`;
    meta.deviceId = deviceId || meta.deviceId;

    for (const key of SECTION_KEYS) {
        if (changed(previous[key], result[key]) || !meta.sections[key]) {
            meta.sections[key] = nextClock(now, mutationId, meta.sections[key]);
        }
    }

    const oldIndex = indexPayload(previous);
    const nextIndex = indexPayload(result);
    const stamp = (kind, currentMap, oldMap) => {
        for (const [id, current] of currentMap) {
            const prior = oldMap.get(id);
            const placementChanged = kind === "subcategory"
                ? prior?.category !== current.category || prior?.order !== current.order
                : prior?.subcategoryId !== current.subcategoryId || prior?.order !== current.order;
            if (!prior || placementChanged || changed(stripPlacement(prior, kind), stripPlacement(current, kind))) {
                const clock = nextClock(now, mutationId, entityClock(prior));
                current.updatedAt = clock.updatedAt;
                current.mutationId = clock.mutationId;
            } else {
                current.updatedAt = Number(prior.updatedAt || current.updatedAt || now);
                current.mutationId = prior.mutationId || current.mutationId || mutationId;
            }
            delete meta.tombstones[kind === "subcategory" ? "subcategories" : "links"][id];
        }
        for (const [id, prior] of oldMap) {
            if (currentMap.has(id)) continue;
            const bucket = meta.tombstones[kind === "subcategory" ? "subcategories" : "links"];
            bucket[id] = nextClock(now, mutationId, bucket[id] || entityClock(prior));
        }
    };
    stamp("subcategory", nextIndex.subcategories, oldIndex.subcategories);
    stamp("link", nextIndex.links, oldIndex.links);

    const rebuilt = rebuildLinkData(result.categories || [], nextIndex.subcategories, nextIndex.links);
    result.linkData = rebuilt.linkData;
    result.categories = rebuilt.categories;
    result.syncMeta = meta;
    result.updatedAt = Math.max(now, ...Object.values(meta.sections).map(clock => Number(clock.updatedAt || 0)));
    return result;
}

function winner(left, right, fallbackLeft, fallbackRight) {
    if (!left) return clone(right);
    if (!right) return clone(left);
    return compareClock(entityClock(left, fallbackLeft), entityClock(right, fallbackRight)) >= 0 ? clone(left) : clone(right);
}

function mergeTombstones(left = {}, right = {}) {
    const result = {};
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
        result[id] = compareClock(left[id], right[id]) >= 0 ? clone(left[id]) : clone(right[id]);
    }
    return result;
}

function applyTombstones(map, tombstones) {
    for (const [id, tombstone] of Object.entries(tombstones || {})) {
        const entity = map.get(id);
        if (!entity || compareClock(tombstone, entityClock(entity)) >= 0) map.delete(id);
    }
}

function rebuildLinkData(categories, subcategories, links) {
    const orderedCategories = [...new Set((categories || []).filter(Boolean))];
    for (const subcategory of subcategories.values()) {
        if (subcategory.category && !orderedCategories.includes(subcategory.category)) orderedCategories.push(subcategory.category);
    }
    const linkData = Object.fromEntries(orderedCategories.map(category => [category, []]));
    const orderedSubcategories = [...subcategories.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (const subcategory of orderedSubcategories) {
        if (!linkData[subcategory.category]) linkData[subcategory.category] = [];
        const { category, order, ...details } = subcategory;
        const children = [...links.values()]
            .filter(link => link.subcategoryId === details.id)
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
            .map(link => {
                const { subcategoryId, order: linkOrder, ...value } = link;
                return value;
            });
        linkData[category].push({ ...details, links: children });
    }
    return { categories: orderedCategories, linkData };
}

export function mergeMemoPayloads(leftPayload, rightPayload, { leftUpdatedAt = 0, rightUpdatedAt = 0 } = {}) {
    if (!leftPayload) return clone(rightPayload);
    if (!rightPayload) return clone(leftPayload);
    const left = clone(leftPayload);
    const right = clone(rightPayload);
    const leftMeta = normalizeMeta(left.syncMeta);
    const rightMeta = normalizeMeta(right.syncMeta);
    const fallbackLeft = { updatedAt: Number(left.updatedAt || leftUpdatedAt || 0), mutationId: leftMeta.deviceId || "" };
    const fallbackRight = { updatedAt: Number(right.updatedAt || rightUpdatedAt || 0), mutationId: rightMeta.deviceId || "" };
    const result = {};
    const meta = normalizeMeta();

    for (const key of SECTION_KEYS) {
        const leftClock = leftMeta.sections[key] || fallbackLeft;
        const rightClock = rightMeta.sections[key] || fallbackRight;
        const useLeft = compareClock(leftClock, rightClock) >= 0;
        result[key] = clone(useLeft ? left[key] : right[key]);
        meta.sections[key] = clone(useLeft ? leftClock : rightClock);
    }

    const leftIndex = indexPayload(left);
    const rightIndex = indexPayload(right);
    const subcategories = new Map();
    const links = new Map();
    for (const id of new Set([...leftIndex.subcategories.keys(), ...rightIndex.subcategories.keys()])) {
        subcategories.set(id, winner(leftIndex.subcategories.get(id), rightIndex.subcategories.get(id), fallbackLeft, fallbackRight));
    }
    for (const id of new Set([...leftIndex.links.keys(), ...rightIndex.links.keys()])) {
        links.set(id, winner(leftIndex.links.get(id), rightIndex.links.get(id), fallbackLeft, fallbackRight));
    }
    meta.tombstones.subcategories = mergeTombstones(leftMeta.tombstones.subcategories, rightMeta.tombstones.subcategories);
    meta.tombstones.links = mergeTombstones(leftMeta.tombstones.links, rightMeta.tombstones.links);
    applyTombstones(subcategories, meta.tombstones.subcategories);
    applyTombstones(links, meta.tombstones.links);
    for (const [id, link] of links) if (!subcategories.has(link.subcategoryId)) links.delete(id);

    const rebuilt = rebuildLinkData(result.categories || [], subcategories, links);
    result.categories = rebuilt.categories;
    result.linkData = rebuilt.linkData;
    meta.deviceId = compareClock(fallbackLeft, fallbackRight) >= 0 ? leftMeta.deviceId : rightMeta.deviceId;
    result.syncMeta = meta;
    result.updatedAt = Math.max(Number(left.updatedAt || leftUpdatedAt || 0), Number(right.updatedAt || rightUpdatedAt || 0));
    return result;
}

export function isSameMemoPayload(left, right) {
    const canonical = value => {
        const copy = clone(value || {});
        delete copy.revision;
        delete copy.updatedAt;
        return copy;
    };
    return comparable(canonical(left)) === comparable(canonical(right));
}
