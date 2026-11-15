/**
 * Client for the warm painter process (worker/src/serve.ts). Started once on first use (and again
 * if it dies); jobs are matched to their events by id.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { ROOT } from "./paths.js";

type Handler = { onEvent: (e: any) => void; resolve: (d: any) => void; reject: (e: Error) => void };
let proc: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<void> | null = null;
const jobs = new Map<string, Handler>();
let seq = 0;

function start(): Promise<void> {
  if (proc && ready) return ready;
  const p = spawn(process.execPath, ["--import", "tsx", join(ROOT, "worker", "src", "serve.ts")], { cwd: join(ROOT, "worker") });
  proc = p;
  let stderr = "";
  p.stderr.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
  ready = new Promise((resolve, reject) => {
    createInterface({ input: p.stdout }).on("line", (line) => {
      let e: any;
      try { e = JSON.parse(line); } catch { return; }
      if (e.event === "ready") return resolve();
      const h = jobs.get(e.id);
      if (!h) return;
      if (e.event === "result") { jobs.delete(e.id); h.resolve(e.data); }
      else if (e.event === "error") { jobs.delete(e.id); h.reject(new Error(e.message)); }
      else h.onEvent(e);
    });
    p.on("exit", (code) => {
      const err = new Error(`painter exited ${code}: ${stderr}`);
      for (const h of jobs.values()) h.reject(err);
      jobs.clear();
      proc = null;
      ready = null;
      reject(err);
    });
  });
  return ready;
}

/** Warm the painter up front so the first blend doesn't pay the startup. */
export function warmPainter() {
  start().catch((e) => console.error("[painter]", e.message));
}

export async function paintWithTechnique(
  job: { a: string; b: string; medium: "oil" | "watercolor"; out: string }, onEvent: (e: any) => void,
): Promise<any> {
  await start();
  const id = `j${++seq}`;
  return new Promise((resolve, reject) => {
    jobs.set(id, { onEvent, resolve, reject });
    proc!.stdin.write(JSON.stringify({ id, ...job }) + "\n");
  });
}
