import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Plasmo only copies files under assets/ that web_accessible_resources lists,
// and its globs do not cross a slash, so every subdirectory needs its own
// entry. A missing one is not a build error: the offscreen document's import
// 404s at runtime, the document dies before registering a listener, and the
// extension goes dark with nothing in the console but ERR_FILE_NOT_FOUND. That
// has now happened five times, most recently for src/shared.

const ROOT = new URL("../..", import.meta.url).pathname;

function declaredResources(): string[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return manifest.manifest.web_accessible_resources.flatMap((entry: { resources: string[] }) => entry.resources);
}

// Every `../src/<dir>/...` a worker imports has to survive the copy.
function directoriesWorkersImport(): Set<string> {
  const workersDir = join(ROOT, "workers");
  const directories = new Set<string>();
  for (const file of readdirSync(workersDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(workersDir, file), "utf8");
    for (const match of source.matchAll(/from\s+"\.\.\/src\/([^/"]+)\//g)) {
      directories.add(match[1]);
    }
  }
  return directories;
}

describe("web_accessible_resources", () => {
  it("ships every src directory the workers import from", () => {
    const declared = declaredResources();
    const missing = [...directoriesWorkersImport()].filter(
      directory => !declared.includes(`assets/src/${directory}/*`)
    );
    expect(missing).toEqual([]);
  });

  it("finds the imports it is meant to be checking", () => {
    expect(directoriesWorkersImport().size).toBeGreaterThan(3);
  });

  describe("regressions", () => {
    it("ships src/shared, whose absence killed the offscreen document", () => {
      expect(declaredResources()).toContain("assets/src/shared/*");
    });
  });
});
