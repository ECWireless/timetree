import type { FlatNode } from "@/lib/nodes/tree";

export function orderScopedAgentNodes(
  allNodes: readonly FlatNode[],
  rootNodeId: string,
  scopeNodeIds: ReadonlySet<string>,
) {
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const children = new Map<string, FlatNode[]>();
  for (const node of allNodes) {
    if (
      node.parentId !== null &&
      scopeNodeIds.has(node.id) &&
      scopeNodeIds.has(node.parentId)
    ) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    );
  }

  const ordered: FlatNode[] = [];
  const visited = new Set<string>();
  const work = [rootNodeId];
  while (work.length > 0) {
    const nodeId = work.pop();
    if (!nodeId || visited.has(nodeId)) {
      throw new Error("Invalid agent subtree.");
    }
    visited.add(nodeId);
    const node = byId.get(nodeId);
    if (!node || !scopeNodeIds.has(nodeId)) {
      throw new Error("Invalid agent subtree.");
    }
    ordered.push(node);
    const childNodes = children.get(nodeId) ?? [];
    for (let index = childNodes.length - 1; index >= 0; index -= 1) {
      work.push(childNodes[index].id);
    }
  }
  if (ordered.length !== scopeNodeIds.size) {
    throw new Error("Invalid agent subtree.");
  }
  return ordered;
}
