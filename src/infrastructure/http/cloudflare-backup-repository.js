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
  const checkpointPath = "/v1/checkpoints/latest";
  return {
    configured: () => Boolean(WORKER_URL),
    upload(user, envelope) { return request("/v1/backups", { method:"POST", user, tokenProvider, body:envelope }); },
    download(user, backupId) { return request(`/v1/backups/${encodeURIComponent(backupId)}`, { user, tokenProvider }); },
    remove(user, backupId) { return request(`/v1/backups/${encodeURIComponent(backupId)}`, { method:"DELETE", user, tokenProvider }); },
    list(user) { return request("/v1/backups", { user, tokenProvider }); },
    loadCheckpoint(user) { return request(checkpointPath, { user, tokenProvider }); },
    saveCheckpoint(user, envelope) { return request(checkpointPath, { method: "POST", user, tokenProvider, body: envelope }); },
    saveCheckpointKeepalive(envelope) {
      const token = tokenProvider?.peekToken?.();
      if (!WORKER_URL || !token) return false;
      const body = JSON.stringify(envelope);
      // Browsers cap all outstanding keepalive request bodies at roughly 64 KiB.
      if (new TextEncoder().encode(body).byteLength > 60 * 1024) return false;
      void fetch(`${WORKER_URL.replace(/\/$/, "")}${checkpointPath}`, {
        method: "POST",
        keepalive: true,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body
      }).catch(() => {});
      return true;
    }
  };
}
