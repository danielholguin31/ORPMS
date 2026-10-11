# Supabase integration handoff

The application and its domain rules run today in development. The Postgres adapter, schema, runtime permissions, Supabase bearer-token verification, and frontend sign-in path are implemented. No hosted database or authentication project was available during the build, so activation and provider-specific acceptance remain open.

## Remaining work

| Marker           | Sebastián completes                                                                                                                                       | Where                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **SEBASTIAN-01** | Create separate development/production Supabase projects; run migrations; choose the workspace zone and first verified admin; create the runtime DB login | `.env.example`, `supabase/migrations/`, `supabase/bootstrap.sql`, `server/store/postgres.ts` |
| **SEBASTIAN-02** | Configure managed auth, redirect allowlist, production SMTP, account provisioning, and invite/login rate limits                                           | `client/api.ts`, `client/App.tsx` (`SignIn`), `server/app.ts` (Supabase `getUser`)           |
| **SEBASTIAN-03** | Add invitation email delivery and new-account provisioning; keep email-bound, one-use, seven-day workspace invites                                        | `server/app.ts` (`/invites/:id/link`), `client/workspace-views.tsx`, `server/domain.ts`      |
| **SEBASTIAN-04** | Pick company-approved Node hosting, HTTPS origin, secret storage, reverse proxy settings, and production monitoring                                       | `server/config.ts`, `server/index.ts`, `.env.example`                                        |
| **SEBASTIAN-05** | Configure daily backups with at least seven days of retention and execute a recovery drill in a separate database                                         | `docs/OPERATIONS.md`                                                                         |
| **SEBASTIAN-06** | Run the real two-account Supabase pilot; verify unauthorized/denied access and production invariants                                                      | `tests/`, checklist below                                                                    |

Search the repository for `SEBASTIAN-` to find the configuration and code notes. These markers describe incomplete integration work; they are not fake implementations or success responses.

## 1. Database and first admin

1. Create a Supabase **development** project first. Keep production separate. Use the provider’s direct connection or **session-mode pooler** for the long-lived Node `pg` pool. Do not use the transaction pooler for this first integration pass.
2. Configure the migration owner’s `DATABASE_URL` and trusted `DATABASE_CA_FILE` if needed, then run `npm run db:migrate` from the repository root. The migration runner records checksums in `openrange.schema_migrations`, applies files in order, and rejects edits to applied files. TLS verification remains enabled. The script loads `.env`; use the owner connection for migration, then switch to the runtime connection before starting the app.
3. The migrations create a private `openrange` schema. Leave this schema out of Supabase’s exposed REST schemas. Browser roles `anon` and `authenticated` receive no access. The `openrange_app` NOLOGIN role has only the runtime table privileges and RLS policies it needs. There are no hard-delete grants for tasks, projects, members, or comments, and no update/delete grants for activity.
4. Create a runtime **LOGIN** role and grant it `openrange_app`. Give its password to the deployment secret manager, never a browser environment variable. For example, as the migration owner:

```sql
-- Replace both identifiers/password in the provider console; do not save the password in Git.
create role orpms_runtime login password '<GENERATED_SERVER_ONLY_PASSWORD>' inherit;
grant openrange_app to orpms_runtime;
```

Use that login’s connection string as the application’s `DATABASE_URL`. Check the actual privileges with that login; do not run the application under the migration owner. If your Supabase connection mode cannot use the dedicated login, resolve that with the provider rather than granting browser roles access.

5. Create the first individual user in Supabase Auth, verify their email, and obtain their Auth UUID. Choose a workspace UUID and IANA zone with the team. Fill every placeholder in `supabase/bootstrap.sql` and execute it once as the migration owner. This creates the workspace, profile, and single first admin, with **no production projects or tasks**. Bootstrap refuses an existing workspace or unverified user.
6. Set `WORKSPACE_ID` to the bootstrap UUID. The application reads one workspace and never admits people based on an email domain.

## 2. Authentication

Set these values for the Node deployment:

```dotenv
APP_MODE=supabase
APP_ORIGIN=https://<APP_HOST>
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_OR_ANON_KEY>
DATABASE_URL=<RUNTIME_LOGIN_CONNECTION_STRING>
WORKSPACE_ID=<BOOTSTRAPPED_WORKSPACE_UUID>
INVITE_SIGNING_SECRET=<AT_LEAST_32_RANDOM_CHARACTERS>
```

