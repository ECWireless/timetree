# TimeTree MVP Specification

Status: Approved for implementation

This specification translates the TimeTree product vision into an intentionally
small first release. Decisions are added as they are agreed; unresolved behavior
is not implied by this document.

## Product definition

TimeTree is a private, self-hostable work ledger organized as an infinitely
nestable tree. A single authenticated person can organize work, record time on
any node, and see time and value roll up through the hierarchy.

The tree is the product's primary interface. TimeTree is not a general-purpose
project-management system.

## Initial deployment

- Initial production URL: `https://timetree.coopallc.com`
- Access is restricted to one configured Google account per deployment.
- Host-specific values, including the public URL and allowed email address, are
  environment configuration rather than application constants.
- Persistent records are associated with a user identifier so the schema does
  not prevent future multi-user support.
- The MVP does not include invitations, organizations, roles, permissions, or
  account switching.

## Open-source distribution

- TimeTree is distributed under the MIT License so people can fork, modify,
  and self-host it.
- Runtime URLs, account allowlists, OAuth credentials, and database connections
  are supplied through environment configuration rather than application
  constants. Project documentation may identify TimeTree's canonical Coopa
  deployment, but forks do not inherit its runtime configuration.

## MVP scope

The authenticated user can:

- Create, rename, describe, move, and complete nodes, with completion serving as
  the MVP archival action.
- Expand, collapse, and search the node tree.
- Record time manually using either a duration or start and end timestamps.
- Run and stop multiple timers concurrently.
- See all active timers persistently on the dashboard.
- See direct hours, rolled-up hours, and historical value.
- Review a selected node's monthly hours and historical value, including its
  current descendants, with a minimal per-node contribution breakdown.
- Set an hourly rate on a node and inherit the nearest ancestor's rate.
- Restore active timers from persisted start timestamps after refresh or a
  closed browser tab.
- Choose whether completed nodes are visible.

## Explicit non-goals

The MVP does not include:

- Teams, invitations, organizations, roles, or permission management.
- Separate client, project, milestone, or task models.
- Invoice generation, billing workflows, budgets, arbitrary-range reporting
  dashboards, charts, or exports.
- Tickets, tags, priorities, due dates, dependencies, sprints, kanban boards,
  reminders, or notifications.
- Offline mode, native mobile applications, calendar integrations, or imports.
- Tree sharing or public links.
- Bulk editing.
- A recycle bin or general soft-delete system.

## Historical time records

A stopped timer or manual time entry is a historical record. Its stored hourly
rate is a snapshot and never changes merely because node rates or tree structure
change later.

Historical integrity does not prevent correcting mistakes:

- A completed entry's timestamps, duration, notes, assigned node, and stored
  hourly rate can be edited explicitly.
- Changing timestamps, duration, notes, or assigned node does not silently
  recalculate the stored hourly rate.
- A completed entry can be permanently deleted after confirmation.
- The MVP does not provide a recycle bin for deleted entries.
- A node that contains time-entry history cannot be deleted. Completion
  preserves its history instead.

## Node lifecycle

The MVP has one lifecycle state: completed. "Complete" is also the MVP's
archival action; there is no separate archived state or archive workflow.

- Completing a node records `completedAt` on it and recursively on every
  incomplete descendant.
- Completed nodes are hidden from the tree by default.
- A "Show completed" control reveals completed nodes in their original tree
  positions.
- A completed node can be reopened.
- Reopening a node also reopens its completed ancestor path so the node remains
  reachable when completed nodes are hidden.
- Reopening a node does not reopen its descendants.
- Completion is blocked if the node or any descendant has an active timer. The
  interface identifies the blocking timer or timers and does not stop them
  automatically.
- Timer start, recursive completion, reopening, and moves lock affected node
  rows in a consistent order before checking lifecycle rules. Concurrent
  requests must not produce an active timer beneath a completed node or move an
  incomplete node beneath a destination that completes simultaneously.
