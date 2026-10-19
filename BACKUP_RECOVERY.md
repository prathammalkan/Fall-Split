# Fall Split — Backup & Recovery

## Supabase Managed Backups

Supabase handles database backups:

- **Free tier**: Daily backups, 7-day retention (point-in-time recovery not available)
- **Pro tier**: Daily backups, 7-day retention with point-in-time recovery (PITR)
- **Paid add-on**: Extended retention up to 90 days

Access backups in Supabase Dashboard → **Settings → Backups**.

## Manual Database Export

You can export your data at any time using the Supabase CLI:

```bash
supabase db dump --file backup-$(date +%Y%m%d).sql
```

Or use `pg_dump` directly with your connection string (from Supabase Dashboard → Settings → Database):

```bash
pg_dump "postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
 --no-owner --no-acl \
 -f backup-$(date +%Y%m%d).sql
```

## Restoring from Backup

### Restore to the same project

In Supabase Dashboard → **Settings → Backups**, click **Restore** on the desired snapshot.

> Warning: This overwrites all current data.

### Restore to a new project

1. Create a new Supabase project.
2. Run migrations first:
 ```bash
 supabase db push
 ```
3. Restore data:
 ```bash
 psql "postgresql://postgres:[password]@db.[new-ref].supabase.co:5432/postgres" \
 -f backup.sql
 ```

## Data Export for Users

Fall Split supports CSV export of expense history (from the Activity or Group Detail pages). This gives users portable copies of their financial records independent of the database.

## What Is Not Backed Up

- **Uploaded receipt images** — Stored in Supabase Storage. Enable storage backups separately or use an external bucket with versioning.
- **Service worker cache** — Client-side only; ephemeral by design.
- **IndexedDB offline queue** — Client-side only; syncs to the server before being cleared.

## Disaster Recovery

| Scenario | Recovery action |
|---|---|
| Accidental row deletion | Restore from most recent Supabase backup |
| Schema migration error | Run corrective migration; restore data from backup |
| Auth provider misconfiguration | Fix in Supabase dashboard; users can still log in via email |
| Vercel deployment broken | Revert to previous deployment in Vercel dashboard |
| Environment variables lost | Recreate from Supabase dashboard; no data loss |

## Recovery Time Objectives

- **Database** (Supabase Pro): < 1 hour to restore from PITR
- **App frontend** (Vercel): < 5 minutes to revert deployment
- **Schema changes**: Immediately reversible via corrective migration

## Preventing Data Loss

1. Never run destructive SQL (`DROP TABLE`, `TRUNCATE`) directly in production.
2. Use soft deletes (`deleted_at`, `voided_at`) rather than hard deletes for financial records.
3. Always test migrations in a staging Supabase project first.
4. Enable Supabase Pro PITR for production deployments.
5. Keep `.env.local` and service-role keys in a secure password manager.
