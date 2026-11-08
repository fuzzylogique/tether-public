# Auth0 on the dashboard

The web app (`apps/web`) signs people in with Auth0 Universal Login. What it does once a tenant is configured:

- `middleware.ts` redirects every page except `/terms`, `/privacy` and `/auth/*` to `/auth/login` until a session exists.
- `lib/auth0.ts` reads the session; `email_verified` must be true before an email counts for workspace access.
- `lib/data.ts` matches the signed-in person to `users` rows by Auth0 subject or verified email. Rows are created
  from Discord with `/workspace web email:<address>`. The first sign-in binds the Auth0 subject to that row, so later
  logins match on the stable subject even after an email change at the provider.
- Edit rights (integration toggles) come from the workspace's own roles **or** from the Auth0 roles claim
  `https://tether/roles` (an `organizer` or `lead` role assigned in the tenant), so a team can manage access from Auth0 alone.
- Every change made on the web is written to the `events` hypertable with the signer's email.

Without the four env values the dashboard runs in **dev mode**: no login, every workspace visible, a fake `lead`.
That is fine on a laptop and wrong on a public URL, so the Vultr deploy expects them.

## Set up the tenant (10 minutes, no card)

1. https://auth0.com → Sign up (or log in) → create a tenant, region US or CA.
2. Applications → **Create Application** → name `Tether`, type **Regular Web Applications** → Create.
3. On the application's **Settings** tab:
   - **Allowed Callback URLs:** `http://localhost:3000/auth/callback, https://<DOMAIN>/auth/callback`
   - **Allowed Logout URLs:** `http://localhost:3000, https://<DOMAIN>`
   - **Allowed Web Origins:** `http://localhost:3000, https://<DOMAIN>`
   - Save. `<DOMAIN>` is what `infra/deploy.sh` printed (a `*.sslip.io` name unless you gave it a real domain).
4. Copy **Domain**, **Client ID** and **Client Secret** into `.env`:
   ```
   AUTH0_DOMAIN=<tenant>.us.auth0.com
   AUTH0_CLIENT_ID=...
   AUTH0_CLIENT_SECRET=...
   AUTH0_SECRET=<output of: openssl rand -hex 32>
   APP_BASE_URL=http://localhost:3000
   ```
   `infra/deploy.sh` rewrites `APP_BASE_URL` to the VM's https URL; locally it stays localhost.
5. Roles on the token (optional, 3 minutes). User Management → **Roles** → create `organizer` and `lead`, assign
   them to people. Then Actions → **Library** → Build Custom → name `tether-roles`, trigger **Login / Post Login**:
   ```js
   exports.onExecutePostLogin = async (event, api) => {
     api.idToken.setCustomClaim("https://tether/roles", event.authorization?.roles ?? []);
   };
   ```
   Deploy it, then Actions → **Triggers** → post-login → drag `tether-roles` into the flow → Apply.
6. Restart `pnpm dev:web`. The nav shows **Sign in**; after Universal Login the overview lists only the workspaces
   whose `users` row carries your verified email (grant one with `/workspace web email:` in Discord).

## Checks

- `pnpm env:check` prints `Auth0: configured (<tenant>)` once the four values are set.
- A fresh browser hitting `/` is redirected to Auth0; `/terms` is not.
- Toggle an integration on the web, then `/integrations status` in Discord shows the change, and the `events`
  row for it carries your email under `data.by`.
