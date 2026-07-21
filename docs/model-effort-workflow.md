# Model Effort Workflow

Use this workflow to recommend the lowest adequate Codex effort setting for each
task and to recognize when changed work justifies reassessment.

## Capability boundary

The agent may assess and recommend effort, but must not claim it changed the
active setting unless the current environment exposes an explicit control and
the change succeeds.

If the active setting is not visible, say it is unknown rather than guessing.
Available effort levels may vary by model and Codex surface.

## Top-line recommendation

Begin the first user-facing response to a new task with one concise line:

> Effort recommendation: High — this task requires consequential architecture
> and data-integrity decisions.

Recommend the lowest adequate level for the current task. Reassess instead of
carrying a previous task's recommendation forward automatically. If the known
active setting is materially mismatched, pause at a safe boundary and ask the
user to change or explicitly retain it before substantive work continues.

Do not inflate mechanical work merely to force an effort change, and do not
delay low-risk work when the current known setting is adequate.

## Effort guide

### Low

Use for precise, reversible, mechanical work such as:

- small copy or formatting edits;
- narrow documentation changes;
- known-value configuration updates;
- established verification commands;
- simple file moves or renames.

### Medium

Use for normal scoped implementation with agreed requirements and direction:

- a well-defined component or route;
- routine queries and schema usage;
- tests for understood behavior;
- contained refactoring within established patterns;
- debugging with a small reproducible search space.

Medium is the default for ordinary phase implementation after architecture and
scope are approved.

### High

Use when work requires substantial judgment, synthesis, or investigation:

- product and phase debriefs;
- architecture or data-model design;
- privacy, authentication, authorization, or security decisions;
- migrations or difficult-to-reverse changes;
- unfamiliar integrations;
- complex debugging across several systems;
- final review of consequential work.

### XHigh

Reserve for unusually ambiguous or consequential work with high rework cost:

- several interacting foundational uncertainties;
- intermittent failures that remain after normal investigation;
- security-critical design across multiple trust boundaries;
- a foundational decision that constrains many later phases.

Do not recommend XHigh merely because a task is large. Break large but
straightforward work into smaller tasks first. XHigh may not be available for
every model.

## When to reassess

Reassess when:

- the goal or scope changes materially;
- mechanical work exposes an architectural decision;
- debugging crosses systems or repeated attempts fail;
- sensitive data, destructive operations, authentication, or security enters
  scope;
- work moves from planning to implementation;
- work moves from implementation to final review.

A task-type change does not automatically require a setting change. Recommend a
switch only when the current effort is materially mismatched.

## Switching protocol

When a switch matters:

1. Pause at a safe boundary.
2. State the current setting if known.
3. Name the recommended setting.
4. Give one reason tied to risk or complexity.
5. Wait for the user to change or explicitly retain the setting.
6. Rebuild context if the switch requires a new session.

Never use higher effort as a substitute for clarifying the goal, reducing scope,
or creating a testable plan.
