import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(projectRoot, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const targetDir = join(projectRoot, "public", "duckdb");

const assets = [
  "duckdb-mvp.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-eh.wasm",
  "duckdb-browser-eh.worker.js",
];

if (!existsSync(sourceDir)) {
  console.error(`DuckDB-Wasm dist not found at ${sourceDir}. Run npm install first.`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
for (const asset of assets) {
  copyFileSync(join(sourceDir, asset), join(targetDir, asset));
}
console.log(`Copied ${assets.length} DuckDB-Wasm assets to public/duckdb`);
