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

### RF-001 — Product rendering: compose vs OpenAI image edit with product reference
Date: TODO · Stage/area: 04 Create · Run: TODO · Status: **planned (M3, ~30 min)**

- **Setup:** one slide from Post TODO, same concept and product (`brand_kit/gymbeamhr/products/TODO`).
  - **A — compose:** background generated without product → `sharp` composites real product photo + real logo + SVG headline.
  - **B — image edit:** OpenAI image edit/generation with the product photo as reference, product and headline rendered by the model.
- **Compare on:** label/logo legibility and correctness vs reference photo, product shape/colour fidelity, scene integration (does it look pasted-in?), text correctness (Croatian diacritics), cost per image, latency, QA scores.
- **What AI produced:** TODO
- **Problem observed:** TODO
- **Hypothesis:** image models redraw small label text and logos, so B is expected to be less accurate; A may look less integrated. TODO confirm or refute.
- **Change made:** TODO
- **Result:** TODO (table: A vs B per criterion, cost, time)
- **Before:** TODO `runs/<run_id>/experiments/rf001_edit.png`
- **After:** TODO `runs/<run_id>/experiments/rf001_compose.png`
- **Kept in recipe?** TODO

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

