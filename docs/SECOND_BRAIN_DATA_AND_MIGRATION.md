# Second Brain Data and Migration Design

## Status

Proposed design for implementation planning. It builds on the current PKM Vault, IndexedDB outbox, Firestore chunk repository, Google Drive image worker, and Cloudflare JSON backup worker. The user selected private Google Drive for document binaries; the 20 MiB per-file PDF/DOCX cap is selected; aggregate quota and recovery rules remain to be finalized. No production data is changed by this document.

## Design goals

- Preserve existing Markdown and Canvas files without rewriting them.
- Let the previous PKM page continue to read its current data during the preview period.
- Store structured metadata as small, versioned text records.
- Keep binary attachments outside Firestore Vault chunks and JSON backup payloads.
- Preserve per-user access checks, offline metadata edits, retries, tombstones, and export.
- Make unsupported extraction visible without blocking storage of the original file.

## Proposed Vault representation

Continue using the existing Vault repository and file merge semantics for the initial release.

- Existing files remain in place and remain authoritative for legacy content.
- A new note is a Markdown file in a dedicated `Second Brain/Items/` namespace.
- Structured fields are a paired JSON sidecar in `Second Brain/Metadata/`.
- A PDF or DOCX is represented by a Markdown item/record plus attachment metadata. Its binary stays in the attachment store.
- TXT can be indexed as text while the original remains an attachment; MD remains editable Markdown.
- The graph and search projector reads Markdown body and relationships; a second-brain projector reads sidecar metadata and joins it to the Markdown file.

Example layout:

```text
Second Brain/
  Items/
    {item-id}.md
  Metadata/
    {item-id}.json
```

The exact path format must pass the existing path normalizer. Metadata should not be injected into a note body as YAML front matter until the current Markdown editor and parsers explicitly support that format.

## Knowledge-item metadata proposal

```json
{
  "schemaVersion": 1,
  "id": "stable-item-id",
  "kind": "note | link | image | document | daily",
  "title": "Human-readable title",
  "source": {
    "url": null,
    "label": null
  },
  "tags": [],
  "areaIds": [],
  "projectIds": [],
  "state": "inbox | processed | archived",
  "capturedAt": 0,
  "updatedAt": 0,
  "legacyPath": null,
  "attachments": [],
  "relatedIds": [],
  "extract": {
    "state": "not-needed | pending | ready | partial | failed",
    "textPath": null
  },
  "mutationId": "device-and-sequence",
  "deleted": false
}
```

This is a field proposal, not a finalized API contract. In this proposal, attachment metadata records are nested in the item sidecar under `attachments`; binary content remains external. Use IDs for relations rather than display names so renaming a tag, Area, or Project does not break references. Avoid storing derived graph coordinates or view-only UI state in the Vault.

## Attachment metadata proposal

```json
{
  "schemaVersion": 1,
  "id": "stable-attachment-id",
  "itemId": "stable-item-id",
  "name": "original-file-name.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 0,
  "sha256": "hex-checksum",
  "provider": "drive",
  "providerFileId": "opaque-provider-id",
  "uploadState": "queued | uploading | uploaded | failed",
  "extractState": "pending | ready | partial | failed | unsupported",
  "createdAt": 0,
  "updatedAt": 0,
  "mutationId": "device-and-sequence",
  "deleted": false
}
```

Keep credentials and OAuth tokens out of these records. A provider file ID is an opaque reference, not a credential. Validate every fetch/delete against the authenticated UID in the worker.

## Local database evolution

Do not change the current `pkm_index_db`, `vaultSnapshots`, or `vaultOutbox` stores for the first implementation pass.

The draft branch adds a separate `second_brain_attachments` IndexedDB database with an `uploadQueue` store:

- Queue records use a compound `userId + attachmentId` key so one account cannot overwrite another account's pending attachment.
- Each queued record stores normalized attachment metadata, retry status, and the local File/Blob until Drive confirms upload.
- The pending binary is removed only after the Drive file ID and checksum have been persisted to the synced item metadata.
- Browser quota failures remain visible and must not be reported as successful local or cloud saves.
- The queue repository is a draft foundation; it is not yet wired to the PKM UI or upload Worker.

New item metadata is still intended to use the existing Vault snapshot/outbox so it inherits the current sync, conflict, and backup path. This choice avoids an upgrade to the active PKM database during the first screen-preview stage.

## Binary storage and privacy

