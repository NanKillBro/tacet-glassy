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

const packageJsonPath = join(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
packageJson.version = match[0];
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Bumped package.json version to ${match[0]}`);
