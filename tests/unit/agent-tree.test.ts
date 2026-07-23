import { describe, expect, it } from "vitest";

import { orderScopedAgentNodes } from "../../src/lib/agent/tree";
import type { FlatNode } from "../../src/lib/nodes/tree";

function node(
  id: string,
  parentId: string | null,
  position: number,
): FlatNode {
  return {
    id,
    parentId,
    position,
    title: id,
    description: null,
    hourlyRateCents: null,
    completedAt: null,
  };
}

describe("agent subtree ordering", () => {
  it("preserves sibling position in depth-first preorder", () => {
    const nodes = [
      node("root", null, 0),
      node("second", "root", 1),
      node("first-child", "first", 0),
      node("first", "root", 0),
    ];

    expect(
      orderScopedAgentNodes(
        nodes,
        "root",
        new Set(nodes.map(({ id }) => id)),
      ).map(({ id }) => id),
    ).toEqual(["root", "first", "first-child", "second"]);
  });

  it("orders a legal deeply nested subtree without recursive stack growth", () => {
    const depth = 15_000;
    const nodes = Array.from({ length: depth }, (_, index) =>
      node(
        `node-${index}`,
        index === 0 ? null : `node-${index - 1}`,
        0,
      ),
    );

    const ordered = orderScopedAgentNodes(
      nodes,
      "node-0",
      new Set(nodes.map(({ id }) => id)),
    );

    expect(ordered).toHaveLength(depth);
    expect(ordered[0].id).toBe("node-0");
    expect(ordered.at(-1)?.id).toBe(`node-${depth - 1}`);
  });
});
