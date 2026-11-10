# Second Brain Storage and Offline Policy

## Status

Planning policy for the staged second-brain replacement. Confirmed product choices: private Google Drive for document binaries, PDF/DOCX up to 20 MiB per file, and no additional recurring cost. No production code or user files are changed by this document.

## Storage principles

- Store document binaries in a private, per-user Google Drive folder managed by the app.
- Keep metadata, checksums, and attachment references in the existing Vault/Firestore and Cloudflare JSON backup flows.
- Do not duplicate document binaries into R2 during the first release.
- Do not request a paid Google One plan or Cloudflare plan upgrade as part of normal product use.
- Never label an attachment cloud-saved until Drive confirms the uploaded file and the app has stored its file ID and checksum.

## Confirmed upload limits

- PDF and DOCX: maximum 20 MiB per file.
- TXT and MD: continue to follow the current Vault text limit until a separate extraction and text-size policy is designed.
- Uploads must enforce both filename extension and MIME validation. The server must verify the bytes and not trust browser-provided MIME metadata alone.
- Reject larger files before upload and show the current limit in the picker and error message.
- Enforce the limit in the client for quick feedback and again in the authenticated Worker.

## Drive quota behavior

Google Account storage can vary by account. Google's help states that a personal Google Account includes up to 15 GB shared across Gmail, Drive, and Google Photos; Workspace, promotional, and paid accounts can differ. Google also says that an account over quota cannot upload new files to Drive. See [How your Google storage works](https://support.google.com/drive/answer/9312312?hl=en).

Therefore:

- Do not advertise “15 GB for this app” or reserve that amount for Second Brain.
- Do not invent an app-wide aggregate quota that may conflict with the user's other Google storage.
- Use Drive's upload result as the authority for whether a file can be stored.
- Show Drive-full or quota errors distinctly, keep the local pending state, and provide a retry action after the user frees space.
- If the currently approved OAuth scope cannot safely provide an exact available-storage meter, do not display a fabricated remaining-space figure. Show connection and upload status instead.
- Do not disable notes, links, tags, or metadata capture when a document upload is blocked.

## Offline and disconnected behavior

Use explicit attachment states:

1. **기기에서 대기 중** — metadata and binary are saved in the local attachment queue, but Drive has not confirmed the file.
2. **업로드 중** — the authenticated worker is transferring the file.
3. **클라우드에 저장됨** — Drive confirmed the file, and the app persisted its file ID and checksum.
4. **업로드 실패** — the local retry record remains; show a clear reason when known and an explicit retry action.
5. **원본 파일을 찾을 수 없음** — metadata references a file ID that Drive no longer returns; preserve the record and allow relinking or re-upload.

Rules:

- If offline or Drive is disconnected, keep an attachment in the persistent local queue when browser storage accepts it. Do not report it as synced or available on other devices.
- If browser storage refuses the binary, keep the knowledge item and show that the attachment itself was not saved. Keep the file picker open or offer immediate retry; never imply the original is safe.
- Retry queued files after connection returns, using a stable attachment ID and checksum so retries do not create duplicate Drive objects.
- Remove a temporary upload blob from the queue only after Drive confirms the object and local metadata is updated.
- Cross-device access requires Drive upload completion. Offline reading of an already uploaded document is not guaranteed unless the user explicitly keeps a local copy; this is outside the initial MVP.
- If the Drive account is disconnected after upload, retain metadata and file IDs. Offer reconnect; do not silently delete local metadata or remote files.
- Removing Drive credentials must not cascade-delete document ownership rows or the document-folder reference. Reconnection to the same verified Google account must restore access to existing uploads. Full account-data deletion remains a separate explicit cleanup that removes the user's document rows and Drive files.

## Transfer path

The existing Worker accepts image MIME types only and handles a file through an image-specific route. Preserve that route for existing images.

Add a separate authenticated document upload/download route with:

- per-user authorization from the Firebase ID token;
- strict PDF and DOCX type and 20 MiB size checks;
- a private, app-managed Drive folder separate from the image folder;
- server-side filename normalization;
- Drive resumable sessions with 2 MiB upload chunks and an endpoint that can query the accepted byte offset after interruption;
- a stable attachment ID and client SHA-256 on session creation so repeated starts reuse the same session or completed file;
- server-side SHA-256 verification of the completed Drive object before recording it as uploaded;
- per-user checks on download and delete;
- clear errors for quota, expired authentication, missing file, and transient network failure.

Draft API shape on the feature branch:

- `POST /documents/uploads` — start or retrieve an idempotent upload session. JSON fields: `attachmentId`, `name`, `mimeType`, `size`, `checksumSha256`.
- `PUT /documents/uploads/{uploadId}` — send one binary chunk with `Content-Range`.
- `GET /documents/uploads/{uploadId}` — query Drive's accepted offset or finish local receipt persistence if Drive completed before a connection was lost.
- `DELETE /documents/uploads/{uploadId}` — cancel a pending session.
- `GET /documents/{fileId}` and `DELETE /documents/{fileId}` — read or trash a file after checking its per-user ownership record.
- `POST /documents/{fileId}/restore` — restore a trashed file while its attachment tombstone and ownership record are retained.

The Worker performs a server-side SHA-256 readback after Drive completes the upload. This adds a download pass for each new file, so validate its memory and execution behavior with a file near the 20 MiB cap before release. The route is draft code only; it has not been deployed.

Google recommends resumable uploads for files above 5 MB and for mobile or interruption-prone networks. See [Google Drive upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

Cloudflare documents that request body limits depend on the account's domain plan, with 100 MB for Free and Pro plans, and a 413 response above the limit. See [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/). The selected 20 MiB cap is below the documented Free/Pro request-body limit, but the project's active route/plan must still be confirmed before rollout.

## Deletion and recovery

- A user delete first writes a Vault tombstone and hides the attachment from normal views.
- The Worker verifies ownership before moving the app-owned Drive file to Drive Trash.
- Keep the tombstone and provider file ID for restore/reconciliation; do not permanently erase the Drive object as part of the initial delete request.
- Backup payloads include item metadata, attachment manifest, checksum, and Drive file ID, but never the binary bytes.
- Restore verifies Drive references and marks missing originals; it does not silently fabricate files or drop metadata.
- A future permanent purge flow must be a separate, explicit action with a retention policy.

## Error and status copy

- Over size: “이 파일은 20MiB를 초과해 첨부할 수 없습니다.”
- Offline/Drive unavailable: “이 기기에서 업로드를 기다리는 중입니다. Drive에 저장될 때까지 다른 기기에서는 열 수 없습니다.”
- Browser could not store pending binary: “첨부 파일을 이 기기에 보관하지 못했습니다. 다시 선택해 저장해 주세요.”
- Drive quota full: “Google Drive 저장공간이 부족해 업로드하지 못했습니다. 공간을 확보한 뒤 다시 시도해 주세요.”
- Drive object missing: “Drive에서 원본 파일을 찾지 못했습니다. 다시 연결하거나 파일을 다시 첨부해 주세요.”

## Release checks

Before rollout:

- Confirm the deployed Drive Worker domain is covered by the expected request-body plan limit.
- Verify an upload slightly below 20 MiB, a rejected file above 20 MiB, and interruption/resume behavior.
- Confirm quota failures preserve local queue data and show the correct state.
- Confirm a logged-in user cannot fetch, delete, or overwrite another UID's attachment.
- Confirm Drive object IDs and checksums survive a sync, backup, and metadata restore.
- Confirm disconnect/reconnect retains document ownership and restores access, while explicit account-data deletion removes the user's recorded document objects.
- Confirm the existing image upload and image links are unchanged.
