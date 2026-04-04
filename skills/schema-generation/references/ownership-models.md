# Ownership Models — RLS Policy Templates

Three ownership models are supported in Household App Infrastructure. Select the model based on who should be able to read and write data.

---

## Model 1: Personal

**Use when:** Data belongs exclusively to one user. No other household member should see it.

**Examples:** personal health logs, private notes, individual workout sessions.

### Table Columns

```sql
user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
```

### RLS Policies

```sql
-- SELECT: user can only read their own rows
CREATE POLICY "{table_name}_select_personal"
  ON {app_schema}.{table_name}
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: user can only insert rows with their own user_id
CREATE POLICY "{table_name}_insert_personal"
  ON {app_schema}.{table_name}
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: user can only update their own rows
CREATE POLICY "{table_name}_update_personal"
  ON {app_schema}.{table_name}
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: user can only delete their own rows
CREATE POLICY "{table_name}_delete_personal"
  ON {app_schema}.{table_name}
  FOR DELETE
  USING (auth.uid() = user_id);
```

---

## Model 2: Shared

**Use when:** All household members should be able to read and write the data.

**Examples:** shared grocery lists, household budget entries, family calendar events.

**Dependency:** Requires a `public.household_members` table with at minimum:

```sql
CREATE TABLE public.household_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

The `household_id` in shared tables must match the user's `household_id` from `public.household_members`.

### Table Columns

```sql
user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- creator
household_id uuid NOT NULL  -- which household this row belongs to
```

### RLS Policies

```sql
-- Helper: check if current user is a member of a given household
-- (Inline the subquery rather than using a stored function for clarity)

-- SELECT: any household member can read
CREATE POLICY "{table_name}_select_shared"
  ON {app_schema}.{table_name}
  FOR SELECT
  USING (
    household_id IN (
      SELECT household_id
      FROM public.household_members
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: must be a member of the target household
CREATE POLICY "{table_name}_insert_shared"
  ON {app_schema}.{table_name}
  FOR INSERT
  WITH CHECK (
    household_id IN (
      SELECT household_id
      FROM public.household_members
      WHERE user_id = auth.uid()
    )
    AND auth.uid() = user_id
  );

-- UPDATE: any household member can update
CREATE POLICY "{table_name}_update_shared"
  ON {app_schema}.{table_name}
  FOR UPDATE
  USING (
    household_id IN (
      SELECT household_id
      FROM public.household_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    household_id IN (
      SELECT household_id
      FROM public.household_members
      WHERE user_id = auth.uid()
    )
  );

-- DELETE: only the row creator can delete
CREATE POLICY "{table_name}_delete_shared"
  ON {app_schema}.{table_name}
  FOR DELETE
  USING (auth.uid() = user_id);
```

---

## Model 3: Partner

**Use when:** Data is visible to exactly two users — the owner and a designated partner.

**Examples:** shared fitness goals, couple's budget items, partner-visible health metrics.

### Table Columns

```sql
user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- primary owner
partner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL            -- designated partner
```

The `partner_id` is set at row creation and represents the one other person who can see this data. It can be null if the owner has not designated a partner yet.

### RLS Policies

```sql
-- SELECT: owner or designated partner can read
CREATE POLICY "{table_name}_select_partner"
  ON {app_schema}.{table_name}
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() = partner_id
  );

-- INSERT: only owner can create, must set their own user_id
CREATE POLICY "{table_name}_insert_partner"
  ON {app_schema}.{table_name}
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: owner can update anything; partner can update non-ownership fields
-- Use a simple policy — restrict field-level control at the app layer
CREATE POLICY "{table_name}_update_partner"
  ON {app_schema}.{table_name}
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR auth.uid() = partner_id
  )
  WITH CHECK (
    -- Only the owner can change the partner_id
    (auth.uid() = user_id)
    OR (auth.uid() = partner_id AND partner_id = partner_id)
  );

-- DELETE: only owner can delete
CREATE POLICY "{table_name}_delete_partner"
  ON {app_schema}.{table_name}
  FOR DELETE
  USING (auth.uid() = user_id);
```

---

## Choosing the Right Model

| Scenario | Model |
|---|---|
| Personal diary, health log | `personal` |
| Grocery list, shared notes | `shared` |
| Couple's goals, partner-visible data | `partner` |
| Admin-only config data | `personal` (or server-side only) |

## Security Notes

- Always call `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` before adding policies
- Test policies with both `auth.uid()` values to confirm access is correctly scoped
- The `shared` model requires the `public.household_members` table to exist — generate that migration first if it doesn't
- Never use `public` schema for app data — always use the app-specific schema namespace
