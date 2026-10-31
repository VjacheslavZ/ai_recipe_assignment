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
- **Decision:** Node 22 + TypeScript, pnpm workspaces: `packages/core` (stages, schemas, OpenAI wrapper, compose), `packages/server` (Fastify + SQLite), `packages/web` (React + Vite + Tailwind), `packages/cli` (removed by ADR-027). Vitest for tests.
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
- **Decision:** Each stage writes to `runs/<run_id>/NN_stage/` (JSON + human-readable MD + PNG) and records status (`state.json` in the run folder, `steps` table in SQLite). A stage reads only earlier artifacts. "Re-run from here" recomputes N…5.
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
Date: 2026-10-30 · Status: Superseded by ADR-027 (all content in English)

- **Context:** @gymbeamhr posts in Croatian; submission language must be English or Croatian.
- **Decision:** Captions and on-image text in Croatian (brand market); all docs, PDF, prompts and code in English. `POSTS.md` adds English glosses for reviewers.
- **Alternatives:** English captions (off-brand); everything in Croatian.
- **Consequences:** Author reviews Croatian copy; language is a brief parameter (`caption_language`).

## ADR-014 — Claude Code as development tool and alternative recipe entry point
Date: 2026-10-30 · Status: Partly superseded by ADR-027 (RECIPE.md and the CLI removed; Claude Code stays the development tool)

- **Context:** Vacancy values AI-assisted development with the ability to review AI code; the assignment accepts prompt-only recipes for agentic environments.
- **Decision:** Code is written with Claude Code and reviewed/edited by the author (stated openly in the PDF; TIMELOG separates author active time from Claude Code working time). `RECIPE.md` lets the same phases run inside Claude Code: the agent runs each phase through the CLI, checks its artifact against a checklist and stops at human checkpoints (price answers, post approval). It does not re-implement phases in prompts, so there is one implementation to keep correct. Because an agent's shell is not interactive, the CLI prints unanswered price questions with their ids and accepts answers with `--answer <id>=<value>` (updated 2026-10-30, M7).
- **Alternatives:** Hand-written code only; app-only recipe.
- **Consequences:** Faster delivery; review corrections are documented in REFINEMENTS.md. RECIPE.md needs Node and the repo like the CLI; a prompt-only recipe without code was rejected because compositing real product photos needs `sharp`.

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

## ADR-020 — Cheapest image settings by default, high quality only for the final run
Date: 2026-10-30 · Status: Accepted

- **Context:** Image generation is the main cost driver; most runs during development are for testing the pipeline, not for final quality.
- **Decision:** Defaults are the cheapest options (prices checked 2026-10-30): `OPENAI_TEXT_MODEL=OPENAI_VISION_MODEL=gpt-6-luna` ($0.10 / $0.50 per 1M tokens; GPT-6 reasoning model, text + image input, released 2026-09-22, the official replacement for `gpt-5.4-nano`), `OPENAI_IMAGE_MODEL=gpt-image-1-mini`, `IMAGE_QUALITY=low`, `IMAGE_SIZE=1024x1024`. Rejected: `gpt-5.4-nano` ($0.20 / $1.25, supports `web_search`, but deprecated — shutdown 2027-04-01); `gpt-5-nano` (no `web_search`, shutdown 2026-12-11); `gpt-4o-mini` (older generation). `web_search` support on `gpt-6-luna` is inferred from the web search guide (GPT-5+ reasoning models) and must be confirmed on the first real call; fallback is `gpt-5.4-nano`. The final submission run uses `gpt-6.1-sol` / `gpt-6.1-terra` / `gpt-image-2.5-flare`, `IMAGE_QUALITY=high`, `IMAGE_SIZE=1024x1536`; compose cover-crops any background to the post canvas, so the size can change without code changes. The final run's effective settings are snapshotted into the run (ADR-009).
- **Alternatives:** High-quality defaults (expensive iterations); a separate dev/prod profile file.
- **Consequences:** Cheap iterations; README documents the final-run settings; cost_report shows the difference between test and final runs.

