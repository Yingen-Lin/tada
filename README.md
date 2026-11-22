# TADA

TADA lets each Google account connect multiple Drive folders, refresh and preview photos, and organize them with private tags and collections. Drive access is read-only. New accounts start with an empty library.

[Open TADA](https://tada-yingen.vercel.app/). Google Drive sign-in is currently available to approved test accounts.

## Run locally

Use Node.js 24. Run `npm test` and `npm run build`. Run `npm start` to open the app at http://127.0.0.1:4180/. For local Google sign-in, add `http://127.0.0.1:4180/auth/google/callback` to the TADA OAuth client and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in a local `.env` file. Local library records use a new SQLite database under `.local/`.

## Test deployment

Use a dedicated Vercel project and a new Upstash Redis database. In that project’s Vercel environment settings, set the following values and redeploy.

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | Stable TADA HTTPS origin with no trailing slash |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | TADA’s own Google OAuth web client |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | TADA’s own Upstash Redis REST credentials |
| `SESSION_ENCRYPTION_KEY` | A new 32-byte base64url secret. Generate it with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'` |

In a new Google Cloud project, enable the Google Drive API and configure Google Auth Platform Branding for TADA. In [Audience](https://console.cloud.google.com/auth/audience), choose **External → Testing** and add both test accounts under **Test users**. In [Data Access](https://console.cloud.google.com/auth/scopes), configure `openid`, email, and `https://www.googleapis.com/auth/drive.readonly`. In [Clients](https://console.cloud.google.com/auth/clients), create a **Web application** OAuth client and register the stable TADA origin followed by `/auth/google/callback` under **Authorized redirect URIs**. Add the client secret directly to Vercel’s environment settings. Each test account completes consent in Google. Drive test consent expires after seven days.

## Two-account acceptance test

1. Create two private Drive folders, each with a distinct test image and accessible only to its respective test account.
2. In separate browser profiles, sign in to TADA as account A and account B. Each should see an empty library on first sign-in.
3. In Settings → Folder connections, add each account’s private folder and preview its image. Add a distinct tag and collection in each account. Add a second folder in one account to verify multiple sources.
4. Add an image to each private folder in Google Drive. In TADA, refresh each source and confirm that the new image appears and existing tags remain.
5. Disconnect and sign back in. Confirm that each profile restores its correct folders, photos, tags, and collections. Try pasting account A’s private folder link into account B and verify that access is denied.
6. Open the original Content Studio in its usual profile and verify that it loads separately.

## Public launch

Publish via Google Auth Platform → Audience after preparing the public app homepage, privacy policy and verified domain. Submit the requested Drive scope and its justification for Google’s restricted-scope review. Google requires a security assessment when servers store or transmit data covered by a restricted scope. Once approved and published, users can sign in and consent themselves.

- [Google app audience and testing](https://support.google.com/cloud/answer/15549945)
- [Google Drive scopes and review](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## Team workspaces

After signing in, open the sidebar workspace switcher and choose **Create team workspace**. In **Workspace settings**, the creator can add Drive folders and grant access to a Google email as an Editor or Viewer. The invite adds the workspace to that account's switcher. Share the folders separately in Google Drive. Editors can organize existing photos with workspace tags and collections, and Viewers can browse. Workspace edits and personal-library edits are stored separately, even for the same Drive file.

To test this branch with real Google accounts on Vercel, set `TADA_PREVIEW_DATABASE_URL` to the connection string for a separate Neon database in Preview, scoped to the `team-workspace` Git branch. Also configure a separate session key, a stable Preview origin as `APP_ORIGIN`, and a Google OAuth client whose allowed callback is that origin followed by `/auth/google/callback`. Keep your Preview credentials separate from the Production variables. The automated tests use simulated Google accounts and Drive files.
