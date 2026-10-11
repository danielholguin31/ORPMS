# Application API

All paths below are prefixed with `/api`. The React app uses these same endpoints. Resource IDs do not grant access; each read checks current active membership, and each write rechecks access inside the workspace transaction.

## Authentication and requests

- Production: `Authorization: Bearer <Supabase access token>`. Tokens and verified email are checked through Supabase, never decoded as proof of identity on their own.
- Read/write limits are separate per IP: 1,200 reads and 300 writes per minute; sign-in/invite acceptance uses 30 attempts per five minutes. The limiter is process-local; see `docs/OPERATIONS.md` for multi-instance hosting.
- Demo: HttpOnly/SameSite session cookie; mutations also require the `/me` response’s `csrfToken` as `X-CSRF-Token`. Development session endpoints are never mounted in Supabase mode.
- JSON bodies use camelCase business fields. PATCH, archive, trash, restore, revoke, comment edits, and comment deletion include integer `expected_version`.
- Every business mutation includes an `Idempotency-Key` of 8–128 characters. Repeat the same key/payload after an uncertain response. Different input with the same key returns 409; receipts expire after 24 hours and are replayed only after current authorization.
- Success: `{ "data": ..., "version": 2 }` for versioned records. Errors: `{ "error": { "code": "VERSION_CONFLICT", "message": "...", "current": {...} } }`; validation can include `fields`.

## Endpoints

