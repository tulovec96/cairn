# Cairn

File hosting with accounts you control, links you can shape and revoke, and an API that does what the docs say.

Cairn is a self-hosted Next.js application backed by SQLite and local disk storage. It runs as a single Node process. There is no Docker requirement, no external database and no third-party service you must sign up for.

## What it is

- **Accounts only.** Every stored file belongs to an account. There are no anonymous uploads and no guest accounts. Public share links and file-request portals are separate concepts: the person on the other end never gets an account.
- **Uploads that survive real networks.** Chunked, resumable uploads with SHA-256 verified between browser and server, a persistent queue, and interrupted-upload recovery.
- **A real file manager.** List, compact, grid, large and gallery views (virtualized), search operators, saved searches, tags, versions, trash, archive, duplicates, batch rename, drag-and-drop, media library with lightbox and slideshow.
- **Sharing.** Passwords, expiry, download and view limits, view-only links, IP allow-lists, privacy-first analytics, embeds, ZIP downloads, and view-only folder sharing with other accounts.
- **Collaboration.** Organizations (owner, admin, member, viewer), comments, activity history, file requests and upload portals.
- **Automation and integration.** Rules that act on files, signed webhooks with retry and replay, a scoped REST API with per-plan rate limits.
- **Plans and entitlements.** Every feature and limit comes from plan records and is enforced on the server. Billing is either administrator-assigned or Stripe.
- **Administration.** Users, organizations, plans, subscriptions, quarantine review, abuse reports, jobs, health, backups, feature flags, email outbox, tickets, changelog, status incidents, audit log.
- **No trackers.** No analytics, ads or third-party scripts.

## Requirements

- Node.js 20.9 or newer (what Next.js 16 requires; 22 recommended)
- npm

## Quick start

```bash
npm install
cp .env.example .env        # then set APP_SECRET (see below)
npm run setup               # applies migrations and generates the Prisma client
npm run dev                 # http://localhost:3000
```

The **first account registered through the web UI becomes the administrator**. To create or reset one from the command line:

```bash
npm run admin:create -- you@example.com "a long passphrase" "Your Name"
```

### Production

```bash
npm run build
npm start                   # node server.mjs
```

Use `npm start`, not `next start`. The wrapper stamps each request with the real peer address so IP-based rate limits and share IP allow-lists can't be bypassed with a forged `X-Forwarded-For`. Behind a reverse proxy, set `TRUST_PROXY` to the number of proxies that append to `X-Forwarded-For`.

Put a TLS-terminating proxy in front and set `APP_URL` to the public `https://` address: cookies are marked `Secure` and HSTS is sent when it starts with `https://`.

## Configuration

Environment variables (`.env`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file, relative to `prisma/`. |
| `DATA_DIR` | Where blobs, upload staging and backups live. |
| `APP_URL` | Public URL, used for absolute links and cookie security. |
| `APP_SECRET` | 32+ random characters. **Required in production.** Signs short-lived tokens and derives the key that encrypts webhook secrets. |
| `TRUST_PROXY` | Number of trusted reverse proxies (default `0`). |
| `STORAGE_PROVIDER` | `local` (default) or `s3`. See "Object storage" below. |
| `DISABLE_WORKER` | Set to `1` to run without the in-process background worker. |
| `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN`, `EMAIL_FROM` | Optional. Delivers email by POSTing JSON to a relay you control. Without them, messages are recorded as "skipped" and nothing pretends to be sent. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Optional. Needed only if you switch billing to Stripe in System settings. |

Everything else (registration, maintenance mode, rate limits, scanner, backups, billing provider, support contact) is edited in **Administration → System settings** and takes effect immediately. Plans, prices, features and limits are edited in **Administration → Plans**.

### Object storage (S3, R2, MinIO)

Blobs live on local disk by default. Set `STORAGE_PROVIDER=s3` to use any S3-compatible store instead (AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi):

| Variable | Purpose |
| --- | --- |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Required. |
| `S3_ENDPOINT` | Full URL of the service. Leave out for AWS. |
| `S3_REGION` | Default `us-east-1`. Use `auto` for R2. |
| `S3_FORCE_PATH_STYLE` | `true` (default with a custom endpoint) or `false` for virtual-hosted style. |
| `S3_KEY_PREFIX` | Optional folder inside the bucket. |

Requests are signed with Signature Version 4 without an SDK, large files use multipart upload, and copies happen server-side. The signer is checked against the examples in the AWS documentation and the whole integration suite passes against an authenticating mock store (`npm run test:integration:s3`), but it has **not** been run against a live AWS, R2 or MinIO endpoint: try it on a test bucket first. Database backups and the upload staging area (`DATA_DIR/tmp`) stay on local disk.

### Malware scanning

Scanning uses ClamAV over its TCP socket when you point System settings at a `clamd`. Without a scanner, only file-type rules apply, and Administration → Health says so. Flagged files are quarantined and reviewed by an administrator under **Malware review**.

### Backups

Administration → Backups takes consistent SQLite backups (also on a schedule). They contain the database only. **File contents live in `DATA_DIR/storage` and must be backed up separately.**

## Project layout

```
src/app/            Routes: (marketing) public site, (auth), (app) signed-in app, (public) share/request pages, api/v1
src/components/     UI, grouped by feature
src/server/         Server code: services (business rules), storage, jobs, security helpers
src/config/         Entitlement catalogue, default plans, event catalogue
src/lib/            Code shared with the browser: search parser, formatters, upload engine
prisma/             Schema and migrations
tests/unit          Fast tests of pure logic and security helpers
tests/integration   End-to-end tests against a real production build and a throwaway database
```

Every action is authorised in `src/server/services` against the caller's role and plan; the UI hides what you can't do, but never relies on that.

## Testing

```bash
npm test                            # unit tests
npm run test:integration            # builds, starts an isolated instance, runs the API suite
npm run test:integration:s3         # the same suite with blobs in a mock S3 store
npm run test:integration -- --serve # starts that isolated instance and leaves it running for manual checks
npm run lint
npm run typecheck
```

The integration runner never touches your development database or data directory.

## Security notes

- Passwords: scrypt with per-user salts. Sessions, API keys and recovery tokens are stored only as hashes.
- Optional TOTP two-factor authentication with hashed one-time backup codes.
- Same-origin enforcement on state-changing browser requests, per-request CSP with nonces, frame protection, `nosniff`, no-referrer.
- Previews never execute uploaded content: SVG and Markdown are sanitized, everything else is served inert.
- Webhook targets and URL imports go through an SSRF-safe client that validates the address again at connect time.

**What it does not do:** files are not end-to-end encrypted and Cairn does not encrypt file contents at rest (use disk or bucket encryption); passkeys and single sign-on are not implemented; the S3-compatible storage provider has only been exercised against a mock store, not a live service; a Stripe integration is included but has only been exercised against locally signed test events, not a live Stripe account.

## License

Not yet chosen.
