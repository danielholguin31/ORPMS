# Operations and recovery

**SEBASTIAN-04 / SEBASTIAN-05:** This document is the implementation handoff, not a record of a completed production deployment or restore. Fill in the real maintainer, host, provider projects, alert route, and backup/recovery results before pilot approval.

| Decision/record                    | Placeholder                                |
| ---------------------------------- | ------------------------------------------ |
| Maintainer / backup owner          | `__SEBASTIAN_MAINTAINER__`                 |
| Product reviewer                   | `__SEBASTIAN_PRODUCT_REVIEWER__`           |
| Development project                | `__SEBASTIAN_DEV_SUPABASE_REF__`           |
| Production project / host          | `__SEBASTIAN_PROD_SUPABASE_REF_AND_HOST__` |
| Alert channel                      | `__SEBASTIAN_PROVIDER_ALERT_ROUTE__`       |
| Last successful restore / evidence | `__SEBASTIAN_RESTORE_RESULT__`             |

## Deploy and monitor

Run checks/build from a clean lockfile install. Apply migrations with the owner connection, then deploy the Node app using the limited runtime connection. Keep `.env`/credential files in secret management, outside Git and frontend bundles. Confirm `/api/health`, real managed-auth sign-in, current membership checks, and HTTPS before the two-account pilot.

Track health failures, database connection saturation, failed saves, invitation delivery failures once delivery is implemented, auth-denied/rate-limit spikes, and provider backup failures. Application errors identify a request with `X-Request-ID` and do not dump credentials or request bodies. Review the host’s logs/proxy settings separately; URLs under `/invite/` contain one-use tokens.

For more than one API process, replace the process-local rate limiter with a shared limiter. Database mutations already serialize on `pg_advisory_xact_lock(hashtextextended(workspace_id::text,0))`. Operators writing directly to SQL should acquire that lock **before** editing rows and keep the work in one transaction. The triggers also lock and reject invalid final states; a conflicting direct writer can still be aborted by PostgreSQL and must retry.

## Backups

Configure provider-backed **daily backups with at least seven days of retention**. Confirm that the selected plan actually includes the required features. Include application schema, profiles/member identity mapping, managed Auth recovery requirements, roles/grants, and migration history in the recovery plan. Keep any additional backup credentials outside the application account.

The admin JSON export is a business-record exit path, not the operational backup. It includes work records, comments/tombstones, audit history, notifications, memberships, and sanitized invite metadata. It intentionally omits tokens and receipts. Pending invites must be reissued after an export-only recovery; auth accounts and credentials are recovered/provisioned separately.

## Recovery drill before pilot

1. Record workspace/task/comment/membership counts and representative records. Include deleted tasks, one parent deletion batch, a comment tombstone, and historical completed-task attribution.
2. Restore a provider backup into a **separate** database/project. Keep its app origin, credentials, and outbound email isolated from production. Apply/verify schema history and runtime-role grants.
3. Point a separate Node deployment at the restored workspace, using the restored/auth-reconciled verified users and a test origin. Compare counts and the representative relationships, dates, and versions.
4. Verify sign-in, denied access, one successful mutation, parent/child rules, trash restoration, export, and visibility in a second account. Confirm all writes affect the restored environment only.
5. Record elapsed recovery time, data cutoff, discrepancies, remediation, owner, and date in the table above. Re-run the drill after a material migration/provider change.

The automated development test reopens server file storage and verifies a saved change remains. Embedded Postgres tests validate the migrations, runtime privileges, and transactions. Neither test establishes a successful provider backup restoration.

## Migrations and rollback

`npm run db:migrate` applies ordered files transactionally and stores their SHA-256 checksums. Never edit a file already applied to a real database: add a new forward migration. The initial migration pair must be applied before bootstrapping the workspace. Runtime code never auto-migrates or auto-creates real work records.

Before upgrading, take/verify a backup and test the migration on a restored development copy. Prefer backward-compatible migrations and roll back the **application version** while keeping compatible schema changes. If a schema change cannot support the prior app, stop writes and use a reviewed corrective migration or restore to a separate database, reconcile data, and cut over deliberately. Do not drop `openrange` as a routine rollback; it contains the work and audit history. No irreversible down-migration script is provided for business records.

## Common failure handling

- Missing configuration/bootstrap: startup fails, or health returns unavailable. Complete the handoff; the server never substitutes demo authentication in production.
- Failed/uncertain save: the UI shows failure and preserves text. Retry the original payload with the same idempotency key within 24 hours. Do not create a new task/comment as a workaround for an uncertain response.
- Version conflict: reload current data or explicitly reapply the preserved draft. Do not weaken version checks or silently merge.
- Offline: reads can remain visible in the open tab; writes are disabled and unsent text remains in memory. There is no offline queue and a browser reload can lose unsent text.
- Deactivated member: access ends on the next request, open assignments/owners are cleared, and history is retained. Reassignment is a deliberate human action.
- Expired/revoked invite: revoke/reissue through an admin. Existing expired links cannot create membership.
- Archive/closed content: reopen or restore the project through the authorized route before editing or restoring tasks.
