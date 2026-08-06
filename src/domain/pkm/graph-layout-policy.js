export const GRAPH_LAYOUT_RULES = Object.freeze({
    minimumNodeGap: 42,
    preferredNodeGap: 42,
    minimumCategoryCenterDistance: 420,
    maximumCategoryRadiusOverlap: 50,
    maximumSubcategoryDistance: 360,
    maximumItemDistance: 300,
    minimumSiblingEdgeAngle: 0.17453292519943295
});

function dimension(node, key, fallback) {
    const value = Number(node?.[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function nodeDimensions(node) {
    return {
        width: dimension(node, "width", 188),
        height: dimension(node, "height", 68)
    };
}

export function nodeHalfDiagonal(node) {
    const { width, height } = nodeDimensions(node);
    return Math.hypot(width / 2, height / 2);
}

export function aabbSeparated(left, right, leftPosition, rightPosition, gap = GRAPH_LAYOUT_RULES.preferredNodeGap) {
    const leftSize = nodeDimensions(left);
    const rightSize = nodeDimensions(right);
    const dx = Math.abs(Number(leftPosition?.x || 0) - Number(rightPosition?.x || 0));
    const dy = Math.abs(Number(leftPosition?.y || 0) - Number(rightPosition?.y || 0));
    return dx >= (leftSize.width + rightSize.width) / 2 + gap
        || dy >= (leftSize.height + rightSize.height) / 2 + gap;
}

export function centerDistance(leftPosition, rightPosition) {
    return Math.hypot(
        Number(leftPosition?.x || 0) - Number(rightPosition?.x || 0),
        Number(leftPosition?.y || 0) - Number(rightPosition?.y || 0)
    );
}

export function deriveInfluenceRadius(parent, children = [], gap = GRAPH_LAYOUT_RULES.preferredNodeGap, scale = 1) {
    const largestChild = children.reduce((largest, child) => Math.max(largest, nodeHalfDiagonal(child)), 0);
    const childSpread = children.length > 1
        ? Math.sqrt(children.length - 1) * Math.max(240, largestChild * 2 + gap)
        : 0;
    return nodeHalfDiagonal(parent) + gap + largestChild + Math.max(220, childSpread) * scale;
}

export function parentDistanceLimit(parent, child, kind, gap = GRAPH_LAYOUT_RULES.preferredNodeGap) {
    const parentSize = nodeDimensions(parent);
    const childSize = nodeDimensions(child);
    const minimum = Math.max(
        (parentSize.width + childSize.width) / 2 + gap,
        (parentSize.height + childSize.height) / 2 + gap
    );
    const maximum = kind === "subcategory"
        ? GRAPH_LAYOUT_RULES.maximumSubcategoryDistance
        : kind === "item"
            ? GRAPH_LAYOUT_RULES.maximumItemDistance
            : minimum;
    return Math.max(minimum, maximum);
}

export function deriveCategoryGroupRadius(category, subcategories = [], childrenByParent = new Map(), gap = GRAPH_LAYOUT_RULES.preferredNodeGap) {
    let radius = nodeHalfDiagonal(category) + gap;
    for (const subcategory of subcategories) {
        const subcategoryDistance = parentDistanceLimit(category, subcategory, "subcategory", gap);
        radius = Math.max(radius, subcategoryDistance + nodeHalfDiagonal(subcategory) + gap);
        const items = childrenByParent.get(subcategory.id) || [];
        for (const item of items) {
            const itemDistance = parentDistanceLimit(subcategory, item, "item", gap);
            radius = Math.max(radius, subcategoryDistance + itemDistance + nodeHalfDiagonal(item) + gap);
        }
    }
    return radius;
}

export function categoryRegionContains(candidatePosition, node, categoryPosition, categoryRadius, gap = GRAPH_LAYOUT_RULES.preferredNodeGap) {
    if (!candidatePosition || !categoryPosition || !Number.isFinite(categoryRadius)) return false;
    return centerDistance(candidatePosition, categoryPosition) + nodeHalfDiagonal(node) + gap <= categoryRadius;
}

export function categoryOwnershipSatisfied(
    candidatePosition,
    node,
    ownCategoryPosition,
    ownCategoryRadius,
    otherRegions = [],
    gap = GRAPH_LAYOUT_RULES.preferredNodeGap
) {
    if (!categoryRegionContains(candidatePosition, node, ownCategoryPosition, ownCategoryRadius, gap)) return false;
    const ownDistance = centerDistance(candidatePosition, ownCategoryPosition);
    return otherRegions.filter(region => region?.position && Number.isFinite(region.radius)).every(region => {
        const otherDistance = centerDistance(candidatePosition, region.position);
        return otherDistance >= region.radius + nodeHalfDiagonal(node) + gap
            && ownDistance < otherDistance;
    });
}

export function hierarchyBandSatisfied(
    node,
    candidatePosition,
    parentPosition,
    categoryPosition,
    kind,
    gap = GRAPH_LAYOUT_RULES.preferredNodeGap
) {
    if (!candidatePosition || !parentPosition) return false;
    const parentDistance = centerDistance(candidatePosition, parentPosition);
    const minimum = Math.max(
        (nodeDimensions(node).width + 188) / 2 + gap,
        (nodeDimensions(node).height + 68) / 2 + gap
    );
    if (parentDistance < minimum) return false;
    if (kind !== "item" || !categoryPosition) return true;

    const parentVector = {
        x: parentPosition.x - categoryPosition.x,
        y: parentPosition.y - categoryPosition.y
    };
    const childVector = {
        x: candidatePosition.x - parentPosition.x,
        y: candidatePosition.y - parentPosition.y
    };
    const parentLength = Math.hypot(parentVector.x, parentVector.y);
    if (!parentLength) return true;

    const outwardProjection = (
        childVector.x * parentVector.x + childVector.y * parentVector.y
    ) / parentLength;
    const minimumOutwardProjection = Math.min(
        120,
        Math.max(GRAPH_LAYOUT_RULES.minimumNodeGap, gap / 2)
    );
    return outwardProjection >= minimumOutwardProjection;
}

function angleOf(position, origin) {
    return Math.atan2(position.y - origin.y, position.x - origin.x);
}

function circularAngleDistance(left, right) {
    const distance = Math.abs(left - right) % (Math.PI * 2);
    return Math.min(distance, Math.PI * 2 - distance);
}

export function parentEdgeAngleSeparated(candidatePosition, parentPosition, peerPositions = [], minimumAngle = GRAPH_LAYOUT_RULES.minimumSiblingEdgeAngle) {
    const candidateAngle = angleOf(candidatePosition, parentPosition);
    return peerPositions.filter(Boolean).every(peerPosition => (
        circularAngleDistance(candidateAngle, angleOf(peerPosition, parentPosition)) >= minimumAngle
    ));
}

export function siblingEdgeAngleLimit(siblingCount) {
    return Math.min(
        GRAPH_LAYOUT_RULES.minimumSiblingEdgeAngle,
        Math.PI / Math.max(1, siblingCount)
    );
}

export function nearestParentSatisfied(candidatePosition, parentPosition, peerPositions = []) {
    if (!candidatePosition || !parentPosition) return false;
    const parentDistance = centerDistance(candidatePosition, parentPosition);
    return peerPositions.filter(Boolean).every(peerPosition => (
        parentDistance < centerDistance(candidatePosition, peerPosition)
    ));
}

export function categorySeparationSatisfied(left, right, leftPosition, rightPosition, leftRadius, rightRadius) {
    const distance = centerDistance(leftPosition, rightPosition);
    const overlapDepth = Math.max(0, leftRadius + rightRadius - distance);
    return distance >= GRAPH_LAYOUT_RULES.minimumCategoryCenterDistance
        && overlapDepth < GRAPH_LAYOUT_RULES.maximumCategoryRadiusOverlap;
}