## ADR-021 — Compose details: Pango text, flood-fill cut-out, cached backgrounds
Date: 2026-10-30 · Status: Accepted

- **Context:** Stage 04 must render Croatian copy reliably, place real packshots and keep re-runs cheap.
- **Decision:** Text is rendered with sharp's Pango text input (word wrap at the box width, auto-fit to the box height, capped at 640 dpi ≈ 105 px headlines), so long copy shrinks instead of overflowing; headlines uppercase, white, on a radial scrim over the generated background. Canvases: 1080×1350 feed, 1080×1920 story; backgrounds are cover-cropped (`position: attention`). Packshots on white are cut out by flood-fill from the border (RF-002), get a soft shadow from their own alpha and are fitted into the layout's product box. The price badge uses the most saturated brand colour. A labelled "PRODUCT PHOTO MISSING" placeholder is drawn when the brand kit lacks a photo, and the logo is skipped (never synthesised) when missing. Backgrounds are reused when prompt, model, size and quality are unchanged (hash in `image_prompts.json`), so re-running compose costs nothing. Captions are taken from the validated plan (fact checking happens in stage 05).
- **Alternatives:** SVG `<text>` with manual wrapping (no reliable measurement); generating text with the image model (garbled diacritics); always regenerating backgrounds.
- **Consequences:** Font is the system `sans bold` unless a licensed brand font is added (fontconfig name), so typography differs from the brand's — noted as a limitation. Reproducible slide geometry is stored in `compose_specs.json`.

## ADR-022 — QA: vision rubric per slide, caption fact check, one targeted regeneration
Date: 2026-10-30 · Status: Accepted

- **Context:** The assignment requires checked results and no invented facts; the vacancy asks for automated quality checking of generated images.
- **Decision:** Stage 05 sends each finished slide (plus the reference product photo when there is one) to the vision model with a five-criterion rubric (brand fit, readability, product accuracy, goal fit, text correctness), scores 1–5 each, mapped to 0–10 and compared with `QA_SCORE_THRESHOLD`. A failing slide gets at most `MAX_REGENERATIONS` new backgrounds: the original prompt plus the QA's `backgroundFix`, recomposed with the same real assets and re-scored; the best attempt ships, all attempts stay in `review.json`. Captions are fact-checked by the text model against the verified facts and usable prices, plus a code check of every price in the text. Captions are never rewritten automatically (that could introduce new claims): failures go to "Needs human attention", together with missing product photos, a missing logo and mock runs. Output: `05_review/posts/` (chosen versions), `POSTS.md`, `review.md`, `review.json`, `posts.zip`.
- **Alternatives:** Regenerate the whole post; let the model rewrite captions; a second model as judge only.
- **Consequences:** Regeneration only touches the background, so it cannot fix copy or layout problems (those need a plan/compose change → REFINEMENTS). QA cost is one vision call per slide per attempt plus one text call per caption.

## ADR-023 — Server: SQLite index + in-process queue, bootstrap DDL, human answers over the API
Date: 2026-10-30 · Status: Accepted

- **Context:** The web UI needs run lists, live progress and a way to answer price questions; the pipeline already keeps artifacts in `runs/<runId>/`.
- **Decision:** SQLite (Drizzle, better-sqlite3) stores `runs`, `steps` (status history), `jobs` and `ai_calls`; artifacts stay in files. Tables are created by bootstrap DDL on start rather than drizzle-kit migrations: one file to read, nothing to run by hand. A single in-process worker polls `jobs`, claims one with a conditional update, runs the core pipeline and publishes events; jobs left `running` after a crash are requeued on boot. One job at a time, because runs are long and rate-limited. Failed runs are not retried automatically: AI calls retry internally, and a failed stage usually needs a human fix, so reruns go through `POST /api/runs/:id/rerun`. Price questions (ADR-018) become `question` events; the stage waits for `POST /api/runs/:id/answers` (10 min timeout → price omitted). Uploads sent with `POST /api/runs` go into a per-run brand kit copy, so runs never change the repo's brand kit. Files are served only from inside the run folder.
- **Alternatives:** BullMQ/Redis; drizzle-kit migrations; an `assets` table.
- **Consequences:** No extra infrastructure. While a run waits for an answer the queue is blocked, which suits a single-user tool; a multi-user product would need per-run concurrency and persisted questions.

