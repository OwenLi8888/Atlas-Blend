"""Two-photo blend that follows "Blend: image blending rules" (Blend image blending rules.pdf).

Pipeline (PDF "Our method"):
  1. Decide in code: subject = A, style + medium = B (rules 4, 5, 12), composition = a bridge
     artwork found by slerp of the two CLIP embeddings (rule 7), targets = balanced merge (rule 10).
  2. 3 references, each with one job (rules 1-3), prompt from the PDF template.
  3. Three candidates with a fixed seed from the pair (rule 9).
       hosted: Gemini image model -> OpenAI fallback (rule 13), needs a key
       local:  style transfer / palette transfer of A in B's look, never B's objects (rule 5),
               squared on A's focal point and simplified into large shapes (rule 11)
  4. LAB color-correct every candidate to the warmth/brightness/saturation targets (rule 8).
  5. Score with the PDF's quality checks and keep the best one.

Two photos stand in for two galleries: "gallery A" is photo A.
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

from .common import REPO, artworks, blur, fit, lab_to_rgb, match_stats, rgb_to_lab, to_f, to_img

sys.path.insert(0, str(REPO / "blend"))
from blend import catalog as bcat  # noqa: E402
from blend.gallery import top_hues  # noqa: E402
from blend.still import color_correct  # noqa: E402
from blend.variables import SCALAR_VARS, measure  # noqa: E402

OUT_SIZE = 640
TARGET_TOL = 0.15          # "each within 15% of the catalog range from its target"
BALANCE_TOL = 0.05         # "the two similarities differ by less than 0.05"
CHECKED_VARS = ["warmth", "brightness", "saturation", "detail"]  # era is metadata, hue is words only

# ------------------------------------------------------------------ CLIP (cached locally)

_clip = None


def _clip_model():
    global _clip
    if _clip is None:
        from transformers import CLIPModel, CLIPProcessor
        name = "openai/clip-vit-base-patch32"
        _clip = (CLIPModel.from_pretrained(name).eval(), CLIPProcessor.from_pretrained(name))
    return _clip


def _feat(out):
    import torch
    if not isinstance(out, torch.Tensor):
        out = out.pooler_output if hasattr(out, "pooler_output") else out[0]
    v = out.numpy()
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def clip_images(imgs: list[Image.Image]) -> np.ndarray:
    import torch
    m, p = _clip_model()
    with torch.no_grad():
        return _feat(m.get_image_features(**p(images=imgs, return_tensors="pt")))


def clip_texts(texts: list[str]) -> np.ndarray:
    import torch
    m, p = _clip_model()
    with torch.no_grad():
        return _feat(m.get_text_features(**p(text=texts, return_tensors="pt", padding=True)))


SUBJECTS = ["landscape", "water", "figures", "portrait", "architecture", "animals",
            "still life", "flowers", "interior", "religious", "night", "abstract"]

# ------------------------------------------------------------------ step 1: recipe (decided in code)


def slerp(a: np.ndarray, b: np.ndarray, t: float = 0.5) -> np.ndarray:
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    om = np.arccos(np.clip(a @ b, -1, 1))
    return a if om < 1e-6 else (np.sin((1 - t) * om) * a + np.sin(t * om) * b) / np.sin(om)


def describe(ref: str, img: Image.Image) -> dict:
    """Catalog facts for a catalog image; measured/zero-shot facts for any other photo."""
    art = artworks().get(ref)
    if art:
        return {"id": ref, "title": art["title"], "medium": art["brush"], "year": art["variables"]["era"],
                "subjects": art["subjects"], "vars": art["variables"],
                "emb": np.asarray(art["clip_embedding"], float)}
    emb = clip_images([img])[0]
    sims = emb @ clip_texts([f"a painting of {s}" for s in SUBJECTS]).T
    return {"id": ref, "title": ref, "medium": "oil", "year": 1880,
            "subjects": [SUBJECTS[i] for i in np.argsort(-sims)[:2]], "vars": measure(img, 1880), "emb": emb}


def word(k: str, v: float) -> str:
    """PDF word maps, split at +-0.5 catalog standard deviations."""
    st = bcat.stats()[k]
    z = (v - st["mean"]) / (st["std"] + 1e-9)
    words = {"warmth": ("cool", "neutral", "warm"),
             "brightness": ("dark, low-key", "balanced light", "bright, high-key"),
             "saturation": ("muted", "natural", "vivid"),
             "detail": ("sparse, simplified", "moderate", "intricate")}[k]
    return words[0] if z < -0.5 else words[2] if z > 0.5 else words[1]


def era_word(year: float) -> str:
    return "an old master painting" if year < 1800 else "a 19th century painting" if year < 1900 else "a modern painting"


def recipe(a_ref: str, b_ref: str, a: Image.Image, b: Image.Image) -> dict:
    A, B = describe(a_ref, a), describe(b_ref, b)
    # rule 10: two single photos have no spread, so every variable is an even 50/50 split
    # (neither side owns any variable, which is inside the "no more than 4 of 6" limit)
    t = {k: (A["vars"][k] + B["vars"][k]) / 2 for k in SCALAR_VARS}
    h = np.asarray(A["vars"]["hue"]) + np.asarray(B["vars"]["hue"])
    t["hue"] = list(h / h.sum())
    # rule 7: slerp of normalized embeddings picks a bridge artwork from neither photo
    target = slerp(A["emb"], B["emb"])
    bridge = max((x for x in artworks().values() if x["id"] not in (a_ref, b_ref)),
                 key=lambda x: float(np.asarray(x["clip_embedding"]) @ target))
    medium = B["medium"]  # rule 12: medium follows the style owner
    subject_words = " and ".join(A["subjects"][:2]) or "main subject"
    hues = top_hues(t["hue"]) + ["neutral"] * 3
    prompt = (
        f"Create one new {medium} painting.\n\n"
        f"Image 1 is the SUBJECT: paint a new scene built around its {subject_words}.\n"
        f"Image 2 is the STYLE: copy its brushwork, medium and texture only. Do not copy any objects from Image 2.\n"
        f"Image 3 is the COMPOSITION: follow its layout, horizon height and balance of empty space.\n\n"
        f"Look: {word('warmth', t['warmth'])}, {word('brightness', t['brightness'])}, "
        f"{word('saturation', t['saturation'])} color, {word('detail', t['detail'])} detail.\n"
        f"Palette leans toward {hues[0]}, {hues[1]} and {hues[2]}.\n"
        f"Feels like {era_word(t['era'])}.\n\n"
        f"Rules: square image, one clear focal point, simple background, large readable shapes.\n"
        f"No text, no signatures, no frames, no close-up human faces."
    )
    seed = int(hashlib.sha256(f"{a_ref}|{b_ref}".encode()).hexdigest()[:8], 16)  # rule 9
    return {"A": A, "B": B, "targets": t, "bridge": bridge["id"], "medium": medium, "prompt": prompt,
            "seed": seed, "subject_words": subject_words,
            "style_words": " and ".join(B["subjects"][:2]) or "objects"}


# ------------------------------------------------------------------ step 3a: local candidates


def focal_point(arr: np.ndarray) -> tuple[float, float]:
    """Where A's subject is: detail density times a soft center prior."""
    L = rgb_to_lab(arr)[..., 0]
    gy, gx = np.gradient(L)
    h, w = L.shape
    sal = blur(np.hypot(gx, gy), 0.06 * max(h, w))
    yy, xx = np.mgrid[0:h, 0:w]
    sal *= np.exp(-(((yy - h / 2) / (0.45 * h)) ** 2 + ((xx - w / 2) / (0.45 * w)) ** 2))
    y, x = np.unravel_index(np.argmax(sal), sal.shape)
    return y / h, x / w


