import { describe, expect, it } from "vitest";

import {
  filterCompletedTree,
  formatBreadcrumb,
  getMoveDestinations,
  searchNodes,
} from "../../src/lib/nodes/presentation";
import { assembleNodeTree, type FlatNode } from "../../src/lib/nodes/tree";

function node(overrides: Partial<FlatNode> & Pick<FlatNode, "id" | "title">): FlatNode {
  return {
    parentId: null,
    position: 0,
    description: null,
    hourlyRateCents: null,
    completedAt: null,
    ...overrides,
  };
}

describe("node presentation", () => {
  const tree = assembleNodeTree([
    node({ id: "active-root", title: "Client Work" }),
    node({
      id: "active-child",
      parentId: "active-root",
      title: "Website Research",
    }),
    node({
      id: "completed-child",
      parentId: "active-root",
      position: 1,
      title: "Old Website",
      completedAt: "2026-07-22T00:00:00.000Z",
    }),
    node({
      id: "completed-root",
      position: 1,
      title: "Archived Client",
      completedAt: "2026-07-22T00:00:00.000Z",
    }),
  ]);

  it("hides completed nodes without mutating the authoritative tree", () => {
    const filtered = filterCompletedTree(tree.roots, false);

    expect(filtered.map(({ id }) => id)).toEqual(["active-root"]);
    expect(filtered[0].children.map(({ id }) => id)).toEqual(["active-child"]);
    expect(tree.byId.get("active-root")?.children.map(({ id }) => id)).toEqual([
      "active-child",
      "completed-child",
    ]);
    expect(filterCompletedTree(tree.roots, true)).toEqual(tree.roots);
  });

  it("matches titles case-insensitively and keeps breadcrumb context", () => {
    expect(searchNodes(tree.ordered, "  WEBSITE ").map(({ id }) => id)).toEqual([
      "active-child",
      "completed-child",
    ]);
    expect(searchNodes(tree.ordered, "")).toEqual([]);
    expect(formatBreadcrumb(tree.byId.get("active-child")!)).toBe(
      "Client Work / Website Research",
    );
  });

  it("excludes the moved subtree and completed parents for an incomplete source", () => {
    const source = tree.byId.get("active-root")!;

    expect(getMoveDestinations(tree.ordered, source, "")).toEqual([]);
  });

  it("allows a completed source to move beneath another completed node", () => {
    const source = tree.byId.get("completed-child")!;

    expect(getMoveDestinations(tree.ordered, source, "archived").map(({ id }) => id)).toEqual([
      "completed-root",
    ]);
  });
});
