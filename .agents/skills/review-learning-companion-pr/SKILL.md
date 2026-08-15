---
name: review-learning-companion-pr
description: Review and gate Learning Companion feature branches before a pull request is opened, updated, or marked ready. Use when Codex has finished implementing a feature, fix, or refactor in this repository; when asked to self-review the current branch, judge PR readiness, inspect an existing PR, or prepare validation evidence. Enforce source-grounded diff inspection, architecture and ownership boundaries, detailed boundary-condition tests, full local gates, and risk-based Electron and CI verification. Never declare a branch ready when relevant tests are missing, weakened, skipped without justification, or failing.
---

# Review Learning Companion PR

## Treat this as a release gate

Act as the author’s strict first reviewer, not as a change summarizer.

Do not open or recommend opening a PR until all applicable local hard gates pass. A Draft PR is not an excuse to publish untested implementation. Use a design-only Draft only when the user explicitly requests early design discussion.

Base every conclusion on the current diff, source code, tests, command output, and—when a PR already exists—its actual base, comments, and checks. Do not infer readiness from a PR description or from “all checks passed” alone.

Use only these verdicts:

- `READY_FOR_PR`: implementation, scope, architecture, detailed tests, and all applicable local checks pass.
- `NOT_READY_FOR_PR`: any hard gate remains unsatisfied.
- `READY_TO_MERGE`: `READY_FOR_PR` remains true and remote CI, review, conflict, and branch-freshness gates also pass.

## 1. Establish the real change set

Start with read-only inspection:

```text
git fetch origin --prune
git status --short --branch
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

For an existing PR, also inspect its true base/head, changed files, commits, discussion, review threads, and checks. Prefer structured GitHub data when available.

Reject or split the branch when any of these are true:

- The title or claimed scope does not match the actual diff.
- A feature PR contains an unrelated Provider, migration, packaging, architecture-map, or global-host change.
- The PR is accidentally stacked on another feature branch without an explicit stacking plan.
- The diff contains generated output, local runtime state, secrets, broad formatting churn, or reverted/newer-main code.
- Multiple independently reviewable fixes are bundled together.

Never discard a dirty worktree or user change while inspecting.

## 2. Build an end-to-end change map

Map every changed production file to one owned layer:

- Renderer / React
- Preload / typed transport
- Electron Main / application service
- Shared contract and runtime validator
- Workbench vertical slice
- Database / migration
- File persistence
- GenerationTask / TaskDefinition
- Agent Provider / Connection / Selector / Session
- External library / subprocess
- Packaging / native runtime

Trace each user-visible behavior across its full call and return path. For example:

```text
Renderer
  -> Preload
  -> IPC
  -> Service
  -> Database/File/Provider
  -> event or result
  -> Renderer
```

Do not accept isolated unit correctness as proof that adjacent layers compose correctly.

Read the relevant current design documents under `docs/superpowers/specs/` and the interactive architecture map when ownership is unclear. Read [references/pr-2-20-lessons.md](references/pr-2-20-lessons.md) when the change touches Workbench, Generation, Provider, Attachment, native packaging, external libraries, persistence, or session behavior.

## 3. Enforce architecture ownership

### Electron and shared contracts

- Keep React and DOM semantics in Renderer.
- Keep privileged IO, SQLite, subprocesses, secrets, and native runtime work in Main.
- Keep Preload narrow: validate and transport typed calls/events; do not implement business behavior.
- Keep Shared modules serializable and environment-neutral.
- Validate IPC requests, responses, events, protocol versions, and opaque payloads at runtime.

### Workbenches

- Keep media semantics, Anchors, interaction detection, feature-specific UI, TaskDefinitions, and feature-specific IPC registration in the owning Workbench vertical slice.
- Keep Host, Runtime, Bridge, and common facilities media-agnostic.
- Register Main and Renderer contributions through aligned catalogs and stable IDs.
- Keep bootstrap generic; it may assemble registries and catalogs but must not know EPUB, PDF, HTML, MindMap, or other feature behavior.
- Reuse mechanical adapters only when the Workbench injects the media-specific target construction.

### Services and persistence

- Let Service own domain behavior and lifecycle orchestration.
- Let Database own SQLite persistence, File own file persistence, Registry own extensions, and Cache own disposable in-memory state.
- Avoid late-bound mutable references, hidden circular dependencies, and fallback chains that mask invalid state.
- Make deletion ordering explicit: clean owned files and dependent records safely before losing the identity needed for cleanup.
- Delete managed/copied files, never user-linked originals.
- Make cancellation, disposal, retries, partial failure, and rollback observable and idempotent.

### Generation and Agent execution

- Keep the main execution path:

```text
Workbench or business service
  -> TaskDefinition
  -> GenerationTask
  -> TaskAgentSession
  -> AgentProvider
  -> provider runtime
