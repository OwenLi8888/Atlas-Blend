// Image decode / resize helpers for the Node scripts. Pure JS (jpeg-js, pngjs): no native modules.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/** Decodes a .jpg/.jpeg/.png file to { width, height, data } with RGBA bytes. */
export function decodeImage(file) {
  const buf = readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 2048, maxResolutionInMP: 400 });
    return { width: img.width, height: img.height, data: img.data };
  }
  throw new Error(`Unsupported image type "${ext}" (use .jpg, .jpeg or .png): ${file}`);
}

/** Area-averaged downscale so the longest side is at most maxSide. Returns the input when already small. */
export function downscale(img, maxSide) {
  const scale = maxSide / Math.max(img.width, img.height);
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(w * h * 4);
  const fx = img.width / w;
  const fy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * fy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * fx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

export function encodeJpeg(img, quality = 88) {
  return jpeg.encode({ width: img.width, height: img.height, data: img.data }, quality).data;
}
