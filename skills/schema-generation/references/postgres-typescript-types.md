# Postgres → TypeScript Type Mapping

Reference for the schema-generation skill. Use this table when generating `database.types.ts`.

## Core Type Mappings

| Postgres Type | TypeScript Type | Notes |
|---|---|---|
| `uuid` | `string` | UUIDs are strings in JS |
| `text` | `string` | |
| `varchar(n)` | `string` | |
| `char(n)` | `string` | |
| `int2` / `smallint` | `number` | |
| `int4` / `integer` | `number` | |
| `int8` / `bigint` | `string` | Bigints exceed JS safe integer — use string |
| `float4` / `real` | `number` | |
| `float8` / `double precision` | `number` | |
| `numeric` / `decimal` | `string` | Arbitrary precision — use string to avoid loss |
| `boolean` | `boolean` | |
| `timestamptz` | `string` | ISO 8601 string from Supabase client |
| `timestamp` | `string` | ISO 8601 string (no timezone info) |
| `date` | `string` | `YYYY-MM-DD` string |
| `time` | `string` | `HH:MM:SS` string |
| `interval` | `string` | ISO 8601 duration string |
| `json` | `Json` | Use the `Json` union type defined in database.types.ts |
| `jsonb` | `Json` | Same as `json` |
| `uuid[]` | `string[]` | Arrays of scalars become typed arrays |
| `text[]` | `string[]` | |
| `int4[]` | `number[]` | |
| `bytea` | `string` | Base64-encoded string |
| `citext` | `string` | Case-insensitive text |
| `inet` | `string` | IP address as string |
| `point` | `string` | PostGIS — treat as string unless using geo lib |
| `enum` (custom) | TypeScript `enum` or union type | See Enum section below |

## Nullability

- If a column has `NOT NULL`, the TypeScript type has no `| null`
- If a column is nullable (no `NOT NULL`), append `| null` to the type
- In `Insert` types, columns with `DEFAULT` should be `optional` (prefix with `?`)

```typescript
// NOT NULL column
session_date: string

// Nullable column
notes: string | null

// Column with DEFAULT (optional in Insert)
id?: string
created_at?: string
```

## Custom Enums

For Postgres enums, generate a TypeScript union type or const enum:

```sql
-- Postgres
CREATE TYPE triathlon.discipline AS ENUM ('swim', 'bike', 'run');
```

```typescript
// TypeScript
export type Discipline = 'swim' | 'bike' | 'run'

// In table Row type
discipline: Discipline
```

Place enum types in the `Enums` block of the schema definition:

```typescript
export interface Database {
  triathlon: {
    // ...
    Enums: {
      discipline: 'swim' | 'bike' | 'run'
    }
  }
}
```

## JSONB Column Typing

For JSONB columns with a known shape, create a specific interface rather than using the generic `Json` type:

```typescript
// Prefer specific typing when shape is known
export interface WorkoutMetrics {
  heart_rate_avg?: number
  power_avg?: number
  cadence_avg?: number
  notes?: string
}

// In Row type
metrics: WorkoutMetrics | null
```

## Arrays

Postgres arrays map to TypeScript arrays:

```sql
tags text[]
split_times float8[]
```

```typescript
tags: string[] | null
split_times: number[] | null
```

## The Json Union Type

Always include this at the top of `database.types.ts`:

```typescript
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]
```

## Insert vs Update Types

- `Row` — full type returned by SELECT (all fields required, including server defaults)
- `Insert` — fields required for INSERT; server-defaulted fields (`id`, `created_at`, `updated_at`) are optional
- `Update` — typically `Partial<Insert>` — all fields optional for PATCH semantics

```typescript
{table_name}: {
  Row: {
    id: string
    user_id: string
    created_at: string
    updated_at: string
    name: string
    score: number | null
  }
  Insert: {
    id?: string           // has DEFAULT
    user_id: string       // required
    created_at?: string   // has DEFAULT
    updated_at?: string   // has DEFAULT
    name: string          // required
    score?: number | null // nullable, optional on insert
  }
  Update: Partial<{table_name}['Insert']>
}
```
