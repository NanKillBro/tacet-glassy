// Applies the Electron patch series in patches/electron/ to this checkout.
//
// The tracked sources here stay as upstream wrote them; every local fix lives in a
// patch file and is applied at build time. That keeps `git merge upstream/main`
// from ever conflicting on a source file — at worst a patch needs refreshing —
// and it keeps each fix readable on its own.
//
//   node tooling/apply-patches.mjs             apply the series (idempotent)
//   node tooling/apply-patches.mjs --status    report what is applied
//   node tooling/apply-patches.mjs --revert    return to a pristine tree
//
// Patches are numbered because order matters: several of them touch the same file,
// and a later one is written against the tree an earlier one produced.
//
// Which means no patch can be tested against the tree with `git apply --check` on its
// own. Patch 01's context stops existing the moment 03 lands on the same file, so on
// a fully patched tree 01 checks as neither applied nor applicable — and passing the
// whole series to one `git apply --check` does not help, because in check mode git
// does not carry each patch's result forward to the next.
//
// So state is read from the patches instead of guessed at. Every `index a..b` line in
// a git patch records the blob hash of that file before and after that step, and
// `git hash-object` gives the same hash for a working-tree file (both run the same
// clean filter, which is what keeps this correct on a CRLF checkout). Comparing the
// two says exactly how far the series has gone in, in any order, with no trial
// applies and nothing to undo.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchDir = join(root, "patches", "electron");
const LABEL = "[patches]";

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function patchNames() {
  let entries;
  try {
    entries = readdirSync(patchDir);
  } catch {
    return [];
  }
  return entries.filter(name => name.endsWith(".patch")).sort();
}

// -- what each patch claims about each file it touches -------------------------

// [{ path, pre, post }] — pre/post are blob hashes as git abbreviated them, with
// all-zeros meaning the file does not exist at that point in the series.
//
// The patch files are generated with LF, but a Windows checkout hands them back with
// CRLF unless .gitattributes says otherwise, and a stray CR breaks this parse in a way
// that is not obvious: in a JS regex `.` does not match \r, so `(.+)$` on a `diff --git`
// line fails, no path is ever picked up, and the patch reads as having no steps at all.
// So normalise first and do not rely on the checkout being configured.
function readPatch(name) {
  const text = readFileSync(join(patchDir, name), "utf8").replace(/\r\n/g, "\n");
  const steps = [];
  let path = null;
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      path = header[2];
      continue;
    }
    const index = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/.exec(line);
    if (index && path) {
      steps.push({ path, pre: index[1], post: index[2] });
      path = null;
    }
  }
  if (steps.length === 0) throw new Error(`${name} has no 'index a..b' lines, so its state cannot be read`);
  return steps;
}

function isAbsent(hash) {
  return /^0+$/.test(hash);
}

// git abbreviates in patches and prints in full; compare on the shorter one.
function sameHash(a, b) {
  if (a === null || b === null) return a === b;
  const width = Math.min(a.length, b.length);
  return a.slice(0, width) === b.slice(0, width);
}

// -- what the tree holds now ---------------------------------------------------

function currentHashes(paths) {
  const present = paths.filter(path => existsSync(join(root, path)));
  const hashes = new Map(paths.map(path => [path, null]));
  if (present.length === 0) return hashes;
  const result = git(["hash-object", ...present]);
  if (!result.ok) throw new Error(`git hash-object failed:\n${result.stderr}`);
  const lines = result.stdout.trim().split("\n");
  if (lines.length !== present.length) throw new Error("git hash-object answered with the wrong number of hashes");
  present.forEach((path, index) => hashes.set(path, lines[index]));
  return hashes;
}

// -- how far the series has gone in --------------------------------------------

// With patches 1..m applied, a file holds whatever the last of those left it as; a
// file no patch up to m touches still holds what the first patch after m expects.
function expectedHash(series, path, m) {
  for (let k = m - 1; k >= 0; k--) {
    const step = series[k].steps.find(entry => entry.path === path);
    if (step) return step.post;
  }
  for (let k = m; k < series.length; k++) {
    const step = series[k].steps.find(entry => entry.path === path);
    if (step) return step.pre;
  }
  throw new Error(`${path} is touched by no patch, which cannot happen`);
}

function mismatchesAt(series, paths, hashes, m) {
  const bad = [];
  for (const path of paths) {
    const expected = expectedHash(series, path, m);
    const actual = hashes.get(path);
    const matches = isAbsent(expected) ? actual === null : sameHash(expected, actual);
    if (!matches) bad.push({ path, expected, actual });
  }
  return bad;
}

// The number of leading patches in the tree, or null if it is in no state this series
// can describe. Counted down from the whole series so the common case — the build
// running this again on an already patched tree — is settled on the first try.
function readState(series, paths, hashes) {
  for (let m = series.length; m >= 0; m--) {
    if (mismatchesAt(series, paths, hashes, m).length === 0) return m;
  }
  return null;
}

