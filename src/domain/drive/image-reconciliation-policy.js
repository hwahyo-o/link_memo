const KST_TIME_ZONE = "Asia/Seoul";

export function getKstMonthKey(value = Date.now()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: KST_TIME_ZONE,
        year: "numeric",
        month: "2-digit"
    }).formatToParts(new Date(value));
    const year = parts.find(part => part.type === "year")?.value;
    const month = parts.find(part => part.type === "month")?.value;
    return `${year}-${month}`;
}

export function getNextKstMonthKey(value = Date.now()) {
    const current = getKstMonthKey(value);
    const [year, month] = current.split("-").map(Number);
    const next = new Date(Date.UTC(year, month, 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shouldReconcileImages({ currentMonth, lastCompletedMonth, cleanupNotBeforeMonth = null }) {
    if (!currentMonth || lastCompletedMonth === currentMonth) return false;
    return !cleanupNotBeforeMonth || cleanupNotBeforeMonth <= currentMonth;
}

export function collectDriveFileIds(linkData) {
    const ids = new Set();
    for (const subcategories of Object.values(linkData || {})) {
        for (const subcategory of subcategories || []) {
            for (const link of subcategory.links || []) {
                const images = Array.isArray(link.images) ? link.images : (link.imageId ? [link] : []);
                for (const image of images) {
                    const fileId = image?.driveImage?.fileId;
                    if (typeof fileId === "string" && fileId) ids.add(fileId);
                }
            }
        }
    }
    return [...ids];
}

export function removeImageAttachment(link, attachmentId) {
    const images = Array.isArray(link?.images) ? link.images : [];
    const index = images.findIndex(image => image?.id === attachmentId || image?.imageId === attachmentId);
    if (index < 0) return { changed: false, removed: null, images };
    return {
        changed: true,
        removed: images[index],
        images: images.filter((_, imageIndex) => imageIndex !== index)
    };
}
