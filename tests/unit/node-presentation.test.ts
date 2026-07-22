import { describe, expect, it } from "vitest";

import {
  filterCompletedTree,
  formatBreadcrumb,
  getMoveDestinations,
  getNodeDropDestination,
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

  it("calculates before, after, and inside positions from every authoritative sibling", () => {
    const dragTree = assembleNodeTree([
      node({ id: "source-parent", title: "Source parent" }),
      node({ id: "first", parentId: "source-parent", title: "First" }),
      node({ id: "source", parentId: "source-parent", position: 1, title: "Source" }),
      node({
        id: "hidden-completed",
        parentId: "source-parent",
        position: 2,
        title: "Hidden completed",
        completedAt: "2026-07-22T00:00:00.000Z",
      }),
      node({ id: "last", parentId: "source-parent", position: 3, title: "Last" }),
      node({ id: "destination", position: 1, title: "Destination" }),
      node({ id: "destination-child", parentId: "destination", title: "Existing child" }),
      node({
        id: "destination-completed-child",
        parentId: "destination",
        position: 1,
        title: "Existing completed child",
        completedAt: "2026-07-22T00:00:00.000Z",
      }),
    ]);
    const source = dragTree.byId.get("source")!;

    expect(
      getNodeDropDestination(dragTree.ordered, source, dragTree.byId.get("last")!, "before"),
    ).toEqual({ parentId: "source-parent", position: 2, targetId: "last", zone: "before" });
    expect(
      getNodeDropDestination(dragTree.ordered, source, dragTree.byId.get("last")!, "after"),
    ).toEqual({ parentId: "source-parent", position: 3, targetId: "last", zone: "after" });
    expect(
      getNodeDropDestination(
        dragTree.ordered,
        source,
        dragTree.byId.get("destination")!,
        "inside",
      ),
    ).toEqual({ parentId: "destination", position: 2, targetId: "destination", zone: "inside" });
  });

  it("rejects cyclic and incomplete-under-completed drop destinations", () => {
    const source = tree.byId.get("active-root")!;
    const descendant = tree.byId.get("active-child")!;
    const completedParent = tree.byId.get("completed-root")!;

    expect(getNodeDropDestination(tree.ordered, source, source, "inside")).toBeNull();
    expect(getNodeDropDestination(tree.ordered, source, descendant, "inside")).toBeNull();
    expect(getNodeDropDestination(tree.ordered, source, descendant, "before")).toBeNull();
    expect(getNodeDropDestination(tree.ordered, descendant, completedParent, "inside")).toBeNull();
    expect(
      getNodeDropDestination(
        tree.ordered,
        tree.byId.get("completed-child")!,
        completedParent,
        "inside",
      ),
    ).toEqual({ parentId: "completed-root", position: 0, targetId: "completed-root", zone: "inside" });
  });
});
