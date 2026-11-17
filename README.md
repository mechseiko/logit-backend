# logit-backend

LOGIT API — the backend for [uselogit.cv](https://uselogit.cv). Express + Firebase Auth +
Firestore + S3-compatible storage (Backblaze B2) + Gemini + Paystack.

Monorepo layout (npm workspaces):

- `apps/api` — Express API (`@logit/api`)
- `packages/shared` — shared types, schemas and helpers (`@logit/shared`)

## Commands

```bash
npm install
npm run dev        # API on :4000 (mock mode without secrets)
npm run build      # shared → api
npm run typecheck
npm test           # vitest: shared + api suites
npm run seed       # seed the Nigerian school directory
npm run smoke:prod # real-adapter smoke test (needs production env vars)
```

## Deploy (Render — Web Service, not Blueprint)

1. New → **Web Service** → connect `mechseiko/logit-backend`.
2. Runtime: **Docker** (uses `Dockerfile` at repo root; installs ghostscript/poppler/sharp).
3. Health check path: `/health`.
4. Set every variable from `.env.example` — see OWNER_TASKS in the main repo for the full list.
   Production refuses to boot on mock providers, dev auth, memory store or local storage.

The web app lives in the sibling repo `mechseiko/logit` (Vercel).
