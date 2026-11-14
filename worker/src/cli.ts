/**
 * Worker CLI. Emits JSON lines on stdout: {"event":"progress",...} then {"event":"result",...}.
 *   tsx src/cli.ts --still path/still.png --out dir --brush watercolor [--size 512]
 */
import { paint } from "./paint.js";
import type { BrushName } from "./brushes.js";

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const still = arg("still");
const out = arg("out");
if (!still || !out) {
  console.error("usage: --still <png> --out <dir> [--brush oil|watercolor|ink|gouache|pastel] [--size 512]");
  process.exit(2);
}
paint({
  still, outDir: out,
  brush: arg("brush", "oil") as BrushName,
  size: arg("size") ? Number(arg("size")) : undefined,
  onProgress: (p) => process.stdout.write(JSON.stringify({ event: "progress", ...p }) + "\n"),
})
  .then((r) => process.stdout.write(JSON.stringify({ event: "result", data: r }) + "\n"))
  .catch((e) => {
    process.stdout.write(JSON.stringify({ event: "error", message: String(e?.message ?? e) }) + "\n");
    process.exit(1);
  });
