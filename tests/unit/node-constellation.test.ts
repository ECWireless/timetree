import { describe, expect, it } from "vitest";

import {
  buildConstellationGraph,
  CONSTELLATION_MAX_RADIUS,
  CONSTELLATION_MIN_RADIUS,
  constellationDurationSeconds,
  constellationRadius,
  staticConstellationPosition,
} from "../../src/lib/nodes/constellation";
import { assembleNodeTree, type FlatNode } from "../../src/lib/nodes/tree";

function node(id: string, parentId: string | null, position: number, completed = false): FlatNode {
  return {
    id,
    parentId,
    position,
    title: id,
    description: null,
    hourlyRateCents: null,
    completedAt: completed ? "2026-07-22T00:00:00.000Z" : null,
  };
}

describe("node constellation", () => {
  it("uses bounded square-root scaling while retaining zero-hour nodes", () => {
    expect(constellationRadius(0, 10_000)).toBe(CONSTELLATION_MIN_RADIUS);
    expect(constellationRadius(10_000, 10_000)).toBe(CONSTELLATION_MAX_RADIUS);
    expect(constellationRadius(2_500, 10_000)).toBe(
      CONSTELLATION_MIN_RADIUS +
        (CONSTELLATION_MAX_RADIUS - CONSTELLATION_MIN_RADIUS) / 2,
    );
  });

  it("provides an immediate deterministic reduced-motion layout", () => {
    expect(staticConstellationPosition(0, 800, 600, 68)).toEqual({ x: 400, y: 300 });
    expect(staticConstellationPosition(4, 800, 600, 68)).toEqual(
      staticConstellationPosition(4, 800, 600, 68),
    );
    expect(staticConstellationPosition(4, 800, 600, 68)).not.toEqual(
      staticConstellationPosition(5, 800, 600, 68),
    );
  });

  it("uses the visible rollup and omits completed branches until requested", () => {
    const tree = assembleNodeTree(
      [
        node("root", null, 0),
        node("active", "root", 0),
        node("completed", "root", 1, true),
        node("completed-child", "completed", 0, true),
      ],
      [
        {
          nodeId: "root",
          durationSeconds: 3_600,
          pricedValueNumerator: "0",
          hasPricedTime: false,
          hasUnpricedTime: true,
        },
        {
          nodeId: "active",
          durationSeconds: 1_800,
          pricedValueNumerator: "0",
          hasPricedTime: false,
          hasUnpricedTime: true,
        },
        {
          nodeId: "completed",
          durationSeconds: 900,
          pricedValueNumerator: "0",
          hasPricedTime: false,
          hasUnpricedTime: true,
        },
        {
          nodeId: "completed-child",
          durationSeconds: 300,
          pricedValueNumerator: "0",
          hasPricedTime: false,
          hasUnpricedTime: true,
        },
      ],
    );

    const activeGraph = buildConstellationGraph(tree.ordered, false);
    expect(activeGraph.nodes.map(({ id }) => id)).toEqual(["root", "active"]);
    expect(activeGraph.links).toEqual([{ sourceId: "root", targetId: "active" }]);
    expect(constellationDurationSeconds(tree.byId.get("root")!, false)).toBe(5_400);

    const completeGraph = buildConstellationGraph(tree.ordered, true);
    expect(completeGraph.nodes.map(({ id }) => id)).toEqual([
      "root",
      "active",
      "completed",
      "completed-child",
    ]);
    expect(completeGraph.links).toEqual([
      { sourceId: "root", targetId: "active" },
      { sourceId: "root", targetId: "completed" },
      { sourceId: "completed", targetId: "completed-child" },
    ]);
    expect(constellationDurationSeconds(tree.byId.get("root")!, true)).toBe(6_600);
  });
});
