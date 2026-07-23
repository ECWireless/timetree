"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
import type { AgentApiKeyMetadata } from "@/lib/agent/contracts";
import {
  createTimeTreeConnectionVerificationPrompt,
  createTimeTreeCodexSetup,
  resolveTimeTreeHarnessOrigin,
  type TimeTreeCodexSetup,
} from "@/lib/agent/setup";
import { isValidIanaTimeZone } from "@/lib/agent/time-zone";

type PendingAction = "create" | "revoke" | "rotate" | null;
type Confirmation = "revoke" | "rotate" | null;
type SecretAction = "create" | "rotate" | null;

type AgentAccessDialogProps = {
  canonicalOrigin: string | null;
  initialCredential: AgentApiKeyMetadata | null;
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
}: {
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
    <section className="agent-setup-section" aria-labelledby="codex-harness-heading">
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

export function AgentAccessDialog({
  canonicalOrigin,
  initialCredential,
  nodeId,
  nodeTitle,
  onClose,
  onCredentialChanged,
  onCredentialConflict,
  returnFocusRef,
}: AgentAccessDialogProps) {
  const [credential, setCredential] =
    useState<AgentApiKeyMetadata | null>(initialCredential);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [secretAction, setSecretAction] = useState<SecretAction>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const copyCredentialButtonRef = useRef<HTMLButtonElement>(null);
  const verificationButtonRef = useRef<HTMLButtonElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const rotateButtonRef = useRef<HTMLButtonElement>(null);
  const revokeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationButtonRef = useRef<HTMLButtonElement>(null);
  const previousApiKeyRef = useRef<string | null>(null);
  const previousConfirmationRef = useRef<Confirmation>(null);
  const secretVisible = apiKey !== null;
  const unsafeToClose = pendingAction !== null || secretVisible;
  const verificationPrompt = createTimeTreeConnectionVerificationPrompt();
  useEffect(() => {
    const previousApiKey = previousApiKeyRef.current;
    previousApiKeyRef.current = apiKey;
    if (apiKey) {
      copyCredentialButtonRef.current?.focus();
    } else if (previousApiKey) {
      verificationButtonRef.current?.focus();
    }
  }, [apiKey]);

  useEffect(() => {
    const previousConfirmation = previousConfirmationRef.current;
    previousConfirmationRef.current = confirmation;
    if (confirmation) {
      confirmationButtonRef.current?.focus();
    } else if (previousConfirmation === "rotate") {
      rotateButtonRef.current?.focus();
    } else if (previousConfirmation === "revoke") {
      if (credential) {
        revokeButtonRef.current?.focus();
      } else {
        createButtonRef.current?.focus();
      }
    }
  }, [confirmation, credential]);

  async function copyVerificationPrompt() {
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(verificationPrompt);
      setCopyStatus("Connection verification prompt copied.");
    } catch {
      setCopyStatus("Copy failed. Select the verification prompt below.");
    }
  }

  function reconcileCredentialState(message: string) {
    queueMicrotask(() => onCredentialConflict(message));
  }

  async function copyCredentialLine() {
    if (!apiKey) {
      return;
    }
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(`TIMETREE_API_KEY=${apiKey}`);
      setCopyStatus("Repository credential line copied.");
    } catch {
      setCopyStatus("Copy failed. Select the credential line manually.");
    }
  }

  async function createCredential() {
    setPendingAction("create");
    try {
      const result = await createAgentApiKey({ nodeId });
      if (!result.ok) {
        reconcileCredentialState(result.message);
        return;
      }
      setCredential(result.credential);
      setApiKey(result.apiKey);
      setSecretAction("create");
      onCredentialChanged();
    } catch {
      reconcileCredentialState(
        "Agent access could not be created. Refreshing current state.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function rotateCredential() {
    if (!credential) {
      return;
    }
    setPendingAction("rotate");
    try {
      const result = await rotateAgentApiKey({
        nodeId,
        credentialId: credential.id,
      });
      if (!result.ok) {
        reconcileCredentialState(result.message);
        return;
      }
      setCredential(result.credential);
      setApiKey(result.apiKey);
      setSecretAction("rotate");
      setConfirmation(null);
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
    if (!credential) {
      return;
    }
    setPendingAction("revoke");
    try {
      const result = await revokeAgentApiKey({
        nodeId,
        credentialId: credential.id,
      });
      if (!result.ok) {
        reconcileCredentialState(result.message);
        return;
      }
      setCredential(null);
      setConfirmation(null);
      setCopyStatus(null);
      onCredentialChanged();
    } catch {
      reconcileCredentialState(
        "Agent access could not be revoked. Refreshing current state.",
      );
    } finally {
      setPendingAction(null);
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
          <p className="eyebrow">Scoped timekeeping</p>
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
          aria-labelledby="repository-connection-heading"
        >
          <div className="agent-setup-section__heading">
            <div>
              <p className="agent-setup-kicker">Once per repository</p>
              <h3 id="repository-connection-heading">
                Connect this repository
              </h3>
            </div>
            {credential && !secretVisible ? (
              <span className="agent-setup-badge agent-setup-badge--active">
                Active
              </span>
            ) : null}
          </div>

          {secretVisible ? (
            <div className="agent-secret">
              <div className="agent-secret__warning" role="status">
                <KeyIcon />
                <div>
                  <strong>Copy this key now</strong>
                  {secretAction === "rotate" ? (
                    <p>
                      TimeTree will not show it again. Replace the existing{" "}
                      <code>TIMETREE_API_KEY=</code> line in the repository-root{" "}
                      <code>.env</code> with this line, and keep exactly one
                      definition.
                    </p>
                  ) : (
                    <p>
                      TimeTree will not show it again. Add this exact line to
                      the repository-root <code>.env</code>.
                    </p>
                  )}
                </div>
              </div>
              <p className="agent-secret__safety">
                Before saving it, verify that <code>.env</code> is untracked
                and covered by a Git ignore rule. Never commit this value.
              </p>
              <pre className="agent-secret__value" tabIndex={0}>
                <code>{`TIMETREE_API_KEY=${apiKey}`}</code>
              </pre>
              <div className="dialog-actions">
                <button
                  ref={copyCredentialButtonRef}
                  className="button button--primary"
                  type="button"
                  onClick={() => void copyCredentialLine()}
                >
                  <CopyIcon />
                  Copy .env line
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => {
                    setApiKey(null);
                    setSecretAction(null);
                    setCopyStatus(null);
                  }}
                >
                  I’ve saved the key
                </button>
              </div>
            </div>
          ) : credential ? (
            <div className="agent-credential">
              <p>
                This key can read and record work only inside{" "}
                <strong>{nodeTitle}</strong> and its current descendants.
              </p>
              <p className="agent-credential__date">
                Created {formatCredentialDate(credential.createdAt)}
              </p>
              <CopyButton
                buttonRef={verificationButtonRef}
                onCopy={() => void copyVerificationPrompt()}
              >
                Copy connection verification prompt
              </CopyButton>
              <details className="agent-setup-fallback">
                <summary>Manual connection verification prompt</summary>
                <div className="agent-setup-fallback__content">
                  <pre tabIndex={0}>
                    <code>{verificationPrompt}</code>
                  </pre>
                </div>
              </details>

              <div className="agent-credential__management">
                <h4>Manage key</h4>
                {confirmation === "rotate" ? (
                  <div className="agent-confirmation">
                    <p>
                      Rotating immediately invalidates the key currently in
                      your repository.
                    </p>
                    <div className="dialog-actions">
                      <button
                        ref={confirmationButtonRef}
                        className="button button--danger"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => void rotateCredential()}
                      >
                        {pendingAction === "rotate"
                          ? "Rotating…"
                          : "Rotate and show new key"}
                      </button>
                      <button
                        className="button button--quiet"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => setConfirmation(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : confirmation === "revoke" ? (
                  <div className="agent-confirmation">
                    <p>
                      Revoking immediately disconnects repositories using this
                      key. The node and its time remain unchanged.
                    </p>
                    <div className="dialog-actions">
                      <button
                        ref={confirmationButtonRef}
                        className="button button--danger"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => void revokeCredential()}
                      >
                        {pendingAction === "revoke"
                          ? "Revoking…"
                          : "Revoke agent access"}
                      </button>
                      <button
                        className="button button--quiet"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => setConfirmation(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="dialog-actions">
                    <button
                      ref={rotateButtonRef}
                      className="button button--quiet"
                      type="button"
                      disabled={pendingAction !== null}
                      onClick={() => setConfirmation("rotate")}
                    >
                      Rotate API key
                    </button>
                    <button
                      ref={revokeButtonRef}
                      className="button button--danger-quiet"
                      type="button"
                      disabled={pendingAction !== null}
                      onClick={() => setConfirmation("revoke")}
                    >
                      Revoke API key
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="agent-credential">
              <p>
                Create one bearer key scoped to <strong>{nodeTitle}</strong>.
                Parent nodes, siblings, and other branches remain inaccessible.
              </p>
              <button
                ref={createButtonRef}
                className="button button--primary"
                type="button"
                disabled={pendingAction !== null}
                onClick={() => void createCredential()}
              >
                <KeyIcon />
                {pendingAction === "create"
                  ? "Creating…"
                  : "Create API key"}
              </button>
            </div>
          )}

          <p className="agent-copy-status" aria-live="polite">
            {copyStatus}
          </p>
        </section>
      </div>
    </DialogFrame>
  );
}
