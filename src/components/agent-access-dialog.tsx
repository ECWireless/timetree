"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  createAgentApiKey,
  revokeAgentApiKey,
  rotateAgentApiKey,
} from "@/app/actions/agent-api-keys";
import { CopyIcon, CloseIcon, KeyIcon, WarningIcon } from "@/components/icons";
import { DialogFrame } from "@/components/node-dialogs";
import type {
  AgentApiKeyAccessLevel,
  AgentApiKeyMetadata,
} from "@/lib/agent/contracts";
import {
  createTimeTreeConnectionVerificationPrompt,
  createTimeTreeCodexSetup,
  createTimeTreeReadOnlyClientSetupPrompt,
  resolveTimeTreeHarnessOrigin,
  type TimeTreeCodexSetup,
} from "@/lib/agent/setup";
import { isValidIanaTimeZone } from "@/lib/agent/time-zone";

type PendingAction =
  | { kind: "create" }
  | { kind: "rotate" | "revoke"; credentialId: string }
  | null;
type Confirmation =
  | {
      kind: "rotate";
      credentialId: string;
      label: string;
      accessLevel: AgentApiKeyAccessLevel;
    }
  | { kind: "revoke"; credentialId: string }
  | null;
type SecretState = {
  action: "create" | "rotate";
  apiKey: string;
  credential: AgentApiKeyMetadata;
};
type FieldErrors = Record<string, string[]>;

type AgentAccessDialogProps = {
  canonicalOrigin: string | null;
  initialCredentials: AgentApiKeyMetadata[];
  nodeId: string;
  nodeTitle: string;
  onClose: () => void;
  onCredentialChanged: () => void;
  onCredentialConflict: (message: string) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
};

function CopyButton({
  buttonRef,
  children,
  disabled = false,
  onCopy,
  primary = false,
  ariaLabel,
}: {
  ariaLabel?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  disabled?: boolean;
  onCopy: () => void;
  primary?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      className={`button ${primary ? "button--primary" : "button--quiet"}`}
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onCopy}
    >
      <CopyIcon />
      {children}
    </button>
  );
}

function formatCredentialDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function accessLevelLabel(accessLevel: AgentApiKeyAccessLevel) {
  return accessLevel === "read_only" ? "Read only" : "Read and write";
}

function credentialReference(credentialId: string) {
  return credentialId.slice(-8);
}

