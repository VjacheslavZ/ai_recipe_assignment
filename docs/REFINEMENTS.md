# Refinements of AI Suggestions

Log of cases where the author corrected or improved what an AI produced — pipeline outputs (analysis, plan, prompts, images, captions) and AI-written code. One entry is used as the "concrete example" in the PDF. Only real observations go here; planned entries stay marked TODO until done.

## Entry format

```markdown
### RF-NNN — <short title>
Date: YYYY-MM-DD · Stage/area: <01 Brief | 02 Analysis | 03 Plan | 04 Create | 05 Review | code> · Run: <run_id>

- **What AI produced:** <output, quoted or summarised; artifact path>
- **Problem observed:** <what is wrong and how it was noticed (manual review, QA score, test)>
- **Hypothesis:** <why the AI produced this>
- **Change made:** <prompt / schema / code / parameter change; commit or file path>
- **Result:** <what changed, with evidence; metric if available (QA score, cost, time)>
- **Before:** `runs/<run_id>/.../before.png` (or artifact path)
- **After:** `runs/<run_id>/.../after.png`
- **Kept in recipe?** yes / no — <why>
```

Rules: no edits to final outputs without an entry here (assignment: no unexplained manual edits). If an artifact was hand-edited and the pipeline resumed from the next stage, record the diff.

---

## Planned entries

### RF-001 — Product rendering: empty scene + compose vs scene painted around the real product
Date: 2026-11-01 · Stage/area: 04 Create (`compose/compose.ts`, `prompts/background.ts`, `stages/04-create.ts`) · Run: four single-slide image calls outside a run (product-right layout, `brand_kit/gymbeamhr/products/` Protein Fusion photo, 1024×1024, quality low) · Status: done

- **Setup:** same slide, product and scene text.
  - **A — generate + compose:** background generated without the product; `sharp` composites the real product (with a drop shadow), logo and headline.
  - **B — edit + compose:** the product cut-out is placed on a grey canvas exactly where compose will put it; OpenAI image edit with a mask (keep the product, paint the rest) builds the scene around it; then the real product is composited on top again at the same spot, so the label is pixel-exact. A model-rendered product alone was not tried: the assignment needs exact labels (ADR-004).
- **Compare on:** label correctness, scene integration (does it look pasted in?), cost, time.
- **What AI produced:** `gpt-image-1-mini` ignored the mask and drew a larger, invented pack ("PRCTEIN EUSION", made-up brand) behind the real one. `gpt-image-2.5-flare` kept the product in place and built the scene around it: stone counter or wooden bench, cocoa pieces, light from the scene, a contact shadow.
- **Problem observed:** A looks pasted in (the scene does not know where the product stands or its colours). B with the mini model leaves a fake product visible around the real one.
- **Hypothesis:** masking with GPT Image is prompt-based (OpenAI docs: the model "may not follow its exact shape"), so how well the product is kept depends on the model.
- **Change made:** B is the default (`BACKGROUND_MODE=edit`, prompt `background@2`). Code measures how much the model changed the product inside the mask (mean absolute RGB difference after a light blur): kept ≈ 11–14, redrawn ≈ 92–94; above 40 the edit is discarded and an empty scene is generated instead (A). Transparent product PNGs are now trimmed, so the product fills its box (a small product invited the model to enlarge it). A stays available with `BACKGROUND_MODE=generate`.
- **Result:**

  | | A generate + compose | B edit, gpt-image-1-mini | B edit, gpt-image-2.5-flare |
  |---|---|---|---|
  | Label | exact (real photo) | exact on top, fake pack visible behind | exact (real photo) |
  | Integration | pasted in | broken (ghost pack) | product stands in the scene, light and shadow match |
  | Product change in mask | — | 92–94 → fallback to A | 11–14 → kept |
  | Cost per image (low, 1024²) | ≈ $0.005 (mini) | ≈ $0.005 + fallback | ≈ $0.015 |
  | Time | ≈ 8 s | ≈ 8 s + fallback | ≈ 11 s |

- **Before / After:** `docs/experiments/rf-001/mini-vs-flare-kitchen.png` (canvas sent to the model, mini result and slide, flare result and slide), `docs/experiments/rf-001/mini-vs-flare-gym.png` (canvas, mini, flare).
- **Kept in recipe?** yes: B for the final run with `gpt-image-2.5-flare`; with the test model the check falls back to A.

---

## Entries

_None yet._

---

## Entries

