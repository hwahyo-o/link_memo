export function classifyGraphMatches(nodes, edges, directIds) {
    const direct = new Set(directIds);
    const context = new Set();
    for (const edge of edges || []) {
        if (direct.has(edge.source) && !direct.has(edge.target)) context.add(edge.target);
        if (direct.has(edge.target) && !direct.has(edge.source)) context.add(edge.source);
    }
    const dimmed = new Set((nodes || []).map(node => node.id).filter(id => !direct.has(id) && !context.has(id)));
    return { direct, context, dimmed };
}
