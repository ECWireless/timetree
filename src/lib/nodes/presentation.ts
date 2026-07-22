import type { DashboardNode } from "@/lib/nodes/tree";

function includesTitle(node: DashboardNode, normalizedQuery: string) {
  return node.title.toLocaleLowerCase().includes(normalizedQuery);
}

export function formatBreadcrumb(node: DashboardNode) {
  return node.breadcrumb.map(({ title }) => title).join(" / ");
}

export function filterCompletedTree(
  roots: readonly DashboardNode[],
  showCompleted: boolean,
): DashboardNode[] {
  if (showCompleted) {
    return [...roots];
  }

  const visibleById = new Map<string, DashboardNode>();
  const visibleRoots: DashboardNode[] = [];

  for (const root of roots) {
    if (root.completedAt === null) {
      const copy = { ...root, children: [] };
      visibleById.set(root.id, copy);
      visibleRoots.push(copy);
    }
  }

  const work = [...roots];
  for (let index = 0; index < work.length; index += 1) {
    const parent = work[index];
    work.push(...parent.children);
    const visibleParent = visibleById.get(parent.id);
    if (!visibleParent) {
      continue;
    }

    for (const child of parent.children) {
      if (child.completedAt === null) {
        const copy = { ...child, children: [] };
        visibleById.set(child.id, copy);
        visibleParent.children.push(copy);
      }
    }
  }

  return visibleRoots;
}

export function searchNodes(nodes: readonly DashboardNode[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  return nodes.filter((node) => includesTitle(node, normalizedQuery));
}

export function getMoveDestinations(
  nodes: readonly DashboardNode[],
  source: DashboardNode,
  query: string,
) {
  const blockedIds = new Set<string>();
  const work = [source];
  while (work.length > 0) {
    const node = work.pop();
    if (!node) {
      break;
    }
    blockedIds.add(node.id);
    work.push(...node.children);
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  return nodes.filter(
    (node) =>
      !blockedIds.has(node.id) &&
      (source.completedAt !== null || node.completedAt === null) &&
      (!normalizedQuery || includesTitle(node, normalizedQuery)),
  );
}
