
# AGENTS.md

## Project

ModOverlayObs is a self-hosted moderator overlay for OBS Browser Source.

A moderator prepares and controls text, images, GIFs, video, audio, and external media.
OBS renders the live result through a browser source. The logical canvas is 1920x1080.

The project is designed for one streamer and a trusted moderator team.

## Stack

- Node.js 22.12+
- TypeScript
- React 19
- Vite 7
- Express 5
- Socket.IO 4
- Prisma 6
- SQLite
- Vitest
- ESLint + Prettier

## Repository layout

- `src/client/` — React UI, moderator panel, preview, OBS-facing pages, playback logic.
- `src/server/` — Express API, authentication, permissions, uploads, Socket.IO, persistence.
- `src/shared/` — contracts/types shared between client and server.
- `prisma/schema.prisma` — persisted data model.
- `tests/` — unit and integration tests.
- `docs/security-review.md` — security assumptions and known limitations.
- `database/` — local runtime database; never treat as source code.
- `uploads/` — runtime media; never treat as source code.

## Core invariants

1. Preserve the distinction between preview state and live/OBS state.
2. Do not silently push preview changes live unless the existing workflow explicitly requires it.
3. Keep the logical overlay coordinate system compatible with the 1920x1080 OBS canvas.
4. Client and OBS views must converge on the same server-authoritative state.
5. Socket.IO changes must handle reconnects, stale clients, authorization changes, logout, and overlay-token rotation.
6. The server is the authority for permissions. UI restrictions are not security boundaries.
7. Never expose secrets, session data, passwords, or overlay tokens in logs, URLs, client-visible state, or committed files.
8. Never append the internal overlay token to external media URLs.
9. Protected uploaded media must continue to support the access patterns required by media playback, including HEAD/Range requests.
10. Do not weaken upload validation, quota handling, cleanup, or authorization checks to simplify a feature.
11. Do not trust `X-Forwarded-For` unless proxy behavior is deliberately redesigned and tested.
12. Preserve existing data unless a task explicitly requires a destructive migration.

## Architecture rules

- Keep browser/UI concerns in `src/client`.
- Keep authorization, persistence, filesystem access, and authoritative mutations in `src/server`.
- Put cross-boundary contracts in `src/shared` instead of duplicating shapes.
- When changing a client/server payload or Socket.IO event, update all producers, consumers, shared types/validation, and relevant tests together.
- Prefer existing utilities and patterns before introducing new abstractions.
- Avoid new dependencies unless they materially simplify the implementation.
- Do not perform broad refactors during a small feature or bug fix.

## Media and OBS rules

When touching media behavior, check all affected surfaces:

- moderator preview;
- live OBS overlay;
- local uploaded files;
- external URLs;
- YouTube behavior where applicable;
- seek/start-time behavior;
- mute/loop/volume behavior;
- element cleanup and lifecycle;
- reconnect/reload behavior.

Do not assume browser playback behavior is identical between the moderator page and OBS Browser Source.

## Security-sensitive areas

Treat changes in these areas as security-sensitive:

- authentication and sessions;
- permission checks;
- Socket.IO authorization/revocation;
- overlay-token handling;
- `/uploads`;
- media URL rewriting;
- file upload validation;
- upload quota/accounting;
- Prisma writes involving permissions or ownership.

For security-sensitive changes, inspect `docs/security-review.md` and extend the existing security/integration tests when behavior changes.

## Database rules

- `prisma/schema.prisma` is the source of truth for the Prisma model.
- Do not edit runtime SQLite files manually.
- Do not run destructive database commands against a real user database.
- Tests that need a database must use isolated temporary test data.
- If the schema changes, update application code and tests in the same task.
- Do not remove or rename persisted fields casually; consider compatibility with existing installations.

## Working method

For each task:

1. Read the smallest set of relevant files first.
2. Trace the existing data/event flow before editing.
3. Make the smallest coherent change.
4. Preserve existing behavior outside the requested scope.
5. Add or update tests for changed logic.
6. Run focused tests first, then the standard checks.
7. Inspect the final diff for accidental changes, secrets, generated files, and unrelated formatting.

Do not scan or rewrite the whole repository when the task is local.

## Standard commands

Install dependencies only when needed:

```bash
npm ci
```

Development:

```bash
npm run dev
```

Checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Database setup for a local development environment:

```bash
npm run db:push
```

Do not run `db:push` merely as a generic validation step when no schema change requires it.

## Definition of done

A change is done when:

- TypeScript typechecking passes.
- Relevant tests pass.
- Lint passes for changed code.
- Production build passes when the change can affect build/runtime behavior.
- Client/server/shared contracts remain consistent.
- Preview/live synchronization still behaves correctly.
- No secret or runtime data is committed.
- Security-sensitive behavior is covered by tests when changed.

## Response style

After implementation, report only:

- what changed;
- important files changed;
- checks/tests run and their result;
- any remaining risk or manual OBS/browser check that is genuinely required.

Do not provide long tutorials unless explicitly asked.
