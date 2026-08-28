# Google and GitHub-only login

OpenClasp now renders only Google and GitHub login buttons. The backend does not support an
OpenClasp email/password login.

## One-time provider setup

1. In the Descope Console for the OpenClasp project, add `https://openclasp.vercel.app` under
   **Settings → Project → Approved Domains**.
2. Go to **Settings → Authentication Methods → Social Login**. Enable Google and GitHub and keep
   **Enable method in API and SDK** on; the web application starts the social OAuth flow directly.
3. For production, choose **Use my own account** for each provider and paste credentials from the
   provider applications below. Descope's defaults are suitable only for limited testing.
4. Do not add email OTP, magic-link, password, passkey, or SSO actions to the project login flow.

## Google OAuth application

1. In Google Cloud Console, create an OAuth client for a web application called OpenClasp.
2. Add `https://openclasp.vercel.app` as an authorized JavaScript origin.
3. In Descope's Google provider configuration, copy the exact **OAuth Callback URL** into Google as
   an authorized redirect URI. Without a custom Descope domain this is normally
   `https://api.descope.com/v1/oauth/callback`.
4. Copy the Google client ID and client secret back into Descope, then save.

## GitHub OAuth application

1. In GitHub **Settings → Developer settings → OAuth Apps**, create an OAuth App named OpenClasp.
2. Set Homepage URL to `https://openclasp.vercel.app`.
3. Set Authorization callback URL to `https://api.descope.com/v1/oauth/callback`.
4. Generate a client secret. In Descope's GitHub provider select **Use my own account** and paste
   the client ID and secret. Request only `user:email` if you need an email attribute.

## Test

Open `https://openclasp.vercel.app/login`. Test Google and GitHub in separate private browser
windows. Both should return to `/dashboard?code=...`; the app exchanges the one-time code and
removes it from the address bar. A disabled or misconfigured provider shows a clear error.

References: [Descope social login settings](https://docs.descope.com/auth-methods/oauth/settings),
[Google setup](https://docs.descope.com/auth-methods/oauth/providers/setting-up-your-own-apps/google),
and [GitHub setup](https://docs.descope.com/auth-methods/oauth/providers/setting-up-your-own-apps/github).
