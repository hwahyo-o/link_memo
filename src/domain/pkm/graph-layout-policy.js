export const GRAPH_LAYOUT_RULES = Object.freeze({
    minimumNodeGap: 42,
    preferredNodeGap: 96,
    minimumCategoryCenterDistance: 420,
    maximumCategoryRadiusOverlap: 49
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

export function categorySeparationSatisfied(left, right, leftPosition, rightPosition, leftRadius, rightRadius) {
    const distance = centerDistance(leftPosition, rightPosition);
    const overlapDepth = Math.max(0, leftRadius + rightRadius - distance);
    return distance >= GRAPH_LAYOUT_RULES.minimumCategoryCenterDistance
        && overlapDepth < GRAPH_LAYOUT_RULES.maximumCategoryRadiusOverlap;
}