| Method/path                              | Behavior                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /config`                            | Public mode and browser-safe Supabase URL/publishable key                                                                 |
| `GET /health`                            | Storage readiness; no credentials                                                                                         |
| `GET /me`                                | Current member, role, workspace zone; demo-only CSRF/account choices                                                      |
| `GET /workspace`                         | Complete small-workspace snapshot; own notifications; admin-only sanitized invite metadata; no receipts/hashes            |
| `GET /projects`                          | Paginated projects and progress; `view=active                                                                             | completed | archived | all` |
| `GET /projects/:id`                      | Project, top-level progress, and ordered milestones with progress                                                         |
| `POST /projects`                         | Name required; outcome, owner, status, start/target optional                                                              |
| `PATCH /projects/:id`                    | Versioned fields; closed projects accept a status-only reopen                                                             |
| `POST /projects/:id/archive`, `/restore` | Admin-only, versioned                                                                                                     |
| `GET /tasks`                             | Paginated filters described below                                                                                         |
| `GET /tasks/:id`                         | Task, project, parent, children, comments/tombstones, activity, milestones, and blocker candidates                        |
| `GET /tasks/:id/link`                    | Validated link from the configured application origin; trashed tasks are unavailable                                      |
| `GET /search`                            | Server search by title, UUID, or task code; `q`, optional `limit` (maximum 30); includes archived work and excludes trash |
| `GET /members`                           | Paginated membership records; optional `active=true                                                                       | false`    |
| `GET /milestones`                        | Paginated milestones; optional `project=<uuid>`                                                                           |
| `GET /trash`                             | Paginated tasks, grouped by deletion batch so included subtasks appear under their parent                                 |
| `GET /invites`                           | Admin-only sanitized invitations; `pending=true` excludes accepted/revoked invitations                                    |
| `GET /workspace/settings`                | Current workspace name, time zone, and version                                                                            |
| `POST /tasks`                            | Title and project required; one-level optional parent; no inherited ownership/dates/collaborators                         |
| `PATCH /tasks/:id`                       | Versioned fields; project and parent are fixed                                                                            |
| `POST /tasks/:id/trash`                  | Versioned; `scope: "task_and_subtasks"` acknowledges the confirmation scope                                               |
| `POST /tasks/:id/restore`                | Versioned; restores only that task’s deletion batch                                                                       |
| `POST /milestones`                       | Project/name required; description/target/sort order optional                                                             |
| `PATCH /milestones/:id`                  | Versioned name/description/target/sort order                                                                              |
| `DELETE /milestones/:id`                 | Versioned; tasks remain ungrouped                                                                                         |
| `POST /tasks/:id/comments`               | Plain-text `body` and optional explicit active-member `mentionIds`; independent of task version                           |
| `PATCH /comments/:id`                    | Versioned own comment only                                                                                                |
| `DELETE /comments/:id`                   | Versioned own comment; preserves a tombstone                                                                              |
| `GET /notifications`                     | Paginated recipient-only updates; `read=unread                                                                            | read      | all`     |
| `POST /notifications/read`               | `{ "ids": ["...UUID..."] }` or `{ "all": true }`; touches only current recipient’s updates                                |
| `POST /invites`                          | Admin-only email/role; seven-day one-use workspace invitation                                                             |
| `GET /invites/:id/link`                  | Admin-only valid invitation link; manual delivery until integration is complete                                           |
| `POST /invites/:id/revoke`               | Admin-only and versioned                                                                                                  |
| `POST /invites/accept`                   | `{ "token": "..." }`; authenticated verified recipient, membership can be absent/inactive                                 |
| `PATCH /members/:id`                     | Admin-only versioned `role`/`active`; last-admin and cleanup rules                                                        |
| `PATCH /workspace`                       | Admin-only versioned `timeZone` with IANA validation                                                                      |
| `GET /admin/export`                      | Admin business-record JSON download, no credentials/invite hashes/receipts                                                |
| `POST /session/login`                    | Public, rate-limited sign-in link request; email required, same-origin redirect path; managed signup disabled             |
| `POST /session/logout`                   | Ends the demo session or revokes the current managed refresh session; the client clears its auth state                    |

Paginated reads default to 50, maximum 100, and return `{ data: [...], next_cursor: null | "..." }`. Use the returned cursor unchanged with `cursor`. IDs provide a deterministic stable ordering.

Task filters: `project=<uuid>`, `assignee=me|unassigned|<member uuid>`, `collaborator=me|<member uuid>`, `status=todo|in_progress|done|canceled|open|not_canceled|all`, `milestone=<uuid>|none`, `due_group=overdue|today|upcoming|no_date`, `q=<title, UUID, or OR-code>`, `top_level=true`, `archived=true`, `trash=true`. `view=assigned|collaborating|completed` implements My Tasks ownership and open/completed rules on the server. `open` means todo/in progress; `not_canceled` also includes done and is the default project view. Ordinary task reads exclude trash and archived projects. Invalid filter values and unknown fields return 422.

The frontend loads each visible view from these resource routes. The workspace snapshot supplies shared member names/relationships and invalidates visible queries after writes and polling. Query errors keep the last loaded records and expose Retry; a failed first read never appears as a successful empty result. Collections follow every pagination cursor. Filters and list/board choices live in the browser URL, so they survive reload and can be shared. Search requests are debounced and superseded reads are canceled. Previously visited views remain readable offline using successful in-memory API responses scoped to the signed-in member. Logout clears this cache and unsent task drafts.

Frontend route coverage:

| UI                             | Read routes                                                                     | Mutation routes                                                      |
| ------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| My Tasks                       | `/tasks?view=…`                                                                 | `/tasks`, `/tasks/:id`                                               |
| Projects                       | `/projects?view=…`                                                              | `/projects`, `/projects/:id`, archive/restore                        |
| Project list/board and filters | `/projects/:id`, `/tasks?project=…&top_level=true&…`                            | task PATCH for drag/status; milestone create/PATCH/delete            |
| Task panel                     | `/tasks/:id`, `/tasks/:id/link`                                                 | task PATCH, subtask create, trash, comment create/PATCH/delete       |
| Creation forms                 | `/projects?view=active`, `/members?active=true`, `/milestones?project=…`        | Project/task/milestone create or PATCH                               |
| Search                         | `/search?q=…`                                                                   | Opens the resource route                                             |
| Notifications                  | `/notifications?read=…`                                                         | `/notifications/read`                                                |
| Trash                          | `/trash`                                                                        | `/tasks/:id/restore`                                                 |
| Settings                       | `/members`, `/invites?pending=true`, `/workspace/settings`, invite link, export | member PATCH, invitation create/revoke, workspace PATCH              |
| Auth and invite acceptance     | `/config`, `/me`, demo accounts                                                 | `/session/login`, `/session/logout`, demo session, `/invites/accept` |

Opening dialogs, keyboard shortcuts, copying to the clipboard, and formatting records remain ordinary browser interactions. All data reads and business changes go through the authenticated API. Supabase still requires the configuration in `docs/SEBASTIAN_HANDOFF.md` before production activation.

## Status and error rules

Task statuses: `todo`, `in_progress`, `done`, `canceled`. Project statuses: `planned`, `active`, `done`, `canceled`. Absent dates/IDs are `null`, and dates are exactly `YYYY-MM-DD`. Title/name limits are 160 characters; description/comment limits are 20,000. Bodies reject unknown fields.

HTTP: 401 signed out; 403 inactive/nonmember/role/origin/CSRF denial; 404 unavailable record; 409 version or invariant conflict; 422 invalid fields; 429 rate limited; 503 unavailable/failed persistence. Failed mutations roll back data, versions, activity, notifications, and receipts together. A stale record is returned with `VERSION_CONFLICT`; the client retains its draft and offers reload/reapply.

Activity is append-only. A change emits at most one notification per event/recipient, excludes the actor, and preserves assignment/collaborator distinction. Comments do not increment the task’s version or subscribe their authors automatically.