## ADR-024 — Web UI: one "proofing desk" app on top of the server API
Date: 2026-10-30 · Status: Accepted

- **Context:** The UI has to start runs, show progress, take answers to price questions and present the posts for approval. It is an internal tool for one marketer, so it should stay small and show the posts the way the audience will see them.
- **Decision:** One React page with hash routes (`#/`, `#/runs/:id`), no router or state library. A run subscribes to the SSE stream; a reducer applies events, and a `revision` counter bumps when a stage finishes so tabs refetch their artifacts. Stage outputs are shown by rendering the markdown files the pipeline already writes (`analysis.md`, `plan.md`, `review.md`), so the UI and the downloaded files show the same text. Posts are shown in phone frames with a scroll-snap carousel, QA score per slide, caption and fact-check result. The visual style is a neutral grey desk with paper panels, so any brand palette reads true; red is used only for things a human must check (questions, failed QA, "check before publishing").
- **Alternatives:** React Router + TanStack Query; dedicated React views for each JSON artifact; polling instead of SSE.
- **Consequences:** Few dependencies (`marked` only) and one source of truth for stage output. A run blocked on a question must be impossible to miss (updated 2026-10-31): a red "waiting for your answer" block above the stage strip with a countdown to the automatic skip (questions carry `expiresAt`), the stage shown as "Waiting for your answer", "Needs your answer" in the runs list (`pendingQuestions` in `GET /api/runs`) and in the tab title. The live stream recovers from server restarts: the server ends SSE streams in a `preClose` hook and sends a named `ping` every 15 s; the page reconnects after an HTTP error or 40 s of silence (a dev proxy can keep a dead stream open). Markdown is rendered as HTML without sanitising because it comes from the app's own pipeline; if users could edit artifacts, it would need sanitising. Log lines are live only, not stored.

## ADR-025 — Docker: one container for API, worker and built UI
Date: 2026-10-30 · Status: Superseded by ADR-027 (Docker dev setup with hot reload)

- **Context:** A reviewer should be able to run the app without installing Node, pnpm and native modules.
- **Decision:** One image (`node:22-bookworm-slim`) installs dependencies with the pinned pnpm, builds the web UI and runs the server from TypeScript sources with tsx, as `pnpm dev:server` does. When `packages/web/dist` exists, the API server also serves the UI with an app-shell fallback, so there is one process and one port (3001). New settings: `HOST` (default `127.0.0.1`, `0.0.0.0` in the image) and `WEB_DIST_DIR`. `compose.yaml` mounts `data/`, `runs/`, and `brand_kit/` + `brief.example.yaml` read-only, reads `.env` if present, and uses its own database file because run paths stored in SQLite differ inside the container. The image installs fontconfig and DejaVu fonts, because Pango needs a font for slide text. Found while testing: `fs.cpSync` into a Docker Desktop bind mount fails with EACCES, so the per-run brand kit is copied file by file.
- **Alternatives:** Separate nginx container for the UI; compiled `dist/` server; Node 22.12 base image (the pinned pnpm 11 requires 22.13+).
- **Consequences:** `docker compose up --build` is the shortest way to try the app. The image keeps dev dependencies (tsx, Vite) for simplicity, so it is larger than a production image would be.

## ADR-026 — Local models through Ollama for free test runs; caption language as a setting
Date: 2026-10-31 · Status: Withdrawn by ADR-028 (Ollama provider removed); the language setting is superseded by ADR-027

