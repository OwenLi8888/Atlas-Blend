import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNTIME = process.env.RUNTIME_DIR ?? join(ROOT, "data", "runtime");
export const CATALOG_DIR = join(ROOT, "catalog", "data");
export const BLEND_DIR = join(ROOT, "blend");
export const AGENT_DIR = join(ROOT, "agent");
export const WORKER_CLI = join(ROOT, "worker", "src", "cli.ts");
export const PYTHON = process.env.PYTHON ?? "python";
