"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createNode, updateNode } from "@/app/actions/nodes";
import { SignOutButton } from "@/components/auth-buttons";
import { BrandMark } from "@/components/brand-mark";
import { NodeTreeList } from "@/components/node-tree-list";
import type { DashboardNode, FlatNode } from "@/lib/nodes/tree";

type DashboardShellProps = {
  email: string;
  nodes: FlatNode[];
  orderedNodes: DashboardNode[];
  selectedNodeId?: string;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatRate(cents: number) {
  return `${usd.format(cents / 100)}/hr`;
}

function rateInputValue(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function parseRateCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
}

function ZeroMetrics({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "node-metrics node-metrics--compact" : "node-metrics"}>
      <span>
        <strong>0h</strong>
        <small>rolled up</small>
      </span>
      <span>
        <strong>0h</strong>
        <small>direct</small>
      </span>
      <span>
        <strong>$0.00</strong>
        <small>value</small>
      </span>
    </span>
  );
}

function NodeCreateForm({
  parentId,
  parentTitle,
  onCreated,
  onCancel,
}: {
  parentId: string | null;
  parentTitle?: string;
  onCreated: (nodeId: string, parentId: string | null) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const label = parentTitle ? `Child node title for ${parentTitle}` : "Root node title";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await createNode({ title, parentId });
      if (!result.ok) {
        setError(result.fieldErrors?.title?.[0] ?? result.message);
        return;
      }
      onCreated(result.nodeId, parentId);
    } finally {
      setPending(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form className="node-create" onSubmit={submit} onKeyDown={keyDown}>
      <label>
        <span className="sr-only">{label}</span>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={parentTitle ? "Child node name" : "Root node name"}
          maxLength={200}
          disabled={pending}
        />
      </label>
      <button className="button button--primary button--small" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </button>
      <button className="button button--quiet button--small" type="button" onClick={onCancel}>
        Cancel
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function TitleEditor({ node, onSaved }: { node: DashboardNode; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing || pending) {
      return;
    }
    if (draft === node.title) {
      setEditing(false);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await updateNode({ id: node.id, title: draft });
      if (!result.ok) {
        setError(result.fieldErrors?.title?.[0] ?? result.message);
        return;
      }
      setEditing(false);
      onSaved();
    } finally {
      setPending(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(node.title);
      setError(null);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="inline-editor inline-editor--title">
        <label>
          <span className="sr-only">Node title</span>
          <input
            autoFocus
            value={draft}
            maxLength={200}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={keyDown}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="detail-title">
      <h1 id="node-detail-title">{node.title}</h1>
      <button
        className="text-action"
        type="button"
        onClick={() => {
          setDraft(node.title);
          setError(null);
          setEditing(true);
        }}
      >
        Edit title
      </button>
    </div>
  );
}

function DescriptionEditor({ node, onSaved }: { node: DashboardNode; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!editing || pending) {
      return;
    }
    const normalized = draft.trim() || null;
    if (normalized === node.description) {
      setEditing(false);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await updateNode({ id: node.id, description: normalized });
      if (!result.ok) {
        setError(result.fieldErrors?.description?.[0] ?? result.message);
        return;
      }
      setEditing(false);
      onSaved();
    } finally {
      setPending(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(node.description ?? "");
      setError(null);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="inline-editor">
        <label>
          <span className="field-label">Description</span>
          <textarea
            autoFocus
            value={draft}
            maxLength={4_000}
            rows={4}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={keyDown}
          />
        </label>
        <p className="field-hint">Enter to save · Shift+Enter for a new line · Escape to cancel</p>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <section className="detail-field" aria-labelledby={`description-${node.id}`}>
      <div>
        <h2 id={`description-${node.id}`}>Description</h2>
        <p className={node.description ? undefined : "empty-copy"}>
          {node.description ?? "Add context for this node."}
        </p>
      </div>
      <button
        className="text-action"
        type="button"
        onClick={() => {
          setDraft(node.description ?? "");
          setError(null);
          setEditing(true);
        }}
      >
        {node.description ? "Edit description" : "Add description"}
      </button>
    </section>
  );
}

function RateEditor({ node, onSaved }: { node: DashboardNode; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [inherits, setInherits] = useState(node.hourlyRateCents === null);
  const [rate, setRate] = useState(rateInputValue(node.hourlyRateCents));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) {
      return;
    }
    const cents = inherits ? null : parseRateCents(rate);
    if (!inherits && cents === null) {
      setError("Enter a non-negative dollar amount with no more than two decimal places.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await updateNode({ id: node.id, hourlyRateCents: cents });
      if (!result.ok) {
        setError(result.fieldErrors?.hourlyRateCents?.[0] ?? result.message);
        return;
      }
      setEditing(false);
      onSaved();
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  function keyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setError(null);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <form className="inline-editor rate-editor" onSubmit={submit} onKeyDown={keyDown}>
        <fieldset>
          <legend>Hourly rate</legend>
          <label className="choice-row">
            <input
              autoFocus
              type="radio"
              name={`rate-mode-${node.id}`}
              checked={inherits}
              onChange={() => setInherits(true)}
            />
            Use inherited rate
          </label>
          <label className="choice-row">
            <input
              type="radio"
              name={`rate-mode-${node.id}`}
              checked={!inherits}
              onChange={() => setInherits(false)}
            />
            Set rate for this node
          </label>
        </fieldset>
        {!inherits ? (
          <label>
            <span className="field-label">Hourly rate in dollars</span>
            <span className="money-input">
              <span aria-hidden="true">$</span>
              <input
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                disabled={pending}
              />
            </span>
          </label>
        ) : null}
        <div className="editor-actions">
          <button className="button button--primary button--small" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save rate"}
          </button>
          <button
            className="button button--quiet button--small"
            type="button"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    );
  }

  const rateDescription =
    node.hourlyRateCents !== null
      ? `${formatRate(node.hourlyRateCents)} · Set on this node`
      : node.resolvedHourlyRateCents !== null
        ? `${formatRate(node.resolvedHourlyRateCents)} · Inherited`
        : "No rate set";

  return (
    <section className="detail-field">
      <div>
        <h2>Hourly rate</h2>
        <p>{rateDescription}</p>
      </div>
      <button
        className="text-action"
        type="button"
        onClick={() => {
          setInherits(node.hourlyRateCents === null);
          setRate(rateInputValue(node.hourlyRateCents));
          setError(null);
          setEditing(true);
        }}
      >
        Edit rate
      </button>
    </section>
  );
}

type NodeTreeProps = {
  roots: DashboardNode[];
  selectedNodeId?: string;
  expanded: Set<string>;
  creatingChildFor: string | null;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onCreated: (nodeId: string, parentId: string | null) => void;
  onCancelCreate: () => void;
  registerNodeButton: (nodeId: string, element: HTMLButtonElement | null) => void;
};

function NodeTree({
  roots,
  selectedNodeId,
  expanded,
  creatingChildFor,
  onSelect,
  onToggle,
  onAddChild,
  onCreated,
  onCancelCreate,
  registerNodeButton,
}: NodeTreeProps) {
  return (
    <NodeTreeList
      roots={roots}
      expanded={expanded}
      renderNode={(node, depth) => {
        const visualDepth = Math.min(depth, 12);
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(node.id);

        return (
          <>
            <div
              className={node.id === selectedNodeId ? "node-row node-row--selected" : "node-row"}
              style={{ "--node-depth": visualDepth } as CSSProperties}
            >
              {hasChildren ? (
                <button
                  className="tree-toggle"
                  type="button"
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.title}`}
                  aria-expanded={isExpanded}
                  onClick={() => onToggle(node.id)}
                >
                  <span aria-hidden="true">{isExpanded ? "−" : "+"}</span>
                </button>
              ) : (
                <span className="tree-toggle tree-toggle--empty" aria-hidden="true" />
              )}
              <button
                ref={(element) => registerNodeButton(node.id, element)}
                className="node-select"
                type="button"
                aria-label={node.title}
                aria-current={node.id === selectedNodeId ? "page" : undefined}
                onClick={() => onSelect(node.id)}
              >
                <span>{node.title}</span>
                <ZeroMetrics compact />
              </button>
              <button
                className="add-child-button"
                type="button"
                aria-label={`Add child to ${node.title}`}
                onClick={() => onAddChild(node.id)}
              >
                <span aria-hidden="true">+</span>
              </button>
            </div>
            {creatingChildFor === node.id ? (
              <div
                className="tree-child-create"
                style={{ "--node-depth": Math.min(depth + 1, 12) } as CSSProperties}
              >
                <NodeCreateForm
                  parentId={node.id}
                  parentTitle={node.title}
                  onCreated={onCreated}
                  onCancel={onCancelCreate}
                />
              </div>
            ) : null}
          </>
        );
      }}
    />
  );
}

export function DashboardShell({
  email,
  nodes,
  orderedNodes,
  selectedNodeId,
}: DashboardShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nodeById = useMemo(
    () => new Map(orderedNodes.map((node) => [node.id, node])),
    [orderedNodes],
  );
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(selectedNode?.breadcrumb.slice(0, -1).map(({ id }) => id) ?? []),
  );
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [creatingTreeChildFor, setCreatingTreeChildFor] = useState<string | null>(null);
  const [creatingDetailChild, setCreatingDetailChild] = useState(false);
  const detailFocusRef = useRef<HTMLDivElement>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<"detail" | "tree" | null>(null);
  const treeFocusNodeId = useRef<string | null>(null);
  const rootNodes = useMemo(
    () => orderedNodes.filter((node) => node.parentId === null),
    [orderedNodes],
  );

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) {
      pendingFocus.current = null;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (pendingFocus.current === "detail" && selectedNode) {
        detailFocusRef.current?.focus();
      } else if (pendingFocus.current === "tree" && !selectedNode && treeFocusNodeId.current) {
        nodeButtonRefs.current.get(treeFocusNodeId.current)?.focus();
      }
      pendingFocus.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedNode]);

  function navigateToNode(nodeId?: string) {
    setCreatingTreeChildFor(null);
    setCreatingDetailChild(false);
    const target = nodeId ? nodeById.get(nodeId) : undefined;
    if (target) {
      pendingFocus.current = "detail";
      setExpanded((current) => {
        const next = new Set(current);
        for (const ancestor of target.breadcrumb.slice(0, -1)) {
          next.add(ancestor.id);
        }
        return next;
      });
    }

    const next = new URLSearchParams(searchParams.toString());
    if (nodeId) {
      next.set("node", nodeId);
    } else {
      next.delete("node");
    }
    const query = next.toString();
    router.push(query ? `/?${query}` : "/", { scroll: false });
  }

  function returnToTree() {
    if (!selectedNode) {
      return;
    }

    treeFocusNodeId.current = selectedNode.id;
    pendingFocus.current = "tree";
    setCreatingDetailChild(false);
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of selectedNode.breadcrumb.slice(0, -1)) {
        next.add(ancestor.id);
      }
      return next;
    });

    const next = new URLSearchParams(searchParams.toString());
    next.delete("node");
    const query = next.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  }

  function registerNodeButton(nodeId: string, element: HTMLButtonElement | null) {
    if (element) {
      nodeButtonRefs.current.set(nodeId, element);
    } else {
      nodeButtonRefs.current.delete(nodeId);
    }
  }

  function mutationSaved() {
    router.refresh();
  }

  function created(nodeId: string, parentId: string | null) {
    if (parentId) {
      setExpanded((current) => new Set(current).add(parentId));
    }
    setCreatingRoot(false);
    setCreatingTreeChildFor(null);
    setCreatingDetailChild(false);
    pendingFocus.current = "detail";
    navigateToNode(nodeId);
  }

  function toggleExpanded(nodeId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  return (
    <main
      className={selectedNode ? "dashboard dashboard--selected" : "dashboard"}
      aria-label="TimeTree workspace"
      data-testid="dashboard-page"
    >
      <header className="dashboard-header">
        <div className="wordmark wordmark--compact" aria-label="TimeTree">
          <BrandMark />
          <span>TimeTree</span>
        </div>
        <div className="dashboard-account">
          <span>{email}</span>
          <SignOutButton />
        </div>
      </header>

      <div className="dashboard-toolbar" aria-label="Tree tools">
        <div>
          <p className="eyebrow">{nodes.length === 1 ? "1 node" : `${nodes.length} nodes`}</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => setCreatingRoot(true)}>
          New root node
        </button>
      </div>

      {creatingRoot ? (
        <div className="root-create-wrap">
          <NodeCreateForm parentId={null} onCreated={created} onCancel={() => setCreatingRoot(false)} />
        </div>
      ) : null}

      <div className="dashboard-main">
        <section className="tree-pane" aria-labelledby="tree-heading">
          <div className="pane-heading">
            <h1 id="tree-heading">Node tree</h1>
            <p>Organize work at any depth.</p>
          </div>

          {orderedNodes.length === 0 ? (
            <div className="tree-empty">
              <p>No nodes yet.</p>
              <button className="text-action" type="button" onClick={() => setCreatingRoot(true)}>
                Create your first root node
              </button>
            </div>
          ) : (
            <div className="node-tree" aria-label="Work nodes">
              <NodeTree
                roots={rootNodes}
                selectedNodeId={selectedNode?.id}
                expanded={expanded}
                creatingChildFor={creatingTreeChildFor}
                onSelect={navigateToNode}
                onToggle={toggleExpanded}
                onAddChild={setCreatingTreeChildFor}
                onCreated={created}
                onCancelCreate={() => setCreatingTreeChildFor(null)}
                registerNodeButton={registerNodeButton}
              />
            </div>
          )}
        </section>

        <section
          className="detail-pane"
          aria-label={selectedNode ? `Node details for ${selectedNode.title}` : "Node details"}
        >
          {selectedNode ? (
            <div
              ref={detailFocusRef}
              className="detail-content"
              key={selectedNode.id}
              tabIndex={-1}
              aria-label={`${selectedNode.title} details`}
            >
              <button className="mobile-back" type="button" onClick={returnToTree}>
                <span aria-hidden="true">←</span> Back to tree
              </button>
              <nav className="breadcrumbs" aria-label="Breadcrumb">
                <ol>
                  {selectedNode.breadcrumb.map((crumb, index) => (
                    <li key={crumb.id}>
                      {index < selectedNode.breadcrumb.length - 1 ? (
                        <button type="button" onClick={() => navigateToNode(crumb.id)}>
                          {crumb.title}
                        </button>
                      ) : (
                        <span aria-current="page">{crumb.title}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
              <TitleEditor node={selectedNode} onSaved={mutationSaved} />
              <ZeroMetrics />
              <div className="detail-fields">
                <DescriptionEditor node={selectedNode} onSaved={mutationSaved} />
                <RateEditor node={selectedNode} onSaved={mutationSaved} />
              </div>
              <div className="detail-child">
                {creatingDetailChild ? (
                  <NodeCreateForm
                    parentId={selectedNode.id}
                    parentTitle={selectedNode.title}
                    onCreated={created}
                    onCancel={() => setCreatingDetailChild(false)}
                  />
                ) : (
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => setCreatingDetailChild(true)}
                  >
                    Add child node
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="detail-empty">
              <p className="eyebrow">Node details</p>
              <h2 id="detail-heading">Select a node to work with it.</h2>
              <p>Its breadcrumb, description, rate, and totals will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
