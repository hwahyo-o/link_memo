# Second Brain Data and Migration Design

## Status

Proposed design for discussion and implementation planning. It builds on the current PKM Vault, IndexedDB outbox, Firestore chunk repository, Google Drive image worker, and Cloudflare JSON backup worker. No production data is changed by this document.

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
  "attachmentIds": [],
  "relatedIds": [],
  "extract": {
    "state": "not-needed | pending | ready | partial | failed",
    "textPath": null
  },
  "mutationId": "device-and-sequence",
  "deleted": false
}
```

This is a field proposal, not a finalized API contract. Use IDs for relations rather than display names so renaming a tag, Area, or Project does not break references. Avoid storing derived graph coordinates or view-only UI state in the Vault.

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

Do not replace the current `vaultSnapshots` or `vaultOutbox` stores.

Proposed additive IndexedDB upgrade:

- Increment `pkm_index_db` to version 2.
- Keep the existing stores and records unchanged.
- Add `attachmentQueue` for pending binary upload metadata and retry state.
- Add `attachmentBlobs` only if browser quota and cleanup rules permit temporary offline binary retention.
- If storing blobs is declined, label the local-only file clearly and do not report it as synced.
- Make the upgrade additive and safe to resume after browser closure; never clear existing outbox entries.

The second-brain metadata itself remains in the existing Vault snapshot/outbox initially so it inherits the current sync, conflict, and backup path.

## Binary storage and privacy

The current Drive worker accepts image MIME types only, has a 20 MiB image limit, and uses the `link-memo-img` folder. Document upload must use an explicit document route and a private folder policy. Keep the existing image endpoint behavior unchanged.

Before implementing document uploads, define:

- permitted MIME types and extension/MIME consistency checks;
- a per-file size limit and batch limits;
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

These need resolution before document upload coding:

| Choice | Recommended default | Why |
|---|---|---|
| Document file storage | Private per-user Google Drive folder via a new worker route | The app already has a Drive OAuth flow; the existing image-only route cannot be reused unchanged. |
| Offline binary handling | Queue metadata; temporarily cache the binary only if browser quota permits, and show an unsynced state | Prevent a false “saved everywhere” message and uncontrolled local storage growth. |
| Binary backup | Keep a manifest in R2 first; decide on a separate binary backup after measuring storage and restore needs | Current backup API is JSON and should not be treated as a binary object store. |
| Metadata sync | Existing Vault JSON sidecars and revisioned Firestore chunks | Reuse tested sync/conflict semantics and avoid a parallel sync engine in the first release. |
| Legacy conversion | Read-only projection first, sidecar on edit | Keeps the prior PKM usable and avoids bulk rewrite risk. |
| Extraction size | Bounded text with an explicit partial/truncated state | The Vault currently caps individual UTF-8 files at 2,000,000 bytes. |

## Implementation sequence after review

1. Specify the exact attachment MIME allowlist and size/quota policy.
2. Implement schema validation and pure migration/projection policies.
3. Add IndexedDB stores additively without touching existing snapshots or outbox rows.
4. Implement a separate attachment repository and authenticated worker routes.
5. Add local PDF/DOCX/TXT extraction with clear partial and failed states.
6. Add the new Library projector and Inbox UI over legacy and new records.
7. Validate sync, backup, restore, offline retries, and old-page compatibility before cutover.
