"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { deleteNode, moveNode } from "@/app/actions/nodes";
import {
  ArrowUpIcon,
  ChevronRightIcon,
  CloseIcon,
  MoveIcon,
} from "@/components/icons";
import {
  formatBreadcrumb,
  getMoveDestinations,
} from "@/lib/nodes/presentation";
import type { DashboardNode } from "@/lib/nodes/tree";

type DialogFrameProps = {
  children: ReactNode;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  labelledBy: string;
  onClose: () => void;
  preventClose?: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
};

export function DialogFrame({
  children,
  className,
  initialFocusRef,
  labelledBy,
  onClose,
  preventClose = false,
  returnFocusRef,
}: DialogFrameProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = returnFocusRef.current;
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = null;
    }
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    initialFocusRef?.current?.focus();
    return () => {
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => returnFocus?.focus());
    };
  }, [initialFocusRef, returnFocusRef]);

  function closed() {
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={["node-dialog", className].filter(Boolean).join(" ")}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        if (preventClose) {
          event.preventDefault();
        }
      }}
      onClose={closed}
    >
      {children}
    </dialog>
  );
}

export function MoveNodeDialog({
  node,
  nodes,
  onClose,
  onMoved,
  returnFocusRef,
}: {
  node: DashboardNode;
  nodes: readonly DashboardNode[];
  onClose: () => void;
  onMoved: (parentId: string | null) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [pendingParentId, setPendingParentId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [browseParentId, setBrowseParentId] = useState<string | null>(node.parentId);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const moveHereButtonRef = useRef<HTMLButtonElement>(null);
  const focusBrowseToolbarAfterNavigation = useRef(false);
  const destinations = getMoveDestinations(nodes, node, "");
  const destinationById = new Map(destinations.map((destination) => [destination.id, destination]));
  const eligibleChildCounts = new Map<string, number>();
  for (const destination of destinations) {
    if (destination.parentId !== null) {
      eligibleChildCounts.set(
        destination.parentId,
        (eligibleChildCounts.get(destination.parentId) ?? 0) + 1,
      );
    }
  }
  const browseParent = browseParentId === null ? null : destinationById.get(browseParentId) ?? null;
  const browseNodes = destinations.filter((destination) => destination.parentId === browseParentId);
  const searchResults = query.trim() ? getMoveDestinations(nodes, node, query) : [];

  useEffect(() => {
    if (!focusBrowseToolbarAfterNavigation.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      moveHereButtonRef.current?.focus();
      focusBrowseToolbarAfterNavigation.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [browseParentId]);

  async function move(parentId: string | null) {
    setPendingParentId(parentId);
    setError(null);
    try {
      const result = await moveNode({ id: node.id, parentId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onMoved(parentId);
    } finally {
      setPendingParentId(undefined);
    }
  }

  return (
    <DialogFrame
      labelledBy="move-node-title"
      initialFocusRef={searchInputRef}
      onClose={onClose}
      preventClose={pendingParentId !== undefined}
      returnFocusRef={returnFocusRef}
    >
      <>
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Move node</p>
          <h2 id="move-node-title">Choose a new parent for {node.title}</h2>
        </div>
        <button
          className="dialog-close icon-button"
          type="button"
          aria-label="Close move dialog"
          data-tooltip="Close"
          disabled={pendingParentId !== undefined}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <label className="dialog-search">
        <span className="field-label">Search destinations</span>
        <input
          ref={searchInputRef}
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search node titles"
        />
      </label>
      {query.trim() ? (
        <div className="dialog-results" aria-label="Search move destinations">
          <button
            className="dialog-result"
            type="button"
            disabled={pendingParentId !== undefined}
            onClick={() => void move(null)}
          >
            <strong>Root</strong>
            <span>Place after the existing root nodes</span>
          </button>
          {searchResults.map((destination) => (
            <button
              className="dialog-result"
              type="button"
              key={destination.id}
              disabled={pendingParentId !== undefined}
              onClick={() => void move(destination.id)}
            >
              <strong>{destination.title}</strong>
              <span>
                {formatBreadcrumb(destination)}
                {destination.completedAt !== null ? " · Completed" : ""}
              </span>
            </button>
          ))}
          {searchResults.length === 0 ? (
            <p className="dialog-empty">No matching node destinations.</p>
          ) : null}
        </div>
      ) : (
        <div className="move-browser">
          <div className="move-browser__toolbar">
            <button
              className="icon-button"
              type="button"
              aria-label="Up one level"
              data-tooltip="Up one level"
              disabled={browseParentId === null || pendingParentId !== undefined}
              onClick={() => {
                focusBrowseToolbarAfterNavigation.current = true;
                setBrowseParentId(browseParent?.parentId ?? null);
              }}
            >
              <ArrowUpIcon />
            </button>
            <div aria-live="polite" aria-atomic="true">
              <small>Browsing</small>
              <strong>{browseParent ? formatBreadcrumb(browseParent) : "Root"}</strong>
            </div>
            <button
              ref={moveHereButtonRef}
              className="move-here-button"
              type="button"
              disabled={pendingParentId !== undefined}
              onClick={() => void move(browseParentId)}
            >
              <MoveIcon />
              <span>Move here</span>
            </button>
          </div>
          <div className="move-browser__nodes" aria-label="Nodes at this level">
            {browseNodes.map((destination) => (
              <button
                type="button"
                key={destination.id}
                disabled={pendingParentId !== undefined}
                onClick={() => {
                  focusBrowseToolbarAfterNavigation.current = true;
                  setBrowseParentId(destination.id);
                }}
              >
                <span>
                  <strong>{destination.title}</strong>
                  <small>
                    {(eligibleChildCounts.get(destination.id) ?? 0) === 1
                      ? "1 child"
                      : `${eligibleChildCounts.get(destination.id) ?? 0} children`}
                    {destination.completedAt !== null ? " · Completed" : ""}
                  </small>
                </span>
                <ChevronRightIcon />
              </button>
            ))}
            {browseNodes.length === 0 ? (
              <p className="dialog-empty">No other nodes at this level.</p>
            ) : null}
          </div>
        </div>
      )}
      {pendingParentId !== undefined ? <p className="dialog-status">Moving…</p> : null}
      {error ? <p role="alert" className="dialog-error">{error}</p> : null}
      </>
    </DialogFrame>
  );
}

export function ConfirmDeleteDialog({
  node,
  onClose,
  onDeleted,
  returnFocusRef,
}: {
  node: DashboardNode;
  onClose: () => void;
  onDeleted: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await deleteNode({ id: node.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDeleted();
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogFrame
      labelledBy="delete-node-title"
      initialFocusRef={cancelRef}
      onClose={onClose}
      preventClose={pending}
      returnFocusRef={returnFocusRef}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Delete subtree</p>
            <h2 id="delete-node-title">Permanently delete {node.title}?</h2>
          </div>
          <button
            className="dialog-close icon-button"
            type="button"
            aria-label="Close delete dialog"
            data-tooltip="Close"
            disabled={pending}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <p className="dialog-copy">
          This removes the node and every descendant. Deletion is blocked only when this subtree
          contains a time entry or a running timer.
        </p>
        <div className="dialog-actions">
          <button className="button button--danger" type="submit" disabled={pending}>
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
          <button
            ref={cancelRef}
            className="button button--quiet"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
        {error ? <p role="alert" className="dialog-error">{error}</p> : null}
      </form>
    </DialogFrame>
  );
}