def square_on_focus(img: Image.Image, size: int) -> tuple[Image.Image, tuple[float, float]]:
    """Rule 11 (square, one focal point): square crop of A slid toward its focal point."""
    w, h = img.size
    fy, fx = focal_point(np.asarray(img.resize((128, max(1, round(128 * h / w)))), float) / 255)
    s = min(w, h)
    left = int(np.clip(fx * w - s / 2, 0, w - s))
    top = int(np.clip(fy * h - 0.4 * s, 0, h - s))  # focal point a bit above center, keeps heads whole
    sq = img.crop((left, top, left + s, top + s)).resize((size, size), Image.LANCZOS)
    return sq, ((fy * h - top) / s, (fx * w - left) / s)


def kuwahara(arr: np.ndarray, r: int) -> np.ndarray:
    """Edge-preserving painterly filter: each pixel takes the mean of its calmest quadrant.
    Turns texture into large flat shapes the stroke painter handles well (rule 11)."""
    if r < 1:
        return arr
    L = rgb_to_lab(arr)[..., 0]
    k = r + 1
    pad = np.pad(arr, ((r, r), (r, r), (0, 0)), mode="reflect")
    padL = np.pad(L, r, mode="reflect")
    def boxmean(x):  # mean over k x k windows, top-left anchored
        c = np.cumsum(np.cumsum(np.pad(x, ((1, 0), (1, 0)) + ((0, 0),) * (x.ndim - 2)), 0), 1)
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    mL, mL2, mC = boxmean(padL), boxmean(padL ** 2), boxmean(pad)
    var = mL2 - mL ** 2
    h, w = L.shape
    best_v = np.full((h, w), np.inf)
    out = np.zeros_like(arr)
    for dy in (0, r):          # the four quadrants around each pixel
        for dx in (0, r):
            v = var[dy:dy + h, dx:dx + w]
            m = mC[dy:dy + h, dx:dx + w]
            better = v < best_v
            best_v = np.where(better, v, best_v)
            out = np.where(better[..., None], m, out)
    return out


