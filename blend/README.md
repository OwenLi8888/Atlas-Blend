# Blend service (Python)

Compares two whole galleries and produces the merged still.

| Module | Job |
|---|---|
| `variables.py` | The six variables from pixels: LAB warmth, L* brightness, LCh chroma, Canny edge density, 12-bin chroma-weighted hue histogram, era |
| `embed.py` | CLIP ViT-B/32 image embeddings (precomputed into the catalog), deterministic fallback |
| `gallery.py` | Gallery means, spreads, hue palette, centroid, card bars and title ("Cool Tidewatcher") |
| `matching.py` | `s_k = 1 - abs(muA-muB)/R_k`, hue by histogram intersection, `score = 100(0.7 mean + 0.3 min)`, cross-gallery cosine matrix, greedy matched pairs, k-means (k=3) groups |
| `merge.py` | Variable targets (`w_A = 0.5` if `s_k >= 0.7`, else `sigma_B/(sigma_A+sigma_B)`, nobody leads more than 4 of 6), slerp bridge artwork, references, prompt |
| `still.py` | Image model (OpenAI image edits with references when `OPENAI_API_KEY` is set) or bridge-composite fallback, then Reinhard LAB color correction and re-measure |

CLI used by the API server (JSON on stdin, JSON lines on stdout):

```
cd blend
python -m blend quiz
python -m blend gallery <<< '{"artwork_ids": ["aic-14311", "aic-21085"]}'
python -m blend blend   <<< '{"blend_id":"x","out_dir":"../data/runtime/x","a":{...},"b":{...}}'
python tune.py          # 10 simulated test pairs: determinism, score spread, dominance
```
