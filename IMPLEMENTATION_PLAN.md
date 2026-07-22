# TimeTree MVP Implementation Plan

Status: Approved for implementation

This plan implements [`SPEC.md`](./SPEC.md) in small, demonstrable slices. The
spec is authoritative when this plan is ambiguous.

## Execution rules

- Complete and verify one phase before starting the next.
- Each phase must leave the application runnable.
- Add no feature, abstraction, datastore, service, or deployment dependency that
  is not required by the current phase and the MVP spec.
- Keep business rules in small server/domain modules rather than embedding them
  in components.
- Protect every product read and mutation with one centralized guard that checks
  a validated session, verified normalized allowlist email, and owner scope from
  the first database-backed phase.
- Make every schema change through a committed SQL migration.
- Keep credentials, machine-specific paths, and local infrastructure details out
  of tracked files.
- Prefer a straightforward implementation that can be replaced later over a
  generalized system for hypothetical requirements.

## Phase 1 — Project foundation

Status: Complete

### Build

- Scaffold a Next.js 16 App Router application with React, strict TypeScript,
  Tailwind CSS, ESLint, and `pnpm`.
- Record the package-manager version and commit the lockfile.
- Establish the minimal source layout for routes, components, domain logic,
  database code, and tests.
- Add server-only environment validation and a placeholder-only `.env.example`.
  Ensure `.env` and all local variants are ignored.
- Add the Coopa color tokens, Inter font stack, global focus treatment, and the
  exact Coopa favicon.
- Configure Vitest and Playwright without adding application-specific test
  helpers yet.

### Verify

- Lint, type checking, unit-test runner, production build, and the focused
  Playwright smoke tests all pass.
- At desktop and mobile viewports, Playwright loads the initial route, finds the
  stable TimeTree page landmark and title, detects no page error, and confirms
  the document has no horizontal overflow.
- The initial page renders the intended minimal dark visual foundation at desktop
  and mobile widths.
- A repository scan finds no credential or machine-specific local detail.

## Phase 2 — Persistence and single-account authentication

Status: Complete

### Build

- Add Drizzle ORM, Drizzle Kit, `pg`, Zod, Better Auth, and the official Better
  Auth Drizzle adapter.
- Define Better Auth's generated tables and the three product tables from the
  spec.
- Add database checks and indexes for positive durations, timestamp pairing,
  non-negative rate cents, sibling reads, entry history reads, owner-scoped
  relationships, one active timer per node, and deferred unique sibling
  positions including the root sibling group.
- Generate and review the initial SQL migration.
- Add one shared server-only database client using `DATABASE_URL`; migration
  commands prefer `DATABASE_URL_UNPOOLED` when supplied.
- Configure Google sign-in, rejection before usable access for non-allowed
  accounts, sign-out, session lookup, and protected-route redirects.
- Add one centralized server authorization guard that rechecks verified,
  normalized session email against the current exact-email allowlist on every
  protected read and action.
- Render a minimal branded sign-in state at `/` and an authenticated empty
  dashboard at the same route.

### Verify

- Migrations apply cleanly to an empty PostgreSQL database and are idempotently
  recognized as already applied on the next run.
- Schema integration tests prove the ownership and active-timer uniqueness
  constraints.
- The configured Google account can enter the dashboard; another account is
  rejected without creating usable application access.
- Unverified email, a disallowed account, and a retained session after an
  allowlist change all fail the centralized guard.
- A missing or invalid session cannot read the dashboard or invoke a product
  action.

## Phase 3 — Usable node tree

Status: Complete

### Build

- Implement `getDashboardData()` and pure functions that assemble the flat node
  list into an ordered tree.
- Implement root and child creation, inline title editing, description editing,
  and explicit/inherited rate editing.
- Assign new siblings the next integer position. When sibling order changes,
  rewrite that sibling group to contiguous integer positions in one transaction;
  do not introduce fractional ranking keys. Serialize or retry conflicting
  writes against the deferred uniqueness constraint.
