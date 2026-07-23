# Session Workflow

TimeTree work may continue across different Codex sessions, branches, and pull
requests, so each session must rebuild its context before implementation begins.

## Sources of truth

- `SPEC.md` defines the approved product behavior, boundaries, and architecture.
- This workflow defines the planning, verification, review, and publication
  process for each PR-sized unit.
- Older attachments, handoffs, brainstorms, and chat history are context, not
  authority, unless the user explicitly promotes a decision into the spec.

## Start every session this way

Before editing files:

1. Read `SPEC.md`, this workflow, and `docs/model-effort-workflow.md`.
2. Recommend the lowest adequate effort level for the current task.
3. Confirm the current branch and worktree state.
4. Identify the directories likely to change and read every applicable nested
   `AGENTS.md` from the repository root down to those directories.
5. Confirm the current PR-sized unit with the user.
6. Debrief the work:
   - intended user-visible outcome;
   - explicit non-goals and stopping point;
   - technical approach and any decisions still open;
   - expected files, schema, services, and dependencies;
   - verification commands and manual QA;
   - commit and PR boundary;
   - proportional independent-review gate.
7. Break the work into sequential tasks.
8. Propose the intended commit sequence. If the work would be too large for a
   comfortably reviewable pull request, propose multiple PR-sized units instead.
   Commit units are sequential delivery gates, not labels applied after all
   implementation is complete.
9. Wait for explicit approval before beginning implementation.

Repository-wide workflow files establish the process and approval boundaries.
Nested guidance may refine instructions for its subtree but may not weaken
repository-wide scope, privacy, security, approval, or review requirements. Stop
and resolve conflicting guidance before editing.

## Work planning checklist

Before writing code, agree on:

- unit goal and acceptance criteria;
- user-visible outcome;
- effort recommendation;
- technical approach;
- dependency or service changes;
- data and migration effects;
- environment-variable names without secret values;
- assets to copy or generate;
- automated verification and manual QA;
- commit strategy and PR boundary;
- independent-review strategy.

Explain and obtain agreement before choosing a new framework, dependency,
external service, datastore, or foundational pattern.

## Implementation rules

- Keep work within the agreed PR-sized unit.
- Do not begin the next unit without a new debrief and approval.
- Do not install dependencies until their purpose is agreed.
- Do not start a development server unless the user expects a preview or it is
  required for agreed verification.
- Preserve `.env` and other ignored local configuration.
- Keep `main` as the approved baseline and use a focused conventional branch
  name such as `feat/phase-1-foundation`, `fix/timer-race`, or
  `docs/release-workflow` unless the user directs otherwise.
- Use conventional commit messages.
- Keep tracked documentation generic: never record credentials, developer
  machine paths, local infrastructure topology, or private operational details.

## Review and closeout

Before declaring a PR-sized unit complete or preparing a pull request:

1. Run the agreed verification commands.
2. Review the diff for correctness, regressions, accessibility, maintainability,
   unnecessary complexity, and scope compliance.
3. Perform a privacy and security pass:
   - confirm local environment files and secrets are ignored;
   - confirm no credentials, private hostnames, local absolute paths, private
     URLs, internal notes, or real user data are tracked;
   - confirm public UI copy does not expose implementation details;
   - confirm authentication, analytics, uploads, storage, and external calls are
     intentional and approved.
4. Run the proportional fresh-context independent-review gate below.
5. Resolve accepted findings and rerun affected verification.
6. Check in with the user before user-facing or browser QA. Report the review
   disposition, identify what needs QA, propose exact workflows and viewports,
   and obtain explicit approval before performing that QA.
7. Perform the approved user-facing QA, including browser inspection for
   interface changes, and resolve accepted findings.
8. Rerun affected verification after QA-driven changes. Obtain focused
   independent re-review when those changes are material.
9. Review every change made since the independent-review snapshot. Material
   changes restart the affected verification and focused-review gates.
10. Summarize what changed, verification and QA evidence, deviations, and
    remaining work.
11. Keep the PR boundary narrow enough to review comfortably.

Use sequential commit units. Prepare only one commit's diff at a time; complete its
automated verification, independent review, user-approved QA when applicable, and
explicit commit approval before implementing the next commit unit. Do not batch
multiple prepared commits into a shared review, QA, or approval cycle. Present the
sequence during the unit debrief. After presenting the final evidence, obtain
explicit approval, create the commit, and confirm it succeeded before implementing
the next commit unit. Staging, committing, pushing, and pull-request actions retain
their separate approval boundaries.

Read `docs/pr-review-workflow.md` before opening or updating a pull request, or
before responding to review feedback.

## Independent-review gate

Run independent review after a commit unit's implementation and automated
verification are complete, but before user-facing QA, commit approval, or work on
the next commit unit. Commit-unit readiness—not session end or eventual PR
readiness—is the routine trigger. After accepted review findings are resolved,
pause for the user-facing QA proposal and approval required above.

Review every sequential commit unit against its intended base and scope. If a
PR-sized unit includes multiple commit units, also review the integrated PR diff
against the PR-sized unit's goal and acceptance criteria before declaring the
PR ready.

### Reviewer count

- Use one fresh-context, read-only reviewer for a normal commit or PR-sized unit.
- Use two reviewers with distinct specialties when work materially changes
  authentication, authorization, privacy, security, migrations, data integrity,
  foundational architecture, or external integrations.
- Add reviewers only when they have clearly different responsibilities.

Useful specialties include:

- **Technical:** correctness, failure modes, tests, architecture, runtime
  behavior, dependencies, unnecessary complexity, and scope compliance.
- **Security and privacy:** authentication, authorization, secrets, data
  handling, storage, external calls, and trust boundaries.
- **Experience:** user-visible behavior, accessibility, responsive layout,
  keyboard and touch operation, and control clarity.

### Review procedure

1. Finish implementation and its verification.
2. Freeze implementation edits while reviewers inspect the work.
3. Give each reviewer the approved goal, acceptance criteria, stopping point,
   relevant docs, and complete diff from the intended base.
4. Keep reviewers read-only. They report findings but do not edit, commit, push,
   merge, or broaden scope.
5. Require evidence-based findings with severity, tight file and line references
   when applicable, the violated contract or risk, and a concise correction
   direction. Reviewers explicitly report when no actionable issue exists.
6. Classify findings:
   - **P0:** catastrophic or unsafe; blocks acceptance immediately.
   - **P1:** material correctness, security, privacy, or data-loss risk; blocks
     merge.
   - **P2:** important scope, maintainability, testing, accessibility, or
     operational issue; normally fix before merge.
   - **P3:** minor improvement that may be fixed or explicitly deferred.
7. Evaluate every finding rather than accepting it automatically.
8. Apply agreed fixes and rerun affected verification.
9. Request focused re-review of material fixes and disputed findings.
10. Report material deferred or unresolved findings to the user and record them
    in a relevant durable project document only when approved. Do not create
    permanent artifacts for fully resolved routine review.
11. Present final review evidence and disposition to the user, who remains the
    merge authority.

Independent review supplements rather than replaces automated tests, runtime
verification, privacy and security checks, and user acceptance. If independent
agents are unavailable, perform a distinct fresh-context review pass and clearly
disclose that it was not independently delegated.
