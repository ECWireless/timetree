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

  it("rolls direct duration, exact priced value, and unpriced time up once", () => {
    const tree = assembleNodeTree(
      [
        node({ id: "root" }),
        node({ id: "child", parentId: "root" }),
        node({
          id: "grandchild",
          parentId: "child",
          completedAt: "2026-07-20T12:00:00.000Z",
        }),
      ],
      [
        {
          nodeId: "root",
          durationSeconds: 3_600,
          pricedValueNumerator: "36000000",
          hasUnpricedTime: false,
          hasPricedTime: true,
        },
        {
          nodeId: "child",
          durationSeconds: 1_800,
          pricedValueNumerator: "36000000",
          hasUnpricedTime: false,
          hasPricedTime: true,
        },
        {
          nodeId: "grandchild",
          durationSeconds: 900,
          pricedValueNumerator: "0",
          hasUnpricedTime: true,
          hasPricedTime: false,
        },
      ],
    );

    expect(tree.byId.get("root")).toMatchObject({
      directDurationSeconds: 3_600,
      rolledUpDurationSeconds: 6_300,
      rolledUpValueCents: "20000",
      hasUnpricedTime: true,
      hasPricedTime: true,
      completedDescendantCount: 1,
    });
    expect(tree.byId.get("child")).toMatchObject({
      directDurationSeconds: 1_800,
      rolledUpDurationSeconds: 2_700,
      rolledUpValueCents: "10000",
      hasUnpricedTime: true,
      hasPricedTime: true,
      completedDescendantCount: 1,
    });
    expect(tree.byId.get("grandchild")).toMatchObject({
      directDurationSeconds: 900,
      rolledUpDurationSeconds: 900,
      rolledUpValueCents: "0",
      hasUnpricedTime: true,
      hasPricedTime: false,
      completedDescendantCount: 0,
    });
  });

  it("rounds a subtree value only after combining exact direct contributions", () => {
    const tree = assembleNodeTree(
      [node({ id: "root" }), node({ id: "child", parentId: "root" })],
      [
        {
          nodeId: "root",
          durationSeconds: 1,
          pricedValueNumerator: "1800",
          hasUnpricedTime: false,
          hasPricedTime: true,
        },
        {
          nodeId: "child",
          durationSeconds: 1,
          pricedValueNumerator: "1800",
          hasUnpricedTime: false,
          hasPricedTime: true,
        },
      ],
    );

    expect(tree.byId.get("root")?.rolledUpValueCents).toBe("1");
    expect(tree.byId.get("child")?.rolledUpValueCents).toBe("1");
  });

  it("preserves aggregate values beyond JavaScript's safe integer range", () => {
    const tree = assembleNodeTree(
      [node({ id: "root" })],
      [
        {
          nodeId: "root",
          durationSeconds: 1,
          pricedValueNumerator: "3242591731706757123600",
          hasUnpricedTime: false,
          hasPricedTime: true,
        },
      ],
    );

    expect(tree.byId.get("root")?.rolledUpValueCents).toBe("900719925474099201");
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
