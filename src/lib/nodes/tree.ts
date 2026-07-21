export type FlatNode = {
  id: string;
  parentId: string | null;
  position: number;
  title: string;
  description: string | null;
  hourlyRateCents: number | null;
  completedAt: string | null;
};

export type NodeBreadcrumb = {
  id: string;
  title: string;
};

export type DashboardNode = FlatNode & {
  children: DashboardNode[];
  breadcrumb: NodeBreadcrumb[];
  resolvedHourlyRateCents: number | null;
  directDurationSeconds: number;
  rolledUpDurationSeconds: number;
  rolledUpValueCents: number;
  hasUnpricedTime: boolean;
};

export type NodeTree = {
  roots: DashboardNode[];
  ordered: DashboardNode[];
  byId: Map<string, DashboardNode>;
};

export class NodeTreeDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeTreeDataError";
  }
}

function compareNodes(left: FlatNode, right: FlatNode) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

export function assembleNodeTree(nodes: readonly FlatNode[]): NodeTree {
  const sourceById = new Map<string, FlatNode>();
  const childrenByParent = new Map<string | null, FlatNode[]>();

  for (const node of nodes) {
    if (sourceById.has(node.id)) {
      throw new NodeTreeDataError(`Duplicate node id: ${node.id}`);
    }

    sourceById.set(node.id, node);
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  for (const node of nodes) {
    if (node.parentId !== null && !sourceById.has(node.parentId)) {
      throw new NodeTreeDataError(`Node ${node.id} has a missing parent.`);
    }
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareNodes);
    for (let index = 1; index < siblings.length; index += 1) {
      if (siblings[index - 1].position === siblings[index].position) {
        throw new NodeTreeDataError("A sibling group contains duplicate positions.");
      }
    }
  }

  const roots: DashboardNode[] = [];
  const ordered: DashboardNode[] = [];
  const byId = new Map<string, DashboardNode>();
  const visited = new Set<string>();
  const work: Array<{
    source: FlatNode;
    ancestors: NodeBreadcrumb[];
    inheritedRate: number | null;
    destination: DashboardNode[];
  }> = [];
  const rootSources = childrenByParent.get(null) ?? [];

  for (let index = rootSources.length - 1; index >= 0; index -= 1) {
    work.push({ source: rootSources[index], ancestors: [], inheritedRate: null, destination: roots });
  }

  while (work.length > 0) {
    const item = work.pop();
    if (!item) {
      break;
    }

    if (visited.has(item.source.id)) {
      throw new NodeTreeDataError(`Node ${item.source.id} is reachable more than once.`);
    }

    const breadcrumb = [
      ...item.ancestors,
      { id: item.source.id, title: item.source.title },
    ];
    const resolvedHourlyRateCents = item.source.hourlyRateCents ?? item.inheritedRate;
    const node: DashboardNode = {
      ...item.source,
      children: [],
      breadcrumb,
      resolvedHourlyRateCents,
      directDurationSeconds: 0,
      rolledUpDurationSeconds: 0,
      rolledUpValueCents: 0,
      hasUnpricedTime: false,
    };

    visited.add(node.id);
    byId.set(node.id, node);
    ordered.push(node);
    item.destination.push(node);

    const childSources = childrenByParent.get(node.id) ?? [];
    for (let index = childSources.length - 1; index >= 0; index -= 1) {
      work.push({
        source: childSources[index],
        ancestors: breadcrumb,
        inheritedRate: resolvedHourlyRateCents,
        destination: node.children,
      });
    }
  }

  if (visited.size !== nodes.length) {
    const unvisited = nodes.find((node) => !visited.has(node.id));
    throw new NodeTreeDataError(`A cycle makes node ${unvisited?.id ?? "unknown"} unreachable.`);
  }

  return { roots, ordered, byId };
}
