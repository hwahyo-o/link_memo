# Private Google Drive backend setup

This project keeps Google refresh tokens out of the browser and out of Firestore plaintext. The `driveApi` Firebase HTTPS function stores an AES-GCM encrypted refresh token in the server-only `driveCredentials` collection.

## One-time Google Cloud setup

1. Enable Google Drive API.
2. Create a Web OAuth client and add `https://hwahyo-o.github.io` to Authorized JavaScript origins.
3. Configure the OAuth consent screen with `drive.file`, `openid`, and `email`.
4. Set the GitHub Actions secret `VITE_GOOGLE_OAUTH_CLIENT_ID`.
5. Deploy the Firebase function with these secrets:
   - `DRIVE_CLIENT_ID`
   - `DRIVE_CLIENT_SECRET`
   - `DRIVE_TOKEN_ENCRYPTION_KEY` (32+ random bytes, base64 or passphrase)
6. Set `VITE_DRIVE_BACKEND_URL` to the deployed `driveApi` URL in GitHub Actions Secrets.

## Security

- Do not grant public Drive permissions.
- Do not store a raw access token or refresh token in the frontend or normal Firestore documents.
- The function checks the Firebase user's email against the Google account returned by the code exchange.
- Browser requests use Firebase ID tokens; images are streamed from the function with private cache headers.
