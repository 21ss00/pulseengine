import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTelemetryGenerators } from "../src/telemetry/generators.ts";
import {
  SCHEMA_STATEMENTS,
  buildAlphaInsertSql,
  buildBetaInsertSql,
  buildGammaInsertSql,
} from "../src/analytics/schema.ts";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist") + "/";

export async function openDb() {
  const duckdb = require(dist + "duckdb-node-blocking.cjs");
  const bundles = {
    mvp: { mainModule: dist + "duckdb-mvp.wasm", mainWorker: dist + "duckdb-node-mvp.worker.cjs" },
    eh: { mainModule: dist + "duckdb-eh.wasm", mainWorker: dist + "duckdb-node-eh.worker.cjs" },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate(() => {});
  const conn = db.connect();
  for (const statement of SCHEMA_STATEMENTS) conn.query(statement);
  return conn;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function toRows(table) {
  return table.toArray().map((row) => {
    const plain = row.toJSON();
    const out = {};
    for (const key of Object.keys(plain)) {
      out[key] = typeof plain[key] === "bigint" ? Number(plain[key]) : plain[key];
    }
    return out;
  });
}

/**
 * Drives the real generators on a simulated clock and loads the events into
 * DuckDB, ending exactly at `endMs`.
 */
export function simulate(conn, { seconds, endMs, seed = 42, betaTopics }) {
  const startMs = endMs - seconds * 1000;
  let clock = startMs;
  const gen = createTelemetryGenerators({
    now: () => clock,
    random: mulberry32(seed),
    betaTopics,
  });
  const buffers = { alpha: [], beta: [], gamma: [] };
  const flush = () => {
    if (buffers.alpha.length) conn.query(buildAlphaInsertSql(buffers.alpha));
    if (buffers.beta.length) conn.query(buildBetaInsertSql(buffers.beta));
    if (buffers.gamma.length) conn.query(buildGammaInsertSql(buffers.gamma));
    buffers.alpha = [];
    buffers.beta = [];
    buffers.gamma = [];
  };
  for (clock = startMs; clock < endMs; clock += 20) {
    const offset = clock - startMs;
    if (offset % 40 === 0) buffers.alpha.push(gen.alpha().payload);
    if (offset % 220 === 0) buffers.beta.push(gen.beta().payload);
    if (offset % 120 === 0) buffers.gamma.push(gen.gamma().payload);
    if (buffers.alpha.length + buffers.beta.length + buffers.gamma.length > 800) flush();
  }
  flush();
  return { startMs, endMs };
}
