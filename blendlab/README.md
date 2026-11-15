# Blend Lab

Two-photo blending on its own, outside the app: no similarity scores, no personalities.
Pick photo A and photo B, get one output, rate it, change the method, run again.

```bash
pip install -r blendlab/requirements.txt
python -m blendlab run v3 --note "what changed"   # every non-legacy method x the 10 pairs in pairs.json
python -m blendlab review                         # rate outputs at http://localhost:8790
python -m blendlab ratings                        # average score per version and method
python -m blendlab pair aic-11 path/to/photo.jpg  # try any two images -> runs/_scratch/
```

A = composition / subject, B = the look (palette, brushwork, medium).

| Method | What it does | Speed (CPU) |
|---|---|---|
| `rules_local` | **Follows `Blend image blending rules.pdf`.** A = subject, B = style and medium only. 3 seeded candidates (square, focal point, large shapes), LAB-corrected to 50/50 targets, scored with the PDF's checks, best one kept | ~45 s |
| `rules_hosted` | Same pipeline, but candidates come from Gemini (`GEMINI_API_KEY`, model in `GEMINI_IMAGE_MODEL`) or OpenAI as backup, using the PDF prompt template | needs a key |
| `palette_swap` | A's picture with B's palette, tonal range and a little of B's texture | 0.2 s |
| `hybrid` (legacy) | B's big shapes and color masses, A's edges and detail on top | 0.2 s |
| `detail_fuse` (legacy) | Each region from whichever image has more detail there, shared palette, multi-band seams | 1 s |
| `style_transfer` | Gatys neural style transfer, VGG19 + L-BFGS (downloads 550 MB of weights once) | 14 s |
| `image_model` (legacy) | OpenAI `gpt-image-1` edit with both images and a fusion prompt (needs `OPENAI_API_KEY`) | 10-30 s |

Each run folder (`runs/<version>/`, gitignored) keeps a copy of `methods.py`, so any old result can be
reproduced. Ratings live in `ratings.json` (tracked) and drive the next version.

Legacy methods break a rule in the PDF (B's objects leak in, or two subjects get merged), so they
only run when named: `--methods hybrid`. Test pairs follow the PDF: 10 pairs, including 2 opposite
(p9, p10) and 1 identical (p11).

## Painting-process video

```bash
python -m blendlab paint v3 --pairs ow1,ow3     # -> runs/v3/painting/rules_local/<pair>/
python -m blendlab paint v3 --style watercolor  # oil (default), watercolor or dots
python -m blendlab paint path/to/any.jpg        # -> runs/_scratch/painting/<name>/
```

Plays the finished blend back as a painting, stroke by stroke, the way magic-brush does: the
impasto stroke planner (MIT, Dongha Kim, vendored in `worker/src/vendor/impasto/`) plans knife
and bristle strokes in 8 layers (underpaint, block-in, masses, presses, forms, detail, contours,
accents), and magic-brush's renderers draw them onto a blank canvas. Each folder gets
`painting_<style>.mp4` (~16 s), `process_<style>.png` (the canvas after each layer next to the
target), `final_<style>.png` and `strokes.json`. `--area` sets the planning budget in mm²
(default 200,000, about 1,000-2,500 strokes and ~15 s per image; lower is coarser and faster).
