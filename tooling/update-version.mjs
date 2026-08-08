import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const inputVersion = process.argv[2];
if (!inputVersion) {
  console.error("Usage: node tooling/update-version.mjs <version>");
  process.exit(1);
}

// Chrome accepts up to four dot-separated integers and nothing else, so a
// "-canary" suffix is carried by the tag and the release, never the manifest.
const match = inputVersion.match(/^(\d+\.\d+\.\d+)(\.\d+)?/);
if (!match) {
  console.error(`Invalid version: ${inputVersion}`);
  process.exit(1);
}
const version = match[0];

// Rewriting the one line rather than reserialising: JSON.stringify expands the
// short arrays biome keeps inline, which would fail the next release's lint.
const packageJsonPath = join(process.cwd(), "package.json");
const source = readFileSync(packageJsonPath, "utf-8");
const versionLine = /^(\s*"version":\s*)"[^"]*"/m;
if (!versionLine.test(source)) {
  console.error("No version field found in package.json");
  process.exit(1);
}

writeFileSync(packageJsonPath, source.replace(versionLine, `$1"${version}"`));
console.log(`Bumped package.json version to ${version}`);