The current Drive worker accepts image MIME types only, has a 20 MiB image limit, and uses the `link-memo-img` folder. Document upload must use an explicit document route and a private folder policy. Keep the existing image endpoint behavior unchanged.

Before implementing document uploads, define:

- permitted MIME types and extension/MIME consistency checks;
- a 20 MiB per-file limit for PDF/DOCX (selected), plus batch limits;
- path and filename normalization;
- UID ownership verification on upload, download, and delete;
- upload timeouts, retry/idempotency behavior, and orphan cleanup;
- quota warnings and behavior when Drive is disconnected or full;
- whether local offline binaries are temporary or durable.

## Text extraction

- PDF and DOCX extraction is best-effort and must not block saving the original.
- TXT is indexed as text using an explicit encoding strategy.
- MD remains editable and indexed through the existing Markdown path.
- Record extraction state and parser version so reprocessing is possible.
- Treat scanned PDFs and unsupported Korean encodings as partial/unsupported; do not claim searchable text when extraction fails.
- Avoid copying a full extracted document into multiple records. Store one bounded text representation, or chunk it explicitly if the existing 2 MB Vault file limit would be exceeded.
- A later OCR feature must be evaluated separately because a free, reliable Korean OCR path is not established by the current repository.

## Backup and export

- Existing Cloudflare backups remain JSON payloads in private R2.
- Include item metadata, attachment manifests, checksums, and original source paths in the backup payload.
- Do not base64-encode document binaries into the JSON backup.
- Drive files remain separate objects; restore must verify each referenced object and mark missing files rather than silently dropping them.
- Provide an export manifest with relative item paths, attachment names, MIME types, checksums, and extraction states.
- Decide whether an independent binary backup is needed before promising complete recovery after Drive deletion or account disconnection.

## Legacy data projection

1. Project existing `.md`, `.json`, and `.canvas` files into the new Library without moving them.
2. Give each projected item a stable ID mapping and record its original Vault path as `legacyPath`.
3. Do not create a duplicate Markdown body for an unchanged legacy note.
4. Create sidecar metadata lazily when the user processes or edits a legacy item.
5. Keep old path references and existing `[[wiki links]]` resolvable.
6. Treat malformed Canvas or conflicted duplicate paths as visible exceptions for review.
7. Keep deletion tombstones and pending outbox writes in the original merge flow.
8. During preview, compare legacy and projected item counts, link resolution, and attachment references.
9. Cut over only after export and restore can reconstruct item metadata and locate every expected attachment.

## Open technical choices

The product-level storage choices below are defined in `docs/SECOND_BRAIN_STORAGE_POLICY.md`. These remaining technical checks need resolution before document upload coding:

| Choice | Recommended default | Why |
|---|---|---|
| Document file storage | **Selected:** private per-user Google Drive folder via a new worker route | The app already has a Drive OAuth flow; the existing image-only route cannot be reused unchanged. |
| PDF/DOCX size cap | **Selected:** 20 MiB per file | Matches the current image-worker cap as a conservative first limit; revisit only after upload and extraction measurements. |
| Offline binary handling | **Selected direction:** queue upload and show an unsynced state until Drive confirms upload; temporary local caching depends on browser quota | Prevent a false “saved everywhere” message and uncontrolled local storage growth. |
| Binary backup | **Selected direction:** keep metadata and attachment manifest in R2; do not duplicate binaries there in the first release | Current backup API is JSON and should not be treated as a binary object store. |
| Metadata sync | Existing Vault JSON sidecars and revisioned Firestore chunks | Reuse tested sync/conflict semantics and avoid a parallel sync engine in the first release. |
| Legacy conversion | Read-only projection first, sidecar on edit | Keeps the prior PKM usable and avoids bulk rewrite risk. |
| Extraction size | Bounded text with an explicit partial/truncated state | The Vault currently caps individual UTF-8 files at 2,000,000 bytes. |

## Implementation sequence after review

1. Storage policy, file types, and 20 MiB per-file cap are documented.
2. Draft domain validators, legacy projection, and isolated IndexedDB upload queue are on the feature branch; they are not wired into UI or Worker yet.
3. Add pure migration and synchronization integration while keeping the existing Vault database unchanged.
4. Implement the separate authenticated Drive document route with resumable transfer and account ownership checks.
5. Add local PDF/DOCX/TXT extraction with clear partial and failed states.
6. Connect the Library projector and Inbox UI to legacy and new records.
7. Validate sync, backup, restore, offline retries, and old-page compatibility before cutover.
