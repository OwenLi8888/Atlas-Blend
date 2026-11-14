/** Run a child process that speaks JSON lines on stdout ({"event": ...}). */
import { spawn } from "node:child_process";

export interface JsonEvent { event: string; [k: string]: unknown }

export function runJsonLines(
  cmd: string, args: string[],
  opts: { cwd: string; input?: string; env?: NodeJS.ProcessEnv; onEvent?: (e: JsonEvent) => void; timeoutMs?: number },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8", ...opts.env }, shell: false });
    let buf = "", err = "", result: unknown = undefined, failed: string | null = null;
    const timer = setTimeout(() => { p.kill(); failed = `timed out after ${opts.timeoutMs}ms`; }, opts.timeoutMs ?? 180_000);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        try {
          const ev = JSON.parse(line) as JsonEvent;
          if (ev.event === "result") result = ev.data;
          else if (ev.event === "error") failed = String(ev.message);
          else opts.onEvent?.(ev);
        } catch { /* non-JSON log line */ }
      }
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (result !== undefined && !failed) resolve(result);
      else reject(new Error(failed ?? `${cmd} exited ${code}: ${err.slice(-1500)}`));
    });
    if (opts.input) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}
