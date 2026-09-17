# Archer API

Express + TypeScript API for the Archer freelance marketplace. It uses Prisma ORM 7 with SQLite and JWT access/refresh authentication.

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate -- --name init
npm run seed:demo
npm run dev
```

The API is served at `http://localhost:4000/api/v1`. Check `/health/live` and `/health/ready` for health status.

## Demo accounts

All seeded accounts use the password `ArcherDemo123!`.

| Role | Email |
| --- | --- |
| Administrator | `admin@archer.local` |
| Client | `client1@archer.local` |
| Freelancer | `freelancer1@archer.local` |

The seed commands reset the configured database and are blocked when `NODE_ENV=production`:

```bash
npm run seed:minimal
npm run seed:demo
npm run seed:full
```

## Useful commands

- `npm run dev` — start the development server with reload.
- `npm run build` — build production JavaScript.
- `npm run typecheck` — check TypeScript.
- `npm test` — run tests.
- `npm run prisma:generate` — regenerate Prisma Client.
- `npm run db:migrate -- --name <name>` — create a development migration.
- `npm run db:deploy` — apply committed migrations in deployment.

## API surface

- Authentication: register, login, refresh, logout, logout-all, email verification, password reset, and current user.
- Profiles: client/freelancer profile management and public freelancer discovery.
- Marketplace: categories, job discovery/CRUD/publishing, saved jobs, and proposals.
- Work: contract offers, acceptance/completion, milestone submission/review.
- Engagement: conversations, messages, read state, notifications, reviews, and reports.
- Admin: metrics, report resolution, user suspension/restoration, and audit logging.

Amounts are integers: USD is stored in cents and MMK in whole kyat. Archer records contract terms and approvals but does not process payments.

Client job management uses `GET /client/jobs` and `GET /client/jobs/:jobId`, which include the owner's private drafts. Public `GET /jobs/:jobId` does not expose drafts. Clients create with `POST /jobs`, edit with `PATCH /jobs/:jobId`, publish with `POST /jobs/:jobId/publish`, and close with `POST /jobs/:jobId/close`.
