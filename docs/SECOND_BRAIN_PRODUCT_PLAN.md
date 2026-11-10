# Second Brain Product Plan

## Status

- Status: implementation foundation and parallel preview are on a draft feature branch; linked from the existing PKM header in that branch, but not merged or deployed
- Product scope: personal and work knowledge in one workspace
- First capture scope: text, links, images, PDF, DOCX, TXT, and MD
- Cost target: no additional recurring cost
- Rollout: staged replacement of the existing PKM page
- This document does not authorize a production cutover or destructive data migration.

## Current implementation checkpoint

The draft PR contains product and migration documents, domain policies, a read-only projector for existing Vault files, and a separate IndexedDB queue for local pending document uploads. Versioned items and Area/Project contexts are stored under the reserved `Second Brain/` path and use the existing sync and tombstone model. The `second-brain.html` preview provides quick capture, Inbox, Library, context filters, edit, delete/restore, TXT/MD import, image capture, and PDF/DOCX attachment flows. PDF/DOCX text is extracted in the browser and indexed with bounded size and explicit extraction states. Items can link to other items through explicit relations or `[[wiki links]]`; backlinks and a focused connection graph are available in the preview. The existing PKM file tree and graph hide this reserved path. A separate Drive Worker API provides resumable upload, checksums, ownership checks, download, trash, and restore. The preview and Worker have not been deployed; the Worker is not connected to the live service. The PR has not been merged.

## Product statement

Capture useful material quickly, organize it with minimal effort, connect it to work and personal contexts, and retrieve it when making or finishing something.

The product should improve the full knowledge loop:

1. Capture a thought, link, image, or document.
2. Keep new material in an Inbox until it is reviewed.
3. Add optional tags, an Area, or a Project.
4. Connect it to related notes and sources.
5. Find and use it later through search, backlinks, graph views, and project context.

The first release is a knowledge workspace, not a full task-management replacement. A knowledge item may carry a next action or link to a project.

## Current PKM capability map

| Current capability | Decision | Target behavior |
|---|---|---|
| Markdown notes | Keep and improve | Preserve Markdown content and existing paths; add structured metadata without breaking plain-text editing or export. |
| `[[wiki links]]` and graph view | Keep and improve | Preserve existing links and graph; add backlinks, filters, and focused views around a selected item. |
| Title/body/tag/comment search | Keep and improve | Preserve current search modes; add type, date, source, Area, and Project filters. |
| Split file tree/editor workspace | Replace presentation | Use Inbox, Library, and context navigation while keeping editing available without losing the current workflow. |
| Image attachment | Keep and extend | Keep private image storage and add the document attachment path after quota and authorization review. |
| IndexedDB offline-first editing | Keep | New notes and metadata remain usable offline and queue for later sync. |
| Firebase sign-in and Firestore sync | Keep | Reuse the current authenticated user boundary and sync model unless the schema review finds a blocking constraint. |
| Cloudflare backup and restore | Keep and extend carefully | Include new metadata in snapshots; confirm how external binary attachments are referenced and restored. |
| Import from the main Link Memo app | Keep and clarify | Retain the current import path and show imported items with provenance. |

## Product structure

### Core views

- **Home:** recent items, Inbox count, recently opened Projects, and quick capture.
- **Quick Capture:** add a note, link, image, PDF, or document with as few fields as possible.
- **Inbox:** review unprocessed items and add a title, tags, Area, or Project.
- **Library:** search and filter all knowledge items by type, date, source, tags, Area, and Project.
- **Areas and Projects:** browse ongoing responsibilities and time-bounded work.
- **Graph:** explore linked knowledge and backlinks, with filters for type and context.
- **Daily Notes:** record short daily notes and link them to existing knowledge.

### Initial content types

- Note: Markdown body
- Link: URL, title, source, fetched preview when available
- Image: original image plus optional caption and extracted metadata
- Document: PDF, DOCX, TXT, or MD original plus extracted/searchable text where feasible

Other file formats, audio, video, automated transcription, and browser-wide web clipping are post-MVP candidates. They are not required for the first release. The confirmed first document types are PDF, DOCX, TXT, and MD.

### Suggested item fields

- Stable item ID and schema version
- Type, title, body or extracted text
- Source URL and source label, when applicable
- Created, updated, and captured timestamps
- Tags, Area ID, Project ID, and Inbox/processed/archive state
- Attachment references and MIME type
- Related item IDs or Markdown wiki links
- Origin/provenance and import status
- Mutation ID and deletion tombstone compatible with current sync behavior

Markdown files should remain exportable as Markdown. Structured fields should have a documented export representation so the user is not locked into the app.

## MVP boundary

### Included

- Capture text, links, images, PDF, DOCX, TXT, and MD.
- Keep uncategorized captures in an Inbox.
- Assign and edit tags, Areas, Projects, and processing state.
- Search titles, Markdown, extracted document text where supported, tags, and source metadata.
- Filter search results by content type, date, Area, Project, and Inbox state.
- Preserve Markdown editing, existing wiki links, graph navigation, offline local saves, account sync, and backup compatibility.
- Provide clear item states when file text extraction or cloud upload is not available.

