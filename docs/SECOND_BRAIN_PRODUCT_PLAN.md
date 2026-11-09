# Second Brain Product Plan

## Status

- Status: planning draft
- Product scope: personal and work knowledge in one workspace
- First capture scope: text, links, images, PDF, DOCX, TXT, and MD
- Cost target: no additional recurring cost
- Rollout: staged replacement of the existing PKM page
- This document does not authorize a production cutover or destructive data migration.

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
- Document: original file plus extracted text where feasible

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
- Reuse the existing Cloudflare backup path for metadata after confirming its size and restore behavior.
- Reuse the private Google Drive integration only after confirming that its OAuth scope and worker can safely support non-image documents. Do not assume the current image folder or quota is sufficient for every document type.
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

## Open implementation checks

These are technical checks, not product decisions:

- Which document extensions should count as “common documents” in the first release.
- Whether PDF and office-document text extraction can run in-browser without a paid service.
- How attachments will be stored and referenced when Drive is disconnected or quota is exhausted.
- Whether the backup worker should store attachment binaries or only safe metadata and references.
- How current Canvas files and imported Link Memo records should appear in the new Library.
- Which mobile capture flow is feasible within the current deployment and authentication setup.

## Immediate next work

1. Inspect the current PKM schema, repository adapters, Drive worker, and backup worker against the release gates.
2. Convert unresolved checks into a precise technical decision table.
3. Draft the migration schema and reversible migration path.
4. Only then implement the new shell and capture flow on the feature branch.
