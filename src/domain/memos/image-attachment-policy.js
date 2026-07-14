// Domain: 링크에 첨부되는 이미지 목록의 형태와 개수 규칙을 정의합니다.
export const MAX_IMAGES_PER_LINK = 10;

export function getLinkImages(link) {
    if (Array.isArray(link?.images)) return link.images.filter(image => image?.imageId);
    if (link?.imageId) return [{ id: `legacy_${link.imageId}`, imageId: link.imageId, driveImage: link.driveImage || null }];
    return [];
}

export function hasLinkImages(link) {
    return getLinkImages(link).length > 0;
}

export function normalizeLinkImages(link, createId) {
    const images = getLinkImages(link).map((image, index) => ({
        id: image.id || createId?.("image") || `image_${index}`,
        imageId: image.imageId,
        driveImage: image.driveImage || null
    }));
    if (JSON.stringify(link.images || []) !== JSON.stringify(images)) link.images = images;
    return images;
}

export function validateImageSelection(files) {
    const images = Array.from(files || []);
    if (images.length > MAX_IMAGES_PER_LINK) return { ok: false, error: `이미지는 한 번에 최대 ${MAX_IMAGES_PER_LINK}개까지 첨부할 수 있습니다.` };
    if (images.some(file => !file?.type?.startsWith("image/"))) return { ok: false, error: "이미지 파일만 첨부할 수 있습니다." };
    return { ok: true, value: images };
}
