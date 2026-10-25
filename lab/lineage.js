const LANE = new Map([
  ['evidence', 0],
  ['citation', 1],
  ['retrieval', 2],
  ['preregistration', 2],
  ['input', 3],
  ['chat', 3],
  ['turn', 4],
  ['run', 5],
  ['kernel', 5],
  ['cell', 6],
  ['experiment', 6],
  ['simulation', 7],
  ['artifact', 8],
  ['revision', 9],
  ['decision', 10],
  ['interaction', 11],
  ['missing', 12]
]);

export function lineageTrace(graph, nodeId, direction = 'both', limit = 512) {
  const ids = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length && ids.size < limit) {
    const current = queue.shift();
    for (const edge of graph?.edges ?? []) {
      let next = null;
      if (direction === 'upstream' || direction === 'both') {
        if (edge.target === current) next = edge.source;
      }
      if (!next && (direction === 'downstream' || direction === 'both')) {
        if (edge.source === current) next = edge.target;
      }
      if (!next || ids.has(next)) continue;
      ids.add(next);
      queue.push(next);
      if (ids.size >= limit) break;
    }
  }
  return ids;
}

export function lineageSubgraph(graph, {
  type = 'all',
  integrity = 'all',
  selected = null,
  direction = 'both'
} = {}) {
  const nodeMap = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  let ids = new Set(nodeMap.keys());
  if (selected && nodeMap.has(selected)) ids = lineageTrace(graph, selected, direction);
  if (type !== 'all') {
    const matching = new Set([...ids].filter((id) => nodeMap.get(id)?.type === type));
    const typed = new Set(matching);
    for (const edge of graph?.edges ?? []) {
      if (matching.has(edge.source) && ids.has(edge.target)) typed.add(edge.target);
      if (matching.has(edge.target) && ids.has(edge.source)) typed.add(edge.source);
    }
    ids = typed;
  }
  if (integrity === 'issues') {
    const issueIds = new Set((graph?.findings ?? []).map((finding) => finding.node_id).filter(Boolean));
    ids = new Set([...ids].filter((id) => issueIds.has(id) || nodeMap.get(id)?.verified === false));
  } else if (integrity === 'verified') {
    ids = new Set([...ids].filter((id) => nodeMap.get(id)?.verified === true));
  }
  return {
    nodes: (graph?.nodes ?? []).filter((node) => ids.has(node.id)),
    edges: (graph?.edges ?? []).filter((edge) => ids.has(edge.source) && ids.has(edge.target))
  };
}

export function layoutLineage(graph) {
  const positions = new Map();
  const rows = new Map();
  const nodes = [...(graph?.nodes ?? [])].sort((left, right) =>
    (LANE.get(left.type) ?? 10) - (LANE.get(right.type) ?? 10) ||
    String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')) ||
    left.id.localeCompare(right.id)
  );
  for (const node of nodes) {
    const lane = LANE.get(node.type) ?? 10;
    const row = rows.get(lane) ?? 0;
    rows.set(lane, row + 1);
    positions.set(node.id, {
      x: 36 + lane * 246,
      y: 42 + row * 92,
      width: 198,
      height: 64
    });
  }
  const maximumLane = Math.max(0, ...[...positions.values()].map((value) => Math.round((value.x - 36) / 246)));
  const maximumRows = Math.max(1, ...rows.values());
  return {
    positions,
    width: Math.max(760, 70 + maximumLane * 246 + 220),
    height: Math.max(440, 82 + maximumRows * 92)
  };
}
