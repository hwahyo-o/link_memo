# Second Brain Technical Audit

## Scope

This is a read-only audit of the current `main` source tree for planning a staged PKM replacement. It documents observed implementation constraints and recommended design boundaries. It does not modify the live PKM or authorize a production data migration.

## Findings from the current code

| Area | Observed behavior | Consequence for the second brain |
|---|---|---|
| Vault file types and size | `src/domain/pkm/vault-policy.js` accepts `md`, `json`, and `canvas`; a single UTF-8 file is limited to 2,000,000 bytes. Records use `path`, `type`, `content`, `updatedAt`, `mutationId`, and `deleted`. | PDFs and office binaries cannot be added as Vault files. Keep the Vault for text and structured metadata; model binary attachments separately. |
| Local PKM storage | `src/infrastructure/pkm/indexeddb-vault-repository.js` uses `pkm_index_db` version 1 with per-user snapshot and outbox stores. | Preserve the outbox and offline-first behavior. Any DB changes need a versioned upgrade path that retains pending local writes. |
| Firestore sync | `src/infrastructure/pkm/firestore-vault-repository.js` writes serialized file records in 320,000-byte chunks, up to 20 chunks per batch. It uploads new chunks, swaps the revision pointer transactionally, then deletes old chunks. | Keep item metadata/text in bounded documents. Do not place binary documents or base64 attachments inside the Vault JSON/chunks. Preserve revision conflict handling and old-revision availability during writes. |
| Conflict and deletion | `vault-policy.js` merges by path using `updatedAt` and `mutationId`; deletions remain as tombstones. | New item IDs and attachment references need deterministic merge semantics. Physical file deletion must not happen before all references and retention rules are understood. |
| Google Drive upload | `workers/drive-api/src/index.js` uses `drive.file`, stores files under `link-memo-img`, rejects non-image MIME types, and caps an image upload at 20 MiB. | The current route cannot store PDF or office documents. Add a separate validated document route and/or folder policy; do not silently route documents through the image API. |
| Client attachment flow | `src/infrastructure/http/drive-worker-image-repository.js` calls an image-oriented worker API using Firebase ID tokens. | Keep current image behavior intact. Introduce a distinct attachment repository contract for documents rather than widening image-specific methods without a migration. |
| Cloudflare backups | `cloudflare-backup-worker/README.md` exposes JSON backup and checkpoint APIs backed by private R2. The application backup service wraps JSON payloads with schema and checksums. | Back up metadata and stable attachment references. Binary backup is a separate storage decision and should not be inferred from the existing JSON endpoint. |
| Search metadata | `PKM_ARCHITECTURE.md` and the graph worker describe Markdown extraction for title, body, hashtags, HTML comments, wiki links, and URLs. | PDF/office text extraction is new functionality. Search should record extraction status and remain useful by filename/title when extraction is unsupported or fails. |

## Recommended data boundary

Keep two related but distinct records:

### Knowledge item

A small, syncable record containing item ID, type, title, Markdown/body or extracted text, source metadata, timestamps, tags, Area/Project IDs, processing state, and relations.

### Attachment

A metadata record containing attachment ID, parent item ID, original name, MIME type, byte size, checksum, storage provider/key, upload state, and extraction state. The binary itself stays in an attachment store; it is not embedded in Firestore Vault chunks or JSON backups.

This boundary supports offline-created metadata, clear upload retries, document previews, and future provider changes while keeping existing Markdown files exportable.

## Proposed storage flow

1. Save item metadata and local edits to IndexedDB immediately.
2. Queue binary uploads separately, with visible pending/failed/uploaded states.
3. Upload supported files through an authenticated document-specific worker route to a private per-user Drive folder.
4. Persist only the attachment reference and extraction result in the syncable metadata record.
5. Include attachment metadata and references in backup payloads; preserve the actual Drive objects separately.
6. Offer an export manifest and clear missing-file status if a Drive object is unavailable.
7. Define how offline-only or Drive-disconnected users retain binaries before enabling document capture across devices.

Selected direction: use a private Google Drive folder for document binaries and keep references/manifests in backups. The user selected 20 MiB as the per-file cap for PDF/DOCX. Aggregate Drive quota, retention, disconnected-account behavior, and restore behavior still need explicit implementation rules.

## Confirmed first document types

The user selected this scope for the MVP:

- `.pdf`: preview where feasible; attempt local text extraction.
- `.docx`: retain original and attempt local text extraction.
- `.txt` and `.md`: full text search; Markdown remains editable.
- Other files: defer at first, or allow attachment-only storage after size and quota rules are settled.

Do not promise full-text extraction for scanned PDFs or unusual encodings until a local parser and representative Korean fixtures are reviewed. Legacy `.doc`, spreadsheets, slide decks, and other types are deferred. Attachment-only support for other file types is not part of the confirmed MVP.

## Migration shape

1. Leave the current Vault schema and existing paths readable.
2. Add a versioned projection/migration that creates stable knowledge item IDs without removing source files.
3. Keep the original Markdown path and content available as the compatibility/export representation.
4. Convert image references into attachment metadata only after confirming old links still resolve.
5. Preserve deleted tombstones and pending outbox records.
6. Report duplicate paths, missing Drive objects, malformed Canvas, and parse failures instead of discarding them.
7. Retain old PKM access until metadata counts, links, attachments, offline edits, and restore behavior match.

## Decisions still needed before file-upload implementation

- Whether to add attachment-only support for other file types after the MVP.
- A user-visible aggregate quota policy based on available free storage.
- Expected behavior when Drive is not connected, quota is full, or an uploaded object is removed.
- Whether attachments should be copied to R2 or backed up through metadata/reference manifests only.
- Whether OCR for scanned Korean PDFs is a later requirement; it may require an external service or substantial client-side processing.

## Next technical work

1. Confirm the document-type boundary and attachment-only policy.
2. Define item and attachment schemas plus versioned IndexedDB migration.
3. Specify an authenticated document upload/download/delete worker API with explicit MIME, size, and ownership checks.
4. Define extraction as a best-effort process whose failure never blocks saving the original attachment.
5. Implement only after storage, quota, backup, and rollback behavior are reviewed.
