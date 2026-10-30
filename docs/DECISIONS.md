# Architecture Decision Records

Lightweight ADR log. Each record uses the format:

- **Context** — the situation and forces at play
- **Decision** — what was chosen
- **Alternatives considered** — what was rejected and why
- **Consequences** — trade-offs, follow-ups, where it shows up

Statuses: Proposed · Accepted · Superseded. New decisions are appended; superseded ones stay with a link to their replacement.

---

## ADR-001 — TypeScript/Node pnpm monorepo
Date: 2026-10-30 · Status: Accepted

- **Context:** Need a CLI, a backend and a web app sharing the same pipeline logic; vacancy stack is TS/Node/React.
- **Decision:** Node 22 + TypeScript, pnpm workspaces: `packages/core` (stages, schemas, OpenAI wrapper, compose), `packages/server` (Fastify + SQLite), `packages/web` (React + Vite + Tailwind), `packages/cli`. Vitest for tests.
- **Alternatives:** Python (FastAPI + Pillow) — good image tooling but splits the stack from the React UI; single package — CLI and server would drift.
- **Consequences:** One language end to end; core is entry-point agnostic (`RunContext` with callbacks). `sharp` covers image compositing needs.

## ADR-002 — OpenAI API as the only AI provider
Date: 2026-10-30 · Status: Accepted

- **Context:** Need text reasoning with web research, vision analysis/QA and image generation; limited time to integrate several vendors.
- **Decision:** OpenAI only: Responses API (text + `web_search` tool), vision-capable model for screenshot analysis and QA, OpenAI image model for backgrounds.
- **Alternatives:** Anthropic for text + fal.ai/Replicate (Flux) for images — better image options/LoRA but two keys, two billing and cost models for reviewers.
- **Consequences:** One key in `.env`; simpler cost tracking. Image quality limited to OpenAI's model; provider abstraction kept thin so a second provider can be added later.

## ADR-003 — Structured outputs validated with Zod
Date: 2026-10-30 · Status: Accepted

- **Context:** Stages pass data to each other and must be resumable; free-form text is fragile to parse and hides hallucinations.
- **Decision:** Every LLM stage returns JSON via Responses API structured outputs generated from Zod schemas (`Brief`, `BrandAnalysis`, `Fact`, `ContentPlan`, `Review`). Artifacts are re-validated on load.
- **Alternatives:** Prompted JSON + manual parsing; function calling only.
- **Consequences:** Typed contracts between stages; facts carry `status` (verified/assumption/unavailable) + `source`; schema changes require artifact migration or rerun from that stage.

## ADR-004 — Composite the real product and logo instead of generating packaging
Date: 2026-10-30 · Status: Accepted

- **Context:** Assignment requires accurate logos, packaging and labels. Image models distort small text and logos.
- **Decision:** Image model generates the scene only (no product, logo, text). `sharp` composites the real product photo (transparent/white background), the real logo and headline text rendered as SVG with the brand font. Validate with a ~30 min experiment vs OpenAI image edit with product reference (REFINEMENTS.md).
- **Alternatives:** Full generation with reference image (edit API); LoRA fine-tune on packaging (ADR-012).
- **Consequences:** Pixel-accurate products/labels, deterministic text. Risk of "pasted-in" look → shadows, reserved placement area in prompt, QA brand-fit check.

## ADR-005 — Instagram analysed via human-provided screenshots
Date: 2026-10-30 · Status: Accepted

