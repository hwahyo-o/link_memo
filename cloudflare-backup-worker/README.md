# Link Memo Cloudflare backup worker

This Worker is the only component allowed to access the private R2 bucket. The browser never receives R2 credentials.

## Dashboard setup

1. In **R2**, create the private bucket `link-memo-backups`. Do not enable public access.
2. In **Workers & Pages**, create a Worker from this directory and bind the bucket as `BACKUPS`.
3. Set Worker variables:
   - `FIREBASE_PROJECT_ID`: the existing Firebase project ID.
   - `ALLOWED_ORIGINS`: comma-separated production and local origins, for example `https://hwahyo-o.github.io,http://localhost:5173`.
4. Deploy the Worker and copy its HTTPS URL.
5. Add its URL to the GitHub repository secret `VITE_BACKUP_WORKER_URL`; the existing Pages workflow must expose that secret at build time.

The Worker verifies Firebase ID tokens, derives the R2 object path from the verified UID, and supports only create/read/delete of that user's objects. It does not list buckets or accept caller-provided object paths.