```

- Do not call a Provider directly from Renderer or a feature IPC handler.
- Let TaskDefinition define Instruction validation, user message construction, workspace configuration, tools, skills, system instruction, Provider Selector, output mode, and `process()`.
- Let GenerationTask own persistence, checkpoint, retry, cancel, recovery, result, metrics, and runtime event publication.
- Keep final Assistant output authoritative when the product result is a message. Treat delta as optional transient UX, never as the only result.
- Keep Workspace instance selection explicit in TaskDefinition. Omitted
  `resolveInstanceKey` means task isolation; a resolver may return a stable
  business key for cross-task Workspace and Session reuse. Do not infer path
  permissions, output mode, Connection, or model identity from that key.
- Keep UI conversation history separate from Provider thread history. Never replay local messages as model history when the Provider Session already owns context.
- Keep Session locator independent of Connection, model, and API-key identity unless an explicit provider protocol proves otherwise.

### Provider configuration

- Keep Provider, Connection, Selector, Session, and model catalog responsibilities separate.
- Snapshot the resolved execution selection into a GenerationTask so recovery does not silently switch configuration.
- Never persist or log API keys in `settings.json`, IPC snapshots, error objects, test snapshots, or console output.
- Test the composed path from generic configuration to provider runtime; testing both halves independently is insufficient.

### Attachments, Anchors, and relations

- Keep Attachment infrastructure generic; keep EPUB/PDF/HTML-specific metadata and behavior in the Workbench.
- Keep large answer bodies in Attachment content files, not metadata.
- Validate `typeId + version + target + metadata` through registries.
- Verify Asset ownership by Project and clean Attachment files on Attachment, Asset, and Project deletion.
- Let each Workbench construct, validate, reveal, and render its own media Anchor.

### Migrations

- Confirm migration numbers and table names do not collide with current `origin/main` or concurrent PRs.
- Test initialization from a previous supported schema and from a fresh database.
- Test repeated initialization, malformed/partial legacy state when relevant, foreign-key ownership, and “database newer than app” behavior.
- Keep schema declarations, migration SQL, Database code, and design documentation consistent.

## 4. Require a detailed boundary-test matrix

This is a hard gate. A behavior-changing PR without newly added or updated relevant tests is `NOT_READY_FOR_PR`.

Before running the suite, write a matrix for every changed behavior:

| Behavior | Test layer | Happy path | Boundary/failure cases | Evidence |
|---|---|---|---|---|

Cover every applicable category below. Marking a category “not applicable” requires a concrete reason.

1. Normal successful behavior.
2. Empty, missing, malformed, unknown-version, and unsupported input.
3. Duplicate calls, idempotency, retry, and stale events.
4. Cancellation, timeout, supersession, unmount, and disposal.
5. Partial write/failure, rollback, and orphan-file cleanup.
6. Restart, persistence, checkpoint, and recovery.
7. Concurrent or out-of-order operations where state can race.
8. Cross-Project, cross-Asset, cross-Workbench, cross-conversation, or cross-provider isolation.
9. Permission, path, secret, and trust-boundary rejection.
10. Windows path/process/native behavior and macOS packaging behavior when relevant.
11. Legacy data and database migration compatibility.
12. UI focus, capture/bubble phase, outside click, keyboard, loading, error, retry, and unmount behavior.
13. At least one integration or composition test across every changed architectural seam.

For bug fixes, first encode the exact reported reproduction as a regression test. The test must fail for the old behavior for the right reason and pass after the fix.

Reject these substitutes for adequate testing:

- Typecheck or lint without behavioral tests.
- Only Database CRUD tests for a Service lifecycle change.
- Two isolated mocks that each pass while their composed configuration is invalid.
- Snapshot-only assertions for lifecycle or security behavior.
- Arbitrary sleeps, broad global timeout increases, or retry loops that hide races.
- Skipping tests because setup is inconvenient.
- Weakening assertions or deleting tests to make the suite green.
- A manual screenshot without deterministic automated coverage.

Prefer domain events and explicit state transitions over timing waits. Keep timeout increases local and justified.

## 5. Run focused checks, then the full gate

Run the closest changed tests first. Fix failures and rerun them. Then run:

```text
pnpm check
```

Apply additional gates by risk:

| Changed area | Additional required evidence |
|---|---|
| Main or Preload bundling | `pnpm package` |
| Forge/Vite/native dependency/packaging | `pnpm smoke:native`, `pnpm make`, `pnpm verify:package:native` |
| Windows subprocess or external library | focused cancellation/timeout tests and `pnpm test:windows-integration` on Windows |
| Provider/auth/custom API | configuration-to-runtime composition tests, secret-leak regression, recovery tests; run an opt-in real integration only when its environment variable exists and never in CI |
| Database migration | fresh and prior-schema initialization tests plus migration-version collision inspection |
| Interaction-heavy UI | component tests plus a real Electron/browser interaction smoke test for the reported path |
| Architecture map | validate navigation, all nested views, boundary links, and responsive layouts |

Inspect `package.json` and the workflow before using command names; do not assume scripts still exist.

Do not claim a command passed unless it was run after the last relevant code change. Any code change after validation invalidates the affected evidence.

## 6. Produce review findings before a verdict

Report findings first, ordered by severity:

- P0: data loss, security exposure, unusable main path, or migration corruption.
- P1: deterministic correctness, architecture, recovery, or lifecycle blocker.
- P2: important maintainability, test-gap, UX, or degraded-path problem.
- P3: local cleanup or clarity improvement.

Attach file paths and tight line ranges. Explain the concrete failure path, not only the preferred style.

Then report:

1. Scope and actual changed layers.
2. Architecture ownership result.
3. Boundary-test matrix and missing cases.
4. Commands run with exact outcomes.
5. Manual/platform checks performed.
6. Remaining risks and known limitations.
7. One explicit verdict.

Use `NOT_READY_FOR_PR` whenever:

- Any applicable boundary case lacks a test.
- Any test or required local command fails.
- A changed seam lacks a composition test.
- The branch contains unrelated or stacked changes.
- Product semantics or ownership remain unresolved.
- Secrets, managed-file deletion, migration, recovery, or permission behavior is unverified.

## 7. Open or update the PR only after the gate

Immediately before publication:

1. Fetch `origin/main` again.
2. Recheck commits, changed files, conflicts, and `git diff --check`.
3. Rerun affected focused tests and `pnpm check`.
4. Confirm no code changed after the recorded evidence.

Write a PR description containing:

- User problem and root cause.
- Exact scope and intentionally excluded work.
- Architecture path and ownership decisions.
- Test matrix summary and commands with counts.
- Migration, secrets, cleanup, recovery, platform, and compatibility impact.
- Screenshots or recordings for visible UI changes.
- Known limitations and follow-up PRs.

After opening the PR, require both Windows x64 and macOS ARM64 workflows, conflict checks, and review threads to pass before returning `READY_TO_MERGE`. Never treat a green CI badge as proof that test coverage or architecture is adequate.