- Add node selection through the `?node=` query parameter, breadcrumbs,
  expand/collapse, inline child creation, and the desktop two-pane shell.
- Add the narrow-screen tree/detail navigation behavior.
- Render zero-state direct hours, rolled-up hours, and value without implementing
  entries prematurely.

### Verify

- Unit tests cover tree assembly, ordering, breadcrumbs, inherited rates, and
  malformed/orphaned data handling.
- Integration tests cover owner-scoped create and update actions.
- A concurrent sibling-create test proves positions remain unique and
  contiguous.
- A user can build and edit a several-level hierarchy without leaving the
  dashboard.
- Refresh and browser Back preserve the selected-node behavior defined by the
  URL.

## Phase 4 — Tree organization and lifecycle

Status: In progress — transactional services and QA-approved search, lifecycle, move, and delete
controls complete; pointer drag-and-drop remains.

### Build

- Implement transactional moves to a parent and sibling position.
- Reject self-parenting, descendant cycles, cross-owner destinations, and moves
  of incomplete nodes beneath completed parents.
- Add drag-and-drop reordering and the searchable, keyboard-operable "Move To..."
  dialog using the same server action.
- Add client-side title search with breadcrumb results and jump-to-node behavior.
- Implement recursive completion, completed-node filtering, reopening with its
  ancestor path, and preservation of descendant completion state.
- Block completion when an active timer exists in the subtree.
- Use consistent row locking for move and lifecycle operations so concurrent
  completion, reopening, movement, and later timer starts preserve invariants.
- Implement confirmed deletion of history-free subtrees, relying on restrictive
  timer and entry foreign keys as the final concurrency guard.

### Verify

- Integration tests cover reparenting, sibling reordering, cycle rejection,
  recursive completion, reopening, completion blocking, and safe deletion.
- Race tests cover a destination completing during a move and timer start racing
  recursive completion.
- Pointer drag and "Move To..." produce identical persisted structures.
- Completed-node visibility and search/jump behavior work at desktop and mobile
  widths.

## Phase 5 — Manual time ledger and rates

### Build

- Implement compact duration parsing and formatting as pure functions.
- Add duration-only and exact-range manual entry forms with local-date handling,
  optional notes, resolved-rate preview, and explicit rate override.
- Implement create, edit, and confirmed permanent deletion of historical
  entries.
- Preserve stored rates when timestamps, duration, notes, assignment, node
  rates, or tree positions change unless the user explicitly edits the entry
  rate.
- Load the selected node's 50 newest direct entries and append older pages with
  a stable cursor.
- Query direct entry aggregates once, then calculate descendant hours, priced
  value, and unpriced-time flags in application code.
- Add and migrate a reviewed composite owner/node/work-date index for monthly
  subtree reads.
- Implement an owner-scoped monthly-summary read that validates `YYYY-MM`, uses
  entry `workDate`, includes the selected node and its current descendants, and
  returns both the rolled-up total and direct per-node contributions.
- Add the selected-node monthly summary with a local-current-month default,
  previous/next controls, a native month selector, `?month=YYYY-MM` navigation,
  headline hours and value, unpriced time, and a minimal contributing-node
  breakdown in current tree order.
- Display all durations and values according to the spec.

### Verify

- Unit tests cover accepted and rejected duration strings, time formatting,
  inheritance including explicit zero, exact value math, tree rollups, calendar
  month boundaries, and exact reconciliation of direct-contribution seconds,
  unpriced seconds, and pre-rounding values without double-counting.
- Integration tests cover manual entry correction, deletion, rate snapshots,
  pagination, reassignment without silent rate recalculation, monthly ownership
  boundaries, empty months, completed descendants, unpriced time, and
  work-date-based month assignment. A database-seeded active timer remains
  excluded from the monthly read.
- Moving a subtree changes ancestor rollups without modifying any historical
  entry.
