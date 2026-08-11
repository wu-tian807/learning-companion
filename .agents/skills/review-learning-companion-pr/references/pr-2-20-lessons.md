# Lessons from Learning Companion PRs #2–#20

Use this reference to recognize recurring failure modes. Recheck current source and `origin/main`; historical implementation details may have changed.

PR #13 and #14 were not present in the repository history returned during this review.

## Recurring patterns

1. A green unit suite can miss an invalid cross-layer composition.
2. A feature can work while bypassing the project’s TaskDefinition, GenerationTask, Workbench, or Service ownership model.
3. A narrowly titled PR can carry unrelated stacked commits or global behavior.
4. Product semantics such as Note versus chat, final output versus delta, and workspace scope versus permissions must be decided independently.
5. File deletion, cancellation, retry, crash recovery, and restart behavior are part of the feature—not optional cleanup.
6. Electron success requires testing the packaged runtime, platform-native dependencies, paths, and subprocess behavior.
7. Timing-sensitive tests should wait for domain events, not longer arbitrary sleeps.
8. Secrets, migrations, media Anchors, and Provider Sessions need explicit isolation tests.

## PR-specific evidence

| PR | Main lesson | Required review implication |
|---|---|---|
| #2 Native PDF runtime packaging | TypeScript success did not prove Vite could package native `.node` files or that packaged PDF.js, Canvas, and SQLite could load. | For native/build changes, inspect bundler externalization and verify the packaged artifact by loading the real runtime dependencies. |
| #3 Windows MSI installation | Installer work spans subprocess launch, elevation, cancellation, timeout, process-tree cleanup, progress, and application responsiveness. Its changed-file surface also expanded beyond the short PR description. | Test success, cancellation, timeout, already-running installer, and cleanup. Compare the actual diff to the title/body and split unrelated Provider changes. |
| #4 Codex permissions | A permission profile existed at thread startup but was selected again at turn startup where it was not defined. Correct data at the wrong lifecycle still failed. | Trace configuration through thread start/resume and turn start. Add a real or faithful composed runtime test, including existing user config. |
| #5 Context-menu dismissal | OpenSeadragon consumed bubbling mouse events, so a generic outside-click handler never ran. | Test the real event phase and component integration. Prefer pointer capture at the shared host when the behavior is truly generic. |
| #6 First architecture map | A technically complete map became too dense for collaborators. | Review documentation for progressive disclosure and contributor usability, not only factual completeness. |
| #7 Managed content deletion | Removing a Project or copied Asset must clean owned files, while linked originals must remain. Cleanup order affects recoverability. | Test copied/generated/linked modes, locked files, partial cleanup failure, Asset deletion, Project deletion, and restart consistency. |
| #8 Windows CI timing | Parallel Windows runners exposed cold-start and filesystem timing; broad sleeps or global timeout increases would hide genuine hangs. | Wait for domain events, keep timeout increases local, and distinguish flake stabilization from production changes. |
| #9 Simplified architecture map | Top-level layers and drill-down views were clearer than one graph containing every node and edge. | Keep architecture docs layered and validate every navigation path and boundary projection. |
| #10 Workspace scope and permissions | `shared` versus `task` chooses identity/session reuse; it must not silently force read-only permissions. | Test scope and permissions as orthogonal axes, including shared writable workspaces where declared. |
| #11 Workbench-owned interactions | Global Host/Main adapters understood media DOM and prevented Workbenches from defining different semantics for the same facility. | Keep transport generic; key registrations by Workbench and facility; test each Workbench’s Anchor construction independently. |
| #12 TaskAgentSession wording | “Task-scoped” documentation was mistaken for a forced task-isolated Provider Session. | Review names/comments against runtime behavior. Test `taskId`, `instanceKey`, workspace scope, and Provider Session lifetime separately. |
| #15 EPUB load performance | A one-line performance fix can still alter lifecycle timing. | Require a focused regression test or measurable reproduction even for very small diffs. |
| #16 Provider Connection and Selector | Provider, Connection, Selector, Session, model catalog, credentials, and GenerationTask snapshots are distinct responsibilities. The change also touched 92 files. | Audit secrets, deletion cleanup, login races, recovery snapshots, configuration/runtime composition, UI decoupling, and package behavior. Split large changes when independent layers can land safely. |
| #17 Selector reload and delta | A deterministic Selector bug was bundled with a disputed streaming design. A final completed message was described as synthetic “delta,” conflating protocol layers. | Split bug fixes from feature design. Distinguish true streaming, final completion fallback, Provider normalization, GenerationTask publication, and UI consumption. |
| #18 Document AI | Separate tests accepted both `permissions` and `default_permissions` generation while another test rejected their combination; the real chain failed. Feature IPC also bypassed GenerationTask and Host code learned PDF DOM. | Add configuration-to-runtime composition tests. Keep all Agent work on the GenerationTask path and all media semantics in the Workbench. |
| #19 EPUB explanations | Attachment, migration, final Assistant output, retry, Session semantics, Workbench placement, and a global Provider permission fix became entangled. | Decide Note/chat, result carrier, delta, Session boundary, and retry independently. Keep generic Attachment infrastructure separate from EPUB, and split global Provider fixes. |
| #20 HTML conversation | Local UI messages were at risk of becoming model history; project-wide `shared` scope did not represent separate conversations; no-delta providers lost final text; HTML UI was hard-coded in generic hosts. | Treat final output as authoritative, delta as optional, conversation ID as Session instance identity, UI history as a projection, and Workbench panels as registered contributions. Test restart and cross-conversation isolation. |

## Boundary cases repeatedly missed

### Cross-layer composition

- Generic provider configuration -> Codex thread configuration.
- TaskDefinition -> GenerationTask -> Provider -> final result -> Renderer.
- Renderer Anchor -> Preload/IPC -> Workbench Main -> persisted Attachment -> reveal.
- Migration -> Database API -> Service ownership checks.

### Lifecycle and recovery

- Turn completes but Processor/Renderer crashes before final task checkpoint.
- Attachment file is written but database/task completion is interrupted.
- Installer or conversion is cancelled while a subprocess tree remains alive.
- Workbench unmounts while an event or command is in flight.
- A task resumes after Connection/model settings changed.

### Isolation

- Two Projects with the same Asset filename.
- Two Assets using a shared Workbench feature.
- Two conversations in one Project.
- Different Connections/models using the same workspace Session locator.
- Managed files versus externally linked files.

### Degraded provider behavior

- Provider emits true delta and final completion.
- Provider emits only final completion.
- Provider returns malformed/empty output.
- Authentication is absent, expires, is cancelled, or completes after replacement.
- Error objects contain credential-like content and must be sanitized.

### Platform behavior

- Windows drive letters, backslashes, spaces, locked files, process trees, MSI behavior, and native modules.
- macOS ARM64 native package selection and packaged loading.
- Dev mode success versus packaged application success.
