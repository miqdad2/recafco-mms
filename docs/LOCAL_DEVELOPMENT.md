# Local Development Guide

## Prerequisites

### 1. PostgreSQL 17

The app requires a locally running PostgreSQL instance.  
Recommended: **PostgreSQL 17** installed as a Windows service.

The Windows service name is typically `postgresql-x64-17`.  
If your service name is different, set `POSTGRES_SERVICE_NAME` in `.env`.

The `npm run dev` command automatically tries to start the service if it is not running.

---

## Environment Setup

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### Required environment variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/recafco_maintenance?schema=public` |
| `NEXT_PUBLIC_APP_URL` | Base URL of the app | `http://localhost:3000` |

### Optional environment variables

| Variable | Description | Default |
|---|---|---|
| `UPLOADS_DIR` | Directory for private file uploads | `uploads` (relative to project root) |
| `POSTGRES_SERVICE_NAME` | Windows PostgreSQL service name | Auto-detected |

**Security note:** `DATABASE_URL` contains your database password.  
The `.env` file is git-ignored and must never be committed to the repository.

---

## First-time database setup

The database schema is managed through the SQL migration files in `supabase/migrations/`.  
These must be applied to your local PostgreSQL instance before the app can run.

**Apply migrations** using `psql` or any PostgreSQL client:

```bash
# Example using psql
psql -U postgres -d recafco_maintenance -f supabase/migrations/20260603093000_phase_1_foundation.sql
# ... repeat for each migration file in order
```

After applying migrations, generate the Prisma client:

```bash
npm run prisma:generate
```

---

## Starting the development server

```bash
npm run dev
```

This will:
1. Run `scripts/ensure-postgres.ps1` — checks if PostgreSQL is reachable, starts the Windows service if not.
2. Start Next.js in development mode on `http://localhost:3000`.

---

## Verifying the database connection

Before starting the server, you can verify the database is reachable:

```bash
npm run db:check
```

Expected output on success:
```
[db:check] Connecting to: postgresql://postgres:***@localhost:5432/recafco_maintenance
[db:check] PostgreSQL connection OK.
```

---

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server (auto-starts PostgreSQL on Windows) |
| `npm run build` | Create production build |
| `npm run typecheck` | Run TypeScript type check — must pass before committing |
| `npm run lint` | Run ESLint — must pass before committing |
| `npm run db:check` | Verify PostgreSQL connection |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:pull` | Pull current database schema into prisma/schema.prisma |
| `npm run auth:set-password` | Set a local user password via CLI |

---

## Creating a local admin user

After applying migrations and seeding demo data, set a password for the super admin profile:

```bash
npm run auth:set-password -- <profile-uuid> admin@recafco.com YourPassword123
```

Find the profile UUID in the `profiles` table for the super admin user.

---

## File uploads

Uploaded files are stored locally under the `uploads/` directory at the project root.  
This directory is git-ignored and must not be committed.

Structure:
```
uploads/
  work-order-files/
  asset-files/
  purchase-files/
```

The directory is created automatically when the first file is uploaded.

---

## Common issues

**"PostgreSQL is not reachable"**  
→ Start the PostgreSQL service manually:  
`Start-Service postgresql-x64-17` (PowerShell as Administrator)

**"DATABASE_URL is not set"**  
→ Create a `.env` file from `.env.example`.

**"PrismaClientInitializationError"**  
→ Run `npm run prisma:generate` to regenerate the Prisma client.

**"Relation does not exist"**  
→ The database schema has not been applied yet. Apply the SQL migrations in order.