- Completion and reopening do not alter time entries, stored rates, or totals.

## Tree structure and navigation

- Nodes may exist at the root or beneath another node, with no product-level
  nesting limit.
- Root nodes and each group of siblings have an explicit user-controlled order.
- A newly created node is appended after its existing siblings.
- Drag-and-drop can place a node before or after a sibling, or inside another
  node as its last child.
- "Move To..." searches for a new parent and appends the moved node after that
  parent's existing children. The root is also a valid destination.
- A node cannot be moved beneath itself or any of its descendants.
- An incomplete node cannot be moved beneath a completed node. The destination
  must be reopened first.
- Sibling positions are protected by a deferred owner/parent/position uniqueness
  constraint that treats root parents as one sibling group. Conflicting
  concurrent creates or moves are serialized or retried rather than leaving
  duplicate positions.
- A move carries the node's entire subtree without changing completion states,
  time entries, or stored hourly rates.
- Direct and rolled-up totals reflect the current tree immediately after a
  move. TimeTree preserves historical records, not historical tree layouts.
- MVP search is case-insensitive title matching. Results include breadcrumb
  paths so identically named nodes can be distinguished.
- Fuzzy matching and description indexing are not part of the MVP.

## Time recording

### Active timers

- An active timer is a persisted record separate from historical time entries.
- Starting a timer records its start timestamp and snapshots the node's resolved
  hourly rate at that moment.
- A node can have at most one active timer. This rule must be protected by the
  database as well as reflected in the interface.
- Timers on any number of different nodes may run concurrently.
- A timer cannot be started on a completed node.
- Refreshing or closing the browser does not affect a timer. Elapsed time is
  reconstructed from its persisted start timestamp.
- Stopping a timer atomically creates a completed time entry with the timer's
  timestamps and rate snapshot, then removes the active timer.
- Stopping is immediate. Optional notes can be added afterward by editing the
  completed entry.

### Manual entries

- Manual entry supports both duration-only and exact-range input.
- A duration-only entry records a work date and duration without inventing
  start or end timestamps.
- A range entry records exact start and end timestamps and derives its duration
  from that range.
- Duration is stored as an integer number of seconds.
- Manual historical entries may be added to completed nodes.
- Overlap between entries is allowed because concurrent work is intentional.

## Rates and value

- The MVP uses one currency: USD. Multi-currency records, conversion, and
  currency settings are out of scope.
- A node's optional hourly rate is stored in dollars with cent precision.
- A `null` node rate means "inherit." A rate of `$0.00` is an explicit zero-rate
  override and stops inheritance.
- A node's resolved rate is its own non-null rate or the nearest non-null rate
  found by walking up its ancestor path.
- Starting a timer snapshots the node's resolved rate onto the active timer.
- A manual entry defaults to the node's currently resolved rate. The user can
  explicitly override it before saving.
- If no rate exists on the node or its ancestors, the stored entry rate is
  `null` and the entry is unpriced rather than zero-value work.
- Node rate changes and tree moves never change rates already stored on active
  timers or historical entries.
- Entry and aggregate values are derived from exact duration seconds and stored
  rates. Monetary values are rounded to cents for display, not during duration
  calculations.
- An aggregate containing unpriced time shows the sum of its priced entries and
  an unobtrusive indication that some included time is unpriced.

## Monthly summaries

- A selected node has a monthly summary for itself and all of its current
  descendants, including completed descendants even when they are hidden from
  the tree.
- Calendar-month membership is determined exclusively by each entry's
  `workDate`. An exact-range entry that crosses midnight remains wholly in its
  recorded work-date month.
- Monthly summaries include completed historical entries only. Active timers do
  not contribute until they are stopped and converted into entries.
- The headline shows rolled-up hours, priced historical value, and the amount of
  unpriced time when applicable. Value uses each entry's stored rate snapshot,
  exact duration seconds, and display-time currency rounding.
