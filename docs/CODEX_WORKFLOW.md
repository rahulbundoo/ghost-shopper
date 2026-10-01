# Codex workflow

This workflow keeps reasoning quality high while minimizing repeated context.

## Context ladder

### Tier 0 — always read

- `AGENT.md`
- the current task packet

### Tier 1 — read when the slice touches it

Use `docs/README.md` to choose at most the relevant current-state docs and source files.

### Tier 2 — decision history

Read one or more ADRs only when a current change depends on or modifies that decision.

### Tier 3 — archaeology

Old phase notes, old prompts, migrations unrelated to the change, and broad test history are not startup context. Inspect them only to answer a specific implementation question.

## Working-set rule

Start with a working set of roughly 5–10 files. Expand only because:

- an imported type/port requires it;
- a failing test points there;
- a persistence/API boundary must change;
- an existing invariant is unclear.

Do not run broad repository search to “understand everything” before the task is scoped.

## Task packet format

Every substantial task should state:

```text
Objective
Current truth
Allowed scope
Explicit non-goals
Required reads
Behavior/contract changes
Safety invariants
Acceptance criteria
Targeted tests
External checks that may remain unverified
```

A task packet should describe one independently reviewable slice.

## Implementation loop

1. Read Tier 0.
2. Inspect only the required source files.
3. State a short plan, including migrations/API/ADR impact.
4. Implement the smallest coherent slice.
5. Run targeted tests immediately.
6. Fix the slice; do not opportunistically refactor neighboring code.
7. Run broader type/lint/checks only after targeted tests are green.
8. Update current-state docs only when behavior changed.
9. If architecture/trust boundaries changed, create/update an ADR.
10. Handoff with facts, not narrative history.

## Search discipline

Prefer exact symbol/file searches over conceptual repository sweeps.

Good:

```text
find ShopperDecision
find PlaywrightJourneyEngine.execute
read packages/browser/src/engine.ts
```

Avoid:

```text
read every file under packages/
read every ADR
read all migrations
summarize the whole repository
```

## Prompt discipline

The implementation prompt should name the slice, not restate the whole product.

Good:

> Implement Phase 13.1 from docs/tasks/PHASE_13_AUTONOMOUS_SHOPPER.md. Follow AGENT.md. Stop after its acceptance criteria.

The model can retrieve the rest from the repo.

## Change discipline

Do not combine these in one slice unless unavoidable:

- domain vocabulary + major UI redesign;
- new persistence model + billing changes;
- agent control loop + change-aware scheduling;
- new AI provider + browser policy redesign.

Prefer a chain of small PRs that each preserve a buildable/testable repo.

## Test discipline

Run checks in increasing cost order:

1. exact unit test file(s);
2. exact browser/integration suite when behavior crosses that boundary;
3. package/repo typecheck;
4. lint/format;
5. `pnpm check`;
6. infrastructure/live acceptance only when required and configured.

Do not rerun expensive suites after documentation-only edits unless CI policy requires them.

## Documentation discipline

Current-state docs explain what the product does now. Roadmap docs explain what is planned. ADRs explain why a material decision was made.

Never mix all three into the same page.

Phase-by-phase implementation diaries should not be used as active Codex context.

## Handoff format

Keep the final engineering handoff compact:

```text
Implemented
- ...

Tests
- command — result

Not verified
- ...

Next slice
- ...
```

Mention risks only when they remain actionable.
