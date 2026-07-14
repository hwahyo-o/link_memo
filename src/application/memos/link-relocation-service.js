// Application: 링크의 표시 텍스트 수정과 카테고리·소분류 이동을 하나의 작업으로 처리합니다.
export function relocateLink({ linkData, sourceCategory, sourceSubcategoryId, linkId, targetCategory, targetSubcategoryId, text, now = Date.now() }) {
    const sourceSubcategory = linkData?.[sourceCategory]?.find(item => item.id === sourceSubcategoryId);
    const targetSubcategory = linkData?.[targetCategory]?.find(item => item.id === targetSubcategoryId);
    if (!sourceSubcategory || !targetSubcategory) return { ok: false, error: "이동할 카테고리 또는 소분류를 찾을 수 없습니다." };
    const sourceIndex = sourceSubcategory.links.findIndex(item => item.id === linkId);
    if (sourceIndex < 0) return { ok: false, error: "수정할 링크를 찾을 수 없습니다." };
    const normalizedText = String(text || "").trim();
    if (!normalizedText) return { ok: false, error: "버튼 텍스트는 비워둘 수 없습니다." };

    const link = sourceSubcategory.links[sourceIndex];
    link.text = normalizedText;
    link.updatedAt = now;
    if (sourceSubcategory === targetSubcategory) return { ok: true, link, moved: false };

    sourceSubcategory.links.splice(sourceIndex, 1);
    targetSubcategory.links.push(link);
    return { ok: true, link, moved: true };
}
