import type { DashboardNode } from "./tree";

export const CONSTELLATION_MIN_RADIUS = 24;
export const CONSTELLATION_MAX_RADIUS = 68;

export type ConstellationLink = {
  sourceId: string;
  targetId: string;
};

export type ConstellationGraph = {
  links: ConstellationLink[];
  nodes: DashboardNode[];
  radiusByNodeId: Map<string, number>;
};

export function constellationDurationSeconds(
  node: DashboardNode,
  includeCompleted: boolean,
) {
  return includeCompleted
    ? node.rolledUpDurationSecondsIncludingCompleted
    : node.rolledUpDurationSeconds;
}

export function constellationRadius(durationSeconds: number, maximumDurationSeconds: number) {
  if (durationSeconds <= 0 || maximumDurationSeconds <= 0) {
    return CONSTELLATION_MIN_RADIUS;
  }

  const normalized = Math.min(durationSeconds / maximumDurationSeconds, 1);
  return (
    CONSTELLATION_MIN_RADIUS +
    Math.sqrt(normalized) * (CONSTELLATION_MAX_RADIUS - CONSTELLATION_MIN_RADIUS)
  );
}

export function staticConstellationPosition(
  index: number,
  width: number,
  height: number,
  maximumRadius: number,
) {
  if (index === 0) {
    return { x: width / 2, y: height / 2 };
  }

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const spacing = maximumRadius * 2 + 24;
  const orbit = spacing * Math.sqrt(index);
  return {
    x: width / 2 + Math.cos(index * goldenAngle) * orbit,
    y: height / 2 + Math.sin(index * goldenAngle) * orbit,
  };
}

export function buildConstellationGraph(
  orderedNodes: readonly DashboardNode[],
  includeCompleted: boolean,
): ConstellationGraph {
  const nodes = includeCompleted
    ? [...orderedNodes]
    : orderedNodes.filter((node) => node.completedAt === null);
  const visibleIds = new Set(nodes.map((node) => node.id));
  const maximumDurationSeconds = nodes.reduce(
    (maximum, node) =>
      Math.max(maximum, constellationDurationSeconds(node, includeCompleted)),
    0,
  );
  const radiusByNodeId = new Map(
    nodes.map((node) => [
      node.id,
      constellationRadius(
        constellationDurationSeconds(node, includeCompleted),
        maximumDurationSeconds,
      ),
    ]),
  );
  const links = nodes.flatMap((node) =>
    node.parentId && visibleIds.has(node.parentId)
      ? [{ sourceId: node.parentId, targetId: node.id }]
      : [],
  );

  return { links, nodes, radiusByNodeId };
}
