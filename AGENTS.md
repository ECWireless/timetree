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
2. Perform user-facing QA when behavior or UI changed.
3. Perform code, accessibility, privacy, and security review passes.
4. Run the proportional fresh-context independent-review gate defined in
   `docs/session-workflow.md`.
5. Resolve accepted findings and rerun affected checks.
6. Update completed items in `IMPLEMENTATION_PLAN.md`.
7. Report verification evidence, review disposition, deviations, and remaining
   scope to the user.

Independent review supplements rather than replaces tests and user acceptance.
The user remains the merge authority.
