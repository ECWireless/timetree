# TimeTree

TimeTree is a private, self-hostable work ledger organized as a nested tree.
It supports manual time entries, concurrent persistent timers, inherited hourly
rates, historical value, completion, search, and day or month filtering.

The MVP is intentionally configured for one allowed Google account per
deployment. It is open source under the [MIT License](./LICENSE).

## Requirements

- Node.js 22 or newer
- Corepack and pnpm
- PostgreSQL 15 or newer
- Google OAuth credentials

## Local setup

1. Install dependencies:

   ```sh
   corepack pnpm install
   ```

2. Copy `.env.example` to `.env` and supply local values:

   - `DATABASE_URL`: pooled PostgreSQL connection used by the application
   - `DATABASE_URL_UNPOOLED`: optional direct connection used by migrations
   - `BETTER_AUTH_SECRET`: random secret containing at least 32 characters
   - `BETTER_AUTH_URL`: public application origin, such as
     `http://localhost:3000`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth credentials
   - `ALLOWED_EMAIL`: the one verified Google account allowed to sign in
   - `NEXT_ALLOWED_DEV_ORIGINS`: optional comma-separated development origins

   Local environment files are ignored by Git. Do not commit credentials.

3. Configure the Google OAuth client with this callback URL:

   ```text
   <BETTER_AUTH_URL>/api/auth/callback/google
   ```

4. Apply the committed migrations:

   ```sh
   corepack pnpm db:migrate
   ```

5. Start the development server:

   ```sh
   corepack pnpm dev
   ```

## Verification

Run the checks individually:

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
corepack pnpm test:e2e
```

Integration and browser tests require a migrated PostgreSQL database through
the required `DATABASE_URL`. `DATABASE_URL_UNPOOLED` may additionally provide a
direct connection for database tooling and test setup. The Playwright
configuration uses synthetic authentication values and writes only synthetic
test records, which it removes after each workflow.

Install the browser used by Playwright when needed:

```sh
corepack pnpm exec playwright install chromium
```

## Database changes

Schema changes belong in `src/db/schema.ts` and must be delivered as reviewed,
committed SQL migrations:

```sh
corepack pnpm db:generate
corepack pnpm db:check
corepack pnpm db:migrate
```

Prefer a direct `DATABASE_URL_UNPOOLED` connection for migration commands.
Review generated SQL before applying it, back up important data, and keep each
migration compatible with the application version running during deployment.

## Deployment

Deploy the standard Next.js Node.js application to a host with PostgreSQL
connectivity. Configure the same environment names documented above in the
hosting platform, set `BETTER_AUTH_URL` to the canonical HTTPS origin, and add
that origin's Google callback URL to the OAuth client.

Apply committed migrations deliberately before deploying code that requires
them. Keep secrets in the hosting platform rather than repository files.
Because TimeTree currently supports one account per deployment, changing
`ALLOWED_EMAIL` immediately revokes retained access for the previous account.
