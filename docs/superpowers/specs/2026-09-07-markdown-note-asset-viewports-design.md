# Markdown note Asset viewports and portable references

## Status and scope

This document is the implementation contract for replacing project-owned note
text with an ordinary managed Markdown Asset and for making references portable
between every Markdown editor surface.  It deliberately does **not** introduce
a shared selection controller: selection interaction, coordinate systems, CFI
semantics, focus state, and cleanup remain owned by each Workbench.

## Invariants

1. A notebook is a Markdown Asset.  The notebook viewport is only an opening
   policy which accepts Markdown Assets and can create one; it is not a second
   editor or a second content store.
2. The Markdown Workbench owns editing, save/recovery, reference insertion and
   reference activation for both ordinary and notebook viewports.
3. A portable location reference is a versioned value containing `projectId`,
   `assetId`, an `AssetTarget`, and (for a content target) the source revision
   captured in the same operation.  It never stores a DOM node, viewport,
   session id, or conversation context.
4. A Workbench owns the conversion from its local selection/focus into that
   snapshot, target validation/description, and reveal/highlight.  The common
   navigator owns identity checks, cancellation, compatible-viewport choice,
   waiting, and stale-version rejection.
5. Direct references, manual Attachments, and AI are independent consumers of
   a captured target.  AI must freeze its invocation target before deriving
   media context; AI busy/failure/cancellation must not make the underlying
   selection unusable.

## Viewports and sessions

Main-process Workbench sessions are keyed by viewport id.  Opening a document
supersedes only a pending/open session in the same viewport.  Commands and
close calls are keyed by session id.  Project close and application shutdown
release every remaining session.

Renderer interaction, target controllers, and conversation contributions are
also instance keyed.  A request specifies the source/target viewport rather
than relying on the most recently mounted workbench.  The runtime may retain a
read-only exported interaction snapshot; it is never the authority for a
Workbench's selection state.

Multiple Markdown viewports may render the same Asset, but editor view state
(scroll, selection, cursor) is local to each viewport.  Content saving is
coordinated by the Markdown document owner and versioned; two independently
editable buffers must not silently overwrite one another.  This change does
not introduce CRDT collaboration.

## Notebook policy

The notebook viewport displays an empty state with **New note** and **Open
Markdown** actions.  New note creates a managed `.md` Asset through the Asset
service using a collision-safe filename, then opens it in the notebook
viewport.  A repeated click is coalesced.  Failure leaves the current document
and unsaved draft intact.  The project stores only its selected notebook Asset
id; there is no project note body write path.

The notebook viewport never opens a non-Markdown target.  A reference to PDF,
EPUB, image, video, or another incompatible Asset is routed to a compatible
material viewport, leaving the notebook editor open.

Opening a Workbench Conversation from the notebook keeps the notebook viewport
mounted. Project displays that Workbench-initiated conversation as a floating
overlay; expanding it moves the complete chat to the existing right-side
Conversation panel. Neither presentation can unregister the notebook's Markdown
Workbench or discard its selection and conversation contribution.

## Reference and attachment rules

Markdown link syntax is a versioned transport encoding.  Existing v1 learning
note links remain readable.  New writers use the portable reference encoding;
they must reject content targets without a same-snapshot source revision and
must reject dirty/unmaterialized sources instead of labelling them with an old
disk revision.  The common layer does not infer quotes from target payloads or
source revisions from Attachment metadata.

Manual annotation Attachment types store only small typed metadata plus a
reliable target/version; longer body text is Attachment content.  Existing AI
Attachment types remain owned by their Workbench.  Resolving an older
Attachment without a reliable revision is an explicit failure, not a weakened
staleness check.

## Capability and test gate

Use the existing manifest/facility/target registries.  A Workbench declaring
location export must register target validation and reveal support.  Its
selection implementation must not import AI conversation/generation modules;
the common navigator must not import media-specific modules.  AI contributions
consume a frozen exported target, never mutate the source selection store.

The catalog test matrix enumerates every declared location-capable Workbench.
Each supplies its own real interaction driver (for example text drag, image
region draw, video frame range, or mind-map node click).  Shared assertions
cover no-AI/no-Attachment behaviour, frozen snapshots during AI execution,
cross-project rejection, cancellation, stale revisions, and viewport
isolation.  Calling a publish helper directly is not a valid interaction test.

## Delivery order

1. viewport-keyed session/registration primitives and tests;
2. portable target snapshot and common navigation contract;
3. Markdown-owned reference insertion/activation;
4. Workbench-by-Workbench AI/selection separation and manual annotations;
5. notebook Asset viewport and creation;
6. catalog gate, migration, package and Electron integration evidence.
