# Brand kit — GymBeam Croatia (@gymbeamhr)

Human-supplied inputs for the recipe. The pipeline never invents products or
logos: every product shown in a post is a real photo from this folder.

| Path | What to put here |
| --- | --- |
| `logo.png` | Official logo at the brand root, ideally ≥ 1000 px wide. A one-colour logo on a plain background is fine: it is cut out and shown white or black, whichever reads on the slide. A multi-colour logo should have a transparent or white background. |
| `products/` | Real product photos to promote. Ideally transparent PNG or a clean white background, ≥ 1500 px on the long side. Name files by product, e.g. `gymbeam-protein-fusion.png`, and set it as `imageFile` with the product page URL in the brief. |
| `instagram/` | 6–10 screenshots of recent @gymbeamhr posts/stories (feed grid + a few individual posts). Used by the vision model to analyse tone, colours, layout and how products and people are shown. Any file names; they are read in name order, up to 10. |
| `sources.json` | Written by "Find the logo and product photos" on the Start a run page: for each collected file, the image URL, the product page, the date and the vision check. |
| `fonts/` | Brand font files (`.ttf`/`.otf`/`.woff2`) **only if licensed** for this use. If empty, the compositor falls back to a similar open-licence font. |

Sources and access dates for each asset should be noted in the brief.
