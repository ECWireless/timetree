# TimeTree Agent Instructions

These instructions apply to the entire repository unless a more specific nested
`AGENTS.md` adds compatible guidance for its subtree.

## Required session start

Before editing files:

1. Read `SPEC.md`.
2. Read `IMPLEMENTATION_PLAN.md`.
3. Read `docs/session-workflow.md`.
4. Read `docs/model-effort-workflow.md` and recommend the lowest adequate effort
   for the task.
5. Confirm the current branch and worktree state.
6. Identify likely change locations and read every applicable nested
   `AGENTS.md`.
7. Debrief the current phase or PR-sized unit with the user and obtain approval
   before implementation.

`SPEC.md` is the product and architecture authority.
`IMPLEMENTATION_PLAN.md` is the execution and verification authority. Resolve
conflicts explicitly before editing.

Do not jump directly into scaffolding, dependency installation, schema changes,
or implementation.

## Phase alignment

Before each phase or PR-sized unit, agree on:

- goal, non-goals, and stopping point;
- user-visible outcome;
- technical approach and dependency changes;
- sequential tasks;
- acceptance criteria and verification commands;
- commit and PR boundary;
- proportional independent-review strategy.

Do not begin the next phase without a new debrief and explicit approval.

## Git and publication

- Keep `main` as the approved baseline.
- Use focused conventional branch names, normally with `feat/`, `fix/`, `docs/`,
  `chore/`, `refactor/`, or `test/`, unless the user directs otherwise.
- Use conventional commit messages.
- Do not stage, commit, push, open or update a pull request, post GitHub comments,
  dismiss reviews, or resolve threads without explicit user approval.
- Read `docs/pr-review-workflow.md` before opening or updating a pull request or
  handling review feedback.

## Privacy and security

- Never commit `.env`, credentials, tokens, private data, production records,
  developer-machine paths, private hostnames, or local infrastructure details.
- Keep `.env.example` limited to placeholder names and safe explanatory text.
- Use synthetic data in tests and documentation.
- Treat authentication, authorization, migrations, storage, analytics, uploads,
  and external calls as explicit review boundaries.

## Completion and review

Before declaring a PR-sized unit complete or preparing its PR:

1. Run the agreed automated verification.
2. Perform code, accessibility, privacy, and security review passes.
3. Run the proportional fresh-context independent-review gate defined in
   `docs/session-workflow.md`.
4. Resolve accepted findings and rerun affected checks.
5. Check in with the user with the review disposition and a concrete QA plan,
   then obtain approval before performing user-facing or browser QA.
6. Perform the approved QA when behavior or UI changed.
7. Resolve accepted QA findings, rerun affected checks, and obtain focused
   independent re-review of material post-review changes.
8. Update completed items in `IMPLEMENTATION_PLAN.md`, then review all changes
   made since the independent-review snapshot.
9. Report verification and QA evidence, review disposition, deviations, and remaining
   scope to the user.

Use sequential commit units: prepare only one commit's diff at a time, then complete
its automated verification, review gate, user-approved QA when applicable, and
explicit commit approval before beginning the next commit's implementation. Propose
the intended sequence during the phase debrief. Do not batch several prepared commit
units into one review, QA, or approval cycle. After final evidence, obtain explicit
approval, create the commit, and confirm it succeeded before implementing the next
unit. Propose multiple PRs up front when the work would otherwise be too large for
comfortable review.

Independent review supplements rather than replaces tests and user acceptance.
The user remains the merge authority.
