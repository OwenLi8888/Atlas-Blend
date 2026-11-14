# Catalog (M1)

120 public-domain artworks from the Art Institute of Chicago open-access API (CC0).
Each record in `data/artworks.json` has title, artist, year, medium, brush set, subjects,
image (local 400px copy + IIIF URL), source URL, license, the six measured variables and a
CLIP ViT-B/32 image embedding. `data/quiz_rounds.json` holds the 5 designed rounds of 4.

```
pip install -r ../blend/requirements.txt   # numpy, pillow, httpx (+ torch/transformers for CLIP)
python catalog/build_catalog.py            # full rebuild from the AIC API
python catalog/build_catalog.py --reembed  # recompute variables + embeddings from cached images
python catalog/build_catalog.py --quiz     # redesign quiz rounds only
```
