// G10.4 No secret in the browser, plus the rules that keep it that way (SPEC §16.1).

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanBuild, scanFiles } from "@/scripts/checkBundle";

const ROOT = join(__dirname, "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => p.slice(ROOT.length + 1);

describe("G10.4 no secret in the browser", () => {
  it("the scanner catches key names, key shapes and secret values, and says which file and rule, never the value", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    const clean = join(dir, "clean.js");
    const bad1 = join(dir, "bad1.js");
    const bad2 = join(dir, "bad2.js");
    const bad3 = join(dir, "bad3.js");
    writeFileSync(clean, "console.log('hello')");
    writeFileSync(bad1, "const k = process.env.SUPABASE_SERVICE_ROLE_KEY");
    writeFileSync(bad2, 'const t = "eyJhbGciOiJIUzI1NiIsInR5cCI6.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop"');
    writeFileSync(bad3, 'const v = "super-secret-value-123"');
    const f = scanFiles([clean, bad1, bad2, bad3], ["super-secret-value-123"]);
    expect(f.filter((x) => x.file === clean)).toEqual([]);
    expect(f.filter((x) => x.file === bad1).length).toBeGreaterThan(0);
    expect(f.filter((x) => x.file === bad2).some((x) => /JWT/.test(x.rule))).toBe(true);
    expect(f.filter((x) => x.file === bad3)[0].rule).toBe("contains the value of a server secret");
    expect(JSON.stringify(f)).not.toContain("super-secret-value-123");
  });

  it.runIf(existsSync(join(ROOT, ".next", "static")))("the built browser bundle contains no secret (run after a build)", () => {
    const { scanned, findings } = scanBuild(join(ROOT, ".next", "static"));
    expect(scanned).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });

  it("only server files import the database, the server-only modules, or read the secret variables", () => {
    const files = sources(ROOT).filter((f) => !rel(f).startsWith("tests/") && !rel(f).startsWith("scripts/"));
    const offenders: string[] = [];
    for (const f of files) {
      const r = rel(f);
      const text = readFileSync(f, "utf8");
      const isServer = r.startsWith("lib/server/") || r.startsWith("app/api/") || r === "lib/llm/gemini.ts";
      if (!isServer && /@supabase\/supabase-js|lib\/server\/|from "server-only"/.test(text)) offenders.push(`${r}: imports server code`);
      if (!isServer && /SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY/.test(text)) offenders.push(`${r}: names a secret`);
      if (/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|SERVICE|PASSWORD)/.test(text)) offenders.push(`${r}: a secret behind NEXT_PUBLIC_`);
    }
    expect(offenders).toEqual([]);
  });

  it("every file that can reach the database starts with 'server-only', so a client import fails the build", () => {
    for (const f of ["lib/server/supabaseRepo.ts", "lib/server/getRepo.ts", "lib/server/route.ts", "lib/server/aiRoute.ts", "lib/llm/gemini.ts"]) {
      expect(readFileSync(join(ROOT, f), "utf8").startsWith('import "server-only";')).toBe(true);
    }
  });

  it(".env files are ignored by git and no environment file is committed", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env\*/m);
    const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n");
    expect(tracked.filter((f: string) => /(^|\/)\.env/.test(f) && !f.endsWith(".example"))).toEqual([]);
  });

  it("RLS is on for every table, with no policies, in the migrations", () => {
    const dir = join(ROOT, "supabase", "migrations");
    const sql = readdirSync(dir).map((n) => readFileSync(join(dir, n), "utf8")).join("\n");
    expect(sql).toMatch(/alter table public\.workspaces enable row level security/);
    expect(sql).toMatch(/alter table public\.events enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on function public\.append_event/);
  });
});