function sortCredentials(credentials: AgentApiKeyMetadata[]) {
  return [...credentials].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function HarnessSetup({
  canonicalOrigin,
}: {
  canonicalOrigin: string | null;
}) {
  const browserOrigin =
    typeof window === "undefined" ? null : window.location.origin;
  const detectedTimeZone =
    typeof window === "undefined"
      ? null
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone =
    typeof detectedTimeZone === "string" &&
    isValidIanaTimeZone(detectedTimeZone)
      ? detectedTimeZone
      : null;
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const originResult = useMemo(
    () =>
      canonicalOrigin && browserOrigin
        ? resolveTimeTreeHarnessOrigin(canonicalOrigin, browserOrigin)
        : null,
    [browserOrigin, canonicalOrigin],
  );
  const setup = useMemo<TimeTreeCodexSetup | null>(() => {
    if (!originResult?.available || !timeZone) {
      return null;
    }
    return createTimeTreeCodexSetup({
      canonicalOrigin: originResult.canonicalOrigin,
      timeZone,
    });
  }, [originResult, timeZone]);

  async function copy(text: string, successMessage: string) {
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(successMessage);
    } catch {
      setCopyStatus("Copy failed. Select the fallback text manually.");
    }
  }

  return (
    <section
      className="agent-setup-section"
      aria-labelledby="codex-harness-heading"
    >
      <div className="agent-setup-section__heading">
        <div>
          <p className="agent-setup-kicker">Once per Codex installation</p>
          <h3 id="codex-harness-heading">Install the TimeTree skill</h3>
        </div>
      </div>
      <p className="agent-setup-copy">
        Do this once for each Codex installation or execution environment that
        connects to this TimeTree deployment. Copy the prompt and paste it into
        any Codex session on that installation. Codex will create the skill and
        activation rule for you.
      </p>

      {!canonicalOrigin ? (
        <p className="agent-setup-warning" role="alert">
          <WarningIcon />
          Harness setup requires a configured HTTPS origin, or explicit
          loopback HTTP for local development.
        </p>
      ) : !browserOrigin ? (
        <p className="agent-setup-status">Checking this dashboard origin…</p>
      ) : originResult && !originResult.available ? (
        <div className="agent-setup-warning" role="alert">
          <WarningIcon />
          <span>
            This dashboard is not the configured TimeTree origin. Generate
            harness setup from{" "}
            <a href={originResult.canonicalOrigin}>
              {originResult.canonicalOrigin}
            </a>
            .
          </span>
        </div>
      ) : !timeZone || !setup ? (
        <p className="agent-setup-warning" role="alert">
          <WarningIcon />
          Codex setup needs a valid browser calendar time zone.
        </p>
      ) : (
        <>
          <p className="agent-setup-time-zone">
            Calendar time zone: <strong>{setup.timeZone}</strong>
          </p>
          <CopyButton
            primary
            onCopy={() =>
              void copy(
                setup.installationPrompt,
                "Codex setup prompt copied. Paste it into any Codex session on the installation you want to configure.",
              )
            }
          >
            Copy Codex setup prompt
          </CopyButton>
          <details className="agent-setup-fallback">
            <summary>Manual setup and generated files</summary>
            <div className="agent-setup-fallback__content">
              <p>
                Create <code>{setup.skillPath}</code> with this content:
              </p>
              <CopyButton
                onCopy={() =>
                  void copy(
                    setup.skillMarkdown,
                    "Generated SKILL.md copied.",
                  )
                }
              >
                Copy SKILL.md
              </CopyButton>
              <pre tabIndex={0}>
                <code>{setup.skillMarkdown}</code>
              </pre>
              <p>
                Append this block to the active global Codex instruction file.
                Use a non-empty <code>AGENTS.override.md</code> in{" "}
                <code>CODEX_HOME</code> when present; otherwise use{" "}
                <code>AGENTS.md</code>.
              </p>
              <CopyButton
                onCopy={() =>
                  void copy(
                    setup.activationMarkdown,
                    "Global activation block copied.",
                  )
                }
              >
                Copy activation block
              </CopyButton>
              <pre tabIndex={0}>
                <code>{setup.activationMarkdown}</code>
              </pre>
            </div>
          </details>
        </>
      )}
      <p className="agent-copy-status" aria-live="polite">
        {copyStatus}
      </p>
    </section>
  );
}

function KeyConfigurationFields({
  accessLevel,
  disabled,
  errors,
  idPrefix,
  inputRef,
  label,
  onAccessLevelChange,
  onLabelChange,
}: {
  accessLevel: AgentApiKeyAccessLevel;
  disabled: boolean;
  errors: FieldErrors;
  idPrefix: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  label: string;
  onAccessLevelChange: (accessLevel: AgentApiKeyAccessLevel) => void;
  onLabelChange: (label: string) => void;
}) {
  const labelErrorId = `${idPrefix}-label-error`;
  const accessErrorId = `${idPrefix}-access-error`;

  return (
    <div className="agent-key-form__fields">
      <label>
        <span className="field-label">Key label</span>
        <input
          ref={inputRef}
          value={label}
          maxLength={100}
          required
          disabled={disabled}
          aria-invalid={Boolean(errors.label)}
          aria-describedby={errors.label ? labelErrorId : undefined}
          placeholder="Client or application name"
          onChange={(event) => onLabelChange(event.target.value)}
        />
        {errors.label ? (
          <span id={labelErrorId} className="field-error" role="alert">
            {errors.label[0]}
          </span>
        ) : null}
      </label>
      <fieldset className="agent-key-access">
        <legend>Access level</legend>
        <label className="choice-row">
          <input
            type="radio"
            name={`${idPrefix}-access`}
            checked={accessLevel === "read_write"}
            disabled={disabled}
            aria-describedby={errors.accessLevel ? accessErrorId : undefined}
            onChange={() => onAccessLevelChange("read_write")}
          />
          <span>
            <strong>Read and write</strong>
            <small>Read reports and record agent work.</small>
          </span>
        </label>
        <label className="choice-row">
          <input
            type="radio"
            name={`${idPrefix}-access`}
            checked={accessLevel === "read_only"}
            disabled={disabled}
            aria-describedby={errors.accessLevel ? accessErrorId : undefined}
            onChange={() => onAccessLevelChange("read_only")}
          />
          <span>
            <strong>Read only</strong>
            <small>Read the complete scoped tree and report.</small>
          </span>
        </label>
        {errors.accessLevel ? (
          <span id={accessErrorId} className="field-error">
            {errors.accessLevel[0]}
          </span>
        ) : null}
      </fieldset>
    </div>
  );
}

