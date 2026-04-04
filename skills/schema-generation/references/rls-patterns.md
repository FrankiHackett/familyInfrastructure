# Additional RLS Patterns and Edge Cases

Supplementary patterns for the schema-generation skill.

## Service Role Bypass

The Supabase service role bypasses RLS by default. This is intentional for server-side admin operations. Document this in migration comments:

```sql
-- NOTE: Service role bypasses RLS. Use only in trusted server environments.
-- Client-side code must use the anon key, which is subject to RLS policies.
```

## Read-Only for Partner

If the partner model should allow reading but not writing by the partner:

```sql
-- Partner can SELECT but not INSERT/UPDATE/DELETE
CREATE POLICY "{table_name}_select_partner_readonly"
  ON {app_schema}.{table_name}
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() = partner_id
  );

-- Only owner can INSERT/UPDATE/DELETE (use personal policies for those)
```

## Soft Deletes

If using soft deletes (`deleted_at timestamptz`), always add this policy AND a partial index:

```sql
-- Hide soft-deleted rows from all queries
CREATE POLICY "{table_name}_hide_deleted"
  ON {app_schema}.{table_name}
  AS RESTRICTIVE
  FOR SELECT
  USING (deleted_at IS NULL);

-- Partial index: only index active rows
CREATE INDEX idx_{table_name}_active_user
  ON {app_schema}.{table_name}(user_id)
  WHERE deleted_at IS NULL;
```

Note: `AS RESTRICTIVE` means this policy ANDs with permissive policies rather than ORing.

## Public Read, Authenticated Write

For data that should be readable by anyone but only writable by authenticated users:

```sql
CREATE POLICY "{table_name}_select_public"
  ON {app_schema}.{table_name}
  FOR SELECT
  USING (true);

CREATE POLICY "{table_name}_insert_auth"
  ON {app_schema}.{table_name}
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = user_id);
```

## Checking Policy Coverage

After writing policies, verify all four operations are covered:

```sql
-- Checklist — confirm a policy exists for each:
-- SELECT  ✓
-- INSERT  ✓
-- UPDATE  ✓
-- DELETE  ✓
```

A table with RLS enabled but no policies denies all access. Always test with a client-side query after migration.

## Policy Naming Convention

Use this format for all policy names:
```
{table_name}_{operation}_{model}
```

Examples:
- `sessions_select_personal`
- `grocery_items_insert_shared`
- `goals_update_partner`

## Testing RLS Locally

To test policies in Supabase local dev:

```sql
-- Simulate a specific user
SET LOCAL request.jwt.claims = '{"sub": "user-uuid-here", "role": "authenticated"}';
SET LOCAL role = 'authenticated';

-- Now run queries as that user
SELECT * FROM triathlon.sessions;
```

Reset with:
```sql
RESET role;
```

## Index on Foreign Keys

Always add an index on any column that is a foreign key — Postgres does not do this automatically:

```sql
-- If sessions reference workouts:
CREATE INDEX idx_sessions_workout_id ON {app_schema}.sessions(workout_id);
```

## Composite Indexes for Common Query Patterns

If the app always filters by `user_id` AND `session_date`:

```sql
CREATE INDEX idx_sessions_user_date
  ON {app_schema}.sessions(user_id, session_date DESC);
```

This is more efficient than two separate single-column indexes for this query pattern.