function explainUnknown(series, paths, hashes) {
  // Naming the state the tree is *closest* to turns this from a wall of hashes into
  // a short list of the files actually out of step — usually one.
  let nearest = { m: 0, bad: mismatchesAt(series, paths, hashes, 0) };
  for (let m = 1; m <= series.length; m++) {
    const bad = mismatchesAt(series, paths, hashes, m);
    if (bad.length < nearest.bad.length) nearest = { m, bad };
  }
  const where =
    nearest.m === 0 ? "unpatched" : nearest.m === series.length ? "fully patched" : `patched up to ${nearest.m}`;
  console.error(`${LABEL} this tree is in no state the series describes.`);
  console.error(`${LABEL} Closest is ${where}, with ${nearest.bad.length} file(s) out of step:`);
  for (const { path, expected, actual } of nearest.bad) {
    const holds = actual === null ? "absent" : actual.slice(0, 7);
    console.error(`${LABEL}   ${path}: expected ${expected.slice(0, 7)}, tree holds ${holds}`);
  }
  console.error(
    `${LABEL} Either the sources moved under the series (an upstream merge — refresh the\n` +
      `${LABEL} patches), or something edited those files by hand. Reverting them to what\n` +
      `${LABEL} that state wants, or 'git checkout -- .' for a clean start, fixes it.`
  );
}

// -- doing it ------------------------------------------------------------------

function applyOne(name, extra = []) {
  return git(["apply", "--whitespace=nowarn", ...extra, join(patchDir, name)]);
}

function reverseOne(name) {
  return git(["apply", "--reverse", "--whitespace=nowarn", join(patchDir, name)]);
}

function verify(series, paths, want, what) {
  const bad = mismatchesAt(series, paths, currentHashes(paths), want);
  if (bad.length === 0) return;
  console.error(`${LABEL} ${what} finished but the tree is not what it should be:`);
  for (const { path } of bad) console.error(`${LABEL}   ${path}`);
  process.exit(1);
}

function runStatus(series, paths, hashes) {
  const m = readState(series, paths, hashes);
  if (m === null) {
    explainUnknown(series, paths, hashes);
    process.exit(1);
  }
  series.forEach((patch, index) => {
    console.log(`${LABEL} ${(index < m ? "applied" : "not applied").padEnd(11)} ${patch.name}`);
  });
  const summary = m === series.length ? "all applied" : m === 0 ? "none applied" : `${m} of ${series.length} applied`;
  console.log(`${LABEL} ${summary}`);
}

function runApply(series, paths, hashes) {
  const m = readState(series, paths, hashes);

  if (m === null) {
    // A patch whose context moved can still be placed by merging it against the blobs
    // it names, which is the shape an upstream merge leaves behind. Only worth trying
    // there: --3way needs the working tree to agree with the index, so it declines on
    // a tree that is half patched, and says so.
    let placed = 0;
    for (const patch of series) {
      const merged = applyOne(patch.name, ["--3way"]);
      if (!merged.ok) {
        explainUnknown(series, paths, hashes);
        console.error(`${LABEL} three-way merge of ${patch.name} did not work either. git said:\n${merged.stderr}`);
        process.exit(1);
      }
      placed++;
    }
    console.warn(
      `${LABEL} the series did not fit this tree and was placed by three-way merge.\n` +
        `${LABEL} The result is not what the patches describe any more — read the diff, and\n` +
        `${LABEL} regenerate the patches from it once you trust it.`
    );
    console.log(`${LABEL} ${placed} patch(es): placed by three-way merge`);
    return;
  }

  if (m === series.length) {
    console.log(`${LABEL} ${series.length} patch(es): already applied`);
    return;
  }

  for (const patch of series.slice(m)) {
    const result = applyOne(patch.name);
    if (!result.ok) {
      console.error(
        `${LABEL} ${patch.name} would not apply even though the tree is in the state it\n` +
          `${LABEL} expects. Something changed underneath this run. git said:\n${result.stderr}`
      );
      process.exit(1);
    }
  }
  verify(series, paths, series.length, "apply");
  console.log(`${LABEL} ${series.length} patch(es): ${series.length - m} applied, ${m} already in place`);
}

function runRevert(series, paths, hashes) {
  const m = readState(series, paths, hashes);

  if (m === null) {
    explainUnknown(series, paths, hashes);
    process.exit(1);
  }
  if (m === 0) {
    console.log(`${LABEL} nothing to revert`);
    return;
  }

  // Backwards, for the same reason they go on forwards.
  for (const patch of series.slice(0, m).reverse()) {
    const result = reverseOne(patch.name);
    if (!result.ok) {
      console.error(`${LABEL} failed to reverse ${patch.name}. git said:\n${result.stderr}`);
      process.exit(1);
    }
  }
  verify(series, paths, 0, "revert");
  console.log(`${LABEL} reverted ${m} patch(es)`);
}

// -- entry ---------------------------------------------------------------------

const mode = process.argv.includes("--revert") ? "revert" : process.argv.includes("--status") ? "status" : "apply";

const names = patchNames();
if (names.length === 0) {
  console.log(`${LABEL} no patches in patches/electron, nothing to do`);
  process.exit(0);
}

if (!git(["rev-parse", "--is-inside-work-tree"]).ok) {
  console.error(`${LABEL} not a git checkout, so the patch series cannot be applied here`);
  process.exit(1);
}

const series = names.map(name => ({ name, steps: readPatch(name) }));
const paths = [...new Set(series.flatMap(patch => patch.steps.map(step => step.path)))].sort();
const hashes = currentHashes(paths);

if (mode === "status") runStatus(series, paths, hashes);
else if (mode === "revert") runRevert(series, paths, hashes);
else runApply(series, paths, hashes);
