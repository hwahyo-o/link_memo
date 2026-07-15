const WORKER_URL = import.meta.env.VITE_BACKUP_WORKER_URL || "";

async function request(path, options = {}) {
  if (!WORKER_URL) throw new Error("BACKUP_WORKER_URL_MISSING");
  const user = options.user;
  const token = await user.getIdToken();
  const response = await fetch(`${WORKER_URL.replace(/\/$/, "")}${path}`, {
    method: options.method || "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.code || "BACKUP_REQUEST_FAILED");
  return body;
}

export function createCloudflareBackupRepository() {
  return {
    configured: () => Boolean(WORKER_URL),
    upload(user, envelope) { return request("/v1/backups", { method:"POST", user, body:envelope }); },
    download(user, backupId) { return request(`/v1/backups/${encodeURIComponent(backupId)}`, { user }); },
    remove(user, backupId) { return request(`/v1/backups/${encodeURIComponent(backupId)}`, { method:"DELETE", user }); }
  };
}