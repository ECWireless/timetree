"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { completeNode, createNode, moveNode, reopenNode, updateNode } from "@/app/actions/nodes";
import { SignOutButton } from "@/components/auth-buttons";
import { BrandMark } from "@/components/brand-mark";
import { ConfirmDeleteDialog, MoveNodeDialog } from "@/components/node-dialogs";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  GripIcon,
  MoveIcon,
  PlusIcon,
  ReopenIcon,
  SearchIcon,
  TrashIcon,
  WarningIcon,
} from "@/components/icons";
import { NodeTreeList } from "@/components/node-tree-list";
import { TimeEntryLedger } from "@/components/time-entry-ledger";
import {
  filterCompletedTree,
  formatBreadcrumb,
  getNodeDropDestination,
  searchNodes,
  type NodeDropDestination,
  type NodeDropZone,
} from "@/lib/nodes/presentation";
import type { DashboardNode, FlatNode } from "@/lib/nodes/tree";
import type { TimeEntryPage } from "@/lib/time-entries/contracts";
import { formatHistoricalDuration } from "@/lib/time-entries/duration";
import { formatRate, formatUsd, parseRateCents } from "@/lib/time-entries/money";

type DashboardShellProps = {
  email: string;
  initialEntryPage: TimeEntryPage;
  nodes: FlatNode[];
  orderedNodes: DashboardNode[];
  selectedNodeId?: string;
};