- Manual historical entry remains available on a completed node.
- With a controlled browser timezone and date, an absent `?month` selects the
  browser's local current month. At desktop and mobile widths, changing the
  month updates the selected node's summary and URL, browser Back restores the
  prior month, and the expected direct-contribution rows are shown. Displayed
  rows are not required to visually reconcile rounding residuals.

## Phase 6 — Concurrent persistent timers

### Build

- Implement timer start with local work date and resolved-rate snapshot.
- Enforce one active timer per node while allowing concurrent timers on different
  nodes.
- Implement atomic stop: consume the active timer, create its historical entry,
  and commit both changes together.
- Add the sticky active-timers strip, shared one-second client clock, stop and
  jump actions, and running state on tree rows.
- Reconstruct elapsed time exclusively from persisted start timestamps after
  refresh or a closed tab.
- Keep active elapsed time out of historical totals until stop succeeds.

### Verify

- Integration tests cover concurrent starts, duplicate-node rejection, rate
  snapshot timing, atomic stop, repeated-stop races, and completion blocking.
- Playwright proves two different nodes can run simultaneously, one node cannot
  run twice, timers survive reload, and stopped time joins both the all-time and
  selected monthly totals.
- No background worker, polling service, or server-side ticking process exists.

## Phase 7 — Accessibility, resilience, and release readiness

### Build

- Finish compact Coopa-derived styling across forms, tree rows, dialogs, empty
  states, pending states, and errors without adding dashboard decoration.
- Complete keyboard behavior, accessible naming, focus-managed dialogs, reduced
  motion, and non-chatty timer announcements.
- Add concise error handling for validation, stale actions, constraint races,
  and database failures.
- Add the focused Playwright desktop/mobile workflows and a CI workflow for
  lint, type checking, tests, build, and browser smoke coverage.
- Document generic setup, migrations, tests, and deployment in the README without
  recording any developer-machine infrastructure.
- Configure Vercel production and preview environments with write-capable
  pooled connections to the same production Neon branch, plus the production
  Google callback and single allowed account. Give previews no direct migration
  URL; document that preview code can mutate production data and must remain
  compatible with the deployed production schema.
- Detect Vercel previews and replace Google sign-in with a concise link to the
  canonical production application. Keep the production Better Auth base URL
  and Google credentials for validated preview server configuration without
  trusting preview origins or supporting authenticated preview QA.
- Classify each production migration, explicitly confirm the target, verify a
  recent Neon recovery point and abort path, and ensure pre-deploy compatibility
  with the running version. Use expand/deploy/contract sequencing when needed.
- Apply the production migration manually, deploy, and execute the release smoke
  test with disposable data.

### Verify

- All automated checks pass from a clean checkout with supplied environment
  values.
- Core workflows are keyboard-operable and usable at the agreed desktop and
  mobile widths.
- Production sign-in, node operations, manual entry, concurrent timers,
  historical correction, and cleanup work at `https://timetree.coopallc.com`.
- A final repository scan finds no secrets, local absolute paths, or local
  infrastructure details.

## Explicitly deferred

- Multiple users per deployment, teams, organizations, invitations, and roles.
- Separate client/project/task models.
- Arbitrary-range reports, charts, invoice generation, billing workflows,
  budgets, and exports. The focused selected-node monthly summary remains in
  scope.
- Tags, priorities, due dates, reminders, notifications, and integrations.
- Offline support, native applications, and calendar synchronization.
- Public product APIs, webhooks, background jobs, and scheduled work.
- Historical tree snapshots, closure tables, cached rollups, and event sourcing.
- Multi-currency support, decimal-hour preferences, themes, and persisted UI
  preferences.
- A recycle bin, audit log, broad browser matrix, visual-regression service, and
  load-testing system.

## MVP completion gate

The MVP is complete only when all seven phases satisfy their verification
criteria, the production release smoke test passes, and no deferred feature was
pulled into scope without an explicit spec change.

After the user accepts the completed MVP and its final verification evidence,
delete this implementation plan as the last repository cleanup step.
