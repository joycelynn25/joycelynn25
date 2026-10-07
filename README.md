# Venture Forge — AI Business Generator

A website that turns a founder's skills, interests, budget and market into distinct, costed business ideas, each with pricing, startup-cost breakdown, break-even estimate, a 90-day plan, risks and a cheap validation experiment. Defaults are tuned for Ghana and West Africa (GHS pricing, mobile money, WhatsApp-first commerce), with other currencies supported.

## Architecture

```
Browser (public/: HTML + CSS + vanilla JS, no build step)
   │  POST /api/generate  (JSON profile)
   ▼
server.js  (Node http, zero framework)
   ├─ validate.js   whitelist enums, bound text length, 10 KB body cap
   ├─ rate limiter  per-IP fixed window (in-memory)
   ├─ ai.js         Claude (claude-opus-5-5) + structured JSON output  ← if ANTHROPIC_API_KEY set
   └─ offline.js    deterministic template ideas (demo mode)           ← otherwise
   ▼
schema.js  one output contract shared by both generators and the UI
```

Design decisions:

- **Structured outputs** (`output_config.format` with a JSON schema) mean the model's response always fits the UI. No fragile prompt-and-regex parsing.
- **The API key stays on the server.** The browser never talks to Anthropic directly.
- **Demo mode** keeps the site usable with no key, for local dev, previews and tests. The UI shows which mode is active.
- **Safety-declined requests are retried server-side** on Anthropic's recommended fallback model (`fallbacks: "default"`). Refusals and truncated output map to clear user-facing errors.
- **XSS-safe rendering**: model text is inserted with `textContent` only. A strict CSP blocks inline scripts.
- History is kept in the user's `localStorage`. Nothing is stored on the server.

## Run locally

```bash
npm install
cp .env.example .env            # optional: add ANTHROPIC_API_KEY
export $(grep -v '^#' .env | xargs)
npm start                       # http://localhost:3000
npm test                        # 10 tests, no API key or network needed
```

Requires Node 20+.

## Deploy

Any Node host works (Render, Railway, Fly.io, a VPS). Set `ANTHROPIC_API_KEY`, and optionally `PORT` and `RATE_LIMIT_PER_MIN`. If you run more than one instance, move the rate limiter to a shared store such as Redis.

## Cost and limits

Each generation is one Claude request (typically a few thousand output tokens). The per-IP rate limit (default 6/min) is the main cost guard. Add authentication or payments before exposing it widely.