function rateInputValue(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function nodeRollup(node: DashboardNode, includeCompleted: boolean) {
  return includeCompleted
    ? {
        durationSeconds: node.rolledUpDurationSecondsIncludingCompleted,
        valueCents: node.rolledUpValueCentsIncludingCompleted,
        hasUnpricedTime: node.hasUnpricedTimeIncludingCompleted,
        hasPricedTime: node.hasPricedTimeIncludingCompleted,
      }
    : {
        durationSeconds: node.rolledUpDurationSeconds,
        valueCents: node.rolledUpValueCents,
        hasUnpricedTime: node.hasUnpricedTime,
        hasPricedTime: node.hasPricedTime,
      };
}

function nodeMetricsLabel(
  node: DashboardNode,
  includeDirect: boolean,
  includeCompleted: boolean,
) {
  const rollup = nodeRollup(node, includeCompleted);
  const hasMixedRates = rollup.hasPricedTime && rollup.hasUnpricedTime;
  return [
    `${formatHistoricalDuration(rollup.durationSeconds)} rolled up`,
    includeDirect ? `${formatHistoricalDuration(node.directDurationSeconds)} direct` : null,
    `${formatUsd(rollup.valueCents)} historical value`,
    hasMixedRates
      ? "contains entries with hourly rates and entries without hourly rates"
      : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function NodeMetrics({
  node,
  compact = false,
  includeCompleted = false,
  id,
}: {
  node: DashboardNode;
  compact?: boolean;
  includeCompleted?: boolean;
  id?: string;
}) {
  const rollup = nodeRollup(node, includeCompleted);
  const hasMixedRates = rollup.hasPricedTime && rollup.hasUnpricedTime;
  return (
    <span
      id={id}
      className={[
        "node-metrics",
        compact ? "node-metrics--compact" : "",
        hasMixedRates ? "node-metrics--mixed-rates" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Time totals: ${nodeMetricsLabel(node, !compact, includeCompleted)}`}
    >
      <span className={compact ? "node-metrics__rolled" : undefined}>
        {compact && hasMixedRates ? (
          <span
            className="node-metrics__warning"
            data-tooltip="This rollup includes entries with hourly rates and entries without hourly rates."
            aria-hidden="true"
          >
            <WarningIcon />
          </span>
        ) : null}
        <span className="node-metrics__copy">
          <strong>{formatHistoricalDuration(rollup.durationSeconds)}</strong>
          <small>rolled up</small>
        </span>
      </span>
      {!compact ? (
        <span>
          <strong>{formatHistoricalDuration(node.directDurationSeconds)}</strong>
          <small>direct</small>
        </span>
      ) : null}
      <span>
        <strong>{formatUsd(rollup.valueCents)}</strong>
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

function dropZoneForEvent(event: DragMoveEvent | DragEndEvent): NodeDropZone | null {
  const activeRect = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  if (!activeRect || !overRect || overRect.height === 0) {
    return null;
  }

  const activeCenter = activeRect.top + activeRect.height / 2;
  const relativePosition = (activeCenter - overRect.top) / overRect.height;
  if (relativePosition < 0.25) {
    return "before";
  }
  if (relativePosition > 0.65) {
    return "after";
  }
  return "inside";
}

function describeDrop(node: DashboardNode, zone: NodeDropZone) {
  if (zone === "inside") {
    return `Move inside ${node.title}`;
  }
  return `Move ${zone} ${node.title}`;
}

function TreeRowDragContainer({
  children,
  depthMarkerCount,
  disabled,
  dropIntent,
  expandPending,
  node,
  rowClassName,
  style,
}: {
  children: ReactNode;
  depthMarkerCount: number;
  disabled: boolean;
  dropIntent: NodeDropDestination | null;
  expandPending: boolean;
  node: DashboardNode;
  rowClassName: string;
  style: CSSProperties;
}) {
  const {
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef: setDraggableNodeRef,
  } = useDraggable({ id: node.id, disabled });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({ id: node.id, disabled });
  const setRowRef = useCallback(
    (element: HTMLDivElement | null) => {
      setDraggableNodeRef(element);
      setDroppableNodeRef(element);
    },
    [setDraggableNodeRef, setDroppableNodeRef],
  );
  const isDropTarget = dropIntent?.targetId === node.id;

  return (
    <div
      ref={setRowRef}
      className={[
        rowClassName,
        isDragging ? "node-row--dragging" : "",
        expandPending ? "node-row--drag-expand-pending" : "",
      ].filter(Boolean).join(" ")}
      data-drop-zone={isDropTarget ? dropIntent.zone : undefined}
      data-drop-label={isDropTarget ? describeDrop(node, dropIntent.zone) : undefined}
      style={style}
    >
      {depthMarkerCount > 0 ? (
        <span className="node-depth-markers" aria-hidden="true">
          {Array.from({ length: depthMarkerCount }, (_, index) => (
            <span key={index} />
          ))}
        </span>
      ) : null}
      <span
        ref={setActivatorNodeRef}
        className="node-drag-handle"
        data-tooltip={`Drag ${node.title}`}
        aria-hidden="true"
        {...listeners}
      >
        <GripIcon />
      </span>
      {children}
    </div>
  );
}

type NodeTreeProps = {
  allNodes: DashboardNode[];
  roots: DashboardNode[];
  showCompleted: boolean;
  selectedNodeId?: string;
  expanded: Set<string>;
  creatingChildFor: string | null;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onCreated: (nodeId: string, parentId: string | null) => void;
  onCancelCreate: () => void;
  onDragStarted: () => void;
  onDrop: (sourceId: string, destination: NodeDropDestination) => void;
  onExpandForDrag: (nodeId: string) => void;
  registerNodeButton: (nodeId: string, element: HTMLButtonElement | null) => void;
  dragPending: boolean;
};

function NodeTree({
  allNodes,
  roots,
  showCompleted,
  selectedNodeId,
  expanded,
  creatingChildFor,
  onSelect,
  onToggle,
  onAddChild,
  onCreated,
  onCancelCreate,
  onDragStarted,
  onDrop,
  onExpandForDrag,
  registerNodeButton,
  dragPending,
}: NodeTreeProps) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<NodeDropDestination | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const nodeById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);
  const activeNode = activeNodeId ? nodeById.get(activeNodeId) : undefined;
  const expandCandidate = dropIntent ? nodeById.get(dropIntent.targetId) : undefined;
  const autoExpandCandidateId =
    dropIntent?.zone === "inside" &&
    expandCandidate &&
    expandCandidate.children.length > 0 &&
    !expanded.has(expandCandidate.id)
      ? expandCandidate.id
      : null;

  useEffect(() => {
    if (!autoExpandCandidateId) {
      return;
    }
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 500 : 1_200;
    const timer = window.setTimeout(() => onExpandForDrag(autoExpandCandidateId), delay);
    return () => window.clearTimeout(timer);
  }, [autoExpandCandidateId, onExpandForDrag]);

  function resolveDropIntent(event: DragMoveEvent | DragEndEvent) {
    const source = nodeById.get(String(event.active.id));
    const target = event.over ? nodeById.get(String(event.over.id)) : undefined;
    const zone = dropZoneForEvent(event);
    if (!source || !target || !zone) {
      return null;
    }
    return getNodeDropDestination(allNodes, source, target, zone);
  }

  function dragStarted(event: DragStartEvent) {
    setActiveNodeId(String(event.active.id));
    setDropIntent(null);
    onDragStarted();
  }

  function dragMoved(event: DragMoveEvent) {
    setDropIntent(resolveDropIntent(event));
  }

  function dragEnded(event: DragEndEvent) {
    const destination = resolveDropIntent(event);
    const sourceId = String(event.active.id);
    setActiveNodeId(null);
    setDropIntent(null);
    if (destination) {
      onDrop(sourceId, destination);
    }
  }

  function dragCancelled() {
    setActiveNodeId(null);
    setDropIntent(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={dragStarted}
      onDragMove={dragMoved}
      onDragEnd={dragEnded}
      onDragCancel={dragCancelled}
    >
      <NodeTreeList
        roots={roots}
        expanded={expanded}
        renderNode={(node, depth) => {
          const visualDepth = Math.min(depth, 12);
          const hasChildren = node.children.length > 0;
          const isExpanded = expanded.has(node.id);
          const hiddenCompletedCount = showCompleted ? 0 : node.completedDescendantCount;
          const metricsId = `node-metrics-${node.id}`;
          const completedCountId = `node-completed-count-${node.id}`;

          return (
            <>
              <TreeRowDragContainer
                node={node}
                depthMarkerCount={visualDepth}
                disabled={dragPending}
                dropIntent={dropIntent}
                expandPending={autoExpandCandidateId === node.id}
                rowClassName={[
                  "node-row",
                  node.id === selectedNodeId ? "node-row--selected" : "",
                  node.completedAt !== null ? "node-row--completed" : "",
                ].filter(Boolean).join(" ")}
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
                  {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </button>
              ) : (
                <span className="tree-toggle tree-toggle--empty" aria-hidden="true" />
              )}
              <button
                ref={(element) => registerNodeButton(node.id, element)}
                className="node-select"
                type="button"
                aria-label={node.completedAt === null ? node.title : `${node.title}, completed`}
                aria-describedby={
                  hiddenCompletedCount > 0 ? `${metricsId} ${completedCountId}` : metricsId
                }
                aria-current={node.id === selectedNodeId ? "page" : undefined}
                onClick={() => onSelect(node.id)}
              >
                <span>
                  {node.title}
                  {node.completedAt !== null ? <small>Completed</small> : null}
                  {hiddenCompletedCount > 0 ? (
                    <small id={completedCountId} className="node-completed-count">
                      {hiddenCompletedCount} child {hiddenCompletedCount === 1 ? "node" : "nodes"} completed
                    </small>
                  ) : null}
                </span>
                <NodeMetrics
                  id={metricsId}
                  node={node}
                  compact
                  includeCompleted={showCompleted}
                />
              </button>
              {node.completedAt === null ? (
                <button
                  className="add-child-button icon-button"
                  type="button"
                  aria-label={`Add child to ${node.title}`}
                  data-tooltip={`Add child to ${node.title}`}
                  onClick={() => onAddChild(node.id)}
                >
                  <PlusIcon />
                </button>
              ) : (
                <span className="add-child-button" aria-hidden="true" />
              )}
              </TreeRowDragContainer>
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
      <DragOverlay zIndex={50} dropAnimation={{ duration: 180, easing: "ease-out" }}>
        {activeNode ? (
          <div className="node-drag-overlay">
            <GripIcon />
            <strong>{activeNode.title}</strong>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function DashboardShell({
  email,
  initialEntryPage,
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
  const [searchText, setSearchText] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [dragPending, setDragPending] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const detailFocusRef = useRef<HTMLDivElement>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<"detail" | "tree" | null>(null);
  const pendingScrollNodeId = useRef<string | null>(null);
  const focusTreeAfterDelete = useRef(false);
  const treeFocusNodeId = useRef<string | null>(null);
  const treeHeadingRef = useRef<HTMLHeadingElement>(null);
  const moveTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const rootNodes = useMemo(
    () => orderedNodes.filter((node) => node.parentId === null),
    [orderedNodes],
  );
  const visibleRoots = useMemo(
    () => filterCompletedTree(rootNodes, showCompleted),
    [rootNodes, showCompleted],
  );
  const searchResults = useMemo(
    () => searchNodes(orderedNodes, searchText),
    [orderedNodes, searchText],
  );
  const expandForDrag = useCallback((nodeId: string) => {
    setExpanded((current) => {
      if (current.has(nodeId)) {
        return current;
      }
      return new Set(current).add(nodeId);
    });
  }, []);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) {
      pendingFocus.current = null;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (pendingFocus.current === "detail" && selectedNode) {
        detailFocusRef.current?.focus();
      } else if (pendingFocus.current === "tree" && !selectedNode && treeFocusNodeId.current) {
        const treeButton = nodeButtonRefs.current.get(treeFocusNodeId.current);
        if (treeButton) {
          treeButton.focus();
        } else {
          treeHeadingRef.current?.focus();
        }
      }
      pendingFocus.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedNode]);

  useEffect(() => {
    if (!focusTreeAfterDelete.current || selectedNode) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      treeHeadingRef.current?.focus();
      focusTreeAfterDelete.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedNode]);

  useEffect(() => {
    const nodeId = pendingScrollNodeId.current;
    if (!nodeId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      nodeButtonRefs.current.get(nodeId)?.scrollIntoView({ block: "center" });
      pendingScrollNodeId.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, searchText, showCompleted]);

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

  function chooseSearchResult(node: DashboardNode) {
    if (node.completedAt !== null) {
      setShowCompleted(true);
    }
    setSearchText("");
    pendingScrollNodeId.current = node.id;
    navigateToNode(node.id);
  }

  async function changeCompletion() {
    if (!selectedNode || lifecyclePending) {
      return;
    }
    setLifecyclePending(true);
    setLifecycleError(null);
    try {
      const result =
        selectedNode.completedAt === null
          ? await completeNode({ id: selectedNode.id })
          : await reopenNode({ id: selectedNode.id });
      if (!result.ok) {
        const blockers = (result.blockingNodeIds ?? [])
          .map((nodeId) => nodeById.get(nodeId))
          .filter((node): node is DashboardNode => Boolean(node))
          .map(formatBreadcrumb)
          .sort((left, right) => left.localeCompare(right));
        setLifecycleError(
          blockers.length > 0
            ? `${result.message} Running: ${blockers.join("; ")}.`
            : result.message,
        );
        return;
      }
      if (selectedNode.completedAt === null) {
        setShowCompleted(true);
      }
      router.refresh();
    } finally {
      setLifecyclePending(false);
    }
  }

  function expandMoveDestination(parentId: string | null) {
    if (parentId !== null) {
      const parent = nodeById.get(parentId);
      setExpanded((current) => {
        const next = new Set(current).add(parentId);
        for (const ancestor of parent?.breadcrumb ?? []) {
          next.add(ancestor.id);
        }
        return next;
      });
    }
  }

  function moved(parentId: string | null) {
    setMoveDialogOpen(false);
    expandMoveDestination(parentId);
    router.refresh();
  }

  async function dropped(sourceId: string, destination: NodeDropDestination) {
    if (dragPending) {
      return;
    }
    setDragPending(true);
    setDragError(null);
    try {
      const result = await moveNode({
        id: sourceId,
        parentId: destination.parentId,
        position: destination.position,
      });
      if (!result.ok) {
        setDragError(result.message);
        return;
      }
      expandMoveDestination(destination.parentId);
      router.refresh();
    } finally {
      setDragPending(false);
    }
  }

  function deleted() {
    setDeleteDialogOpen(false);
    setLifecycleError(null);
    focusTreeAfterDelete.current = true;
    navigateToNode();
    router.refresh();
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
        <div className="toolbar-count">
          <p className="eyebrow">{nodes.length === 1 ? "1 node" : `${nodes.length} nodes`}</p>
        </div>
        <div className="tree-search">
          <SearchIcon className="search-icon" />
          <label>
            <span className="sr-only">Search node titles</span>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search nodes"
              aria-controls={searchText.trim() ? "tree-search-results" : undefined}
            />
          </label>
          {searchText.trim() ? (
            <div id="tree-search-results" className="search-results" aria-label="Search results">
              {searchResults.map((node) => (
                <button type="button" key={node.id} onClick={() => chooseSearchResult(node)}>
                  <strong>{node.title}</strong>
                  <span>
                    {formatBreadcrumb(node)}
                    {node.completedAt !== null ? " · Completed" : ""}
                  </span>
                </button>
              ))}
              {searchResults.length === 0 ? <p>No matching nodes.</p> : null}
            </div>
          ) : null}
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Show completed"
            aria-pressed={showCompleted}
            data-tooltip={showCompleted ? "Hide completed" : "Show completed"}
            onClick={() => setShowCompleted((current) => !current)}
          >
            {showCompleted ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            className="icon-button icon-button--primary"
            type="button"
            aria-label="New root node"
            data-tooltip="New root node"
            onClick={() => setCreatingRoot(true)}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      {creatingRoot ? (
        <div className="root-create-wrap">
          <NodeCreateForm parentId={null} onCreated={created} onCancel={() => setCreatingRoot(false)} />
        </div>
      ) : null}

      <div className="dashboard-main">
        <section className="tree-pane" aria-labelledby="tree-heading">
          <div className="pane-heading">
            <h1 ref={treeHeadingRef} id="tree-heading" tabIndex={-1}>Node tree</h1>
            <p>Organize work at any depth.</p>
          </div>

          {dragPending ? <p className="tree-move-status" role="status">Moving node…</p> : null}
          {dragError ? <p className="tree-move-error" role="alert">{dragError}</p> : null}

          {orderedNodes.length === 0 ? (
            <div className="tree-empty">
              <p>No nodes yet.</p>
              <button className="text-action" type="button" onClick={() => setCreatingRoot(true)}>
                Create your first root node
              </button>
            </div>
          ) : visibleRoots.length === 0 ? (
            <div className="tree-empty">
              <p>No active nodes.</p>
              <button className="text-action" type="button" onClick={() => setShowCompleted(true)}>
                Show completed nodes
              </button>
            </div>
          ) : (
            <div className="node-tree" aria-label="Work nodes">
              <NodeTree
                allNodes={orderedNodes}
                roots={visibleRoots}
                showCompleted={showCompleted}
                selectedNodeId={selectedNode?.id}
                expanded={expanded}
                creatingChildFor={creatingTreeChildFor}
                onSelect={navigateToNode}
                onToggle={toggleExpanded}
                onAddChild={setCreatingTreeChildFor}
                onCreated={created}
                onCancelCreate={() => setCreatingTreeChildFor(null)}
                onDragStarted={() => setDragError(null)}
                onDrop={(sourceId, destination) => void dropped(sourceId, destination)}
                onExpandForDrag={expandForDrag}
                registerNodeButton={registerNodeButton}
                dragPending={dragPending}
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
              <div className="node-status-line">
                <span className={selectedNode.completedAt === null ? "status-pill" : "status-pill status-pill--completed"}>
                  {selectedNode.completedAt === null ? "Active" : "Completed"}
                </span>
              </div>
              <NodeMetrics node={selectedNode} includeCompleted={showCompleted} />
              <div className="detail-fields">
                <DescriptionEditor node={selectedNode} onSaved={mutationSaved} />
                <RateEditor node={selectedNode} onSaved={mutationSaved} />
              </div>
              <TimeEntryLedger
                initialPage={initialEntryPage}
                node={selectedNode}
                nodes={orderedNodes}
                onMutation={mutationSaved}
              />
              {selectedNode.completedAt === null ? (
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
                    className="icon-button"
                    type="button"
                    aria-label="Add child node"
                    data-tooltip="Add child node"
                    onClick={() => setCreatingDetailChild(true)}
                  >
                    <PlusIcon />
                  </button>
                  )}
                </div>
              ) : null}
              <div className="node-actions" aria-label="Node actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={
                    lifecyclePending
                      ? "Saving node status"
                      : selectedNode.completedAt === null
                        ? "Complete node"
                        : "Reopen node"
                  }
                  data-tooltip={selectedNode.completedAt === null ? "Complete node" : "Reopen node"}
                  disabled={lifecyclePending}
                  onClick={() => void changeCompletion()}
                >
                  {selectedNode.completedAt === null ? <CheckIcon /> : <ReopenIcon />}
                </button>
                <button
                  ref={moveTriggerRef}
                  className="icon-button"
                  type="button"
                  aria-label="Move To…"
                  data-tooltip="Move To…"
                  onClick={() => setMoveDialogOpen(true)}
                >
                  <MoveIcon />
                </button>
                <button
                  ref={deleteTriggerRef}
                  className="icon-button icon-button--danger"
                  type="button"
                  aria-label="Delete node"
                  data-tooltip="Delete node"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <TrashIcon />
                </button>
              </div>
              {lifecycleError ? <p className="detail-error" role="alert">{lifecycleError}</p> : null}
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
      {selectedNode && moveDialogOpen ? (
        <MoveNodeDialog
          node={selectedNode}
          nodes={orderedNodes}
          onClose={() => setMoveDialogOpen(false)}
          onMoved={moved}
          returnFocusRef={moveTriggerRef}
        />
      ) : null}
      {selectedNode && deleteDialogOpen ? (
        <ConfirmDeleteDialog
          node={selectedNode}
          onClose={() => setDeleteDialogOpen(false)}
          onDeleted={deleted}
          returnFocusRef={deleteTriggerRef}
        />
      ) : null}
    </main>
  );
}