- **Context:** Instagram blocks automated/unauthenticated access; scraping violates ToS and is unreliable.
- **Decision:** Human action: 6–10 screenshots of @gymbeamhr (grid + representative posts) into `brand_kit/gymbeamhr/instagram/` or uploaded in the UI. Vision model analyses them. Analysis records Instagram as "accessed via screenshots" and lists direct access under unavailable sources.
- **Alternatives:** Scraping tools/headless login; Instagram Graph API (requires brand's business account access).
- **Consequences:** Reproducible input set committed with the submission; sample limited to what was captured — stated as a limitation.

## ADR-006 — SQLite + Drizzle ORM instead of PostgreSQL
Date: 2026-10-30 · Status: Accepted

- **Context:** Single-user local app; reviewers should run it without installing a database.
- **Decision:** SQLite file database via Drizzle ORM (`runs`, `steps`, `jobs`, `ai_calls`, `assets`).
- **Alternatives:** PostgreSQL (Docker or local install).
- **Consequences:** Zero setup. Drizzle schema is portable to `pg-core` for a multi-user deployment; noted as a next step.

## ADR-007 — In-process job queue on a SQLite `jobs` table
Date: 2026-10-30 · Status: Accepted

- **Context:** Pipeline runs take minutes (image generation); HTTP requests must not block; runs must survive restarts.
- **Decision:** `jobs` table + in-process worker (poll, lock with `locked_at`, attempts/max_attempts, requeue stale jobs on boot). SSE pushes progress to the UI.
- **Alternatives:** Redis + BullMQ — robust, but extra infrastructure for one process.
- **Consequences:** No extra services; concurrency 1 by default. Queue behind a small interface so BullMQ can replace it when scaling horizontally.

## ADR-008 — File artifact per stage + resumability
Date: 2026-10-30 · Status: Accepted

- **Context:** Assignment asks for intermediate results and ideally resuming from a saved phase; expensive AI calls should not be repeated.
- **Decision:** Each stage writes to `runs/<run_id>/NN_stage/` (JSON + human-readable MD + PNG) and records status (`state.json` for CLI, `steps` table for server). A stage reads only earlier artifacts. `--from-step N` / "Rerun from this stage" recomputes N…5.
- **Alternatives:** DB-only storage; single monolithic run.
- **Consequences:** Artifacts are inspectable and shippable with the submission; enables hand-edit-then-resume (logged in REFINEMENTS.md).

## ADR-009 — Model IDs and generation settings configurable via env
Date: 2026-10-30 · Status: Accepted

- **Context:** Model names, prices and quality tiers change; dev runs should be cheaper than the final run.
- **Decision:** `.env` keys `OPENAI_TEXT_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_MODEL`, `IMAGE_SIZE`, `IMAGE_QUALITY`, `QA_SCORE_THRESHOLD`, `MAX_REGENERATIONS`, `DATABASE_PATH`, `RUNS_DIR`, `BRAND_KIT_DIR`, `PORT`, validated by Zod in `packages/core/src/config.ts`; price table in config. Effective config snapshotted into each run (`config.json` / `runs.config_json`).
- **Alternatives:** Hard-coded models.
- **Consequences:** Reproducibility — the exact models/settings of the submitted run are recorded; `.env.example` doubles as the "example config without keys".

## ADR-010 — CLI and post quality first, UI second
Date: 2026-10-30 · Status: Accepted

- **Context:** Fixed deadline; the submission is judged mainly on post quality and a reproducible recipe.
- **Decision:** Milestones M1–M4 deliver a CLI pipeline producing finished posts; M5–M6 (server, web) build on the same core afterwards.
- **Alternatives:** UI-first.
- **Consequences:** A complete submission exists after M4 + M8 even if UI time runs out.

## ADR-011 — No video / reels
Date: 2026-10-30 · Status: Accepted

- **Context:** Assignment allows any combination of formats; video adds generation cost, FFmpeg work and brand-consistency risk.
- **Decision:** Single images and carousels only.
- **Alternatives:** Reel from carousel slides with FFmpeg (Ken Burns + text animation).
- **Consequences:** Mentioned in PDF limitations and improvement proposal.

## ADR-012 — LoRA personalisation deferred to the proposal
Date: 2026-10-30 · Status: Accepted

- **Context:** Vacancy mentions LoRA research; compose (ADR-004) already guarantees packaging accuracy for this scope.
- **Decision:** No LoRA training. Proposal in PDF: train a Flux LoRA (fal.ai / Replicate) on GymBeam packaging and visual style for in-scene product rendering; evaluate vs compose.
- **Alternatives:** Train now (time + cost + extra provider).
- **Consequences:** Clear research next step with evaluation plan.

## ADR-013 — Croatian captions, English documentation
Date: 2026-10-30 · Status: Accepted

- **Context:** @gymbeamhr posts in Croatian; submission language must be English or Croatian.
- **Decision:** Captions and on-image text in Croatian (brand market); all docs, PDF, prompts and code in English. `POSTS.md` adds English glosses for reviewers.
- **Alternatives:** English captions (off-brand); everything in Croatian.
- **Consequences:** Author reviews Croatian copy; language is a brief parameter (`caption_language`).

## ADR-014 — Claude Code as development tool and alternative recipe entry point
Date: 2026-10-30 · Status: Accepted

- **Context:** Vacancy values AI-assisted development with the ability to review AI code; the assignment accepts prompt-only recipes for agentic environments.
- **Decision:** Code is written with Claude Code and reviewed/edited by the author (stated openly in the PDF; TIMELOG separates author active time from Claude Code working time). `RECIPE.md` lets the same phases run inside Claude Code, reading/writing the same artifact layout.
- **Alternatives:** Hand-written code only; app-only recipe.
- **Consequences:** Faster delivery; review corrections are documented in REFINEMENTS.md. Two entry points must be kept consistent.

## ADR-015 — Brand: GymBeam Croatia (@gymbeamhr)
Date: 2026-10-30 · Status: Accepted (confirmed by the author)

- **Context:** Must choose a real brand with Instagram and explain why.
- **Decision:** GymBeam Croatia — Instagram @gymbeamhr, site gymbeam.hr. Large public product catalogue with clear packshots (good for compose), consistent visual identity, suggested first by the assignment.
- **Alternatives:** Dida Boža (second suggestion); a small local business (less public product data).
- **Consequences:** Recipe stays brand-parameterised (`brand_kit/<slug>`, brief); a second brand is mentioned but not evaluated.

## ADR-016 — Toolchain details from the M0 scaffold
Date: 2026-10-30 · Status: Accepted

- **Context:** Current package majors (TypeScript 7, pnpm 11, Vitest 5, Tailwind 4, better-sqlite3 13) changed some defaults; native modules must actually load.
- **Decision:** better-sqlite3 pinned to v12 (v13 prebuilt binary segfaults on Node 22.12 / darwin-arm64); pnpm 11 `allowBuilds` for `better-sqlite3`, `esbuild`, `sharp`; workspace packages expose a custom `source` export condition so dev/typecheck/tests run from `src/` without a build, while `tsconfig.build.json` emits `dist/`; config loads `.env` via `process.loadEnvFile()` (no dotenv), `OPENAI_API_KEY` is only required when a stage calls OpenAI (`requireOpenAIKey()`); Tailwind v4 via `@tailwindcss/vite`, no config files; server binds to 127.0.0.1.
- **Alternatives:** dotenv; building packages before every dev run; better-sqlite3 13 with a Node upgrade.
- **Consequences:** `pnpm install && pnpm typecheck && pnpm test` works without a key; retry better-sqlite3 13 after upgrading Node.

## ADR-017 — No recurring people in posts
Date: 2026-10-30 · Status: Accepted

- **Context:** The brief requires identity consistency across frames if people/influencers are used; people are optional.
- **Decision:** Posts feature products, scenes and typography only. People may appear only as anonymous, non-identifiable background elements; no recurring person or influencer.
- **Alternatives:** A generated recurring model (needs reference/LoRA for identity consistency).
- **Consequences:** Removes identity-drift risk; mentioned as a limitation and as a LoRA use case in the proposal.

## ADR-018 — Prices: current verified price or ask the user
Date: 2026-10-30 · Status: Accepted

- **Context:** Prices must not be invented, and prices on gymbeam.hr change often.
- **Decision:** Stage 02 extracts current prices from the official site with source URL and retrieval date (`status: verified`). If a price is missing, ambiguous (variants, promo vs regular) or the model is not confident, the pipeline does not guess: it records a `pending_confirmation` item and asks the user (CLI prompt / UI form) before the price is used in a post. Without confirmation the price is left out.
- **Alternatives:** Never show prices; trust the model's extraction.
- **Consequences:** Adds a human-in-the-loop checkpoint (documented under "Human actions required"); confirmed prices are stored in the run artifacts with who/when confirmed.

## ADR-019 — Mock AI provider for keyless development and tests
Date: 2026-10-30 · Status: Accepted

- **Context:** Development starts before an OpenAI key is available; tests must not call paid APIs.
- **Decision:** The AI client sits behind an interface with two implementations: `openai` and `mock` (selected by `AI_PROVIDER`, default `openai`). The mock returns schema-valid fixtures and placeholder images, so the whole pipeline, server and UI can run end-to-end without a key.
- **Alternatives:** Develop stages only after the key arrives; record/replay real responses.
- **Consequences:** Unit and integration tests run offline and free; the cost tracker logs `cost_usd = 0` for mock calls.

## мADR-020 — Cheapest image settings by default, high quality only for the final run
Date: 2026-10-30 · Status: Accepted

- **Context:** Image generation is the main cost driver; most runs during development are for testing the pipeline, not for final quality.
- **Decision:** Defaults are the cheapest options (prices checked 2026-10-30): `OPENAI_TEXT_MODEL=OPENAI_VISION_MODEL=gpt-6-luna` ($0.10 / $0.50 per 1M tokens; GPT-6 reasoning model, text + image input, released 2026-09-22, the official replacement for `gpt-5.4-nano`), `OPENAI_IMAGE_MODEL=gpt-image-1-mini`, `IMAGE_QUALITY=low`, `IMAGE_SIZE=1024x1024`. Rejected: `gpt-5.4-nano` ($0.20 / $1.25, supports `web_search`, but deprecated — shutdown 2027-04-01); `gpt-5-nano` (no `web_search`, shutdown 2026-12-11); `gpt-4o-mini` (older generation). `web_search` support on `gpt-6-luna` is inferred from the web search guide (GPT-5+ reasoning models) and must be confirmed on the first real call; fallback is `gpt-5.4-nano`. The final submission run uses `gpt-6.1-sol` / `gpt-6.1-terra` / `gpt-image-2.5-flare`, `IMAGE_QUALITY=high`, `IMAGE_SIZE=1024x1536`; compose cover-crops any background to the post canvas, so the size can change without code changes. The final run's effective settings are snapshotted into the run (ADR-009).
- **Alternatives:** High-quality defaults (expensive iterations); a separate dev/prod profile file.
- **Consequences:** Cheap iterations; README documents the final-run settings; cost_report shows the difference between test and final runs.

