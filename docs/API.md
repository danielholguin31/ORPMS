# Application API

All paths below are prefixed with `/api`. The React app uses these same endpoints. Resource IDs do not grant access; each read checks current active membership, and each write rechecks access inside the workspace transaction.

## Authentication and requests

- Production: `Authorization: Bearer <Supabase access token>`. Tokens and verified email are checked through Supabase, never decoded as proof of identity on their own.
- Demo: HttpOnly/SameSite session cookie; mutations also require the `/me` response’s `csrfToken` as `X-CSRF-Token`. Development session endpoints are never mounted in Supabase mode.
- JSON bodies use camelCase business fields. PATCH, archive, trash, restore, revoke, comment edits, and comment deletion include integer `expected_version`.
- Every business mutation includes an `Idempotency-Key` of 8–128 characters. Repeat the same key/payload after an uncertain response. Different input with the same key returns 409; receipts expire after 24 hours and are replayed only after current authorization.
- Success: `{ "data": ..., "version": 2 }` for versioned records. Errors: `{ "error": { "code": "VERSION_CONFLICT", "message": "...", "current": {...} } }`; validation can include `fields`.

## Endpoints

| Method/path                              | Behavior                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /config`                            | Public mode and browser-safe Supabase URL/publishable key                                                      |
| `GET /health`                            | Storage readiness; no credentials                                                                              |
| `GET /me`                                | Current member, role, workspace zone; demo-only CSRF/account choices                                           |
| `GET /workspace`                         | Complete small-workspace snapshot; own notifications; admin-only sanitized invite metadata; no receipts/hashes |
| `GET /projects`                          | Paginated projects, derived top-level progress; `archived=true` selects archive                                |
| `GET /projects/:id`                      | Project and derived progress                                                                                   |
| `POST /projects`                         | Name required; outcome, owner, status, start/target optional                                                   |
| `PATCH /projects/:id`                    | Versioned fields; closed projects accept a status-only reopen                                                  |
| `POST /projects/:id/archive`, `/restore` | Admin-only, versioned                                                                                          |
| `GET /tasks`                             | Paginated filters described below                                                                              |
| `GET /tasks/:id`                         | Task, available children, comments/tombstones, chronological activity                                          |
| `POST /tasks`                            | Title and project required; one-level optional parent; no inherited ownership/dates/collaborators              |
| `PATCH /tasks/:id`                       | Versioned fields; project and parent are fixed                                                                 |
| `POST /tasks/:id/trash`                  | Versioned; `scope: "task_and_subtasks"` acknowledges the confirmation scope                                    |
| `POST /tasks/:id/restore`                | Versioned; restores only that task’s deletion batch                                                            |
| `POST /milestones`                       | Project/name required; description/target/sort order optional                                                  |
| `PATCH /milestones/:id`                  | Versioned name/description/target/sort order                                                                   |
| `DELETE /milestones/:id`                 | Versioned; tasks remain ungrouped                                                                              |
| `POST /tasks/:id/comments`               | Plain-text `body` and optional explicit active-member `mentionIds`; independent of task version                |
| `PATCH /comments/:id`                    | Versioned own comment only                                                                                     |
| `DELETE /comments/:id`                   | Versioned own comment; preserves a tombstone                                                                   |
| `GET /notifications`                     | Paginated recipient-only updates                                                                               |
| `POST /notifications/read`               | `{ "ids": ["...UUID..."] }` or `{ "all": true }`; touches only current recipient’s updates                     |
| `POST /invites`                          | Admin-only email/role; seven-day one-use workspace invitation                                                  |
| `GET /invites/:id/link`                  | Admin-only valid invitation link; manual delivery until integration is complete                                |
| `POST /invites/:id/revoke`               | Admin-only and versioned                                                                                       |
| `POST /invites/accept`                   | `{ "token": "..." }`; authenticated verified recipient, membership can be absent/inactive                      |
| `PATCH /members/:id`                     | Admin-only versioned `role`/`active`; last-admin and cleanup rules                                             |
| `PATCH /workspace`                       | Admin-only versioned `timeZone` with IANA validation                                                           |
| `GET /admin/export`                      | Admin business-record JSON download, no credentials/invite hashes/receipts                                     |
| `POST /session/logout`                   | Ends demo session; production sign-out also uses Supabase SDK                                                  |

Paginated reads default to 50, maximum 100, and return `{ data: [...], next_cursor: null | "..." }`. Use the returned cursor unchanged with `cursor`. IDs provide a deterministic stable ordering.

Task filters: `project=<uuid>`, `assignee=me`, `collaborator=me`, `status=todo|in_progress|done|canceled`, `milestone=<uuid>`, `due_group=overdue|today|upcoming|no_date`, `q=<title or UUID>`, `archived=true`, `trash=true`. Ordinary task reads exclude trash and archived projects. My Tasks additionally applies its specified open/completed grouping.

## Status and error rules

Task statuses: `todo`, `in_progress`, `done`, `canceled`. Project statuses: `planned`, `active`, `done`, `canceled`. Absent dates/IDs are `null`, and dates are exactly `YYYY-MM-DD`. Title/name limits are 160 characters; description/comment limits are 20,000. Bodies reject unknown fields.

HTTP: 401 signed out; 403 inactive/nonmember/role/origin/CSRF denial; 404 unavailable record; 409 version or invariant conflict; 422 invalid fields; 429 rate limited; 503 unavailable/failed persistence. Failed mutations roll back data, versions, activity, notifications, and receipts together. A stale record is returned with `VERSION_CONFLICT`; the client retains its draft and offers reload/reapply.

Activity is append-only. A change emits at most one notification per event/recipient, excludes the actor, and preserves assignment/collaborator distinction. Comments do not increment the task’s version or subscribe their authors automatically.