- A minimal breakdown contains only nodes with entries in the selected month.
  Each row shows that node's direct contribution rather than its descendant
  rollup. The underlying duration seconds, unpriced seconds, and exact
  pre-rounding values sum to the headline without double-counting. Independently
  formatted row durations and currency values can differ slightly from the
  formatted headline because whole-minute formatting and cent rounding are
  applied for display.
- Breakdown rows follow current tree order. A relative breadcrumb distinguishes
  ambiguous titles without introducing separate client or project concepts.
- Moving a subtree changes which ancestors include its monthly history, just as
  it changes all-time rollups; TimeTree does not preserve historical tree
  layouts.
- A month without entries displays `0h` and `$0.00` with no breakdown rows.

## Dashboard experience

The authenticated application is one dashboard workspace rather than a set of
management pages.

### Layout

- A sticky active-timers strip appears at the top whenever at least one timer is
  running. Each timer shows its node title, breadcrumb, live elapsed time, a
  stop action, and a jump-to-node action.
- A compact toolbar provides search, "Show completed," and "New root node."
- On wider screens the main area uses two panes: the tree on the left and the
  selected node's details on the right.
- On narrow screens the tree is the primary view. Selecting a node opens its
  detail view, and a back action returns to the tree.
- The MVP does not include charts, analytics cards, a virtualized tree, or a
  separate settings area.

### Tree rows

Each node row presents:

- Expand or collapse control when children exist.
- Title.
- Rolled-up hours as the dominant metric.
- Direct hours as a secondary metric.
- Rolled-up historical value and an unpriced-time indicator when applicable.
- Running-timer state.
- An add-child affordance.
- An overflow menu for less common actions.

### Selected-node details

The detail view contains:

- Breadcrumb path.
- Inline-editable title, description, and rate.
- Start/stop timer and manual-entry controls.
- A compact monthly summary with previous/next controls, a native month
  selector, rolled-up hours and value, unpriced time, and the direct-contribution
  breakdown.
- Direct time-entry history for that node.

### Search and interaction

- Search shows a simple result list with each node's breadcrumb.
- Choosing a result clears search, expands the node's ancestors, scrolls to it,
  and selects it.
- Inline interactions are preferred. Modals are reserved for destructive
  confirmation and the searchable "Move To..." flow.
- Completed-entry totals exclude active elapsed time. Live elapsed time is shown
  on the active timer and node indicator, and joins totals only after the timer
  is stopped.

## Visual direction

