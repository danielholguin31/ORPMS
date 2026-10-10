# Openrange Project Manager

A shared project manager built from the Openrange specification: a React/TypeScript frontend, an Express API, and a Supabase/Postgres integration path.

## Run it

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Development explicitly uses fictional accounts and sample work. Data lives on the server in `.data/dev-workspace.json`, so separate browser sessions share saved records. Settings → Members lets you switch demo accounts. The demo adapter is single-process development storage and refuses to run with `NODE_ENV=production`.

## Included

See [desktop and mobile previews](docs/UI_PREVIEW.md).

- My Tasks with assigned, collaborating, and completed views; project rows, milestone grouping, list and board views.
- Direct task/project URLs, desktop task panel, mobile task pages, command search, keyboard creation, accessible dialogs and navigation.
- One assignee, explicit collaborators, one level of subtasks, date-only targets, advisory blockers, comments, mentions, chronological activity, and recipient-only notifications.
- Server validation, workspace/role checks, record versions, conflict recovery, 24-hour idempotency receipts, soft trash/restore batches, archive/restore, member deactivation, last-admin protection, and admin JSON export.
- Normalized private Postgres schema, workspace transaction locks, relational and deferred rule checks, append-only activity, RLS, and a limited runtime role.
- Supabase token verification and passwordless sign-in for provisioned accounts. Activation requires the setup below.

## Sebastián’s integration handoff

Start with **[docs/SEBASTIAN_HANDOFF.md](docs/SEBASTIAN_HANDOFF.md)**. It maps each remaining setup task to its exact code/configuration location and includes bootstrap and deployment steps.

**Not activated:** a real Supabase project, production authentication/SMTP, invitation email delivery, hosting, provider backups, and a real recovery drill. The runnable demo does not satisfy the production multiplayer release gate. Production starts with zero tasks/projects; sample records are never inserted by migrations.

Configuration placeholders are in [.env.example](.env.example) and [supabase/bootstrap.sql](supabase/bootstrap.sql). Never commit an environment file or database credentials. The browser receives only the Supabase URL and publishable key; membership and role decisions remain on the server.

## Validate and build

```sh
npm run check       # TypeScript, domain/API tests, and migrations on embedded Postgres
npm run test:e2e    # Browser workflows and WCAG A/AA checks
npm run build      # dist/client + dist/server
```

The browser suite uses an isolated demo API on port 3002 and web server on 5180. Install Chromium with `npx playwright install chromium` when it is not already present. Tests do not touch Supabase or production records.

For a built local demo: `npm run start:demo`, then open http://localhost:3001. For production, configure `.env` following the handoff and run `npm start`.

## Structure

| Path                   | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `client/`              | React views, API client, conflict-preserving forms, responsive styling |
| `shared/`              | Types, progress and workspace-date calculations                        |
| `server/domain.ts`     | Validated transactional mutations and deterministic rules              |
| `server/app.ts`        | Authenticated HTTP endpoints and development sessions                  |
| `server/store/`        | Development persistence and normalized Postgres adapter                |
| `supabase/migrations/` | Versioned schema and runtime permissions                               |
| `docs/`                | Integration handoff, API contract, operations, and visual previews     |
| `tests/`               | Domain, API, database, and browser acceptance coverage                 |

The design uses the specification’s warm neutral palette, blue selection, Geist type, thin separators, and compact rows. The actual mark comes from https://openrange.live/logo.png. The requested Apple UI and antislop skill packages were unavailable in the build environment; this implementation follows the specification’s visual direction directly.
