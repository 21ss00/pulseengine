/**
 * Validation for user-typed SQL in the query console. The dashboard depends on
 * its tables, so the console is read-only: one statement, starting with a
 * read keyword. Enforced in the DuckDB worker, not just in the UI.
 */

export type GuardResult =
  | { ok: true; sql: string; wrappable: boolean }
  | { ok: false; error: string };

const WRAPPABLE = new Set(["select", "with", "from", "values"]);
const PASSTHROUGH = new Set(["describe", "show", "explain", "summarize"]);

interface Scanned {
  /** Text with comments removed; string literals are kept verbatim. */
  text: string;
  /** Index in `text` of each ';' that sits outside string literals. */
  semicolons: number[];
  unterminated: boolean;
}

function scan(input: string): Scanned {
  let text = "";
  const semicolons: number[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === "-" && next === "-") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      if (end === -1) return { text, semicolons, unterminated: true };
      i = end + 2;
      text += " ";
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      text += ch;
      i++;
      let closed = false;
      while (i < input.length) {
        text += input[i];
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            text += input[i + 1];
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) return { text, semicolons, unterminated: true };
      continue;
    }
    if (ch === ";") semicolons.push(text.length);
    text += ch;
    i++;
  }
  return { text, semicolons, unterminated: false };
}

export function prepareReadOnlySql(input: string): GuardResult {
  const scanned = scan(input);
  if (scanned.unterminated) {
    return { ok: false, error: "Unterminated string literal or comment." };
  }

  let text = scanned.text.trim();
  while (text.endsWith(";")) text = text.slice(0, -1).trimEnd();
  if (text.length === 0) {
    return { ok: false, error: "Enter a SQL statement to run." };
  }

  const rescanned = scan(text);
  if (rescanned.semicolons.length > 0) {
    return { ok: false, error: "Only one statement can be run at a time." };
  }

  const keyword = /^[a-zA-Z]+/.exec(text)?.[0].toLowerCase() ?? "";
  if (WRAPPABLE.has(keyword)) {
    return { ok: true, sql: text, wrappable: true };
  }
  if (PASSTHROUGH.has(keyword)) {
    if (keyword === "explain" && /\banalyze\b/i.test(text)) {
      return { ok: false, error: "EXPLAIN ANALYZE executes the statement and is not allowed." };
    }
    return { ok: true, sql: text, wrappable: false };
  }
  return {
    ok: false,
    error:
      "The console is read-only. Start with SELECT, WITH, FROM, VALUES, DESCRIBE, SHOW, EXPLAIN or SUMMARIZE.",
  };
}
