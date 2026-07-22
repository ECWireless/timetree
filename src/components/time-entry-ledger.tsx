"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import {
  createTimeEntry,
  deleteTimeEntry,
  loadTimeEntriesPage,
  updateTimeEntry,
} from "@/app/actions/time-entries";
import { EditIcon, TrashIcon } from "@/components/icons";
import type { DashboardNode } from "@/lib/nodes/tree";
import type {
  TimeEntryActionResult,
  TimeEntryPage,
  TimeEntryRecord,
} from "@/lib/time-entries/contracts";
import {
  formatUtcOffset,
  getLocalDateTimeCandidates,
  resolveRangeInput,
  toLocalDateTimeInput,
} from "@/lib/time-entries/dates";
import { formatHistoricalDuration } from "@/lib/time-entries/duration";
import {
  calculateRoundedValueCents,
  formatRate,
  formatUsd,
  parseRateCents,
} from "@/lib/time-entries/money";

type RateMode = "default" | "override" | "unpriced";

const workDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatWorkDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return workDateFormatter.format(new Date(year, month - 1, day));
}

function formatRange(entry: TimeEntryRecord) {
  if (!entry.startedAt || !entry.endedAt) {
    return null;
  }
  return `${timeFormatter.format(new Date(entry.startedAt))} – ${timeFormatter.format(new Date(entry.endedAt))}`;
}