TimeTree uses [Coopa LLC](https://www.coopallc.com/) as its sole visual source.
It borrows the brand's tokens and restraint, not the marketing page's layout.

- Primary canvas: near-black `#050608`.
- Primary text: off-white `#f7f8ff`.
- Secondary text: muted blue-gray `#9aa6b2`.
- Brand blue: `#1263ad`.
- Brand yellow: `#faf30e`.
- Typeface: Inter with a system sans-serif fallback stack.
- The default MVP appearance is dark; there is no theme switcher.
- Surfaces use subtle tonal separation and restrained borders rather than a
  dashboard full of elevated cards.
- Blue carries primary actions and selection. Yellow is reserved for focus,
  running-timer emphasis, and small brand accents so it remains meaningful.
- Motion is short and functional. Decoration, gradients, and large display type
  are used sparingly in the authenticated workspace.
- Controls remain compact, high-contrast, keyboard-visible, and touch-usable.
- TimeTree reuses the exact favicon served at
  `https://www.coopallc.com/favicon.ico`.

## Application architecture

- Next.js 16 App Router, React, and strict TypeScript form a single full-stack
  application.
- The application runs in the standard Node.js runtime, not the Edge runtime.
- Server Components perform initial reads. Typed Server Actions perform product
  mutations and revalidate affected data.
- Better Auth exposes the only general HTTP route handler, mounted at its
  conventional `/api/auth/[...all]` path.
- The MVP does not add REST, GraphQL, tRPC, Redux, or a separately deployed API.
- Tailwind CSS provides styling. Only the small set of accessible UI primitives
  needed by the product is added and owned locally.
- `pnpm` is the package manager. The repository commits its lockfile and records
  the package-manager version.

## Persistence and hosting

- PostgreSQL is the only datastore.
- Drizzle ORM defines the schema and performs queries through the standard `pg`
  driver.
- Drizzle Kit generates version-controlled SQL migrations. Production schema
  changes run through committed migrations rather than schema push.
- Better Auth uses its official Drizzle adapter and stores authentication data
  in the same PostgreSQL database.
- The initial application deployment is on Vercel at
  `https://timetree.coopallc.com`.
- The production database is hosted on Neon in a region close to the Vercel
  functions.
- Application traffic uses Neon's pooled connection string through
  `DATABASE_URL`.
- Migration tooling uses a direct connection through
  `DATABASE_URL_UNPOOLED`. Locally, both variables may point to the same
  PostgreSQL instance.
- Local development connects to a developer-provided PostgreSQL instance through
  environment variables. The repository does not provision or document the
  machine-specific database service.
- Local connection values live in a gitignored project-root `.env`. A committed
  `.env.example` documents required names without containing credentials.
- Production and preview secrets are managed through Vercel environment
  variables.
- The same Drizzle and `pg` code path is used locally and in production; the MVP
  does not introduce the Neon-specific serverless driver or a local Neon proxy.

## Data model

Better Auth owns its generated user, session, account, and verification tables.
TimeTree adds only the following three product tables. Product records use UUID
primary keys and reference the Better Auth user ID.

### `nodes`

- `id`
- `userId`
- Nullable self-reference `parentId`
- `position` within its sibling group
- `title`
- Nullable `description`
- Nullable `hourlyRateCents`
- Nullable `completedAt`
- `createdAt` and `updatedAt`

Integrity rules:

- A node cannot directly parent itself.
- Parent and child must belong to the same user.
- A rate is either null or a non-negative integer number of cents.
- Titles are trimmed, non-empty, and limited to a modest application-defined
  length.
- Deleting a node cascades to its descendants only after the application has
  verified that the entire subtree contains no historical entries or active
  timers.

### `activeTimers`

- `id`
- `userId`
- `nodeId`
- `startedAt`
- `workDate`, captured from the user's local date when starting
- Nullable snapshotted `hourlyRateCents`
- `createdAt`

Integrity rules:

- Timer and node must belong to the same user.
- A unique constraint on owner and node guarantees at most one active timer per
  node, including under concurrent requests.
- A snapshotted rate is either null or a non-negative integer number of cents.
- Node deletion is restricted while a timer exists.

### `timeEntries`

- `id`
- `userId`
- `nodeId`
- `workDate`
- Nullable `startedAt` and `endedAt`
- Positive integer `durationSeconds`
- Nullable snapshotted `hourlyRateCents`
- Nullable `notes`
- `createdAt` and `updatedAt`

Integrity rules:

- Entry and node must belong to the same user.
- Exact timestamps are either both absent or both present.
- When exact timestamps are present, the end must be later than the start.
- Duration must be greater than zero.
- A snapshotted rate is either null or a non-negative integer number of cents.
- Node deletion is restricted while an entry exists.

### Node deletion

- A node and its subtree can be permanently deleted only when that entire
  subtree contains no time entries and no active timers.
- Deletion requires confirmation and removes the history-free subtree in one
  transaction.
- Time-entry and active-timer foreign keys restrict node deletion. They provide
  the final database-level guard if a record is created concurrently after the
  application check.
- If any historical entry or active timer exists, deletion is blocked and
  completion remains available.

### Derived data

The database does not store breadcrumbs, paths, descendant lists, rolled-up
totals, calculated monetary values, or historical tree positions. Dashboard
reads load the user's flat node set plus direct entry aggregates, assemble the
tree, and calculate descendant rollups in application code. Monthly summaries
are also derived on read rather than stored.

## Server boundary

TimeTree has an internal, action-oriented server boundary rather than a public
product API.

### Server-only reads

- `getDashboardData()` returns the user's flat nodes, direct entry aggregates,
  and active timers.
- `getNodeEntries(nodeId, cursor?)` returns the selected node's 50 most recent
  direct entries and an optional cursor for loading older entries.
- `getNodeMonthlySummary(nodeId, month)` validates an exact `YYYY-MM` calendar
  month, resolves the selected node's current owner-scoped descendant set, and
  returns the rolled-up total plus direct per-node contributions.
- Selected-node context, including its resolved rate, is folded into the
  dashboard read where practical rather than exposed as a general endpoint.
- Node title search and breadcrumb matching happen client-side over the already
  loaded node set.

### Server Actions

- `createNode`
- `updateNode`
- `moveNode`
- `completeNode`
- `reopenNode`
- `deleteNode`
- `startTimer`
- `stopTimer`
- `createTimeEntry`
- `updateTimeEntry`
- `deleteTimeEntry`

Every protected read and action uses one centralized authorization guard that:

- Validates a full Better Auth session on the server.
- Requires the session email to be verified, normalized, and exactly equal to
  the current `ALLOWED_EMAIL` value.
- Re-evaluates the allowlist on every request so a retained session stops
  granting access after configuration changes.

Better Auth also rejects non-allowed accounts before creating usable application
access. In addition, every action:

- Validates input with Zod.
- Scopes all reads and writes to the authenticated user.
- Uses a transaction for multi-record changes.
- Returns a small typed success or field-error result.
- Revalidates only affected dashboard data.

Better Auth's conventional handler is the sole general HTTP route. A public
product API is not part of the MVP.

## Routes, components, and client state

### Routes

- `/` renders a branded Google sign-in state for unauthenticated visitors and
  the dashboard for an authorized session.
- `/api/auth/[...all]` is the Better Auth handler.
- The selected node is represented by `?node=<id>` so selection is linkable and
  browser navigation works naturally on narrow screens. An explicit monthly
  selection is represented by `?month=YYYY-MM`.

### Component hierarchy

```text
DashboardPage (server)
└── DashboardShell (client)
    ├── ActiveTimersStrip
    ├── DashboardToolbar
    ├── TreePane
    │   └── NodeTree
    │       ├── NodeRow
    │       └── InlineNodeCreate
    ├── NodeDetailPane
    │   ├── Breadcrumbs
    │   ├── NodeEditor
    │   ├── TimeControls
    │   ├── ManualEntryForm
    │   ├── MonthlySummary
    │   └── EntryList
    │       └── EntryRow
    ├── MoveNodeDialog
    └── ConfirmDialog
```

### State rules

- The server page provides authoritative dashboard data and the selected node's
  first page of entries.
- Expanded nodes, search text, and "Show completed" are ephemeral client state.
- The MVP does not add Redux, React Query, or persisted UI preferences.
- Selecting a node updates the URL and loads its first entry page from the
  server.
- When no month is selected, the client derives the user's current local
  calendar month. Changing the month updates the URL and loads an authoritative
  owner-scoped summary; previous and next controls use the same path.
- One shared client clock updates all visible running timers.
- Inline edits save on Enter or blur and cancel on Escape.
- Drag-and-drop is client-side. "Move To..." provides an accessible alternative
  that does not require pointer dragging.
- Server mutations refresh authoritative data. Optimistic UI is limited to
  interactions with trivial rollback, such as expand/collapse and pending
  presentation states.

## Time input and display

- Running timers display as `H:MM:SS` and update once per second.
- Historical entries display as hours and minutes, for example `1h 23m`.
- Tree totals use the same hours-and-minutes format, for example `42h 15m`.
- Monthly headline and contribution durations use the same hours-and-minutes
  format, and monthly values display as USD currency.
- The MVP does not add a decimal-hours display mode.
- Duration-based manual entry defaults to the user's current local date.
- Duration input accepts compact forms including `1h 30m`, `90m`, and `1.5h`.
- Exact-range entry uses local date and time inputs and may cross midnight.
- Notes are optional.
- Stopwatch duration is recorded with one-second precision.
- Historical duration presentation uses completed whole minutes, while stored
  seconds and value calculations remain exact.
- A positive duration below one minute displays as `<1m`.

## Quality boundary

### Automated verification

- Unit tests cover tree assembly and rollups, rate inheritance, value math,
  monthly boundaries and contribution assembly, duration parsing, and display
  formatting.
- PostgreSQL integration tests cover ownership boundaries, cycle prevention,
  active-timer uniqueness, atomic timer stopping, recursive completion, moves,
  history-safe deletion, and owner-scoped monthly summaries.
- A focused Playwright Chromium suite covers the primary workflow at desktop
  and mobile viewport widths.
- Browser tests create a real Better Auth test session. Application code does
  not expose an authentication-bypass route.
- CI runs linting, type checking, unit and integration tests, a production
  build, and the focused browser suite.
- The MVP does not add a visual-regression service, broad browser matrix, load
  test suite, or formal accessibility audit.

### Accessibility baseline

- Interactive controls have accessible names and visible keyboard focus.
- Core workflows are keyboard-operable.
- Dialogs manage focus and restore it to their trigger when closed.
- Reduced-motion preferences are respected.
- "Move To..." provides an accessible alternative to drag-and-drop.
- Per-second timer updates are not announced continuously to screen readers.

## Deployment and release

- Vercel deploys the Next.js application using the standard Node.js runtime.
- Neon uses one production branch for both the production deployment and Vercel
  preview deployments.
- Production at `https://timetree.coopallc.com` and Vercel previews use
  write-capable connections to the same production database.
- Preview code can therefore mutate production data. This is an explicit risk
  accepted for the canonical small deployment, not an isolation guarantee that
  forks should assume is safe for their own environments.
- Preview runtimes receive the write-capable pooled `DATABASE_URL` only.
  `DATABASE_URL_UNPOOLED` is reserved for an explicitly confirmed manual
  production-migration context and is not configured on previews.
- Previews neither apply nor validate pending migrations. Preview code must
  remain compatible with the schema currently deployed to production.
- Local development uses a separately supplied local PostgreSQL connection.
- Vercel builds do not run database migrations automatically.
- Before a production migration, the operator classifies it as additive,
  destructive, or compatibility-sensitive; explicitly confirms the production
  target; and verifies a recent Neon recovery point and abort path.
- Pre-deploy migrations must remain compatible with the currently running
  application. Incompatible changes use an expand/deploy/contract sequence
  across releases instead of one destructive step.
- After those gates pass, a production release applies committed migrations
  through the direct production connection before deploying application code.
- Google OAuth registers only the supported local and production callbacks:
  `http://localhost:3000/api/auth/callback/google` and
  `https://timetree.coopallc.com/api/auth/callback/google`.
- Arbitrary preview URLs are build and unauthenticated UI checks rather than
  supported Google OAuth environments. A preview detects Vercel's preview
  environment, does not initiate Google sign-in, and shows a concise link to the
  canonical production application instead. Preview auth configuration uses the
  canonical production base URL and credentials only to satisfy validated
  server configuration; the preview origin is not added as a trusted OAuth
  origin.
- Runtime deployment configuration is limited to the pooled database URL,
  Better Auth secret and base URL, Google credentials, and `ALLOWED_EMAIL`. The
  direct database URL is supplied separately only for confirmed manual
  migration commands.
- The MVP does not add analytics, error-reporting services, background workers,
  Redis, cron jobs, or an automated production-migration job.
- Release verification covers sign-in, node creation, manual entry, timer
  start/stop, correction of the disposable entry, and cleanup of disposable
  data.

The implementation sequence is maintained separately in
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
