// G10.4: no secret in the browser. Scans everything the build sends to the browser (.next/static) for key
// names, key-shaped strings and the actual values of the server's secrets. Prints only file names and the
// rule that matched, never a value. Exit code 1 if anything matches.
//
//   npm run build && npm run check:bundle

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Finding {
  file: string;
  rule: string;
}

export const FORBIDDEN_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "GEMINI_API_KEY", "service_role", "supabase.co", "@supabase/supabase-js", "mozchjkxxciughpsfive"];
const SHAPES: [string, RegExp][] = [
  ["a JWT-shaped token", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a Google API key", /AIza[0-9A-Za-z_-]{30,}/],
  ["a Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|css|html|json|map|txt)$/.test(name)) out.push(p);
  }
  return out;
}

/** Values of the server's secrets from the environment and .env.local, so a leaked value is caught by value too. */
export function secretValues(env: NodeJS.ProcessEnv = process.env, envFile = ".env.local"): string[] {
  const names = ["SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"];
  const values = new Set<string>();
  for (const n of names) if (env[n]) values.add(env[n] as string);
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && names.includes(m[1])) values.add(m[2].replace(/^["']|["']$/g, ""));
    }
  }
  return [...values].filter((v) => v.length >= 8);
}

export function scanFiles(files: string[], values: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const n of FORBIDDEN_NAMES) if (text.includes(n)) findings.push({ file, rule: `contains "${n}"` });
    for (const [label, re] of SHAPES) if (re.test(text)) findings.push({ file, rule: `contains ${label}` });
    if (values.some((v) => text.includes(v))) findings.push({ file, rule: "contains the value of a server secret" });
  }
  return findings;
}

export function scanBuild(dir = ".next/static"): { scanned: number; findings: Finding[] } {
  if (!existsSync(dir)) throw new Error(`${dir} not found. Run "npm run build" first.`);
  const files = walk(dir);
  return { scanned: files.length, findings: scanFiles(files, secretValues()) };
}

if (process.argv[1]?.endsWith("checkBundle.ts")) {
  const { scanned, findings } = scanBuild();
  if (findings.length) {
    console.error(`G10.4 FAILED: ${findings.length} problem(s) in the browser bundle:`);
    for (const f of findings) console.error(`  ${f.file}: ${f.rule}`);
    process.exit(1);
  }
  console.log(`G10.4 passed: scanned ${scanned} browser files; no secret names, key shapes or secret values.`);
}
