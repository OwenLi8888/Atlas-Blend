/**
 * Worker CLI. Emits JSON lines on stdout: {"event":"progress",...} then {"event":"result",...}.
 *   tsx src/cli.ts --still path/still.png --out dir --brush watercolor [--size 512]
 *   tsx src/cli.ts --engine impasto --still path/still.png --out dir [--brush oil|watercolor|dots]
 *                  [--size 640] [--area 200000] [--seconds 14]
 *   tsx src/cli.ts --engine technique --a imageA --b paintingB --medium oil|watercolor --out dir
 *                  (paint A with B's technique; B's medium sets the renderer)
 */
import { paint } from "./paint.js";
import type { BrushName } from "./brushes.js";
import { paintImpasto, type StyleName } from "./impasto/paint.ts";
import { paintTransfer } from "./transfer.ts";

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const still = arg("still") ?? arg("a");
const out = arg("out");
if (!still || !out || (arg("engine") === "technique" && !arg("b"))) {
  console.error("usage: --still <png> --out <dir> [--engine builtin|impasto] [--brush oil|watercolor|ink|gouache|pastel|dots] [--size 512] [--area 200000] [--seconds 14]");
  process.exit(2);
}
const onProgress = (p: object) => process.stdout.write(JSON.stringify({ event: "progress", ...p }) + "\n");
const num = (name: string) => (arg(name) ? Number(arg(name)) : undefined);

const job = arg("engine") === "technique"
  ? paintTransfer({ a: still, b: arg("b")!, medium: arg("medium") === "watercolor" ? "watercolor" : "oil", outDir: out, onProgress, size: num("size"), paintSeconds: num("seconds") })
  : arg("engine") === "impasto"
  ? paintImpasto({
      still, outDir: out, onProgress,
      style: arg("brush", "oil") as StyleName,
      size: num("size"), areaMm2: num("area"), paintSeconds: num("seconds"),
    })
  : paint({ still, outDir: out, brush: arg("brush", "oil") as BrushName, size: num("size"), onProgress });

job
  .then((r) => process.stdout.write(JSON.stringify({ event: "result", data: r }) + "\n"))
  .catch((e) => {
    process.stdout.write(JSON.stringify({ event: "error", message: String(e?.message ?? e) }) + "\n");
    process.exit(1);
  });