### RF-002 — Product cut-out erased white areas inside the packaging
Date: 2026-10-30 · Stage/area: 04 Create (`packages/core/src/compose/compose.ts`) · Run: mock run with a synthetic test packshot (`runs/_tmp/`, not committed) · Found by: Claude Code during visual review of composed slides

- **What AI produced:** the first `cutOutWhite` made every near-white pixel transparent (global threshold), so white label text on the product became see-through.
- **Problem observed:** on the composed slide the product label showed the background colour through the letters — a direct violation of "labels must remain accurate".
- **Hypothesis:** a global colour threshold cannot tell studio background from white parts of the product.
- **Change made:** flood-fill from the image border, so only white pixels connected to the edge (the studio background) are removed; feathered alpha between 225–245 for a soft edge. Test `compose.test.ts › cutOutWhite` keeps a white stripe inside the product opaque.
- **Result:** label text stays opaque; background removed. Residual limitation: white areas that touch the product's outline (e.g. a white lid against a white background) can still be eaten — transparent PNGs from the brand are preferred.
- **Before / After:** not kept (synthetic test asset); reproducible via the unit test.
- **Kept in recipe?** yes.


### RF-003 — White GymBeam packaging came out see-through; the logo sat in a white box
Date: 2026-11-01 · Stage/area: 04 Create (`packages/core/src/compose/compose.ts`) · Run: test slides composed from the real brand kit (`brand_kit/gymbeamhr/`: collected packshots, the user's `logo.png`) · Found by: Claude Code during visual review

- **What AI produced:** nothing generated; the compose code placed the real files. The RF-002 cut-out removed every pixel lighter than 225 connected to the border, and the logo was pasted as is.
- **Problem observed:** GymBeam tubs and pouches are white with soft shading (about 230–245) on a pure white (255) background, so the fill ran into the packaging and the Creatine tub became semi-transparent on a dark slide. A pale studio reflection under the protein bar showed as a white stripe. `logo.png` is a black wordmark on white without transparency: a white rectangle on coloured slides, nearly invisible on dark ones.
- **Hypothesis:** the shop's packshots use pure white as the background, so only near-pure white should count as background; a logo download is usually one colour on white, so it can be used as a mask.
- **Change made:** background = pixels ≥ 250 connected to the border; only the one-pixel ring next to it is feathered; separate pale parts without colour or dark pixels (reflections, floor shadows not touching the product) are dropped. New `prepareLogo`: a one-colour logo becomes a transparent mask painted white or black by the brightness of the slide under it; a multi-colour logo keeps its colours and loses a white background. Tests in `compose.test.ts` (white tub stays opaque, reflection dropped, logo white on dark / black on light / colours kept).
- **Result:** all three products are opaque with clean edges on dark, orange and blue test slides; the logo reads on each. Residual: a pale floor shadow that touches the product (bottom of the Creatine tub) stays as a faint light edge.
- **Before / After:** test renders not kept; reproducible with the unit tests and the brand kit files.
- **Kept in recipe?** yes.

### RF-004 — The content plan cited an assumption as a fact; the run stopped at stage 03
Date: 2026-11-01 · Stage/area: 03 Plan (`prompts/plan.ts`, `stages/03-plan.ts`) and the run page · Run: `gymbeamhr_20261101-111605` (test models) · Found by: the author, from the error on the run page

- **What AI produced:** a plan whose post 2 listed `F-IG-15` in `factIds`, an assumption from the Instagram analysis ("heavy uppercase sans-serif headlines … typeface cannot be confirmed").
- **Problem observed:** validation stopped the run: `post 2: factId "F-IG-15" is "assumption", only verified facts may be used`. Re-running stage 3 passed, but the run page kept showing the old error on the stage, so it looked as if the re-run had failed too.
- **Hypothesis:** the prompt listed assumptions with ids in the same `[id] statement` format as verified facts, and asked the rationale to reference fact ids, so citing one was an easy mistake; the page kept a stage's last error when the stage later passed.
- **Change made:** `plan@4` lists assumptions without ids and states that only verified facts and claims have ids; on a validation failure the stage sends the violations back once (`plan.retry`, ADR-031); the run page clears a stage's error when its status changes. Tests: prompt has no assumption ids; correction round succeeds; a second failure still stops the run.
- **Result:** the rule stays strict and the run no longer depends on luck at stage 03; the run page shows the stage as passed after a successful re-run.
- **Before / After:** before: `runs/gymbeamhr_20261101-111605` (stage 3 failed at 11:22, re-run done at 11:23); after: unit tests in `03-plan.test.ts`.
- **Kept in recipe?** yes.
