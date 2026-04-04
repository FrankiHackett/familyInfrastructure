# Schema Inference from App Code

When the user describes a data need but existing app code is already present, scan the code to infer the full schema rather than guessing from the description alone.

## Scan Sequence

Run these in order, stopping when enough signal is gathered:

### 1. Find Supabase Queries

```
Grep: supabase\.from\(
Grep: \.schema\(
Grep: supabase\.rpc\(
```

Extracts: existing table names, column names used in `.select()`, `.insert()`, `.update()`, `.eq()`, `.filter()`

**Example:**
```typescript
supabase.schema('triathlon').from('sessions').select('id, athlete_id, discipline, distance_km')
```
→ Infer table `triathlon.sessions` with columns `id`, `athlete_id`, `discipline`, `distance_km`

### 2. Find TypeScript Interfaces and Types

```
Grep: ^(export\s+)?(interface|type)\s+\w+
```

Look for interfaces that describe domain data (not UI state). These are strong signals for table shapes.

**Example:**
```typescript
interface WorkoutSession {
  id: string
  athleteId: string
  discipline: 'swim' | 'bike' | 'run'
  distanceKm: number
  durationSeconds: number
  sessionDate: string
  notes?: string
}
```
→ Infer enum for `discipline`, all columns and their types

### 3. Find API Route Handlers

```
Glob: app/api/**/*.ts
Glob: pages/api/**/*.ts
```

Read route bodies for `.insert()`, `.upsert()`, `req.body` destructuring — reveals what fields the API accepts.

### 4. Find Zod / Yup Schemas

```
Grep: z\.object\(
Grep: yup\.object\(
```

Validation schemas are often the most precise description of table shape:

```typescript
const sessionSchema = z.object({
  discipline: z.enum(['swim', 'bike', 'run']),
  distanceKm: z.number().positive(),
  durationSeconds: z.number().int().positive(),
  sessionDate: z.string().datetime(),
  notes: z.string().optional(),
})
```

### 5. Find Form Components

```
Glob: components/**/*.tsx
Grep: name="|name={
```

Form field names reveal column names, especially for user-facing data.

---

## Column Name Convention Conversion

App code typically uses camelCase; Postgres uses snake_case.

| TypeScript | Postgres |
|---|---|
| `userId` | `user_id` |
| `createdAt` | `created_at` |
| `distanceKm` | `distance_km` |
| `sessionDate` | `session_date` |
| `heartRateAvg` | `heart_rate_avg` |

Always generate Postgres columns in snake_case and TypeScript types in camelCase.

---

## Inferring Relationships

Look for patterns that suggest foreign keys:

| Code Pattern | Inference |
|---|---|
| Field named `{entity}Id` or `{entity}_id` | Foreign key to `{entity}s` table |
| `.select('*, sessions(*)')` | One-to-many join |
| `supabase.from('a').select('*, b!inner(*)')` | Required join |
| Arrays of IDs like `tagIds: string[]` | Many-to-many junction table needed |

---

## Inferring Ownership Model

Look for these signals in the code:

| Signal | Likely Model |
|---|---|
| `user_id = auth.uid()` only | `personal` |
| `household_id` or `household_members` reference | `shared` |
| `partner_id` field or partner user reference | `partner` |
| Fetch without user filter | Check if it's server-only or a bug |

---

## Inferring Index Needs

Beyond the standard `user_id` and `created_at` indexes, look for:

```typescript
// .eq() and .filter() calls reveal frequently-queried columns
.eq('discipline', discipline)         → index on discipline
.gte('session_date', startDate)       → index on session_date
.order('distance_km', { ascending })  → index on distance_km
```

Add an index for any column that appears in `.eq()`, `.filter()`, `.order()`, or `.lt()`/`.gte()` calls outside of `id` and `user_id`.

---

## When Code Is Absent

If no existing code is found, rely entirely on the user's natural language description. Ask clarifying questions for:
- Any relationships between entities that aren't clear
- The ownership model if not stated
- Whether any numeric fields need high precision (use `numeric` instead of `float8`)
- Whether any text fields need full-text search (add GIN index)
