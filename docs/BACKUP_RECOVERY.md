# Fall Split — Backup & Recovery

## Current recovery state

The production project's application tables and Auth users were deliberately
deleted, and no backup was retained. This data cannot be recovered from this
repository or by rolling back application code. Do not assume a provider backup
exists or restore one; confirm the project's current backup/PITR status in the
[Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)
and Dashboard. No restore or new project is part of this runbook.

For future schema changes, take and verify a recoverable backup before applying
DDL. Record who can restore it and validate the restore procedure in an isolated
project. Backup availability and retention depend on current plan and settings;
verify those directly instead of relying on fixed retention claims in this file.

## Manual Database Export

You can export your data at any time using the Supabase CLI:

```bash
supabase db dump --file backup-$(date +%Y%m%d).sql
```

Or use `pg_dump` directly. Set `SUPABASE_DB_URL` from an approved secret store or secure shell environment first; do not paste the connection string into this file, a command, or shell history:

```bash
pg_dump "$SUPABASE_DB_URL" \
 --no-owner --no-acl \
 -f backup-$(date +%Y%m%d).sql
```

## Restore procedure

Restore only after independently verifying the project, snapshot, restore point,
and impact. A database restore overwrites current state. For this project, there
is no retained backup and no authorized restoration target. Do not use a restore
as a migration rollback; use a reviewed forward corrective migration instead.

## Data Export for Users

Fall Split supports CSV export of expense history (from the Activity or Group Detail pages). This gives users portable copies of their financial records independent of the database.

## What Is Not Backed Up

- **Uploaded receipt images** — Stored in Supabase Storage. Enable storage backups separately or use an external bucket with versioning.
- **Service worker cache** — Client-side only; ephemeral by design.
- **IndexedDB offline queue** — Client-side only; syncs to the server before being cleared.

## Disaster Recovery

| Scenario | Recovery action |
|---|---|
| Accidental row deletion | Verify an available backup and restore point first; no backup was retained for the completed production wipe |
| Schema migration error | Hold the maintenance barrier and apply a reviewed forward corrective migration after recovery assessment |
| Auth provider misconfiguration | Fix in Supabase dashboard; users can still log in via email |
| Vercel deployment broken | Revert to previous deployment in Vercel dashboard |
| Environment variables lost | Recreate from Supabase dashboard; no data loss |

## Recovery Time Objectives

- **Database**: No recovery time can be promised without verified backup/PITR coverage and a restore rehearsal.
- **App frontend**: Vercel rollback may restore code but cannot restore deleted database data.
- **Schema changes**: Recovery depends on a reviewed corrective migration or verified backup; changes are not automatically reversible.

## Preventing Data Loss

1. Never run destructive SQL (`DROP TABLE`, `TRUNCATE`) directly in production.
2. Use soft deletes (`deleted_at`, `voided_at`) rather than hard deletes for financial records.
3. Always test migrations in a staging Supabase project first.
4. Enable Supabase Pro PITR for production deployments.
5. Keep `.env.local` and service-role keys in a secure password manager.
