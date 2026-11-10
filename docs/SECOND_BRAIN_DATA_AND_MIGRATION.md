# Second Brain Data and Migration Design

## Status

This document records the current draft implementation and the migration work still required. The feature remains a parallel preview: no production deployment, bulk migration, or cutover has occurred. The selected product constraints are private Google Drive for document binaries, PDF/DOCX up to 20 MiB each, and no additional recurring service cost.

## Data boundary

- The existing PKM Vault remains the sync and conflict-resolution layer for small JSON records.
- New knowledge items are versioned JSON documents at `Second Brain/items/{encoded-id}.json`.
- Areas and Projects are versioned JSON documents at `Second Brain/areas/{encoded-id}.json` and `Second Brain/projects/{encoded-id}.json`.
- The original Markdown, Canvas, and structured Vault records remain at their current paths. The legacy projector exposes them read-only in the preview with stable `legacy:{path}` IDs; it does not rewrite their source files.
- PDF/DOCX binary data is stored separately in the private Drive document folder. Item metadata stores an attachment manifest and bounded extracted text, not the binary.
- TXT/MD imports become editable knowledge items. Existing image capture uses the existing image route and remains separate from PDF/DOCX upload.
- Relations use item IDs. Explicit related-item references, `[[title]]` wiki references, backlinks, and a focused graph are presentation features; derived graph coordinates are not stored.

Example Vault layout:

```text
Second Brain/
  items/
    {encoded-id}.json
  areas/
    {encoded-id}.json
  projects/
    {encoded-id}.json
```

## Versioned item fields

The implemented item validator normalizes these fields: `schemaVersion`, `id`, `kind`, `title`, `bodyMarkdown`, `sourceUrl`, `sourceLabel`, `tags`, `areaIds`, `projectIds`, `relatedIds`, `attachmentIds`, `attachments`, `state`, `capturedAt`, `updatedAt`, `mutationId`, `legacyPath`, and `deleted`.

Allowed kinds are note, link, image, document, daily, canvas, and structured. Legacy Canvas/structured items require a source path and remain projection-only. A knowledge-item JSON record is capped to fit the existing Vault file limit; extracted attachment text is capped at 300,000 UTF-8 bytes.

Attachment metadata includes the stable attachment/item IDs, name, MIME type, byte size, SHA-256, Drive file ID when uploaded, upload/extraction states, extracted text, timestamps, mutation ID, and tombstone. OAuth credentials never belong in Vault records. Every remote read/delete must be authorized against the Firebase user and the Worker’s per-user ownership record.

Areas and Projects have stable IDs, names, descriptions, active/archived state, timestamps, mutation IDs, and tombstones. Items reference them by ID so a rename does not break assignments.

## Local and cloud storage

The current PKM Vault database and its outbox are reused for item/context JSON records; the existing database schema is not upgraded by this feature. A separate `second_brain_attachments` IndexedDB database stores pending PDF/DOCX blobs under a user + attachment key, with upload session ID, accepted offset, retry state, and error code. The local blob is cleared only after upload succeeds and the app records the Drive receipt.

The feature branch contains a separate authenticated Worker API for resumable PDF/DOCX upload, progress lookup, download, trash, and pending-session cancellation. It checks ownership, file size/type/signature, and SHA-256. The API is draft code and must be deployed and exercised in a non-production environment before it can be used. Do not count an attachment as cloud-saved until Drive and the item manifest both confirm the file ID and checksum.

## Legacy projection and staged migration

1. Keep all existing Vault paths and the old PKM page available.
2. Project supported legacy Markdown, Canvas, and JSON files read-only with stable path-based IDs; ignore the reserved Second Brain namespace.
3. Keep pending outbox writes and deletion tombstones in the current Vault merge flow.
4. Save new or edited second-brain items under the reserved JSON namespace without mutating unrelated legacy records.
5. Before considering a conversion tool, compare old and projected item counts, Markdown content, Canvas/JSON parse errors, wiki-link resolution, and image/document references.
6. Implement export/backup manifest and restore/relink handling on non-production data.
7. Perform any bulk migration only after a recoverable backup and parity report exist. Keep the previous page available until the user explicitly chooses a cutover.

## Backup and recovery

The current backup path is JSON-based. A future second-brain backup must include item/context records and attachment manifests with checksums and Drive IDs; it must not embed document bytes as base64. Restore must verify each Drive reference, mark missing originals, and provide a relink or re-upload path. An independent binary backup is not selected, so full recovery after permanent Drive deletion cannot be promised.

## Current implementation status

- Done in draft branch: versioned item/context validators and Vault repositories, read-only legacy projection, reserved-path exclusion, separate pending-attachment queue, document Worker routes, browser PDF/DOCX text extraction, and the parallel Inbox/Library/Trash preview with context and relation navigation.
- Build: `npm run build` succeeds locally. Existing CSS import-order warnings in the legacy stylesheet remain.
- Not verified: representative browser flows, multi-device sync/conflict, offline queue recovery, upload interruption/resume, near-limit file handling, user-isolation checks against a deployed Worker, Drive disconnect/reconnect, and backup/restore.
- Not done: production migration, cutover, and deployment.

## Next sequence

1. Manually validate the preview with a small synthetic Vault: capture/edit/delete/restore, Area/Project filtering, explicit and wiki relations, backlinks, graph navigation, and legacy path exclusion.
2. Validate sign-in changes and two-user isolation, including clearing stale view state when accounts switch.
3. Exercise PDF/DOCX fixtures (Korean text, scanned PDF, malformed file, and near the 20 MiB cap); verify original retention when extraction fails.
4. Deploy the Worker only to a non-production environment and test upload, interruption/resume, download, trash/restore, quota failure, and cross-user denial.
5. Verify sync, backup manifest, restore/relink, disconnect/reconnect, and old-page compatibility.
6. Publish a parity report and review the rollback path before requesting merge or production deployment.

Do not merge, deploy to production, or migrate user data until the remaining checks pass.
