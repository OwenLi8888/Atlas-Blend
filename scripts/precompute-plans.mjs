// Precomputes the stroke plan for every painting in public/paintings/paintings.json.
//
//   node scripts/precompute-plans.mjs            all paintings
//   node scripts/precompute-plans.mjs monet      just these ids
//
// Writes public/paintings/<id>.plan.json. The app loads that file when it exists and otherwise
// plans in a Web Worker, so this step only makes the first paint instant.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planImpasto, strokesToJSON } from 'tryimpasto';
import { decodeImage, downscale } from './lib/images.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'paintings');
const only = process.argv.slice(2);

/** Keep in step with PLAN_VERSION and trimStrokes in src/plan/format.ts. */
const PLAN_VERSION = 1;
const PLAN_MAX_SIDE = 1024;
const r3 = (v) => Math.round(v * 1000) / 1000;

function trimStrokes(strokes) {
  return strokes.map((s) => ({
    layer: s.layer,
    primitive: s.primitive,
    points: s.points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
    widthMm: r3(s.widthMm),
    lengthMm: r3(s.lengthMm),
    contact: s.contact.map(r3),
    color: s.color.map(r3),
    secondary: s.secondary.map(r3),
  }));
}

const paintings = JSON.parse(readFileSync(path.join(dir, 'paintings.json'), 'utf8'));
let failed = 0;
for (const p of paintings) {
  if (only.length && !only.includes(p.id)) continue;
  const file = path.join(dir, p.file);
  if (!existsSync(file)) {
    console.warn(`${p.id}: ${p.file} is missing, skipped`);
    failed++;
    continue;
  }
  const t0 = performance.now();
  const img = downscale(decodeImage(file), PLAN_MAX_SIDE);
  const result = await planImpasto(
    { width: img.width, height: img.height, data: img.data, channels: 4 },
    { widthMm: p.widthMm ?? 200 },
  );
  const plan = {
    version: PLAN_VERSION,
    id: p.id,
    widthMm: r3(result.widthMm),
    heightMm: r3(result.heightMm),
    strokes: trimStrokes(strokesToJSON(result.plan)),
  };
  const out = path.join(dir, `${p.id}.plan.json`);
  const json = JSON.stringify(plan);
  writeFileSync(out, json);
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `${p.id}: ${plan.strokes.length} strokes, ${plan.widthMm} x ${plan.heightMm} mm, ` +
      `${(json.length / 1024).toFixed(0)} kB, ${s} s -> ${path.relative(root, out)}`,
  );
}
if (failed) process.exitCode = 1;
