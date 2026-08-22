import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root) throw new Error("test root is required");

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  }));
  return nested.flat();
}

const files = (await collect(root)).sort();
if (files.length === 0) throw new Error(`no test files under ${root}`);
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