function rateInputValue(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function durationInputValue(seconds: number) {
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${(seconds / 3_600).toFixed(6).replace(/0+$/, "")}h`;
}

function entryValue(entry: TimeEntryRecord) {
  return entry.hourlyRateCents === null
    ? "Unpriced"
    : formatUsd(calculateRoundedValueCents(entry.durationSeconds, entry.hourlyRateCents));
}

function nodeLabel(node: DashboardNode) {
  return node.breadcrumb.map(({ title }) => title).join(" / ");
}

function TimeEntryForm({
  entry,
  node,
  nodes,
  onCancel,
  onSaved,
}: {
  entry?: TimeEntryRecord;
  node: DashboardNode;
  nodes: readonly DashboardNode[];
  onCancel: () => void;
  onSaved: (entry: TimeEntryRecord) => void;
}) {
  const initialMode = entry?.startedAt ? "range" : "duration";
  const [initialRange] = useState(() => {
    const now = new Date();
    return {
      startedAt: entry?.startedAt
        ? toLocalDateTimeInput(new Date(entry.startedAt), true)
        : toLocalDateTimeInput(now),
      endedAt: entry?.endedAt
        ? toLocalDateTimeInput(new Date(entry.endedAt), true)
        : toLocalDateTimeInput(new Date(now.getTime() + 3_600_000)),
    };
  });
  const formRef = useRef<HTMLFormElement>(null);
  const formKey = entry?.id ?? `new-${node.id}`;
  const [mode, setMode] = useState<"duration" | "range">(initialMode);
  const [nodeId, setNodeId] = useState(entry?.nodeId ?? node.id);
  const [workDate, setWorkDate] = useState(
    entry?.workDate ?? initialRange.startedAt.slice(0, 10),
  );
  const [duration, setDuration] = useState(
    entry ? durationInputValue(entry.durationSeconds) : "",
  );
  const [startedAt, setStartedAt] = useState(initialRange.startedAt);
  const [endedAt, setEndedAt] = useState(initialRange.endedAt);
  const [startOffsetMinutes, setStartOffsetMinutes] = useState<number | null>(() => {
    const candidates = getLocalDateTimeCandidates(initialRange.startedAt);
    return candidates.length === 1 ? candidates[0].offsetMinutes : null;
  });
  const [endOffsetMinutes, setEndOffsetMinutes] = useState<number | null>(() => {
    const candidates = getLocalDateTimeCandidates(initialRange.endedAt);
    return candidates.length === 1 ? candidates[0].offsetMinutes : null;
  });
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [rateMode, setRateMode] = useState<RateMode>("default");
  const [rate, setRate] = useState(rateInputValue(entry?.hourlyRateCents ?? node.resolvedHourlyRateCents));
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TimeEntryActionResult | null>(null);
  const selectedNode = nodes.find((candidate) => candidate.id === nodeId) ?? node;
  const defaultRate = entry ? entry.hourlyRateCents : selectedNode.resolvedHourlyRateCents;
  const heading = entry ? "Edit time entry" : "Add time";
  const startCandidates = getLocalDateTimeCandidates(startedAt);
  const endCandidates = getLocalDateTimeCandidates(endedAt);
  const errors = result && !result.ok ? result.fieldErrors ?? {} : {};
  const alertMessage = Object.values(errors).flat()[0] ?? (result && !result.ok ? result.message : null);
  const startOccurrenceError = Boolean(errors.startedAt?.[0]?.match(/occurrence|UTC offset/));
  const endOccurrenceError = Boolean(errors.endedAt?.[0]?.match(/occurrence|UTC offset/));

  function errorId(field: string) {
    return `${formKey}-${field}-error`;
  }

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);

  useEffect(() => {
    if (result && !result.ok) {
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
    }
  }, [result]);

  function explicitRate() {
    if (rateMode === "default") {
      return { valid: true as const, supplied: false as const };
    }
    if (rateMode === "unpriced") {
      return { valid: true as const, supplied: true as const, value: null };
    }
    const cents = parseRateCents(rate);
    return cents === null
      ? { valid: false as const }
      : { valid: true as const, supplied: true as const, value: cents };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const rateChoice = explicitRate();
    if (!rateChoice.valid) {
      setResult({
        ok: false,
        message: "Check the highlighted fields.",
        fieldErrors: {
          hourlyRateCents: [
            "Enter a non-negative dollar amount with no more than two decimal places.",
          ],
        },
      });
      return;
    }

    setPending(true);
    try {
      const rateOverride = rateChoice.supplied
        ? { hourlyRateCents: rateChoice.value }
        : {};
      let actionResult: TimeEntryActionResult;
      if (mode === "duration") {
        const input = { nodeId, mode, workDate, duration, notes, ...rateOverride } as const;
        actionResult = entry
          ? await updateTimeEntry({ id: entry.id, ...input })
          : await createTimeEntry(input);
      } else {
        const range = resolveRangeInput({
          startedAtInput: startedAt,
          endedAtInput: endedAt,
          startOffsetMinutes,
          endOffsetMinutes,
          ...(entry?.startedAt && entry.endedAt
            ? {
                initialStartedAtInput: initialRange.startedAt,
                initialEndedAtInput: initialRange.endedAt,
                storedStartedAt: entry.startedAt,
                storedEndedAt: entry.endedAt,
                storedWorkDate: entry.workDate,
              }
            : {}),
        });
        if (!range.ok) {
          setResult({
            ok: false,
            message: "Check the highlighted fields.",
            fieldErrors: range.fieldErrors,
          });
          return;
        }
        actionResult = entry
          ? await updateTimeEntry({
              id: entry.id,
              nodeId,
              mode,
              start: range.preserveStart
                ? { kind: "preserve" }
                : { kind: "replace", value: range.startedAt, workDate: range.workDate },
              end: range.preserveEnd
                ? { kind: "preserve" }
                : { kind: "replace", value: range.endedAt },
              notes,
              ...rateOverride,
            })
          : await createTimeEntry({
              nodeId,
              mode,
              workDate: range.workDate,
              startedAt: range.startedAt,
              endedAt: range.endedAt,
              notes,
              ...rateOverride,
            });
      }

      setResult(actionResult);
      if (actionResult.ok) {
        onSaved(actionResult.entry);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="time-entry-form" onSubmit={submit} aria-busy={pending}>
      <div className="time-entry-form__heading">
        <h3>{heading}</h3>
        <button className="text-action" type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
      <fieldset className="segmented-control">
        <legend>Entry type</legend>
        <label>
          <input
            type="radio"
            name={`entry-mode-${entry?.id ?? "new"}`}
            checked={mode === "duration"}
            disabled={pending}
            onChange={() => setMode("duration")}
          />
          Duration
        </label>
        <label>
          <input
            type="radio"
            name={`entry-mode-${entry?.id ?? "new"}`}
            checked={mode === "range"}
            disabled={pending}
            onChange={() => setMode("range")}
          />
          Exact range
        </label>
      </fieldset>
      {entry ? (
        <label>
          <span className="field-label">Assigned node</span>
          <select
            value={nodeId}
            disabled={pending}
            aria-invalid={Boolean(errors.nodeId)}
            aria-describedby={errors.nodeId ? errorId("nodeId") : undefined}
            onChange={(event) => setNodeId(event.target.value)}
          >
            {nodes.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {nodeLabel(candidate)}{candidate.completedAt ? " · Completed" : ""}
              </option>
            ))}
          </select>
          {errors.nodeId ? <span id={errorId("nodeId")} className="field-error">{errors.nodeId[0]}</span> : null}
        </label>
      ) : null}
      {mode === "duration" ? (
        <div className="time-entry-form__grid">
          <label>
            <span className="field-label">Work date</span>
            <input
              type="date"
              value={workDate}
              disabled={pending}
              aria-invalid={Boolean(errors.workDate)}
              aria-describedby={errors.workDate ? errorId("workDate") : undefined}
              onChange={(event) => setWorkDate(event.target.value)}
            />
            {errors.workDate ? (
              <span id={errorId("workDate")} className="field-error">{errors.workDate[0]}</span>
            ) : null}
          </label>
          <label>
            <span className="field-label">Duration</span>
            <input
              value={duration}
              maxLength={64}
              disabled={pending}
              aria-invalid={Boolean(errors.duration)}
              aria-describedby={errors.duration ? errorId("duration") : undefined}
              onChange={(event) => setDuration(event.target.value)}
              placeholder="1h 30m"
              inputMode="text"
            />
            <span className="field-hint">Examples: 1h 30m, 90m, 1.5h</span>
            {errors.duration ? (
              <span id={errorId("duration")} className="field-error">{errors.duration[0]}</span>
            ) : null}
          </label>
        </div>
      ) : (
        <div className="time-entry-form__grid">
          <div>
            <label className="field-label" htmlFor={`${formKey}-startedAt`}>Start</label>
            <input
              id={`${formKey}-startedAt`}
              type="datetime-local"
              step="1"
              value={startedAt}
              disabled={pending}
              aria-invalid={Boolean(errors.startedAt) && !startOccurrenceError}
              aria-describedby={errors.startedAt && !startOccurrenceError ? errorId("startedAt") : undefined}
              onChange={(event) => {
                const value = event.target.value;
                const candidates = getLocalDateTimeCandidates(value);
                setStartedAt(value);
                setStartOffsetMinutes(candidates.length === 1 ? candidates[0].offsetMinutes : null);
              }}
            />
            {startCandidates.length > 1 &&
            (!entry?.startedAt || startedAt !== initialRange.startedAt) ? (
              <div className="occurrence-field">
                <label className="field-label" htmlFor={`${formKey}-startOccurrence`}>
                  Start occurrence
                </label>
                <select
                  id={`${formKey}-startOccurrence`}
                  value={startOffsetMinutes ?? ""}
                  disabled={pending}
                  aria-invalid={startOccurrenceError}
                  aria-describedby={startOccurrenceError ? errorId("startedAt") : undefined}
                  onChange={(event) =>
                    setStartOffsetMinutes(
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                >
                  <option value="">Choose occurrence</option>
                  {startCandidates.map((candidate, index) => (
                    <option key={candidate.iso} value={candidate.offsetMinutes}>
                      {index === 0 ? "First" : "Second"} occurrence · {formatUtcOffset(candidate.offsetMinutes)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {errors.startedAt ? (
              <span id={errorId("startedAt")} className="field-error">{errors.startedAt[0]}</span>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor={`${formKey}-endedAt`}>End</label>
            <input
              id={`${formKey}-endedAt`}
              type="datetime-local"
              step="1"
              value={endedAt}
              disabled={pending}
              aria-invalid={Boolean(errors.endedAt) && !endOccurrenceError}
              aria-describedby={errors.endedAt && !endOccurrenceError ? errorId("endedAt") : undefined}
              onChange={(event) => {
                const value = event.target.value;
                const candidates = getLocalDateTimeCandidates(value);
                setEndedAt(value);
                setEndOffsetMinutes(candidates.length === 1 ? candidates[0].offsetMinutes : null);
              }}
            />
            {endCandidates.length > 1 &&
            (!entry?.endedAt || endedAt !== initialRange.endedAt) ? (
              <div className="occurrence-field">
                <label className="field-label" htmlFor={`${formKey}-endOccurrence`}>
                  End occurrence
                </label>
                <select
                  id={`${formKey}-endOccurrence`}
                  value={endOffsetMinutes ?? ""}
                  disabled={pending}
                  aria-invalid={endOccurrenceError}
                  aria-describedby={endOccurrenceError ? errorId("endedAt") : undefined}
                  onChange={(event) =>
                    setEndOffsetMinutes(
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                >
                  <option value="">Choose occurrence</option>
                  {endCandidates.map((candidate, index) => (
                    <option key={candidate.iso} value={candidate.offsetMinutes}>
                      {index === 0 ? "First" : "Second"} occurrence · {formatUtcOffset(candidate.offsetMinutes)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {errors.endedAt ? (
              <span id={errorId("endedAt")} className="field-error">{errors.endedAt[0]}</span>
            ) : null}
          </div>
          <p className="field-hint time-entry-form__wide">
            This entry belongs to the local start date, including when it ends after midnight.
          </p>
        </div>
      )}
      <label>
        <span className="field-label">Notes <span className="optional">Optional</span></span>
        <textarea
          value={notes}
          maxLength={4_000}
          rows={3}
          disabled={pending}
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? errorId("notes") : undefined}
          onChange={(event) => setNotes(event.target.value)}
        />
        {errors.notes ? (
          <span id={errorId("notes")} className="field-error">{errors.notes[0]}</span>
        ) : null}
      </label>
      <fieldset className="entry-rate-options">
        <legend>Historical rate</legend>
        <label>
          <input
            type="radio"
            name={`entry-rate-${entry?.id ?? "new"}`}
            checked={rateMode === "default"}
            disabled={pending}
            onChange={() => setRateMode("default")}
          />
          {entry
            ? defaultRate === null
              ? "Keep: No hourly rate"
              : `Keep ${formatRate(defaultRate)}`
            : `Use resolved rate: ${defaultRate === null ? "No hourly rate" : formatRate(defaultRate)}`}
        </label>
        <label>
          <input
            type="radio"
            name={`entry-rate-${entry?.id ?? "new"}`}
            checked={rateMode === "override"}
            disabled={pending}
            onChange={() => setRateMode("override")}
          />
          Override rate
        </label>
        {rateMode === "override" ? (
          <label className="money-input entry-rate-input">
            <span aria-hidden="true">$</span>
            <span className="sr-only">Hourly rate in dollars</span>
            <input
              inputMode="decimal"
              maxLength={24}
              value={rate}
              disabled={pending}
              aria-invalid={Boolean(errors.hourlyRateCents)}
              aria-describedby={errors.hourlyRateCents ? errorId("hourlyRateCents") : undefined}
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          <input
            type="radio"
            name={`entry-rate-${entry?.id ?? "new"}`}
            checked={rateMode === "unpriced"}
            disabled={pending}
            onChange={() => setRateMode("unpriced")}
          />
          No hourly rate
        </label>
        {errors.hourlyRateCents ? (
          <span id={errorId("hourlyRateCents")} className="field-error">{errors.hourlyRateCents[0]}</span>
        ) : null}
      </fieldset>
      <div className="editor-actions">
        <button className="button button--primary button--small" type="submit" disabled={pending}>
          {pending ? "Saving…" : entry ? "Save entry" : "Add entry"}
        </button>
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
      {alertMessage ? <p className="detail-error" role="alert">{alertMessage}</p> : null}
    </form>
  );
}

function DeleteEntryDialog({
  entry,
  onClose,
  onDeleted,
  returnFocusRef,
}: {
  entry: TimeEntryRecord;
  onClose: () => void;
  onDeleted: (entryId: string) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = returnFocusRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      window.requestAnimationFrame(() => returnFocus?.focus());
    };
  }, [returnFocusRef]);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      const result = await deleteTimeEntry({ id: entry.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDeleted(result.entryId);
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="node-dialog"
      aria-labelledby={`delete-entry-${entry.id}`}
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Delete time entry</p>
          <h2 id={`delete-entry-${entry.id}`}>Permanently delete this entry?</h2>
        </div>
      </div>
      <p>This removes {formatHistoricalDuration(entry.durationSeconds)} from {formatWorkDate(entry.workDate)}. It cannot be recovered.</p>
      <div className="dialog-actions">
        <button ref={cancelRef} className="button button--quiet" type="button" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button className="button button--danger" type="button" onClick={() => void remove()} disabled={pending}>
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    </dialog>
  );
}

function EntryRow({
  entry,
  node,
  nodes,
  onChanged,
  onDeleted,
}: {
  entry: TimeEntryRecord;
  node: DashboardNode;
  nodes: readonly DashboardNode[];
  onChanged: (entry: TimeEntryRecord) => void;
  onDeleted: (entryId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const range = formatRange(entry);

  if (editing) {
    return (
      <li className="entry-row entry-row--editing">
        <TimeEntryForm
          entry={entry}
          node={node}
          nodes={nodes}
          onCancel={() => {
            setEditing(false);
            window.requestAnimationFrame(() => editButtonRef.current?.focus());
          }}
          onSaved={(updated) => {
            setEditing(false);
            onChanged(updated);
          }}
        />
      </li>
    );
  }

  return (
    <li className="entry-row">
      <div className="entry-row__summary">
        <div>
          <strong>{formatHistoricalDuration(entry.durationSeconds)}</strong>
          <span>{entryValue(entry)}</span>
        </div>
        <div className="entry-row__meta">
          <time dateTime={entry.workDate}>{formatWorkDate(entry.workDate)}</time>
          <div className="entry-row__actions" aria-label="Time entry actions">
            <button
              ref={editButtonRef}
              className="icon-button"
              type="button"
              aria-label={`Edit ${formatHistoricalDuration(entry.durationSeconds)} entry from ${formatWorkDate(entry.workDate)}`}
              data-tooltip="Edit entry"
              onClick={() => setEditing(true)}
            >
              <EditIcon />
            </button>
            <button
              ref={deleteButtonRef}
              className="icon-button icon-button--danger"
              type="button"
              aria-label={`Delete ${formatHistoricalDuration(entry.durationSeconds)} entry from ${formatWorkDate(entry.workDate)}`}
              data-tooltip="Delete entry"
              onClick={() => setDeleting(true)}
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      </div>
      {range ? <p className="entry-row__range" suppressHydrationWarning>{range}</p> : null}
      <p className={entry.notes ? "entry-row__notes" : "entry-row__notes empty-copy"}>
        {entry.notes ?? "No notes"}
      </p>
      <p className="entry-row__rate">
        {entry.hourlyRateCents === null
          ? "No hourly rate"
          : `Stored at ${formatRate(entry.hourlyRateCents)}`}
      </p>
      {deleting ? (
        <DeleteEntryDialog
          entry={entry}
          onClose={() => setDeleting(false)}
          onDeleted={(entryId) => {
            setDeleting(false);
            onDeleted(entryId);
          }}
          returnFocusRef={deleteButtonRef}
        />
      ) : null}
    </li>
  );
}

export function TimeEntryLedger({
  initialPage,
  node,
  nodes,
  onMutation,
}: {
  initialPage: TimeEntryPage;
  node: DashboardNode;
  nodes: readonly DashboardNode[];
  onMutation: () => void;
}) {
  const [entries, setEntries] = useState(initialPage.entries);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const loadButtonRef = useRef<HTMLButtonElement>(null);
  const loadedPageRef = useRef(0);

  async function loadOlder() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await loadTimeEntriesPage(node.id, nextCursor);
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setEntries((current) => [
        ...current,
        ...result.page.entries.filter(
          (candidate) => !current.some((entry) => entry.id === candidate.id),
        ),
      ]);
      setNextCursor(result.page.nextCursor);
      loadedPageRef.current += 1;
      setLoadStatus(
        result.page.entries.length === 1
          ? `Loaded 1 older entry, page ${loadedPageRef.current}.`
          : `Loaded ${result.page.entries.length} older entries, page ${loadedPageRef.current}.`,
      );
      if (!result.page.nextCursor) {
        window.requestAnimationFrame(() => headingRef.current?.focus());
      }
    } finally {
      setLoading(false);
    }
  }

  function changed(updated: TimeEntryRecord) {
    setEntries((current) =>
      updated.nodeId === node.id
        ? current.map((entry) => (entry.id === updated.id ? updated : entry))
        : current.filter((entry) => entry.id !== updated.id),
    );
    onMutation();
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  return (
    <section className="time-ledger" aria-labelledby={`time-ledger-${node.id}`}>
      <div className="time-ledger__heading">
        <div>
          <p className="eyebrow">Direct history</p>
          <h2 ref={headingRef} id={`time-ledger-${node.id}`} tabIndex={-1}>Time entries</h2>
        </div>
        {!adding ? (
          <button ref={addButtonRef} className="button button--primary button--small" type="button" onClick={() => setAdding(true)}>
            Add time
          </button>
        ) : null}
      </div>
      {adding ? (
        <TimeEntryForm
          node={node}
          nodes={nodes}
          onCancel={() => {
            setAdding(false);
            window.requestAnimationFrame(() => addButtonRef.current?.focus());
          }}
          onSaved={(created) => {
            setEntries((current) => [created, ...current]);
            setAdding(false);
            onMutation();
            window.requestAnimationFrame(() => headingRef.current?.focus());
          }}
        />
      ) : null}
      {entries.length > 0 ? (
        <ol className="entry-list">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              node={node}
              nodes={nodes}
              onChanged={changed}
              onDeleted={(entryId) => {
                setEntries((current) => current.filter((entry) => entry.id !== entryId));
                onMutation();
                window.requestAnimationFrame(() => headingRef.current?.focus());
              }}
            />
          ))}
        </ol>
      ) : (
        <p className="time-ledger__empty">No direct time entries yet.</p>
      )}
      {nextCursor ? (
        <button ref={loadButtonRef} className="button button--quiet button--small load-entries" type="button" onClick={() => void loadOlder()} disabled={loading}>
          {loading ? "Loading…" : "Load older entries"}
        </button>
      ) : null}
      <p className="sr-only" aria-live="polite">{loadStatus}</p>
      {loadError ? <p className="detail-error" role="alert">{loadError}</p> : null}
    </section>
  );
}
