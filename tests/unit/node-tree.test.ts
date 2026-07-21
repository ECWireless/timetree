import { describe, expect, it } from "vitest";

import { assembleNodeTree, NodeTreeDataError, type FlatNode } from "../../src/lib/nodes/tree";

function node(overrides: Partial<FlatNode> & Pick<FlatNode, "id">): FlatNode {
  return {
    parentId: null,
    position: 0,
    title: overrides.id,
    description: null,
    hourlyRateCents: null,
    completedAt: null,
    ...overrides,
  };
}

describe("node tree assembly", () => {
  it("orders every sibling group and produces breadcrumbs", () => {
    const tree = assembleNodeTree([
      node({ id: "second-root", position: 1 }),
      node({ id: "late-child", parentId: "first-root", position: 1 }),
      node({ id: "first-root", position: 0, title: "First" }),
      node({ id: "early-child", parentId: "first-root", position: 0, title: "Early" }),
      node({ id: "grandchild", parentId: "early-child", position: 0, title: "Deep" }),
    ]);

    expect(tree.roots.map(({ id }) => id)).toEqual(["first-root", "second-root"]);
    expect(tree.roots[0].children.map(({ id }) => id)).toEqual(["early-child", "late-child"]);
    expect(tree.byId.get("grandchild")?.breadcrumb.map(({ title }) => title)).toEqual([
      "First",
      "Early",
      "Deep",
    ]);
    expect(tree.ordered.map(({ id }) => id)).toEqual([
      "first-root",
      "early-child",
      "grandchild",
      "late-child",
      "second-root",
    ]);
  });

  it("inherits the nearest explicit rate and preserves explicit zero", () => {
    const tree = assembleNodeTree([
      node({ id: "root", hourlyRateCents: 12_500 }),
      node({ id: "child", parentId: "root", hourlyRateCents: null }),
      node({ id: "zero", parentId: "child", hourlyRateCents: 0 }),
      node({ id: "deep", parentId: "zero", hourlyRateCents: null }),
    ]);

    expect(tree.byId.get("child")?.resolvedHourlyRateCents).toBe(12_500);
    expect(tree.byId.get("zero")?.resolvedHourlyRateCents).toBe(0);
    expect(tree.byId.get("deep")?.resolvedHourlyRateCents).toBe(0);
  });

  it("assembles a deeply nested valid tree without using the call stack", () => {
    const depth = 5_000;
    const nodes = Array.from({ length: depth }, (_, index) =>
      node({
        id: `node-${index}`,
        parentId: index === 0 ? null : `node-${index - 1}`,
      }),
    );

    const tree = assembleNodeTree(nodes);

    expect(tree.ordered).toHaveLength(depth);
    expect(tree.ordered.at(-1)?.breadcrumb).toHaveLength(depth);
  });

  it.each([
    {
      name: "duplicate ids",
      nodes: [node({ id: "same" }), node({ id: "same", position: 1 })],
    },
    {
      name: "missing parents",
      nodes: [node({ id: "orphan", parentId: "missing" })],
    },
    {
      name: "duplicate sibling positions",
      nodes: [node({ id: "one" }), node({ id: "two" })],
    },
    {
      name: "cycles",
      nodes: [
        node({ id: "one", parentId: "two" }),
        node({ id: "two", parentId: "one" }),
      ],
    },
  ])("rejects $name", ({ nodes }) => {
    expect(() => assembleNodeTree(nodes)).toThrow(NodeTreeDataError);
  });
});
