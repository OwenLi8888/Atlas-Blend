/**
 * Long-running painter for the API: one warm process, jobs in on stdin, events out on stdout.
 * Saves the ~1.3 s of TypeScript/Node startup per job and keeps the planner JIT-warm.
 *
 *   in : {"id":"j1","a":"<image A>","b":"<painting B>","medium":"oil"|"watercolor","out":"<dir>"}
 *   out: {"id":"j1","event":"progress",...} ... {"id":"j1","event":"result","data":{...}}
 *        or {"id":"j1","event":"error","message":"..."}
 * Jobs run one at a time, in order.
 */
import { createInterface } from "node:readline";
import { paintTransfer } from "./transfer.ts";

const send = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");
let queue: Promise<void> = Promise.resolve();

createInterface({ input: process.stdin }).on("line", (line) => {
  let job: { id: string; a: string; b: string; medium: string; out: string };
  try { job = JSON.parse(line); } catch { return; }
  queue = queue.then(async () => {
    try {
      const data = await paintTransfer({
        a: job.a, b: job.b, medium: job.medium === "watercolor" ? "watercolor" : "oil", outDir: job.out,
        onProgress: (p) => send({ id: job.id, event: "progress", ...p }),
      });
      send({ id: job.id, event: "result", data });
    } catch (e: any) {
      send({ id: job.id, event: "error", message: String(e?.message ?? e) });
    }
  });
});
send({ event: "ready" });