def simplify(arr: np.ndarray, focus: tuple[float, float], r_focus: int, r_back: int) -> np.ndarray:
    """Large shapes everywhere, simplest in the background, most detail kept at the focal point."""
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot(yy / h - focus[0], xx / w - focus[1])
    wf = np.exp(-(d / 0.28) ** 2)[..., None]
    return kuwahara(arr, r_focus) * wf + kuwahara(arr, r_back) * (1 - wf)


def stylize(A: np.ndarray, B: np.ndarray, seed: int, style_weight: float, steps: int, noise: float) -> np.ndarray:
    """Gatys style transfer: B's brushwork and texture on A's content, none of B's objects (rule 5)."""
    import torch
    from .methods import _vgg
    torch.manual_seed(seed)
    mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
    t = lambda x: ((torch.from_numpy(np.ascontiguousarray(x)).float().permute(2, 0, 1)[None] - mean) / std).contiguous()
    ca, sb = t(A), t(B)
    net = _vgg()
    style_ids, cid = (0, 5, 10, 19, 28), 21
    def feats(x):
        out = {}
        for i, layer in enumerate(net):
            x = layer(x)
            if i in style_ids or i == cid:
                out[i] = x
        return out
    def gram(f):
        _, c, h, w = f.shape
        f = f.reshape(c, h * w)
        return f @ f.t() / (c * h * w)
    with torch.no_grad():
        tc = feats(ca)[cid]
        ts = {i: gram(f) for i, f in feats(sb).items() if i in style_ids}
    x = (ca + noise * torch.randn_like(ca)).contiguous().requires_grad_(True)
    opt = torch.optim.LBFGS([x], max_iter=steps, history_size=20)
    def closure():
        opt.zero_grad()
        f = feats(x)
        loss = torch.nn.functional.mse_loss(f[cid], tc)
        loss = loss + style_weight * sum(torch.nn.functional.mse_loss(gram(f[i]), ts[i]) for i in style_ids) / 5
        loss.backward()
        return loss
    opt.step(closure)
    return (x.detach() * std + mean)[0].permute(1, 2, 0).clamp(0, 1).numpy().astype(np.float64)


LOCAL_CANDIDATES = [
    # name, how A gets B's look, simplification radii (focal, background) at 640 px
    {"name": "c1 light style", "style_weight": 3e5, "noise": 0.0, "r": (2, 6)},
    {"name": "c2 strong style", "style_weight": 3e6, "noise": 0.15, "r": (3, 9)},
    {"name": "c3 palette + shapes", "style_weight": 0, "noise": 0.0, "r": (4, 12)},
]


def local_candidates(a: Image.Image, b: Image.Image, rc: dict, p: dict) -> list[tuple[str, Image.Image]]:
    work = p["work_size"]
    a_sq, focus = square_on_focus(a, work)
    A = to_f(a_sq)
    B = to_f(fit(b, (work, work)))
    out = []
    for i, c in enumerate(LOCAL_CANDIDATES):
        if c["style_weight"]:
            arr = stylize(A, B, rc["seed"] + i, c["style_weight"], p["steps"], c["noise"])
        else:  # palette and tonal range of B on A (v1's best-rated method), no B content
            la, lb = rgb_to_lab(A), rgb_to_lab(B)
            arr = lab_to_rgb(match_stats(la, lb, 1.0))
        big = to_f(to_img(arr).resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS))
        out.append((c["name"], to_img(simplify(big, focus, *c["r"]))))
    return out