### Deferred

- Audio/video transcription.
- Browser extension or full-page web clipping.
- Automatic AI summaries or semantic search requiring a paid API.
- Multi-user collaboration and shared knowledge spaces.
- Replacing the existing Link Memo main app or its unrelated memo workflows.

### Zero-cost AI policy

Core capture, organization, search, linking, and export must work without AI. Start with deterministic rules for basic type recognition and optional metadata suggestions. Do not assume a free AI endpoint or unlimited free file storage. Evaluate local/on-device and user-invoked workflows only after confirming Korean quality, supported devices, privacy, and maintenance cost.

## Architecture direction

Prefer incremental changes inside the current repository and current stack for the first release:

- Keep Vite and the existing Vanilla JavaScript modules for the PKM interface.
- Keep IndexedDB for immediate local writes and offline operation.
- Keep Firebase Auth and the existing Firestore user boundary for sync.
- Reuse the existing Cloudflare JSON backup path for item/context metadata and attachment manifests; backup/restore parity is still a release gate.
- Keep image uploads on the existing image route. PDF/DOCX use a separate authenticated resumable Drive Worker route and private folder; deploy and verify it in a non-production environment before preview rollout.
- Keep presentation, application, domain, and storage responsibilities separate as in the current PKM architecture.

A framework or database rewrite is out of scope unless the current implementation audit reveals a concrete blocker.

## Migration and rollout

1. **Inventory:** map every existing PKM action and stored file type to this document; identify current schema and backup/restore assumptions.
2. **Compatibility design:** document a versioned mapping for existing Markdown, Canvas files, attachments, links, and tombstones. No destructive migration.
3. **Parallel implementation:** build the new experience on a feature branch and keep the current PKM entry point available.
4. **Shadow migration:** copy or project existing data into the new representation without deleting the source. Record skipped or conflicting records visibly.
5. **Parity review:** compare item counts, file paths, links, attachments, and editing behavior. Validate offline edits, multi-device sync, backup, and restore on a non-production dataset.
6. **Opt-in preview:** let the owner use the new screen while retaining a clear route to the old PKM view.
7. **Cutover:** change the default entry only after parity and recovery criteria pass. Keep a rollback route until the new path is stable.
8. **Retirement:** remove the old view only after the user confirms that the new experience covers the established workflows and rollback is no longer needed.

## Release gates

### Gate A — requirements and data inventory

- Every current user-visible PKM feature has a Keep, Improve, Replace, or Defer decision.
- Existing schemas and attachment flows are documented from code.
- Storage quota, OAuth scope, Firestore document/chunk limits, and backup contents are understood before expanding file storage.

### Gate B — MVP function

- Text, link, image, PDF, and document captures can be created, edited, found, and deleted or archived.
- Unsupported extraction is clearly reported; the source file remains available.
- Inbox, tags, Areas, Projects, filters, backlinks, and graph navigation work together.
- Core workflows remain available offline and reconcile after reconnecting.

### Gate C — safe replacement

- Existing notes, links, attachments, and tombstones remain accounted for.
- Backup and restore include all metadata required to reopen items.
- No production cutover occurs until migration, sync, and rollback paths are confirmed.
- The prior PKM experience remains reachable through the preview period.

## Resolved design choices

- PDF/DOCX extraction runs in the browser with PDF.js and Mammoth; extracted text is bounded, and extraction failure does not block keeping the original.
- PDF/DOCX originals use a separate private Google Drive route with a 20 MiB per-file cap. TXT/MD are imported as text; other document types and OCR are deferred.
- Offline PDF/DOCX uploads remain in a per-user IndexedDB queue until Drive confirms receipt. Drive quota is authoritative; the app does not guess available storage.
- Backups include metadata and attachment manifests only. Binary backup is not part of the MVP.
- Legacy Markdown, Canvas, and JSON records appear through a read-only projection; the old source files remain in place.

## Remaining implementation checks

- Verify mobile capture usability on supported viewport sizes.
- Verify multi-device sync/conflict, tombstone behavior, and backup/restore parity using non-production data.
- Verify the document Worker’s body-size/runtime behavior, ownership checks, and reconnect behavior after deployment to a non-production environment.
- Compare projected legacy counts, content, links, and attachments with the original Vault before any cutover.

## Immediate next work

1. Manually validate capture, editing, delete/restore, Area/Project filters, explicit relations, wiki links, backlinks, graph navigation, and legacy path exclusion with a representative Vault.
2. Verify sign-in transitions and account isolation, including stale-state clearing.
3. Check Korean PDF/DOCX extraction, scanned and malformed documents, file-size boundaries, and original retention when extraction fails.
4. Deploy the Worker only to a non-production environment; validate upload, interruption/resume, download, trash/restore, quota failure, and cross-user denial.
5. Complete sync, backup manifest, restore/relink, disconnect/reconnect, old-page compatibility, and migration parity review.
6. Publish the release-gate results and rollback path before asking to merge or deploy.
