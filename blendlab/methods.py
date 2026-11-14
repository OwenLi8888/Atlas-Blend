"""Blend methods. Each takes two PIL images (A, B) and returns one PIL image.

Convention: A gives the composition / subject, B gives the look (palette, texture, medium),
unless the method says otherwise. Every method has a PARAMS dict; change it here, re-run a
version, and the run folder keeps a copy of this file so old results stay reproducible.
"""
from __future__ import annotations

import base64
import io
import os

import numpy as np
from PIL import Image

from .common import blur, canvas, fit, hist_match, lab_to_rgb, match_stats, rgb_to_lab, to_f, to_img

METHODS: dict[str, dict] = {}


def method(name: str, needs: str | None = None, legacy: str | None = None, **params):
    """legacy = why the method is off by default (e.g. it breaks a rule in the blending-rules PDF)."""
    def wrap(fn):
        METHODS[name] = {"fn": fn, "params": params, "needs": needs, "legacy": legacy,
                         "doc": (fn.__doc__ or "").strip()}
        return fn
    return wrap


def _pair(a: Image.Image, b: Image.Image, long_side: int) -> tuple[np.ndarray, np.ndarray]:
    size = canvas(a, long_side)
    return to_f(fit(a, size)), to_f(fit(b, size))


# ---------------------------------------------------------------- image processing

@method("palette_swap", long_side=512, color=1.0, tone=0.6, texture=0.35, texture_sigma=1.5)
def palette_swap(a, b, p):
    """A's picture painted with B's palette and tonal range, plus a little of B's surface texture."""
    A, B = _pair(a, b, p["long_side"])
    la, lb = rgb_to_lab(A), rgb_to_lab(B)
    out = match_stats(la, lb, p["color"])
    out[..., 0] = out[..., 0] * (1 - p["tone"]) + hist_match(la[..., 0], lb[..., 0]) * p["tone"]
    tex = lb[..., 0] - blur(lb[..., 0], p["texture_sigma"])
    out[..., 0] += p["texture"] * tex
    return to_img(lab_to_rgb(out))


@method("hybrid", legacy="rule 5: B's objects leak into the result", long_side=512, sigma_frac=0.03, detail_gain=1.15, color_from_b=0.75)
def hybrid(a, b, p):
    """B's big shapes and color masses with A's edges and details drawn over them."""
    A, B = _pair(a, b, p["long_side"])
    s = p["sigma_frac"] * max(A.shape[:2])
    la, lb = rgb_to_lab(A), rgb_to_lab(B)
    low_a, low_b = blur(la, s), blur(lb, s)
    low = low_b * p["color_from_b"] + low_a * (1 - p["color_from_b"])
    out = low.copy()
    out[..., 0] += (la[..., 0] - low_a[..., 0]) * p["detail_gain"]
    out[..., 1:] += (la[..., 1:] - low_a[..., 1:]) * 0.5
    return to_img(lab_to_rgb(out))


@method("detail_fuse", legacy="rules 4-5: merges two subjects and leaks B's objects", long_side=512, detail_sigma_frac=0.02, mask_sigma_frac=0.04, sharpness=6.0,
        bands=6, unify=0.7)
def detail_fuse(a, b, p):
    """Real fusion: each region comes from whichever painting has more going on there, both are
    pulled to a shared palette first, and a multi-band blend hides the seams."""
    A, B = _pair(a, b, p["long_side"])
    la, lb = rgb_to_lab(A), rgb_to_lab(B)
    # shared palette: move both halfway toward each other
    mid = {c: ((la[..., c].mean() + lb[..., c].mean()) / 2, (la[..., c].std() + lb[..., c].std()) / 2) for c in range(3)}
    def to_mid(x):
        y = x.copy()
        for c in range(3):
            m, s = x[..., c].mean(), x[..., c].std() + 1e-6
            y[..., c] = x[..., c] * (1 - p["unify"]) + ((x[..., c] - m) / s * mid[c][1] + mid[c][0]) * p["unify"]
        return y
    la, lb = to_mid(la), to_mid(lb)
    n = max(A.shape[:2])
    def detail(l):
        gy, gx = np.gradient(l[..., 0])
        return blur(np.hypot(gx, gy), p["detail_sigma_frac"] * n)
    da, db = detail(la), detail(lb)
    z = (da - db) / (np.std(da - db) + 1e-6)
    mask = blur(1 / (1 + np.exp(-p["sharpness"] * z)), p["mask_sigma_frac"] * n)[..., None]
    # multi-band blend: fine bands use a sharp mask, coarse bands a soft one
    out = np.zeros_like(la)
    prev_a, prev_b = la, lb
    for i in range(p["bands"]):
        s = 2 ** i
        ga, gb = blur(la, s), blur(lb, s)
        m = blur(mask, s)
        out += (prev_a - ga) * m + (prev_b - gb) * (1 - m)
        prev_a, prev_b = ga, gb
    m = blur(mask, 2 ** p["bands"])
    out += prev_a * m + prev_b * (1 - m)
    return to_img(lab_to_rgb(out))


# ---------------------------------------------------------------- neural style transfer (CPU)

_VGG = None


