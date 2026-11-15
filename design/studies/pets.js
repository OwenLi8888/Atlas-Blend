// Shared by the 3D studies: the playable characters as 16x16 sprites, and the artwork list.
// A sprite is the single source for every form of a pet: paper sticker (book study),
// voxel body (portal study), LCD icon (app skin "pet").
// Legend: . empty, k outline and eyes, b body, c light belly or face, t white, p accent, r and y paint dabs.

export const PETS = {
  beaver: {
    name: "Beaver",
    ink: { k: "#3b2a20", b: "#a8693d", c: "#e8c79a", t: "#fff8ea", p: "#7a4a2a", r: "#ff6fa3", y: "#ffd447" },
    rows: [
      "................", "...kk......kk...", "..kbbkkkkkkbbk..", "..kbbbbbbbbbbk..", ".kbbbbbbbbbbbbk.", ".kbbkbbbbbbkbbk.",
      ".kbbbbbkkbbbbbk.", ".kbbbcckkccbbbk.", ".kbbbccttccbbbk.", "..kbbcccccbbk...", "..kbbcccccbbkkk.", ".kbbbcccccbbkppk",
      ".kbbbbcccbbbkrpk", "..kbbbbbbbbkpypk", "..kkbkkkkbkkkkk.", "...kk....kk.....",
    ],
  },
  cat: {
    name: "Cat",
    ink: { k: "#33282e", b: "#f2a24b", c: "#fff1dc", t: "#ffffff", p: "#ff9fb4", r: "#6fe0c8", y: "#ffd447" },
    rows: [
      "................", "..kk........kk..", ".kbbk......kbbk.", ".kbpbkkkkkkbpbk.", ".kbbbbbbbbbbbbk.", ".kbbkbbbbbbkbbk.",
      ".kbbbbbbbbbbbbk.", ".kbbccbkkbccbbk.", ".kbbbcckkccbbbk.", "..kbbccccccbbk..", "..kbbccccccbbkk.", ".kbbbccccccbbkbk",
      ".kbbbbccccbbbkbk", "..kbbbbbbbbbkkbk", "..kkbkkkkbkk.kk.", "...kk....kk.....",
    ],
  },
  frog: {
    name: "Frog",
    ink: { k: "#1f3b2a", b: "#6cc56a", c: "#e9f7c8", t: "#ffffff", p: "#ff7a59", r: "#ff6fa3", y: "#ffd447" },
    rows: [
      "................", "..kkk......kkk..", ".kcckk....kkcck.", ".kckckkkkkkckck.", ".kcccbbbbbbccck.", ".kbbbbbbbbbbbbk.",
      ".kbbbbbbbbbbbbk.", ".kbpbbbbbbbbpbk.", ".kbbkkkkkkkkbbk.", "..kbbccccccbbk..", "..kbccccccccbk..", ".kbbccccccccbbk.",
      ".kbbbccccccbbbk.", "kbbkbbbbbbbbkbbk", "kkkkkbkkkkbkkkkk", "....kk....kk....",
    ],
  },
};

/** Canvas with the pet drawn at `px` per sprite pixel. `sticker` adds a white die-cut border. */
export function petCanvas(pet, px = 12, sticker = false) {
  const pad = sticker ? px : 0, size = 16 * px + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const each = (fn) => pet.rows.forEach((line, y) => [...line].forEach((ch, x) => { if (pet.ink[ch]) fn(x, y, ch); }));
  if (sticker) {
    g.fillStyle = "#fffdf6";
    each((x, y) => g.fillRect(pad + x * px - pad * 0.8, pad + y * px - pad * 0.8, px + pad * 1.6, px + pad * 1.6));
  }
  each((x, y, ch) => { g.fillStyle = pet.ink[ch]; g.fillRect(pad + x * px, pad + y * px, px, px); });
  return cv;
}

// Twelve quiz artworks (three rounds of four) and the painting shown as the blend result.
export const QUIZ_ART = ["aic-9148", "aic-16794", "aic-14311", "aic-9", "aic-22857", "aic-7169", "aic-181777", "aic-21085", "aic-874", "aic-887", "aic-895", "aic-9021"];
export const BLEND_ART = "aic-16584";
export const artUrl = (id) => `mock-art/${id}.jpg`;
export const loadImage = (src) => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });
