# Development Plan — "From an Instagram brand to three finished posts"

Status date: 2026-10-30 · Brand: **GymBeam Croatia** — Instagram [@gymbeamhr](https://www.instagram.com/gymbeamhr/), site [gymbeam.hr](https://gymbeam.hr) (pending final confirmation, see ADR log in [DECISIONS.md](./DECISIONS.md)).

Related docs: [DECISIONS.md](./DECISIONS.md) (ADRs) · [TIMELOG.md](./TIMELOG.md) (time tracking) · [REFINEMENTS.md](./REFINEMENTS.md) (how AI output was corrected).

---

## 1. Goal and success criteria

**Goal.** A re-runnable, resumable AI recipe that turns a short brand brief into three finished, on-brand Instagram posts (images + Croatian captions), with saved intermediate artifacts (brief, analysis, plan, prompts, QA review) and cost/time tracking. Delivered as code (pnpm monorepo: CLI + web app) plus a 1–2 page PDF.

**Success criteria (checked before submission in M8):**

| # | Criterion | How it is checked |
|---|---|---|
| S1 | 3 finished posts, numbered 1/2/3; carousel slides in order; each has caption, format, goal, rationale | `runs/<id>/04_create/` + `posts/POST_1..3/` folders; gallery screen |
| S2 | Product photos, logo, packaging, labels are pixel-accurate (not AI-redrawn) | Compose pipeline uses real files from `brand_kit/`; QA rubric item "product accuracy" ≥ threshold; manual visual check |
| S3 | No invented product properties, prices or quotes | Plan/caption prompts restricted to facts in `analysis.json` tagged `verified`; QA rubric item "no invented facts"; manual check against source URLs |
| S4 | Brand analysis cites specific URLs/examples, separates verified / assumption / unavailable | `analysis.json` schema enforces a `status` + `source` per fact; `analysis.md` rendering |
| S5 | One command re-runs the process end to end; any stage can be resumed | `pnpm recipe run --brief brief.yaml` and `--from-step N`; tested in M7 |
| S6 | Recipe has no hidden dependencies: start command, tools, models, settings, human actions documented | README, RECIPE.md, `.env.example`, `brief.example.yaml` |
| S7 | PDF ≤ 2 pages covering all required sections | Checklist in §13 |
| S8 | Time log separates active work from waiting | `TIMELOG.md` totals |
| S9 | Cost per run is reported | `cost_report.json` from `ai_calls` table; UI cost screen |

---

## 2. Architecture overview

```
                         ┌──────────────────────────────┐
  brief.yaml ──────────► │ packages/cli                 │  pnpm recipe run --brief brief.yaml [--from-step N]
  brand_kit/<brand>/ ──► │  (commander, thin wrapper)   │
                         └──────────────┬───────────────┘
                                        │ calls
┌───────────────────────┐    REST/SSE   │
│ packages/web          │ ◄──────────►  │
│ React + Vite + Tailwind│              ▼
│ New run · Run view ·  │    ┌──────────────────────────────┐
│ Gallery · Cost        │    │ packages/server              │
└───────────────────────┘    │ Fastify REST + SSE           │
                             │ in-process job worker        │
                             │ SQLite (Drizzle ORM)         │
                             │ runs/steps/jobs/ai_calls/    │
                             │ assets                       │
                             └──────────────┬───────────────┘
                                            │ calls
                             ┌──────────────▼───────────────┐
                             │ packages/core                │
                             │ stages 01..05 (pure-ish fns) │
                             │ Zod schemas (structured out) │
                             │ OpenAI client wrapper        │──► OpenAI Responses API
                             │  (retry, timeout, cost log)  │    (text+web_search, vision,
                             │ compose (sharp + SVG text)   │     image generation)
                             │ artifact store (runs/<id>/)  │
                             └──────────────┬───────────────┘
                                            ▼
                     runs/<run_id>/01_brief … 05_review/  (JSON, MD, PNG, ZIP)
```

- **core** has no knowledge of HTTP or DB; it receives a `RunContext` (run dir, config, `onAiCall` / `onProgress` callbacks). CLI and server both drive the same stage functions → identical behaviour from either entry point.
- **CLI** persists status to `runs/<id>/state.json` when run standalone; **server** persists to SQLite and mirrors the same artifact files.
- **RECIPE.md** is a third entry point: step-by-step prompts for running the same phases inside Claude Code. The agent runs each phase through the CLI (`--from-step N --to-step N`), checks the artifact against a checklist and stops at human checkpoints, so all three entry points share one implementation (ADR-014).

### Data flow (one run)

```
brief.yaml + uploads ─► 01 Brief ─► brief.json
brief.json + screenshots + site (web_search) ─► 02 Analysis ─► analysis.json / analysis.md
analysis.json + brief.json ─► 03 Plan ─► plan.json / plan.md
plan.json + brand_kit assets ─► 04 Create ─► slides/*.png, captions.json, image_prompts.json
slides + plan + analysis ─► 05 Review ─► review.json (+ ≤1 regeneration per failing slide) ─► posts.zip
every AI call ─► ai_calls ─► cost_report.json
```

---

## 3. Pipeline stages

| # | Stage | Input | What it does | Output | Artifact file(s) |
|---|---|---|---|---|---|
| 01 | Brief | `brief.yaml` (CLI) or form (UI); uploaded logo, product images, Instagram screenshots, reference links | Validates with Zod; normalises URLs; copies/registers assets; records which assets exist (logo, N products with names, N screenshots); asks for missing required fields (UI form validation / CLI error with hint) | Normalised brief | `01_brief/brief.json`, `assets` rows |
| 02 | Analysis | `brief.json`, screenshots, brand site | (a) Site research via Responses API + `web_search` restricted to the brand domain(s) → product facts with URLs; (b) vision model over Instagram screenshots → tone, themes, visual style, HEX colours, how products/people are shown; (c) merge into one structured analysis. Every fact: `status: verified \| assumption \| unavailable`, `source` (URL or screenshot filename), `evidence` | Brand analysis | `02_analysis/analysis.json`, `analysis.md`, `sources.json` |
| 03 | Plan | `analysis.json`, `brief.json` | Plans 3 posts: goal (educate / engagement / saves / product intro / purchase intent), format (single / carousel), concept, rationale tied to analysis, slide list with on-image text, product asset per slide, caption draft (HR), hashtags. Only `verified` facts may appear as claims | Content plan | `03_plan/plan.json`, `plan.md` |
| 04 | Create | `plan.json`, `analysis.json` (colours, style), `brand_kit/` | Per slide: build background prompt (scene without product/logo/text) → image model → `sharp` composite: background + real product cut-out (shadow, scale, placement) + real logo + headline/body text as SVG with brand font → 1080×1350 PNG. Final caption polish. | Finished slides & captions | `04_create/post_<n>/slide_<k>.png`, `captions.json`, `image_prompts.json`, `compose_specs.json` |
| 05 | Review | slides, `plan.json`, `analysis.json` | Vision QA per slide + per post against rubric: brand fit, readability/contrast, product accuracy (compared with reference photo), goal fit, no invented facts (caption vs verified facts). Score < threshold → regenerate that slide once (new seed / prompt fix from QA feedback) → re-score. Packages final posts. | QA report + final package | `05_review/review.json`, `review.md`, `posts.zip`, `cost_report.json` |

Resumability: each stage reads only files from earlier stage folders; a stage is "done" when its artifact exists and validates against its Zod schema and the DB/state marks it `succeeded`. `--from-step N` deletes/overwrites stage ≥ N artifacts and keeps earlier ones.

---

## 4. Data model sketch (SQLite, Drizzle)

| Table | Key columns | Notes |
|---|---|---|
| `runs` | `id` (ulid), `brand_slug`, `status` (`pending\|running\|succeeded\|failed\|cancelled`), `brief_json`, `config_json` (model IDs, thresholds, seed), `run_dir`, `created_at`, `finished_at`, `total_cost_usd`, `total_duration_ms` | One recipe execution |
| `steps` | `id`, `run_id` FK, `step_no` (1–5), `name`, `status`, `attempt`, `artifact_paths` (json), `error`, `started_at`, `finished_at` | One row per stage per attempt |
| `jobs` | `id`, `run_id` FK, `type` (`run_pipeline`, `rerun_from_step`, `regenerate_slide`), `payload` (json), `status` (`queued\|running\|done\|failed`), `attempts`, `max_attempts`, `locked_at`, `run_after`, `last_error`, `created_at` | In-process queue; worker polls `queued` ordered by `created_at`; stale `locked_at` → requeue on boot |
| `ai_calls` | `id`, `run_id` FK, `step_no`, `purpose` (e.g. `analysis.site`, `create.bg.p2s3`), `model`, `kind` (`text\|vision\|image`), `input_tokens`, `output_tokens`, `image_count`, `image_size`, `cost_usd`, `duration_ms`, `status`, `retry_count`, `request_hash`, `created_at` | Cost & latency per call; `cost_usd` from price table in config |
| `assets` | `id`, `run_id` FK (nullable for shared brand kit), `kind` (`logo\|product\|screenshot\|reference\|background\|slide`), `label` (e.g. product name), `path`, `mime`, `width`, `height`, `sha256`, `source_url`, `created_at` | Uploaded and generated files |

---

## 5. API sketch (Fastify)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/runs` | Create run from brief JSON (multipart: brief + files) → enqueue `run_pipeline` |
| `GET` | `/api/runs` | List runs (status, cost, duration) |
| `GET` | `/api/runs/:id` | Run detail incl. steps |
| `GET` | `/api/runs/:id/events` | **SSE**: `step.started`, `step.progress`, `step.succeeded`, `step.failed`, `ai_call`, `run.finished` |
| `GET` | `/api/runs/:id/steps/:n/artifact` | Stage output JSON (analysis, plan, review…) |
| `POST` | `/api/runs/:id/rerun` | Body `{ fromStep }` → enqueue `rerun_from_step` |
| `POST` | `/api/runs/:id/posts/:p/slides/:s/regenerate` | Optional: regenerate a single slide |
| `GET` | `/api/runs/:id/posts` | Posts with slides, captions, goal, rationale, QA scores |
| `GET` | `/api/runs/:id/files/*` | Static serving of run artifacts (PNG etc.) |
| `GET` | `/api/runs/:id/download` | `posts.zip` |
| `GET` | `/api/runs/:id/costs` | Aggregated `ai_calls` by step/model + timings |
| `POST` | `/api/assets` | Upload logo / product / screenshot (multipart) |

---

## 6. UI screens (React + Vite + Tailwind)

1. **New run** — brief form (brand name, Instagram handle, site URL, products to promote, audience, goals, references/links, caption language) + drag-and-drop uploads for logo, product images (with product name each), Instagram screenshots. "Load example (GymBeam)" button pre-fills from `brief.example.yaml`.
2. **Run view** — 5 stage cards with live status via SSE (pending/running/succeeded/failed, duration, cost); click a stage → its output rendered (analysis with verified/assumption/unavailable badges and links, plan table, prompts, QA scores); "Rerun from this stage" button per stage.
3. **Posts gallery** — Post 1/2/3: slides in order (swipeable carousel), caption with copy button, format, goal, rationale, QA score per slide and per rubric item; "Download ZIP".
4. **Cost & time** — per run: table of AI calls by stage/model (tokens, images, $), totals, wall-clock per stage.

---

## 7. Milestones

Estimates are the **author's active time**; waiting time (Claude Code writing code, image generation) is logged separately in [TIMELOG.md](./TIMELOG.md). Order is deliberate: CLI + post quality first (M1–M4) so a complete submission exists even if UI time runs out.

### M0 — Monorepo skeleton, config, docs · est. 15 min · **DONE (2026-10-30)**

- [x] pnpm workspace: `packages/{core,server,web,cli}`, `tsconfig.base.json`, Vitest projects config (no ESLint/Prettier yet — optional)
- [x] `.env.example` (`OPENAI_API_KEY=`, `OPENAI_TEXT_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_MODEL`, `IMAGE_SIZE`, `IMAGE_QUALITY`, `QA_SCORE_THRESHOLD=7`, `MAX_REGENERATIONS=1`, `DATABASE_PATH`, `RUNS_DIR`, `BRAND_KIT_DIR`, `PORT`), `.gitignore` (`.env*`, `data/*`, `*.db`, `runs/_tmp/`)
- [x] `brand_kit/gymbeamhr/{products,instagram,fonts}/` placeholders + README, `runs/`, `data/`
- [x] `README.md` stub; server `GET /api/health`; web placeholder with Tailwind; CLI help
- [x] `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/TIMELOG.md`, `docs/REFINEMENTS.md`

**Done when:** `pnpm install && pnpm -r build && pnpm test` pass on an empty skeleton; docs exist.

### M1 — Core: OpenAI wrapper, schemas, stages 01–03, CLI · est. 45 min · **DONE in mock mode (2026-10-30)**; real OpenAI run pending the API key

- [x] `config.ts`: env loading + validation (Zod), price table per model, `AI_PROVIDER=openai|mock`
- [x] `ai/mock.ts`: mock provider returning schema-valid fixtures + placeholder images (ADR-019) — all development until the key arrives runs on it
- [x] Price confirmation: `pending_confirmation` items from stage 02 → CLI prompt (UI form in M6) (ADR-018)
- [x] `ai/openai.ts` (planned as `ai/client.ts`): Responses API wrapper — structured output via Zod (`zodTextFormat`), retries with exponential backoff (429/5xx/timeouts), per-call timeout, logs `{model, tokens, cost, duration, purpose}` via `onAiCall`
- [x] Zod schemas: `Brief`, `Fact` (`status`, `source`, `evidence`), `BrandAnalysis`, `ContentPlan`, `PostPlan`, `SlidePlan` (`Review` moves to M4)
- [x] Artifact store: `runs/<id>/NN_stage/` read/write + schema validation + `state.json`
- [x] Stage 01 brief, stage 02 analysis (site via `web_search`, screenshots via vision), stage 03 plan — verified with mock provider only; first real OpenAI call pending the key
- [x] CLI: `pnpm recipe run --brief brief.yaml [--from-step N] [--to-step N] [--run-id ID] [--yes]`, progress output, cost summary at end
- [x] `brief.example.yaml` for GymBeam — product URLs and image file names still marked VERIFY for the author

**Done when:** `pnpm recipe run --brief brief.example.yaml --to-step 3` produces valid `analysis.json` (each fact tagged, URLs present, inaccessible sources listed) and `plan.json` with 3 posts; rerun with `--from-step 3` reuses the existing analysis.

### M2 — Brand kit preparation (human + scripted) · est. 30 min

- [ ] Download official logo (SVG/PNG) from gymbeam.hr; record source URL in `brand_kit/gymbeamhr/SOURCES.md`
- [ ] 3–5 product images from gymbeam.hr product pages (white/transparent background), name + URL each; background removal / trim with `sharp` if needed
- [ ] 6–10 Instagram screenshots of @gymbeamhr grid and representative posts → `brand_kit/gymbeamhr/instagram/` (human action — Instagram blocks automated access)
- [ ] Brand font (or closest open font with licence note) → `brand_kit/gymbeamhr/fonts/`
- [ ] `brand_kit/gymbeamhr/brand.yaml`: products list (name, file, URL), logo path, font path

**Done when:** brief references only existing files; stage 01 registers all assets without warnings; stage 02 marks Instagram as "accessed via screenshots".

### M3 — Stage 04: generation + compose → first post drafts · est. 1–1.5 h · **code DONE in mock mode (2026-10-30)**; real images, visual review and RF-001 experiment pending the API key and brand kit

- [x] Background prompt builder (style from analysis, scene from slide plan, explicit "no product, no logo, no text" constraints, safe area for product/text)
- [x] Image generation call (size/quality from env), save raw background + prompt to `image_prompts.json`; unchanged backgrounds reused on re-run
- [x] `compose.ts` (sharp): layouts (text-only, product-center/left/right), product cut-out with soft shadow + scale, logo placement, Pango text auto-fit, scrim for contrast, price badge, 1080×1350 feed + 1080×1920 story — brand font not yet (system `sans bold`, ADR-021)
- [ ] Caption finalisation (HR) with only verified facts; hashtags — captions + hashtags + CTA assembled into `caption.txt`; fact check of caption text moves to M4
- [ ] Experiment (~30 min, part of estimate): compose vs OpenAI image edit with product reference for one slide → record in REFINEMENTS.md — pending the API key and real product photos
- [x] Unit tests: compose produces correct dimensions; text fits box (no overflow); cut-out keeps white areas inside the product

**Done when:** a full run produces 3 posts (≥1 carousel) as PNGs + `captions.json`; author's visual review finds no distorted logo/packaging; experiment entry written.

### M4 — Stage 05: QA + regeneration · est. 30 min · **code DONE in mock mode (2026-10-30)**; real vision QA pending the API key

- [x] QA rubric prompt + `Review` schema: per-criterion score 1–5 + reason (brand fit, readability, product accuracy vs reference photo, goal fit, text correctness); "no invented facts" is checked on the caption
- [x] Caption fact check: each claim in caption must map to a `verified` fact ID or be flagged; plus a code check that every price in the caption is verified/user-confirmed
- [x] Threshold from env; failing slide → one regeneration with QA feedback appended to prompt → re-score; keep best
- [x] `review.md`, `posts.zip` (chosen slides + captions + POSTS.md + review.md), `cost_report.json`

**Done when:** `review.json` has scores for every slide; a deliberately bad slide (e.g. low-contrast text) is caught and regenerated in a test run; cost report totals match `ai_calls`.

_Status 2026-10-30:_ scores for every slide ✅; regeneration of a failing slide ✅ in a unit test with a simulated low QA verdict (a real low-contrast slide judged by the vision model still to be checked with the key); cost report = `ai_calls` ✅ (21 calls, tokens equal) on a mock run.

### M5 — Server: SQLite, queue, API, SSE · est. 20 min · **DONE in mock mode (2026-10-30)**

- [x] Drizzle schema for `runs`, `steps`, `jobs`, `ai_calls` with bootstrap DDL on start instead of migrations (ADR-023); `assets` dropped — uploads live in the run's own brand kit folder
- [x] Job worker (poll loop, conditional-update lock, requeue stale on boot); no automatic retry of failed runs — rerun via API (ADR-023)
- [x] Routes from §5 (except single-slide regenerate and `/api/assets`: uploads go with `POST /api/runs`), plus `/api/example-brief` and `/api/runs/:id/answers` for price questions; SSE event bus
- [x] Server reuses core stages; persists `ai_calls` from `onAiCall`; 5 API tests (end-to-end run, path traversal, SSE events + human answer, stale requeue, rerun)

**Done when:** `POST /api/runs` with example brief completes all stages; killing the server mid-run and restarting resumes from the last succeeded step; SSE stream shows step events.

### M6 — Web: 3 screens + cost view · est. 30 min

- [x] New run form + uploads + "Load example"
- [x] Run view with SSE statuses, stage output viewers, "Rerun from here", price question card (ADR-024)
- [x] Posts gallery with carousel, caption, goal/rationale, QA, ZIP
- [x] Cost & time panel

Checked in the browser with mock AI (2026-10-30): run started from the form with uploaded logo and product photos, price question answered in the UI, posts, analysis and costs viewed, posts.zip offered; desktop and 390 px phone width.

**Done when:** a run can be started, watched and downloaded entirely from the browser.

### M7 — Tests, README, RECIPE.md · est. 20 min

- [x] Vitest: schema validation, cost calculation, compose dimensions/overflow, resumability (`--from-step` keeps earlier artifacts), job queue lock/requeue; AI calls mocked (84 tests)
- [x] README: prerequisites, setup, `.env`, start commands (CLI, server+web), human actions, what varies, cost & time, troubleshooting
- [x] RECIPE.md: Claude Code entry point — phases with prompts, inputs/outputs, same artifact layout; CLI `--answer` for price questions in non-interactive shells

**Done when:** `pnpm test` green; a fresh clone + README steps reach a finished run.

### M8 — Final run, selection, PDF · est. 45 min

- [ ] Clean final run from scratch; keep `runs/<final>/` in the submission
- [ ] Author selects/approves posts (document any rerun reasons in REFINEMENTS)
- [ ] Manual fact check of captions vs source URLs
- [ ] PDF report (1–2 pages), see §13
- [ ] Finalise TIMELOG totals
- [ ] Email submission

**Done when:** all items of the deliverables checklist (§13) are ticked.

**Total author active estimate:** ≈ 5–6 h. Actual time is logged in TIMELOG.md.

---

## 8. Requirements traceability

| # | Assignment requirement | Where satisfied |
|---|---|---|
| R1 | Choose a real brand with an Instagram account; give exact profile | `brief.example.yaml` (`instagram: https://www.instagram.com/gymbeamhr/`), README, PDF |
| R2 | Briefly explain the brand choice | PDF "Key decisions"; ADR in DECISIONS.md; `brief.example.yaml` `why_this_brand` |
| R3 | Interactive brief: ask site/shop URL | UI New run form; CLI validation error with prompt for missing field; `Brief` schema |
| R4 | Ask products to promote | Form field + `brief.products[]` |
| R5 | Ask audience | Form field + `brief.audience` |
| R6 | Ask goals | Form field + `brief.goals[]` |
| R7 | Ask references / inspiration | Form field + `brief.references[]` (links) |
| R8 | Allow links or uploads of product images, logos, other references | UI uploads + `POST /api/assets`; CLI `brand_kit/<brand>/` paths in brief; `assets` table |
| R9 | Prepare and attach own brief answers and inputs for the demo | `brief.example.yaml`, `brand_kit/gymbeamhr/` (+ `SOURCES.md`), copied into `runs/<final>/01_brief/` |
| R10 | Study Instagram posts: tone, audience, themes, style, colours, product & people presentation | Stage 02 vision analysis of screenshots → `analysis.json` fields `tone`, `audience`, `content_pillars`, `visual_style`, `colors_hex`, `product_presentation`, `people_presentation` |
| R11 | Use official site / shop / catalogue for facts | Stage 02 `web_search` scoped to gymbeam.hr; `sources.json` |
| R12 | Cite specific links and examples supporting conclusions | `Fact.source` (URL or screenshot file) + `evidence`; `analysis.md` |
| R13 | Separate verified information from assumptions | `Fact.status` enum `verified \| assumption`; badges in UI and `analysis.md` |
| R14 | List sources that could not be accessed | `Fact.status = unavailable` + `analysis.unavailable_sources[]` (e.g. Instagram direct access, blocked pages) |
| R15 | Plan 3 posts, each with goal, format, concept | Stage 03 `plan.json` (`PostPlan.goal/format/concept`) |
| R16 | Briefly explain why the approach suits the brand | `PostPlan.rationale` referencing analysis fact IDs |
| R17 | Choose formats (single image / carousel / story / reel) | `PostPlan.format`; video/reel out of scope (§11) |
| R18 | Number posts clearly 1, 2, 3 | Output folders `post_1..3`, filenames, gallery, ZIP |
| R19 | Deliver finished images + accompanying text (not a script/description) | Stage 04 PNGs + `captions.json`; `posts.zip` |
| R20 | Include all carousel slides in order | `slide_<k>.png` ordered; gallery order; ZIP order |
| R21 | Creativity / improve approach while keeping recognisable brand character, style, colours | Analysis-driven colours/fonts in compose; QA "brand fit" criterion; creative concepts in plan |
| R22 | Logos, products, packaging, labels accurate and consistent | Compose real product photo + real logo (ADR-004); QA "product accuracy"; experiment in REFINEMENTS |
| R23 | If people used, keep appearance consistent | No recurring person (ADR-017); people only as anonymous background — stated in plan prompt and PDF limitations |
| R24 | Don't invent product properties, prices, quotes of real people | Prompts allow only `verified` facts; prices only if current and verified with URL+date, otherwise the user is asked to confirm (ADR-018); no quotes; QA "no invented facts" + caption fact mapping; manual check in M8 |
| R25 | Posts are demo only, no publishing | No Instagram API integration; stated in README |
| R26 | Use real, available AI tools/models | OpenAI Responses API, `web_search`, vision, image model; model IDs in `.env.example` |
| R27 | Code on GitHub / ZIP; if web app, include code | Repo (or ZIP) with all packages |
| R28 | Must be possible to run the process (not just a results page) | CLI + server + web; RECIPE.md |
| R29 | Clear phases: brief/inputs, analysis, planning, creation, review/delivery | Stages 01–05 (§3) |
| R30 | Per phase: inputs, what it does, output passed on | §3 table; README; RECIPE.md; PDF phase overview |
| R31 | Include key intermediate results: analysis, plan, generation prompts | `analysis.json/.md`, `plan.json/.md`, `image_prompts.json`, `compose_specs.json`, `review.json` in `runs/<final>/` |
| R32 | Resume from a saved phase after interruption | Artifact-per-stage + `steps` status; `--from-step N`; server requeues stale jobs; UI "Rerun from this stage" |
| R33 | Deliver 3 posts: media + texts with format, goal, short rationale | `posts.zip` incl. `POSTS.md` (format/goal/rationale per post) |
| R34 | State Instagram profile, sources, input references needed to repeat | `brief.example.yaml`, `brand_kit/gymbeamhr/SOURCES.md`, `sources.json`, PDF |
| R35 | Recipe actually used: prompts or code (+ app link if any) | Repo; prompts in `packages/core/src/prompts/`; RECIPE.md |
| R36 | Start prompt/command | README + PDF: `pnpm recipe run --brief brief.example.yaml`; `pnpm dev` for UI |
| R37 | Tools and models | README "Tools & models"; `.env.example`; `runs/<id>/config.json` snapshot |
| R38 | Settings | `.env.example`, `config_json` per run (size, quality, threshold, seed) |
| R39 | All required manual actions | README "Human actions" (API key, Instagram screenshots, approve final selection) |
| R40 | No dependency on unshared chats or unexplained manual edits | All prompts in repo; RECIPE.md self-contained; any manual edit logged in REFINEMENTS |
| R41 | PDF 1–2 pages: setup & run | PDF §1 |
| R42 | PDF: phase overview | PDF §2 |
| R43 | PDF: key decisions | PDF §3 (from DECISIONS.md) |
| R44 | PDF: result checks | PDF §4 (QA rubric, fact check, manual review) |
| R45 | PDF: limitations | PDF §5 |
| R46 | PDF: time spent, active vs generation waiting | PDF §6 from TIMELOG.md |
| R47 | PDF: one concrete example of the author refining an AI suggestion | PDF §7 from REFINEMENTS.md |
| R48 | No API keys / passwords / secrets | `.env` git-ignored; `.env.example` without keys; pre-submit `grep` for `sk-` |
| R49 | Example config without keys | `.env.example`, `brief.example.yaml` |
| R50 | Explain what may vary between runs and what's needed to rerun | PDF §8 + README "Reproducibility" (wording, backgrounds, layout choices vary; product/logo/colours/facts fixed) |
| R51 | Comparable quality, brand identity, goal fit on rerun | Fixed brand kit, structured outputs, QA threshold + regeneration, temperature/seed settings |
| R52 | Improvement proposal | PDF §9 |
| R53 | Learning from comments, approvals, past post performance: data used, what changes, how to verify new version is better | PDF §9: data = approval/rejection + edit diffs in UI, Instagram Insights (saves, shares, comments, reach) per post, comment sentiment; changes = few-shot examples of approved posts in plan prompt, rubric weights, preferred templates, LoRA on brand packaging/style; verification = offline eval set of briefs scored by QA rubric + human blind A/B, online A/B of post variants on engagement rate |
| R54 | Deadline: 7 days from invitation | §12 timeline; TIMELOG dates |
| R55 | Submission language English or Croatian | Docs/PDF in English; captions in Croatian (brand market) — ADR-013 |
| R56 | Send to the email in the brief | §13 checklist (velimir@filmconnect.com) |
| R57 | Separate active time from generation waiting | TIMELOG.md columns Active / Waiting |

---

## 9. Vacancy alignment

| Vacancy point | Feature in this project |
|---|---|
| Products connecting AI agents, brand analysis, image generation | Whole pipeline: web_search research agent → vision brand analysis → plan → image generation + compose |
| Turning a process run on real brands into a standalone app | Same core used by CLI, web app and Claude Code recipe; parameterised by brand (`brand_kit/<slug>`) |
| Backend + web app, architecture | Fastify + SQLite/Drizzle + React/Vite monorepo; ADRs in DECISIONS.md |
| Connect AI models and agentic processes into a reliable product | Retries, timeouts, schema-validated outputs, resumable stages, job queue with requeue on restart |
| Generation, analysis and quality checking of images | Stage 04 generation/compose, stage 05 vision QA rubric + regeneration |
| Reliability, speed, cost | `ai_calls` cost/latency tracking, cost report per run, caching via resume, configurable model tiers |
| Claude Code / Cursor + ability to review AI code | Code written with Claude Code, reviewed by author; REFINEMENTS documents corrections; RECIPE.md as Claude Code entry point |
| LLM API, agents, tool calling, structured outputs | Responses API, `web_search` tool, Zod structured outputs |
| Automated testing and evaluation of results | Vitest suite; QA rubric scores as automatic eval; proposed offline eval set (PDF §9) |
| TS / Node / React / Python | TS/Node/React (Python not needed) |
| PostgreSQL, APIs, Git | SQLite via Drizzle (Postgres migration path documented, ADR-006), REST + SSE API, Git history |
| Image/video models, LoRA, computer vision, FFmpeg | Image model + vision QA + sharp compositing; LoRA and video as documented proposals (ADR-011, ADR-012) |
| Background jobs and queues | SQLite-backed `jobs` table worker (ADR-007) |
| AI cost tracking | `ai_calls` table, `cost_report.json`, UI cost screen |
| Data security | No secrets in repo, `.env.example`, uploads stored locally per run, no Instagram credentials used |
| Docker / cloud | Out of scope; mentioned as next step |
| Curiosity / research: try a method, understand why it's bad, improve | Compose vs image-edit experiment; REFINEMENTS log with hypothesis → change → result |

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Instagram blocks automated access (login wall, rate limits) | No brand visual data | Human action: 6–10 screenshots in `brand_kit/gymbeamhr/instagram/` or UI upload; analysis records Instagram as "accessed via screenshots" and lists direct access under `unavailable_sources` |
| Image model distorts logo, packaging, label text | Fails accuracy requirement | Never generate product/logo/text: background-only prompts with explicit negatives; real assets composited by `sharp`; text rendered as SVG; QA "product accuracy"; experiment documents why |
| Composited product looks pasted-in | Lower quality | Prompt reserves a surface/placement area and lighting direction; soft contact shadow, scale per layout, slight colour-temperature match; QA brand-fit check; template per layout |
| Hallucinated facts (claims, prices, ingredients, quotes) | Fails "don't invent" requirement | Facts only from site via `web_search` with URL; plan/caption may only reference `verified` fact IDs; prices verified or user-confirmed (ADR-018), no quotes; QA caption fact mapping; manual M8 check |
| `web_search` returns off-domain or outdated info | Wrong facts | Domain-restricted search instructions; each fact stores URL; analysis flags non-official sources as `assumption` |
| Cost overrun (image generations, retries) | Budget | Per-run cost report; `MAX_REGENERATIONS=1`; image size/quality env; resume instead of full reruns; dev runs with cheaper text model and low image quality |
| Non-determinism between runs | Rerun differs | Fixed brand kit, structured outputs, low temperature for analysis/plan, saved prompts; documented "what varies" (wording, backgrounds, concepts) vs "what is fixed" (products, logo, colours, fact set) |
| API errors / timeouts / rate limits | Broken runs | Exponential backoff, per-call timeout, step-level retry, resumability |
| Font licensing / missing brand font | Off-brand typography | Use official font if openly licensed, else closest Google Font; note in SOURCES.md |
| Croatian caption quality | Unnatural language | Generate natively in HR with analysis tone examples; author reviews; English gloss in `POSTS.md` |
| Time overrun | Incomplete submission | CLI + posts first (M1–M4); UI later; scope cuts in §11; complete submission possible after M4 + M8 |

---

## 11. Out of scope

| Item | Reason | Where mentioned instead |
|---|---|---|
| Video / reels / FFmpeg | Time; image formats satisfy the assignment ("any combination") | PDF limitations + improvement proposal; ADR-011 |
| PostgreSQL | Single-user local app; SQLite is zero-setup for reviewers | ADR-006 (Drizzle → Postgres migration path) |
| Redis / BullMQ | Extra infra for a single-process app | ADR-007 (swap queue adapter when scaling) |
| Docker / cloud deploy | Not required; local `pnpm` start is simpler to review | PDF improvements; README |
| LoRA training | Time/cost; compose already guarantees packaging accuracy | ADR-012; PDF improvement proposal (fal.ai / Replicate Flux LoRA on GymBeam packaging) |
| Second-brand evaluation | Time | PDF: recipe is parameterised by brand (`brand_kit/<slug>`, brief) |
| Instagram API / publishing | Demo only, per assignment | README |
| Automated Instagram scraping | ToS / blocking | ADR-005; screenshots as human action |
| Consistent recurring people/influencers | Not required; avoids identity drift | PDF limitations |
| Auth / multi-user | Local tool | PDF improvements |

---

## 12. Timeline

Invitation received → deadline 7 days later (exact date to be filled in from the invitation email). Planned: M0–M4 day 1–2, M5–M7 day 2–3, M8 day 3–4, buffer remaining days.

---

## 13. Deliverables checklist (final email to velimir@filmconnect.com)

- [ ] Instagram profile stated: https://www.instagram.com/gymbeamhr/ + why this brand
- [ ] Post 1, Post 2, Post 3 — PNGs (all carousel slides in order), caption (HR + EN gloss), format, goal, rationale (`posts.zip` with `POSTS.md`)
- [ ] Sources and input references: `brief.example.yaml`, `brand_kit/gymbeamhr/` + `SOURCES.md`, `sources.json`
- [ ] Intermediate results of the final run: `analysis.json/.md`, `plan.json/.md`, `image_prompts.json`, `review.json`, `cost_report.json`
- [ ] Recipe: GitHub link (or ZIP) with code + prompts; RECIPE.md; app run instructions
- [ ] Start command, tools, models, settings, human actions — in README and PDF
- [ ] `.env.example` without keys; secrets scan done (`grep -r "sk-"` clean)
- [ ] PDF (1–2 pages): setup/run · phases · key decisions · result checks · limitations · time (active vs waiting) · one AI refinement example · what varies between runs · improvement proposal incl. learning from comments/approvals/performance (data, changes, verification) · statement that code was written with Claude Code and reviewed by the author
- [ ] Sent within 7 days of invitation; language English (captions Croatian)