def _vgg():
    global _VGG
    if _VGG is None:
        import torch
        from torchvision.models import VGG19_Weights, vgg19
        net = vgg19(weights=VGG19_Weights.IMAGENET1K_V1).features[:29].eval()
        for q in net.parameters():
            q.requires_grad_(False)
        for i, layer in enumerate(net):  # avg-pool gives smoother, more painterly results
            if isinstance(layer, torch.nn.MaxPool2d):
                net[i] = torch.nn.AvgPool2d(2, 2)
        _VGG = net
    return _VGG


@method("style_transfer", needs="torchvision", long_side=320, steps=40, style_weight=1e6,
        content_weight=1.0, keep_a_colors=0.0)
def style_transfer(a, b, p):
    """Gatys neural style transfer: A's content repainted in B's brushwork and colors (VGG19, L-BFGS)."""
    import torch
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    A, B = _pair(a, b, p["long_side"])
    mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
    t = lambda x: (torch.from_numpy(x).float().permute(2, 0, 1)[None] - mean) / std
    ca, sb = t(A), t(B)
    net = _vgg()
    style_ids, content_id = {0, 5, 10, 19, 28}, 21

    def feats(x):
        out = {}
        for i, layer in enumerate(net):
            x = layer(x)
            if i in style_ids or i == content_id:
                out[i] = x
        return out

    def gram(f):
        _, c, h, w = f.shape
        f = f.reshape(c, h * w)
        return f @ f.t() / (c * h * w)

    with torch.no_grad():
        target_c = feats(ca)[content_id]
        target_s = {i: gram(f) for i, f in feats(sb).items() if i in style_ids}
    x = ca.clone().contiguous().requires_grad_(True)
    opt = torch.optim.LBFGS([x], max_iter=p["steps"], history_size=20)

    def closure():
        opt.zero_grad()
        f = feats(x)
        loss = p["content_weight"] * torch.nn.functional.mse_loss(f[content_id], target_c)
        loss = loss + p["style_weight"] * sum(torch.nn.functional.mse_loss(gram(f[i]), target_s[i]) for i in style_ids) / len(style_ids)
        loss.backward()
        return loss

    opt.step(closure)
    out = (x.detach() * std + mean)[0].permute(1, 2, 0).clamp(0, 1).numpy().astype(np.float64)
    if p["keep_a_colors"] > 0:  # keep A's chroma, use the transferred luminance
        lo, la = rgb_to_lab(out), rgb_to_lab(A)
        lo[..., 1:] = lo[..., 1:] * (1 - p["keep_a_colors"]) + la[..., 1:] * p["keep_a_colors"]
        out = lab_to_rgb(lo)
    return to_img(out)


# ---------------------------------------------------------------- image model (needs a key)

PROMPT = ("Create one new, original painting that fuses these two artworks into a single coherent "
          "scene. Take the composition and main subject from the first image, and the color palette, "
          "brushwork, and medium of the second, while bringing in recognizable elements from both. "
          "It should look like one painting by one artist, not a collage. No text, no frame, no signature.")


@method("image_model", needs="OPENAI_API_KEY", legacy="rule 1: asks the model to just blend; replaced by rules_hosted", model=os.environ.get("IMAGE_MODEL", "gpt-image-1"),
        size="1024x1024", quality="medium", prompt=PROMPT)
def image_model(a, b, p):
    """OpenAI image edit with both paintings as references and a fusion prompt."""
    import httpx
    def png(img):
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()
    files = [("image[]", ("a.png", png(a), "image/png")), ("image[]", ("b.png", png(b), "image/png"))]
    data = {"model": p["model"], "prompt": p["prompt"], "size": p["size"], "quality": p["quality"], "n": "1"}
    r = httpx.post("https://api.openai.com/v1/images/edits",
                   headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                   data=data, files=files, timeout=180)
    r.raise_for_status()
    return Image.open(io.BytesIO(base64.b64decode(r.json()["data"][0]["b64_json"]))).convert("RGB")


# ---------------------------------------------------------------- the blending-rules PDF pipeline

@method("rules_local", needs="torchvision", work_size=320, steps=40)
def rules_local(a, b, p):
    """Blending-rules pipeline, local generator: A is the subject, B gives style + medium only,
    3 seeded candidates (square, focal point, large shapes), LAB-corrected to the merged targets,
    scored with the PDF's quality checks, best one kept."""
    from .rules import blend
    return blend(p["_a"], p["_b"], a, b, p, hosted=False)


@method("rules_hosted", needs="GEMINI_API_KEY|OPENAI_API_KEY")
def rules_hosted(a, b, p):
    """Blending-rules pipeline, hosted generator: the PDF prompt template with 3 role-tagged
    references (subject, style, slerp bridge as composition) to Gemini, OpenAI as backup;
    then the same color correction, checks and pick as rules_local."""
    from .rules import blend
    return blend(p["_a"], p["_b"], a, b, p, hosted=True)


def available(name: str) -> tuple[bool, str]:
    need = METHODS[name]["needs"]
    if need is None:
        return True, ""
    if need == "torchvision":
        try:
            import torchvision  # noqa: F401
            return True, ""
        except ImportError:
            return False, "torchvision not installed"
    keys = need.split("|")
    return (any(os.environ.get(k) for k in keys), f"{' or '.join(keys)} not set")
