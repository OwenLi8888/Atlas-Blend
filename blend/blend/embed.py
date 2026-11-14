"""Image embeddings for subject matching.

Primary: CLIP ViT-B/32 image embeddings (transformers). Embeddings are precomputed into the
catalog, so the blend service never loads CLIP at request time.

Fallback (no torch): a deterministic 'visual layout' embedding (coarse LAB grid, hue mix,
edge-orientation histogram, subject keywords). Weaker than CLIP but keeps the pipeline whole.
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from .variables import load_rgb, rgb_to_lab, hue_histogram

CLIP_MODEL = "openai/clip-vit-base-patch32"
SUBJECTS = ["landscape", "water", "figures", "portrait", "architecture", "animals",
            "still life", "flowers", "interior", "religious", "night", "abstract"]

_clip = None


def _load_clip():
    global _clip
    if _clip is None:
        import torch  # noqa: F401
        from transformers import CLIPModel, CLIPProcessor
        model = CLIPModel.from_pretrained(CLIP_MODEL).eval()
        proc = CLIPProcessor.from_pretrained(CLIP_MODEL)
        _clip = (model, proc)
    return _clip


def clip_available() -> bool:
    try:
        _load_clip()
        return True
    except Exception:
        return False


def _norm(v: np.ndarray) -> np.ndarray:
    return v / (np.linalg.norm(v) + 1e-9)


def clip_image_embeddings(paths: list[str], batch: int = 16) -> np.ndarray:
    import torch
    model, proc = _load_clip()
    out = []
    for i in range(0, len(paths), batch):
        imgs = [Image.open(p).convert("RGB") for p in paths[i:i + batch]]
        with torch.no_grad():
            inputs = proc(images=imgs, return_tensors="pt")
            feats = model.get_image_features(**inputs)
            if not isinstance(feats, torch.Tensor):  # newer transformers return an output object
                feats = feats.pooler_output if hasattr(feats, "pooler_output") else feats[0]
        out.append(feats.numpy())
    e = np.concatenate(out)
    return e / np.linalg.norm(e, axis=1, keepdims=True)


def clip_subject_scores(emb: np.ndarray) -> np.ndarray:
    """Zero-shot subject probabilities for each embedding row."""
    import torch
    model, proc = _load_clip()
    prompts = [f"a painting of {s}" for s in SUBJECTS]
    with torch.no_grad():
        t = proc(text=prompts, return_tensors="pt", padding=True)
        tf = model.get_text_features(**t)
        if not isinstance(tf, torch.Tensor):
            tf = tf.pooler_output if hasattr(tf, "pooler_output") else tf[0]
    tf = tf.numpy()
    tf = tf / np.linalg.norm(tf, axis=1, keepdims=True)
    logits = 100 * emb @ tf.T
    logits -= logits.max(axis=1, keepdims=True)
    p = np.exp(logits)
    return p / p.sum(axis=1, keepdims=True)


def fallback_embedding(path: str, subject_tags: list[str] | None = None) -> np.ndarray:
    rgb = load_rgb(path, 128)
    lab = rgb_to_lab(rgb)
    H, W, _ = lab.shape
    grid = []
    for gy in range(4):
        for gx in range(4):
            cell = lab[gy * H // 4:(gy + 1) * H // 4, gx * W // 4:(gx + 1) * W // 4]
            m = cell.reshape(-1, 3).mean(0)
            grid += [m[0] / 100, m[1] / 80, m[2] / 80]
    L = lab[..., 0] / 100
    gy_, gx_ = np.gradient(L)
    ang = (np.arctan2(gy_, gx_) % np.pi) / np.pi
    mag = np.hypot(gx_, gy_).ravel()
    eo = np.bincount((ang.ravel() * 8).astype(int) % 8, weights=mag, minlength=8)
    eo = eo / (eo.sum() + 1e-9)
    subj = np.array([1.0 if s in (subject_tags or []) else 0.0 for s in SUBJECTS])
    v = np.concatenate([np.array(grid) * 0.6, hue_histogram(lab) * 1.5, eo, subj * 1.2])
    return _norm(v)
