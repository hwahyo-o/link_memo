const WORKER_URL = import.meta.env.VITE_BACKUP_WORKER_URL || "";

async function request(path, options = {}) {
  if (!WORKER_URL) throw new Error("BACKUP_WORKER_URL_MISSING");
  const user = options.user;
  const tokenProvider = options.tokenProvider;
  const token = tokenProvider ? await tokenProvider.getToken() : await user.getIdToken();
  const send = currentToken => fetch(`${WORKER_URL.replace(/\/$/, "")}${path}`, {
    method: options.method || "GET",
    headers: { authorization: `Bearer ${currentToken}`, "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let response = await send(token);
  if (response.status === 401) {
    // Firebase ID tokens expire periodically. Refresh once and retry the same idempotent backup request.
    const refreshedToken = tokenProvider ? await tokenProvider.getToken({ forceRefresh: true }) : await user.getIdToken(true);
    response = await send(refreshedToken);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.code || "BACKUP_REQUEST_FAILED");
  return body;
}

export function createCloudflareBackupRepository({ tokenProvider = null } = {}) {
  return {
    configured: () => Boolean(WORKER_URL),
    upload(user, envelope) { return request("/v1/backups", { method:"POST", user, tokenProvider, body:envelope }); },
    download(user, backupId) { return request(`/v1/backups/${encodeURIComponent(backupId)}`, { user, tokenProvider }); },
    remove(user, backupId) { return request(`/v1/backups/${encodeURIComponent(backupId)}`, { method:"DELETE", user, tokenProvider }); }
  };
}