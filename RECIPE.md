# Running the recipe in Claude Code

This file is the entry point for running the recipe from an agentic environment (Claude Code or a similar tool). The agent does not re-implement the phases: it runs the same stage code as the CLI and the web UI, one phase at a time, reads each artifact, checks it against the list below and stops where a person has to decide. All prompts sent to OpenAI are in `packages/core/src/prompts/`, the output schemas in `packages/core/src/schemas/`.

Open the repository in Claude Code and paste the prompts below in order. Each prompt is self-contained; you can stop after any phase and continue later with the same run id.

## 0. Setup

> Read README.md and RECIPE.md. Run `pnpm install`, then check that `.env` exists (copy `.env.example` if not) without printing its contents. Tell me whether `AI_PROVIDER` is `openai` or `mock` and whether `OPENAI_API_KEY` is set (yes/no only). Run `pnpm typecheck && pnpm test`. Then list what is in `brand_kit/<slug>/` for the brand in the brief I give you, and which product `imageFile`s from the brief are missing. Do not continue until I confirm.

Human checkpoint: the key is set by you, never pasted into the chat. Logo, product photos and 6–10 Instagram screenshots are in the brand kit (see README, "Human actions required").

## 1. Brief

Input: `brief.example.yaml` (or your own brief) and the brand kit. Output: `runs/<runId>/01_brief/brief.json`, `brief.md`.

> Run `pnpm recipe run --brief brief.example.yaml --to-step 1`. Note the run id from the output. Read `01_brief/brief.md` and list every warning, every product without a URL or photo, and every field still marked TODO or VERIFY. Suggest fixes to the brief, but do not edit it without asking me.

Check: brand name, domains and caption language are right; every product has a page URL on the brand domain and an existing photo.

## 2. Brand analysis

Input: `brief.json`, Instagram screenshots, the brand website (web search restricted to the brand domains). Output: `02_analysis/analysis.json`, `analysis.md`, `sources.json`.

> Run `pnpm recipe run --run-id <runId> --from-step 2 --to-step 2`. The shell is not interactive, so any price the analysis could not verify is printed as an "unanswered question" with its id and left out. Show me each such question with its context and wait for my answers; do not answer them yourself. Then re-run the same step with one `--answer <questionId>=<value>` per answer (an empty value keeps the price out). Then read `02_analysis/analysis.md` and report: (1) facts marked verified that have no URL or whose evidence does not support the statement; (2) prices and their status; (3) sources that could not be accessed; (4) whether the colours and style match the screenshots in the brand kit (open two or three of them).

Check: every verified fact has a URL on the brand domain and a quote as evidence; prices are verified, confirmed by you, or left out; assumptions are labelled as assumptions.

## 3. Content plan

Input: `analysis.json`, `brief.json`. Output: `03_plan/plan.json`, `plan.md`.

> Run `pnpm recipe run --run-id <runId> --from-step 3 --to-step 3`. Read `03_plan/plan.md` and check each post: goal and format are different across the three posts; every claim in the caption and on the slides refers to a verified fact id; no people are planned in any slide; every product shown exists in the brand kit; Croatian headlines are short enough for one slide. List problems, then ask me whether to continue or re-run this step.

Check: three distinct goals, the rationale ties back to the analysis, no invented claims or prices.

## 4. Create

Input: `plan.json`, `analysis.json`, brand kit. Output: `04_create/post_N/slide_K.png`, `captions.json`, `image_prompts.json`, `compose_specs.json`, `POSTS.md`.

> Run `pnpm recipe run --run-id <runId> --from-step 4 --to-step 4`. Open every slide image and describe problems: text that is cut off or hard to read, the product cropped or distorted, the logo missing, a generated background that contains a product, packaging, text or people. Check `image_prompts.json` to confirm the prompts ask for backgrounds only.

Check: the product on every slide is the real photo from the brand kit; on-image text matches the plan.

## 5. Review

Input: slides, `plan.json`, `analysis.json`. Output: `05_review/posts/`, `review.json`, `review.md`, `POSTS.md`, `posts.zip`, and the cost report.

> Run `pnpm recipe run --run-id <runId> --from-step 5`. Read `05_review/review.md` and summarise: QA score per slide, slides that were regenerated, slides still below the threshold, caption claims the fact check did not support, and the "needs human attention" list. Then read `cost_report.json` and give total cost and time per stage.

Check: you decide which posts to approve. To redo something, fix its cause and re-run from that phase, for example `--from-step 3` for a weak concept or `--from-step 4` for a bad background. Re-running step 4 reuses backgrounds whose prompt did not change. Write down what you changed and why in `docs/REFINEMENTS.md`.

## Rules for the agent

- Never print, paste or commit `.env` or any API key.
- Never edit artifacts in `runs/` by hand; change the brief or the brand kit and re-run the phase, so every result can be reproduced from the repo.
- Never answer price questions or approve posts on the user's behalf.
- Report AI cost from `cost_report.json`, not from estimates.