- **Context:** Mock fixtures prove the pipeline wiring but never exercise the prompts and schemas against a real model. OpenAI runs cost money and need the key, which is added last.
- **Decision:** `AI_PROVIDER=ollama` points the same OpenAI SDK code at Ollama's OpenAI-compatible Responses API (checked: structured output with a JSON schema works on Ollama 0.40). Text calls use `OLLAMA_TEXT_MODEL` (default `qwen3:14b`), vision calls `OLLAMA_VISION_MODEL` (default `qwen2.5vl:7b`); thinking is turned off, timeouts are longer, cost is recorded as $0. Calls that need hosted web search, and image generation, go to the mock: Ollama has neither (its search is a cloud service with an account), and a local model asked to research the site without search would invent facts and mark them verified. The review lists such runs as not publishable. The post language became a setting: `market.captionLanguage` in the brief (`hr` or `en`) with an env override `CONTENT_LANGUAGE`. Local test runs use English because small models write poor Croatian. Plan fields lost their `Hr` suffix (`headline`, `subtext`, `caption`; `*En` stays the English gloss).
- **Alternatives:** A separate Ollama client on the native `/api/chat`; a local web fetcher for site research; generating backgrounds with a local diffusion model.
- **Consequences:** Free, realistic runs for prompt and schema work. Quality of local output says nothing about the final run. Runs created before the field rename cannot be re-run from step 4 or 5.

## ADR-027 — The web UI is the only way to run the recipe; Docker-only development; English content
Date: 2026-10-31 · Status: Accepted (decided by the author)

- **Context:** Three entry points (CLI, Claude Code via RECIPE.md, web UI) meant three sets of instructions and behaviour to keep in sync, and the CLI needed workarounds for non-interactive shells (`--answer`). Running on the host needed Node 22.13+, pnpm and native modules. Captions in Croatian could not be reviewed by the reviewer or the author with confidence, and small local models write poor Croatian.
- **Decision:** Runs are started, answered, re-run and downloaded only in the web UI; `packages/cli` and `RECIPE.md` are removed. The app is started and developed only through `docker compose up`: two containers from one dev image, `server` (`tsx watch`, file polling because inotify events from Docker Desktop bind mounts missed editor saves) and `web` (Vite with HMR, proxying `/api` to `server`). The repo is bind-mounted, `node_modules` live in named volumes. The API server no longer serves a built UI (`WEB_DIST_DIR` removed). All post copy (on-image text and captions) is in English: the language setting (`market.captionLanguage`, `CONTENT_LANGUAGE`) and the `*En` gloss fields are removed; the rule is one of the default brief constraints and part of the plan prompt (`plan@3`, `review@3`).
- **Alternatives:** Keep the CLI for scripted runs; a production image with a built UI next to the dev setup; Croatian captions with an English gloss.
- **Consequences:** One documented way to run and one way to develop; the reviewer needs only Docker. Resuming a run is the UI's "Re-run from here". Posts are in English for a Croatian brand account, which is stated as a limitation; adding a language back is a prompt rule plus a brief field. Runs made before this change (Croatian fields, host paths in the old database `data/recipe.pre-docker.db`) cannot be re-run.

## ADR-028 — No local-model testing; test with the OpenAI API on the cheapest models
Date: 2026-10-31 · Status: Accepted (decided by the author)

- **Context:** The Ollama provider (ADR-026) ran only part of the pipeline for real: site research and image generation stayed mock, because Ollama has no hosted web search without an ollama.com account and no image endpoint. Small local models were weak judges (QA let unsupported slide text through), so local runs said little about the final run while adding a provider, settings and a code path to maintain.
- **Decision:** The Ollama provider, its settings and the `host.docker.internal` mapping are removed; providers are `openai` and `mock`. Test runs use the OpenAI API with the cheapest defaults (`gpt-6-luna`, `gpt-image-1-mini`, low quality, 1024×1024). To avoid paid surprises: `POST /api/runs` refuses a real run without a key before creating it, and `GET /api/openai/check` ("Check OpenAI setup" in the UI) retrieves each configured model (`GET /v1/models/{id}`, free) and reports a rejected key, unknown models, models without a price entry and announced shutdown dates.
- **Alternatives:** Keep Ollama for prompt work; a local diffusion server (LocalAI, stable-diffusion.cpp) for backgrounds; a paid "smoke" call per model in the check.
- **Consequences:** Every realistic test costs money (a few cents per run on the defaults) and needs the key. The check does not prove a model accepts every parameter (e.g. the `web_search` tool); stage 2 reports that on the first run.