Generate the signing secret using your secret manager. Keep it stable; changing it invalidates pending invitation links. `DATABASE_CA_FILE` is optional only when the certificate already chains to a trusted CA. Do not disable certificate verification.

The frontend obtains only the public Supabase URL/key from `/api/config`. It stores an ordinary Supabase auth session and sends a bearer token to the API. The API verifies it with Supabase `getUser()` on every request, requires a verified email, and checks active membership from the current database state. It ignores browser-supplied roles and identity fields. Production uses bearer authentication, so mutations do not rely on cross-site cookies. Development uses HttpOnly/SameSite cookies plus CSRF headers and is disabled under `NODE_ENV=production`.

Configure the Site URL and redirect allowlist for the actual app domain. Permit `/invite/*` redirects for invitation acceptance. Configure production SMTP and Supabase auth rate limits. The sign-in form calls `/api/session/login`; the backend calls `signInWithOtp` with `shouldCreateUser: false`: **users must be provisioned in managed Auth first**. An auth account by itself gives no workspace access.

## 3. Invitation delivery placeholder

Today, an admin creates a workspace invitation and copies its email-bound link. The UI asks the admin to share the invitation link; it does not claim to send invitation mail. Tokens are derived from the server signing secret, stored only as hashes in the invite table, omitted from exports and receipts, and checked for recipient email, expiration, revocation, and prior acceptance. Accepting a valid invite creates/reactivates membership using the verified Auth user ID.

Until you implement delivery, provision the invited account through Supabase’s managed administration and share the link manually with its recipient. Never enable automatic workspace membership or open email-domain admission.

For delivery, implement a durable mail outbox with a unique invitation/event key, provision new users through a **server-only** Supabase admin client, and send a transactional invite containing the workspace link. Persist a delivery state separate from the invitation’s accepted state. Do not report an email as delivered when only the database write succeeds. Retry uncertain sends using the provider’s idempotency mechanism where available. Add tests for existing accounts, new accounts, delayed mail, expired/revoked invites, and wrong-email sign-in before changing the invitation flow to email delivery. No service-role key belongs in `client/` or a `VITE_` variable.

## 4. Hosting and operational limits

```sh
npm ci
npm run check
npm run build
npm start
```

The Node server serves `dist/client` and `/api` from the same HTTPS origin in production. Use a Node-compatible host, not a static-only host. Demo mode cannot start with production NODE_ENV. Health checks use `/api/health`; startup refuses missing configuration or an unbootstrapped workspace.

The API’s default in-memory rate limiter is useful for development and a single process. **Replace it with a shared, provider-backed limit before scaling to multiple instances**, and configure only the actual trusted proxy hop count. Review proxy access logs so invite tokens and Authorization headers are not recorded. Application error logs contain a request ID, not request bodies or provider secrets.

Visible views refresh every five seconds and on focus/reconnect/writes. There are no websocket dependencies or offline write queues. The `/api/workspace` snapshot is intentionally a complete small-workspace projection; paginated task/project endpoints already exist. If the workspace grows enough that full snapshots become expensive, wire those paginated reads into the frontend before expanding the pilot. The application serializes workspace writes for simplicity and is not designed for extreme write throughput.

## 5. Integration acceptance before real work

- Two separate **Supabase-authenticated** people can create/edit one project; the second sees accepted writes in ten seconds; refresh/new devices retain records.
- Forged/expired tokens, a verified nonmember, a deactivated user, and member attempts at admin endpoints fail. Direct browser-role SQL/REST access remains denied.
- Test email-bound invitations for new/existing users, revocation, expiry, reuse, and verified-email mismatch. Last-admin protections must survive simultaneous changes.
- Confirm parent/child races, cyclic blockers, milestone/project progress, date-only values across zone/DST boundaries, version conflicts, retry idempotency, and archived/closed write rejection against the hosted database.
- Check trash batch restoration, historical attribution after deactivation, notification deduplication/recipient isolation, and comment tombstones.
- Verify keyboard-only flows and 390 px flows with actual production auth and a screen reader. Automated accessibility checks cover project and mobile task views; they do not replace manual assistive-technology review.
- Complete the backup restoration drill in `OPERATIONS.md`, verify counts/representative records, and record the recovery result.
- Name the maintainer and product reviewer. Obtain pilot acceptance before introducing real team work or expanding access.

Automated tests validate the domain and HTTP service, both migrations and runtime grants on embedded Postgres, and browser workflows in development mode. **A live Supabase integration or provider backup restoration has not been verified.**