export function AgentAccessDialog({
  canonicalOrigin,
  initialCredentials,
  nodeId,
  nodeTitle,
  onClose,
  onCredentialChanged,
  onCredentialConflict,
  returnFocusRef,
}: AgentAccessDialogProps) {
  const [credentials, setCredentials] = useState(() =>
    sortCredentials(initialCredentials),
  );
  const [lastInitialCredentials, setLastInitialCredentials] =
    useState(initialCredentials);
  const [createOpen, setCreateOpen] = useState(initialCredentials.length === 0);
  const [createLabel, setCreateLabel] = useState("");
  const [createAccessLevel, setCreateAccessLevel] =
    useState<AgentApiKeyAccessLevel>("read_write");
  const [createErrors, setCreateErrors] = useState<FieldErrors>({});
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [confirmationErrors, setConfirmationErrors] = useState<FieldErrors>({});
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [secret, setSecret] = useState<SecretState | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const confirmationCredentialId = confirmation?.credentialId;
  const confirmationKind = confirmation?.kind;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const addKeyButtonRef = useRef<HTMLButtonElement>(null);
  const createLabelRef = useRef<HTMLInputElement>(null);
  const rotationLabelRef = useRef<HTMLInputElement>(null);
  const secretCopyButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationButtonRef = useRef<HTMLButtonElement>(null);
  const credentialActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterCredentialsRefreshRef = useRef(false);
  const unsafeToClose = pendingAction !== null || secret !== null;
  const verificationPrompt = createTimeTreeConnectionVerificationPrompt();
  const browserOrigin =
    typeof window === "undefined" ? null : window.location.origin;
  const clientSetupPrompt = useMemo(() => {
    if (!canonicalOrigin || !browserOrigin) {
      return null;
    }
    const originResult = resolveTimeTreeHarnessOrigin(
      canonicalOrigin,
      browserOrigin,
    );
    return originResult.available
      ? createTimeTreeReadOnlyClientSetupPrompt(originResult.canonicalOrigin)
      : null;
  }, [browserOrigin, canonicalOrigin]);

  if (initialCredentials !== lastInitialCredentials) {
    setLastInitialCredentials(initialCredentials);
    setCredentials(sortCredentials(initialCredentials));
    setCreateOpen((current) =>
      initialCredentials.length === 0
        ? true
        : focusAfterCredentialsRefreshRef.current
          ? false
          : current,
    );
  }

  useEffect(() => {
    if (secret) {
      secretCopyButtonRef.current?.focus();
    }
  }, [secret]);

  useEffect(() => {
    if (confirmationKind) {
      confirmationButtonRef.current?.focus();
    }
  }, [confirmationCredentialId, confirmationKind]);

  useEffect(() => {
    if (createErrors.label) {
      createLabelRef.current?.focus();
    }
  }, [createErrors]);

  useEffect(() => {
    if (confirmationErrors.label) {
      rotationLabelRef.current?.focus();
    }
  }, [confirmationErrors]);

  useEffect(() => {
    if (!focusAfterCredentialsRefreshRef.current) {
      return;
    }
    focusAfterCredentialsRefreshRef.current = false;
    if (initialCredentials.length === 0) {
      createLabelRef.current?.focus();
    } else {
      addKeyButtonRef.current?.focus();
    }
  }, [initialCredentials]);

  function focusAfterRender(callback: () => void) {
    window.requestAnimationFrame(() => callback());
  }

  function reconcileCredentialState(message: string) {
    queueMicrotask(() => onCredentialConflict(message));
  }

  async function copy(text: string, successMessage: string) {
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(successMessage);
    } catch {
      setCopyStatus("Copy failed. Select the value or prompt below.");
    }
  }

  async function createCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateErrors({});
    setCopyStatus(null);
    setPendingAction({ kind: "create" });
    try {
      const result = await createAgentApiKey({
        nodeId,
        label: createLabel,
        accessLevel: createAccessLevel,
      });
      if (!result.ok) {
        if (result.fieldErrors) {
          setCreateErrors(result.fieldErrors);
          return;
        }
        reconcileCredentialState(result.message);
        return;
      }
      setCredentials((current) =>
        sortCredentials([...current, result.credential]),
      );
      setCreateLabel("");
      setCreateAccessLevel("read_write");
      setCreateOpen(false);
      setSecret({
        action: "create",
        apiKey: result.apiKey,
        credential: result.credential,
      });
      onCredentialChanged();
    } catch {
      reconcileCredentialState(
        "Agent access could not be created. Refreshing current state.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function rotateCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmation || confirmation.kind !== "rotate") {
      return;
    }
    const currentConfirmation = confirmation;
    setConfirmationErrors({});
    setCopyStatus(null);
    setPendingAction({
      kind: "rotate",
      credentialId: currentConfirmation.credentialId,
    });
    try {
      const result = await rotateAgentApiKey({
        nodeId,
        credentialId: currentConfirmation.credentialId,
        label: currentConfirmation.label,
        accessLevel: currentConfirmation.accessLevel,
      });
      if (!result.ok) {
        if (result.fieldErrors) {
          setConfirmationErrors(result.fieldErrors);
          return;
        }
        reconcileCredentialState(result.message);
        return;
      }
      setCredentials((current) =>
        sortCredentials([
          ...current.filter(
            ({ id }) => id !== currentConfirmation.credentialId,
          ),
          result.credential,
        ]),
      );
      setConfirmation(null);
      setSecret({
        action: "rotate",
        apiKey: result.apiKey,
        credential: result.credential,
      });
      onCredentialChanged();
    } catch {
      reconcileCredentialState(
        "Agent access could not be rotated. Refreshing current state.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function revokeCredential() {
    if (!confirmation || confirmation.kind !== "revoke") {
      return;
    }
    const credentialId = confirmation.credentialId;
    setCopyStatus(null);
    setPendingAction({ kind: "revoke", credentialId });
    try {
      const result = await revokeAgentApiKey({ nodeId, credentialId });
      if (!result.ok) {
        reconcileCredentialState(result.message);
        return;
      }
      const remaining = credentials.filter(({ id }) => id !== credentialId);
      setCredentials(remaining);
      setConfirmation(null);
      setCreateOpen(remaining.length === 0);
      focusAfterCredentialsRefreshRef.current = true;
      onCredentialChanged();
      focusAfterRender(() => {
        if (remaining.length === 0) {
          createLabelRef.current?.focus();
        } else {
          addKeyButtonRef.current?.focus();
        }
      });
    } catch {
      reconcileCredentialState(
        "Agent access could not be revoked. Refreshing current state.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  function cancelConfirmation() {
    const credentialId = confirmation?.credentialId;
    setConfirmation(null);
    setConfirmationErrors({});
    if (credentialId) {
      focusAfterRender(() =>
        credentialActionRefs.current.get(credentialId)?.focus(),
      );
    }
  }

  function acknowledgeSecret() {
    const credentialId = secret?.credential.id;
    setSecret(null);
    setCopyStatus(null);
    if (credentialId) {
      focusAfterRender(() =>
        credentialActionRefs.current.get(credentialId)?.focus(),
      );
    }
  }

  return (
    <DialogFrame
      className="agent-access-dialog"
      labelledBy="agent-access-dialog-title"
      initialFocusRef={closeButtonRef}
      onClose={onClose}
      preventClose={unsafeToClose}
      returnFocusRef={returnFocusRef}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Scoped agent access</p>
          <h2 id="agent-access-dialog-title">Agent access for {nodeTitle}</h2>
        </div>
        <button
          ref={closeButtonRef}
          className="dialog-close icon-button"
          type="button"
          aria-label="Close agent access dialog"
          data-tooltip="Close"
          disabled={unsafeToClose}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="agent-access-dialog__body">
        <HarnessSetup canonicalOrigin={canonicalOrigin} />

        <section
          className="agent-setup-section"
          aria-labelledby="credential-management-heading"
        >
          <div className="agent-setup-section__heading">
            <div>
              <p className="agent-setup-kicker">Per application or client</p>
              <h3 id="credential-management-heading">API keys</h3>
            </div>
            <span className="agent-setup-badge agent-setup-badge--active">
              {credentials.length} active
            </span>
          </div>

          {secret ? (
            <div className="agent-secret">
              <div className="agent-secret__warning" role="status">
                <KeyIcon />
                <div>
                  <strong>Copy this key now</strong>
                  <p>
                    TimeTree will not show it again.
                    {secret.action === "rotate"
                      ? " The previous key is already invalid."
                      : ""}{" "}
                    Save it only in the application or client that will use{" "}
                    <strong>{secret.credential.label}</strong>.
                  </p>
                </div>
              </div>
              <div className="agent-secret__metadata">
                <strong>{secret.credential.label}</strong>
                <span className="agent-key-access-badge">
                  {accessLevelLabel(secret.credential.accessLevel)}
                </span>
              </div>
              <p className="agent-secret__safety">
                Keep this bearer credential out of chat, logs, URLs, and
                tracked files. For a repository, verify that <code>.env</code>{" "}
                is untracked and ignored before saving it.
              </p>
              <div className="agent-secret__copies">
                <div>
                  <span className="field-label">Raw API key</span>
                  <pre className="agent-secret__value" tabIndex={0}>
                    <code>{secret.apiKey}</code>
                  </pre>
                  <CopyButton
                    buttonRef={secretCopyButtonRef}
                    primary
                    onCopy={() =>
                      void copy(secret.apiKey, "Raw API key copied.")
                    }
                  >
                    Copy raw API key
                  </CopyButton>
                </div>
                <div>
                  <span className="field-label">Repository .env line</span>
                  <pre className="agent-secret__value" tabIndex={0}>
                    <code>{`TIMETREE_API_KEY=${secret.apiKey}`}</code>
                  </pre>
                  <CopyButton
                    onCopy={() =>
                      void copy(
                        `TIMETREE_API_KEY=${secret.apiKey}`,
                        "Repository credential line copied.",
                      )
                    }
                  >
                    Copy .env line
                  </CopyButton>
                </div>
              </div>
              <button
                className="button button--quiet"
                type="button"
                onClick={acknowledgeSecret}
              >
                I’ve saved the key
              </button>
            </div>
          ) : (
            <>
              <p className="agent-setup-copy">
                Create separate, labeled keys for applications and clients.
                Every key remains limited to <strong>{nodeTitle}</strong> and
                its current descendants.
              </p>

              {createOpen ? (
                <form
                  className="agent-key-form"
                  aria-label="Create API key"
                  onSubmit={(event) => void createCredential(event)}
                >
                  <div className="agent-key-form__heading">
                    <h4>Create API key</h4>
                    {credentials.length > 0 ? (
                      <button
                        className="text-action"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => {
                          setCreateOpen(false);
                          setCreateErrors({});
                          focusAfterRender(() => addKeyButtonRef.current?.focus());
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  <KeyConfigurationFields
                    accessLevel={createAccessLevel}
                    disabled={pendingAction !== null}
                    errors={createErrors}
                    idPrefix="create-agent-key"
                    inputRef={createLabelRef}
                    label={createLabel}
                    onAccessLevelChange={setCreateAccessLevel}
                    onLabelChange={setCreateLabel}
                  />
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={pendingAction !== null}
                  >
                    <KeyIcon />
                    {pendingAction?.kind === "create"
                      ? "Creating…"
                      : "Create key"}
                  </button>
                </form>
              ) : (
                <button
                  ref={addKeyButtonRef}
                  className="button button--primary"
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => {
                    setCreateOpen(true);
                    setCreateErrors({});
                    focusAfterRender(() => createLabelRef.current?.focus());
                  }}
                >
                  <KeyIcon /> Add API key
                </button>
              )}

              {credentials.length > 0 ? (
                <div className="agent-key-list" aria-label="Active API keys">
                  {credentials.map((credential) => {
                    const reference = credentialReference(credential.id);
                    const isRotating =
                      confirmation?.kind === "rotate" &&
                      confirmation.credentialId === credential.id;
                    const isRevoking =
                      confirmation?.kind === "revoke" &&
                      confirmation.credentialId === credential.id;
                    const pending =
                      pendingAction !== null &&
                      (pendingAction.kind === "create" ||
                        pendingAction.credentialId === credential.id);

                    return (
                      <article className="agent-key-card" key={credential.id}>
                        <div className="agent-key-card__heading">
                          <div>
                            <h4>{credential.label}</h4>
                            <p>
                              Key <code>…{reference}</code> · Created{" "}
                              {formatCredentialDate(credential.createdAt)}
                            </p>
                          </div>
                          <span className="agent-key-access-badge">
                            {accessLevelLabel(credential.accessLevel)}
                          </span>
                        </div>
                        <p className="agent-key-card__scope">
                          {credential.accessLevel === "read_only"
                            ? "Can read the complete scoped tree and historical report."
                            : "Can read scoped data, create child nodes, and control timers."}
                        </p>

                        <div className="agent-key-card__setup">
                          <CopyButton
                            ariaLabel={`Copy verification prompt for ${credential.label}, key ${reference}`}
                            onCopy={() =>
                              void copy(
                                verificationPrompt,
                                "Connection verification prompt copied.",
                              )
                            }
                          >
                            Copy verification prompt
                          </CopyButton>
                          {credential.accessLevel === "read_only" ? (
                            clientSetupPrompt ? (
                              <CopyButton
                                ariaLabel={`Copy client-agent setup prompt for ${credential.label}, key ${reference}`}
                                onCopy={() =>
                                  void copy(
                                    clientSetupPrompt,
                                    "Read-only client-agent setup prompt copied.",
                                  )
                                }
                              >
                                Copy client-agent setup prompt
                              </CopyButton>
                            ) : (
                              <p className="agent-key-card__setup-warning">
                                Client setup is available only from the
                                configured TimeTree origin.
                              </p>
                            )
                          ) : null}
                        </div>
                        <details className="agent-setup-fallback agent-key-card__fallback">
                          <summary>View prompts manually</summary>
                          <div className="agent-setup-fallback__content">
                            <p>
                              <strong>Connection verification prompt</strong>
                            </p>
                            <pre tabIndex={0}>
                              <code>{verificationPrompt}</code>
                            </pre>
                            {credential.accessLevel === "read_only" &&
                            clientSetupPrompt ? (
                              <>
                                <p>
                                  <strong>Read-only client-agent setup prompt</strong>
                                </p>
                                <pre tabIndex={0}>
                                  <code>{clientSetupPrompt}</code>
                                </pre>
                              </>
                            ) : null}
                          </div>
                        </details>

                        {isRotating ? (
                          <form
                            className="agent-confirmation agent-key-form"
                            aria-label={`Rotate ${credential.label}, key ${reference}`}
                            onSubmit={(event) => void rotateCredential(event)}
                          >
                            <p>
                              Rotating immediately invalidates this key. Other
                              keys remain active.
                            </p>
                            <KeyConfigurationFields
                              accessLevel={confirmation.accessLevel}
                              disabled={pending}
                              errors={confirmationErrors}
                              idPrefix={`rotate-${credential.id}`}
                              inputRef={rotationLabelRef}
                              label={confirmation.label}
                              onAccessLevelChange={(accessLevel) =>
                                setConfirmation((current) =>
                                  current?.kind === "rotate"
                                    ? { ...current, accessLevel }
                                    : current,
                                )
                              }
                              onLabelChange={(label) =>
                                setConfirmation((current) =>
                                  current?.kind === "rotate"
                                    ? { ...current, label }
                                    : current,
                                )
                              }
                            />
                            <div className="dialog-actions">
                              <button
                                ref={confirmationButtonRef}
                                className="button button--danger"
                                type="submit"
                                disabled={pendingAction !== null}
                              >
                                {pendingAction?.kind === "rotate"
                                  ? "Rotating…"
                                  : "Rotate and show new key"}
                              </button>
                              <button
                                className="button button--quiet"
                                type="button"
                                disabled={pendingAction !== null}
                                onClick={cancelConfirmation}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : isRevoking ? (
                          <div
                            className="agent-confirmation"
                            role="group"
                            aria-label={`Revoke ${credential.label}, key ${reference}`}
                          >
                            <p>
                              Revoking immediately disconnects clients using
                              this key. Other keys, the node, and its time remain
                              unchanged.
                            </p>
                            <div className="dialog-actions">
                              <button
                                ref={confirmationButtonRef}
                                className="button button--danger"
                                type="button"
                                aria-label={`Revoke API key ${credential.label}, key ${reference}`}
                                disabled={pendingAction !== null}
                                onClick={() => void revokeCredential()}
                              >
                                {pendingAction?.kind === "revoke"
                                  ? "Revoking…"
                                  : "Revoke API key"}
                              </button>
                              <button
                                className="button button--quiet"
                                type="button"
                                disabled={pendingAction !== null}
                                onClick={cancelConfirmation}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="agent-key-card__actions">
                            <button
                              ref={(element) => {
                                if (element) {
                                  credentialActionRefs.current.set(
                                    credential.id,
                                    element,
                                  );
                                } else {
                                  credentialActionRefs.current.delete(
                                    credential.id,
                                  );
                                }
                              }}
                              className="button button--quiet"
                              type="button"
                              aria-label={`Rotate key ${credential.label}, key ${reference}`}
                              disabled={pendingAction !== null}
                              onClick={() => {
                                setConfirmationErrors({});
                                setConfirmation({
                                  kind: "rotate",
                                  credentialId: credential.id,
                                  label: credential.label,
                                  accessLevel: credential.accessLevel,
                                });
                              }}
                            >
                              Rotate key
                            </button>
                            <button
                              className="button button--danger-quiet"
                              type="button"
                              aria-label={`Revoke key ${credential.label}, key ${reference}`}
                              disabled={pendingAction !== null}
                              onClick={() => {
                                setConfirmationErrors({});
                                setConfirmation({
                                  kind: "revoke",
                                  credentialId: credential.id,
                                });
                              }}
                            >
                              Revoke key
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}

          <p className="agent-copy-status" aria-live="polite">
            {copyStatus}
          </p>
        </section>
      </div>
    </DialogFrame>
  );
}