# ------------------------------------------------------------------ step 3b: hosted candidates


def _ref_bytes(img: Image.Image) -> bytes:
    img = img.copy()
    img.thumbnail((1024, 1024), Image.LANCZOS)  # rule 6: about 1024 px on the long side
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    return buf.getvalue()


_genai_client = None


def _genai():
    global _genai_client
    if _genai_client is None:
        from google import genai
        # 120 s per request and at most 2 attempts, so a quota error fails fast instead of hanging
        _genai_client = genai.Client(http_options={"timeout": 120_000,
                                                   "retry_options": {"attempts": 2}})
    return _genai_client


def _gemini(prompt: str, refs: list[Image.Image], seed: int, model: str | None = None) -> Image.Image:
    """Gemini Interactions API (google-genai SDK). Each reference is labelled "Image N" right before
    it is sent, in the same order the prompt names them (rule 3). The Interactions API has no seed
    option, so rule 9 is enforced by the candidate cache in hosted_candidates instead."""
    model = model or os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")
    parts: list[dict] = [{"type": "text", "text": prompt}]
    for i, r in enumerate(refs):
        parts.append({"type": "text", "text": f"Image {i + 1}:"})
        parts.append({"type": "image", "data": base64.b64encode(_ref_bytes(r)).decode(), "mime_type": "image/jpeg"})
    it = _genai().interactions.create(model=model, input=parts,
                                      response_format={"type": "image", "mime_type": "image/jpeg",
                                                       "aspect_ratio": "1:1", "image_size": "1K"})
    if not it.output_image:
        raise RuntimeError("no image in Gemini response (safety block?)")
    return Image.open(io.BytesIO(base64.b64decode(it.output_image.data))).convert("RGB")


def _openai(prompt: str, refs: list[Image.Image], seed: int) -> Image.Image:
    import httpx
    files = [("image[]", (f"image{i + 1}.jpg", _ref_bytes(im), "image/jpeg")) for i, im in enumerate(refs)]
    r = httpx.post("https://api.openai.com/v1/images/edits",
                   headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                   data={"model": os.environ.get("IMAGE_MODEL", "gpt-image-1"), "prompt": prompt,
                         "size": "1024x1024", "n": "1"}, files=files, timeout=180)
    r.raise_for_status()
    return Image.open(io.BytesIO(base64.b64decode(r.json()["data"][0]["b64_json"]))).convert("RGB")


def _gemini_backup(prompt: str, refs: list[Image.Image], seed: int) -> Image.Image:
    return _gemini(prompt, refs, seed, os.environ.get("GEMINI_BACKUP_MODEL", "gemini-3-pro-image"))


def hosted_backends() -> list:
    """Rule 13 order: Gemini 3.1 Flash Image, then a backup model (the PDF's FLUX is not set up, so
    Gemini 3 Pro Image), then OpenAI if that key exists."""
    order = (("GEMINI_API_KEY", _gemini), ("GEMINI_API_KEY", _gemini_backup), ("OPENAI_API_KEY", _openai))
    return [fn for key, fn in order if os.environ.get(key)]


def hosted_candidates(a, b, rc) -> list[tuple[str, Image.Image]]:
    from .common import load
    from .common import RUNS
    refs = [a, b, load(rc["bridge"])]  # Image 1 subject, Image 2 style, Image 3 composition
    cache = RUNS / "_cache"
    cache.mkdir(parents=True, exist_ok=True)

    def one(i):
        # rule 9 (same inputs, same output): the API has no seed, so each candidate is cached under
        # a hash of seed + prompt + slot; a re-run of the same pair reuses it and costs nothing
        key = hashlib.sha256(f"{rc['seed']}|{i}|{rc['prompt']}".encode()).hexdigest()[:16]
        hit = next(cache.glob(f"{key}_*.png"), None)
        if hit:
            return (f"c{i + 1} {hit.stem.split('_', 1)[1]} (cached)", Image.open(hit).convert("RGB"))
        for backend in hosted_backends():          # rule 13: retry once, then the backup model
            for _ in range(2):
                try:
                    img = backend(rc["prompt"], refs, rc["seed"] + i)
                    name = backend.__name__.strip("_")
                    img.save(cache / f"{key}_{name}.png")
                    return (f"c{i + 1} {name}", fit(img, (OUT_SIZE, OUT_SIZE)))
                except Exception as e:
                    msg = str(e)
                    print(f"    [{backend.__name__}] {type(e).__name__}: {msg[:200]}", flush=True)
                    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                        break  # quota: retrying the same model won't help
        return None
    with ThreadPoolExecutor(3) as ex:                # 3 candidates in parallel
        return [c for c in ex.map(one, range(3)) if c]


