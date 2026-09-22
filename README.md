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

Send `Accept-Language: en` or `Accept-Language: my` to localize human-readable error messages. Error `code` values remain stable for clients, unsupported locales fall back to English, and localized error responses include `Content-Language`.

## Demo accounts

All seeded accounts use the password `ArcherDemo123!`.

| Role | Email |
| --- | --- |
| Administrator | `admin@archer.local` |
| Client | `client1@archer.local` |
| Freelancer | `freelancer1@archer.local` |
| Client + freelancer | `both@archer.local` |

The seed commands reset the configured database and are blocked when `NODE_ENV=production`:

```bash
npm run seed:minimal
npm run seed:demo
npm run seed:full
```

The both-role account has both profiles, a published job with an incoming proposal from `freelancer1@archer.local`, a proposal on another client's job, and a saved job. To add it to an existing seeded local database without resetting other data, run `npm run seed:both-demo`. The command is idempotent and blocked in production.

## Useful commands

- `npm run dev` — start the development server with reload.
- `npm run build` — build production JavaScript.
- `npm run typecheck` — check TypeScript.
- `npm test` — run tests.
- `npm run prisma:generate` — regenerate Prisma Client.
- `npm run db:migrate -- --name <name>` — create a development migration.
- `npm run db:deploy` — apply committed migrations in deployment.
- `npm run seed:both-demo` — add the both-role account to an existing local seed without a reset.

## API surface

- Authentication: register, login, refresh, logout, logout-all, email verification, password reset, and current user.
- Profiles: client/freelancer profile management and public freelancer discovery.
- Marketplace: categories, job discovery/CRUD/publishing, saved jobs, and proposals.
- Work: contract offers, acceptance/completion, milestone submission/review, cancellation, and disputes.
- Engagement: conversations, messages, read state, notifications, reviews, and reports.
- Admin: metrics, report resolution, user suspension/restoration, and audit logging.

Admin capabilities currently exist in the API only. The web admin workspace has not been built. An administrator can resolve a disputed contract with `POST /admin/contracts/:contractId/resolve-dispute` and `{ "resolution": "RESUME" | "CANCEL", "note": "..." }`; this also resolves its open dispute report, records an audit event, and notifies both parties.

For fixed-price work, all milestones must be approved before either party can request or finalize completion. Cancelling a contract closes its job and cancels unfinished milestones. Submission links must use HTTP or HTTPS. Archer records these status changes but does not transfer money.

Amounts are integers: USD is stored in cents and MMK in whole kyat. Archer records contract terms and approvals but does not process payments.

Client job management uses `GET /client/jobs` and `GET /client/jobs/:jobId`, which include the owner's private drafts. Public `GET /jobs/:jobId` does not expose drafts. Clients create with `POST /jobs`, edit with `PATCH /jobs/:jobId`, publish with `POST /jobs/:jobId/publish`, and close with `POST /jobs/:jobId/close`.
