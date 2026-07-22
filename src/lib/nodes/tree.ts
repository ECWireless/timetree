import { roundValueNumeratorToCents } from "../time-entries/money";

export type FlatNode = {
  id: string;
  parentId: string | null;
  position: number;
  title: string;
  description: string | null;
  hourlyRateCents: number | null;
  completedAt: string | null;
};

export type DirectEntryAggregate = {
  nodeId: string;
  durationSeconds: number;
  pricedValueNumerator: string;
  hasUnpricedTime: boolean;
  hasPricedTime: boolean;
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
  rolledUpValueCents: string;
  hasUnpricedTime: boolean;
  hasPricedTime: boolean;
  rolledUpDurationSecondsIncludingCompleted: number;
  rolledUpValueCentsIncludingCompleted: string;
  hasUnpricedTimeIncludingCompleted: boolean;
  hasPricedTimeIncludingCompleted: boolean;
  completedDescendantCount: number;
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

export function assembleNodeTree(
  nodes: readonly FlatNode[],
  directEntryAggregates: readonly DirectEntryAggregate[] = [],
): NodeTree {
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
      rolledUpValueCents: "0",
      hasUnpricedTime: false,
      hasPricedTime: false,
      rolledUpDurationSecondsIncludingCompleted: 0,
      rolledUpValueCentsIncludingCompleted: "0",
      hasUnpricedTimeIncludingCompleted: false,
      hasPricedTimeIncludingCompleted: false,
      completedDescendantCount: 0,
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

  const directValueNumerators = new Map<string, bigint>();
  const rolledUpValueNumerators = new Map<string, bigint>();
  const rolledUpValueNumeratorsIncludingCompleted = new Map<string, bigint>();
  const aggregatedNodeIds = new Set<string>();

  for (const aggregate of directEntryAggregates) {
    if (aggregatedNodeIds.has(aggregate.nodeId)) {
      throw new NodeTreeDataError(`Duplicate direct aggregate for node ${aggregate.nodeId}.`);
    }
    aggregatedNodeIds.add(aggregate.nodeId);

    const node = byId.get(aggregate.nodeId);
    if (!node) {
      throw new NodeTreeDataError(`Direct aggregate has a missing node: ${aggregate.nodeId}.`);
    }
    if (!Number.isSafeInteger(aggregate.durationSeconds) || aggregate.durationSeconds < 0) {
      throw new NodeTreeDataError(`Direct duration is invalid for node ${aggregate.nodeId}.`);
    }

    let numerator: bigint;
    try {
      numerator = BigInt(aggregate.pricedValueNumerator);
    } catch {
      throw new NodeTreeDataError(`Priced value is invalid for node ${aggregate.nodeId}.`);
    }
    if (numerator < 0) {
      throw new NodeTreeDataError(`Priced value is invalid for node ${aggregate.nodeId}.`);
    }

    node.directDurationSeconds = aggregate.durationSeconds;
    node.hasUnpricedTime = aggregate.hasUnpricedTime;
    node.hasPricedTime = aggregate.hasPricedTime;
    directValueNumerators.set(node.id, numerator);
  }

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const node = ordered[index];
    let durationSeconds = node.directDurationSeconds;
    let valueNumerator = directValueNumerators.get(node.id) ?? BigInt(0);
    let hasUnpricedTime = node.hasUnpricedTime;
    let hasPricedTime = node.hasPricedTime;
    let durationSecondsIncludingCompleted = node.directDurationSeconds;
    let valueNumeratorIncludingCompleted = valueNumerator;
    let hasUnpricedTimeIncludingCompleted = node.hasUnpricedTime;
    let hasPricedTimeIncludingCompleted = node.hasPricedTime;
    let completedDescendantCount = 0;

    for (const child of node.children) {
      durationSecondsIncludingCompleted += child.rolledUpDurationSecondsIncludingCompleted;
      valueNumeratorIncludingCompleted +=
        rolledUpValueNumeratorsIncludingCompleted.get(child.id) ?? BigInt(0);
      hasUnpricedTimeIncludingCompleted ||= child.hasUnpricedTimeIncludingCompleted;
      hasPricedTimeIncludingCompleted ||= child.hasPricedTimeIncludingCompleted;

      if (child.completedAt === null) {
        durationSeconds += child.rolledUpDurationSeconds;
        valueNumerator += rolledUpValueNumerators.get(child.id) ?? BigInt(0);
        hasUnpricedTime ||= child.hasUnpricedTime;
        hasPricedTime ||= child.hasPricedTime;
      }
      completedDescendantCount +=
        child.completedDescendantCount + (child.completedAt === null ? 0 : 1);
    }

    if (
      !Number.isSafeInteger(durationSeconds) ||
      !Number.isSafeInteger(durationSecondsIncludingCompleted)
    ) {
      throw new NodeTreeDataError(`Rolled-up duration is too large for node ${node.id}.`);
    }
    node.rolledUpDurationSeconds = durationSeconds;
    node.rolledUpValueCents = roundValueNumeratorToCents(valueNumerator).toString();
    node.hasUnpricedTime = hasUnpricedTime;
    node.hasPricedTime = hasPricedTime;
    node.rolledUpDurationSecondsIncludingCompleted = durationSecondsIncludingCompleted;
    node.rolledUpValueCentsIncludingCompleted = roundValueNumeratorToCents(
      valueNumeratorIncludingCompleted,
    ).toString();
    node.hasUnpricedTimeIncludingCompleted = hasUnpricedTimeIncludingCompleted;
    node.hasPricedTimeIncludingCompleted = hasPricedTimeIncludingCompleted;
    node.completedDescendantCount = completedDescendantCount;
    rolledUpValueNumerators.set(node.id, valueNumerator);
    rolledUpValueNumeratorsIncludingCompleted.set(node.id, valueNumeratorIncludingCompleted);
  }

  return { roots, ordered, byId };
}
