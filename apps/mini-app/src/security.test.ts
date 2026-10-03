import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural security-boundary tests (Section 09 §31/§37/§48/§60).
 * These scan the ACTUAL source tree rather than asserting behavior
 * through a mock — the point is to catch a future regression where
 * someone adds a raw `fetch()` call bypassing the centralized API
 * client, or a secret-looking string creeps into a file that ends up in
 * the browser bundle, before it ever reaches a build.
 */

const SRC_DIR = join(__dirname);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      listSourceFiles(fullPath, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx") && !entry.endsWith(".d.ts")) {
      out.push(fullPath);
    }
  }
  return out;
}

describe("Mini App source — no bypass of the centralized API client", () => {
  it("contains no raw fetch() call outside services/api.ts (Section 09 §31 — 'no arbitrary fetch calls scattered through components')", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_DIR)) {
      if (file.endsWith(join("services", "api.ts"))) continue; // the one sanctioned module
      const content = readFileSync(file, "utf8");
      if (/\bfetch\s*\(/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("Mini App source — no secret material in the browser-bundled tree", () => {
  const FORBIDDEN_PATTERNS = [/service_role/i, /SUPABASE_SERVICE_ROLE_KEY/, /SESSION_SIGNING_SECRET/, /TELEGRAM_BOT_TOKEN/, /BEGIN (RSA |EC )?PRIVATE KEY/];

  it("never references a server-only secret name or embeds key material (Section 09 §37)", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