# ------------------------------------------------------------------ steps 4-5: correct, score, pick


def run_checks(img: Image.Image, rc: dict) -> dict:
    st = bcat.stats()
    t = rc["targets"]
    m = measure(img, int(t["era"]))
    errs = {k: abs(m[k] - t[k]) / (st[k]["range"] + 1e-9) for k in CHECKED_VARS}
    e_img = clip_images([img])[0]
    sim_a, sim_b = float(e_img @ rc["A"]["emb"]), float(e_img @ rc["B"]["emb"])
    tx = clip_texts([f"a beautiful {rc['medium']} painting", "a blurry, messy image",
                     f"a painting of {rc['subject_words']}", f"a painting of {rc['style_words']}",
                     "a close-up of a human face", "a painting with no close-up faces"])
    s = e_img @ tx.T
    same_subject = rc["subject_words"] == rc["style_words"]
    detail_lo, detail_hi = np.percentile([x["variables"]["detail"] for x in artworks().values()], [10, 75])
    checks = {
        "targets": {"pass": all(e <= TARGET_TOL for e in errs.values()),
                    "detail": {k: round(e, 3) for k, e in errs.items()}},
        "balance": {"pass": abs(sim_a - sim_b) < BALANCE_TOL, "detail": {"sim_a": round(sim_a, 3), "sim_b": round(sim_b, 3)}},
        "art_not_mush": {"pass": bool(s[0] - s[1] > 0), "detail": round(float(s[0] - s[1]), 4)},
        "no_style_leak": {"pass": bool(same_subject or s[3] < s[2]),
                          "detail": "same subject words" if same_subject else round(float(s[2] - s[3]), 4)},
        "paintable": {"pass": bool(detail_lo <= m["detail"] <= detail_hi),
                      "detail": {"edge_density": m["detail"], "range": [round(detail_lo, 4), round(detail_hi, 4)]}},
        "no_faces_proxy": {"pass": bool(s[4] < s[5]), "detail": round(float(s[5] - s[4]), 4)},
    }
    # one number to rank candidates: passes first, then closeness to targets and balance
    score = sum(c["pass"] for c in checks.values()) - float(np.mean(list(errs.values()))) - abs(sim_a - sim_b)
    return {"checks": checks, "score": round(score, 4), "measured": {k: m[k] for k in CHECKED_VARS}}


def blend(a_ref: str, b_ref: str, a: Image.Image, b: Image.Image, p: dict, hosted: bool):
    t0 = time.time()
    rc = recipe(a_ref, b_ref, a, b)
    cands = hosted_candidates(a, b, rc) if hosted else local_candidates(a, b, rc, p)
    if not cands:
        raise RuntimeError("no candidates (rule 13: serve a cached blend)")
    l_std = float(np.mean([rgb_to_lab(to_f(x.resize((128, 128))))[..., 0].std() for x in (a, b)]))
    scored = []
    for name, img in cands:
        img = color_correct(img, rc["targets"], l_std)   # rule 8: numbers enforced after generation
        scored.append((name, img, run_checks(img, rc)))
    best = max(scored, key=lambda s: s[2]["score"])
    extra = {
        "picked": best[0],
        "checks": best[2]["checks"],
        "passed": sum(c["pass"] for c in best[2]["checks"].values()),
        "candidates": [{"name": n, "score": r["score"], "passed": sum(c["pass"] for c in r["checks"].values())}
                       for n, _, r in scored],
        "recipe": {"subject": rc["A"]["title"], "style": rc["B"]["title"], "bridge": rc["bridge"],
                   "medium": rc["medium"], "seed": rc["seed"], "prompt": rc["prompt"]},
        "targets": {k: round(rc["targets"][k], 4) for k in CHECKED_VARS},
        "measured": best[2]["measured"],
        "seconds_total": round(time.time() - t0, 1),
    }
    return best[1], extra, [(n, img) for n, img, _ in scored]
