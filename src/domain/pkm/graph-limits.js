export const MAX_GRAPH_NODES = 100_000;
export const MAX_GRAPH_EDGES = 500_000;

export function layoutIterationsFor(nodeCount) {
    if (nodeCount > 50_000) return 2;
    if (nodeCount > 20_000) return 4;
    if (nodeCount > 5_000) return 8;
    if (nodeCount > 3_000) return 18;
    return 36;
}
