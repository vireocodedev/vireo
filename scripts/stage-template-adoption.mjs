import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./template-release-adoption-state.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commit = /^[a-f0-9]{40}$/u;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
function replaceExact(path, expected, replacement) {
  const source = readFileSync(path, "utf8");
  const count = source.split(expected).length - 1;
  if (count !== 1) throw new Error(`${path} must contain exactly one current coordinate to stage.`);
  writeFileSync(path, source.replace(expected, replacement));
}

export function assertNoPendingMarkdownChangesets(repositoryRoot = root) {
  const directory = resolve(repositoryRoot, ".changeset");
  const pending = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
    .map(entry => entry.name)
    .sort();
  if (pending.length > 0)
    throw new Error(`Template adoption refuses to collide with pending Changesets: ${pending.join(", ")}.`);
}

export function parseStageArguments(args = process.argv.slice(2)) {
  const options = { plan: null, dryRun: false, json: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--plan") options.plan = args[++index] ?? null;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown option ${argument}.`);
  }
  if (!options.help && !options.plan) throw new Error("--plan is required.");
  return options;
}

export function adoptionReceipt(plan) {
  if (plan?.action !== "stage" || !version.test(plan.version ?? "") || !commit.test(plan.commit ?? ""))
    throw new Error("Template adoption staging requires an exact approved plan.");
  return {
    schemaVersion: 1,
    status: "candidate",
    template: {
      repository: "vireocodedev/vireo-template",
      version: plan.version,
      tag: plan.tag,
      commit: plan.commit,
      releaseUrl: plan.releaseUrl,
    },
    createVireoVersion: plan.version,
    ecosystemRelease: plan.ecosystemRelease,
    releaseManifestSha256: plan.releaseManifestDigest,
    npm: plan.npm,
    maven: plan.maven,
    source: "immutable-template-release",
  };
}

function unresolvedReport(plan, reason) {
  return {
    schemaVersion: 1,
    status: "requires-human-upgrade-design",
    template: { version: plan.version, tag: plan.tag, commit: plan.commit },
    reason,
    invariant:
      "The automation never invents managed upgrade transforms, application-owned actions, or projection ownership.",
    requiredWork: [
      "Classify changed Template paths against the mirrored application projection contract.",
      "Add reviewed managed baselines and application-owned actions for the adjacent project-upgrade edge.",
      "Remove this report only after the candidate upgrade is executable and its focused fixtures pass.",
    ],
  };
}

function changesetBump(current, target) {
  const [currentMajor, currentMinor, currentPatch] = current.split(".").map(Number);
  const [targetMajor, targetMinor, targetPatch] = target.split(".").map(Number);
  if (targetMajor !== currentMajor)
    throw new Error("Template adoption refuses a major create-vireo version transition.");
  if (targetMinor === currentMinor && targetPatch === currentPatch + 1) return "patch";
  // Template's own release-coordinate-change detection only ever fires for the
  // exact push that changes it, so a Template release whose tag/GitHub Release
  // creation fails partway can never be retried later (see
  // planTemplateRelease's intentionally strict "release coordinates did not
  // change" gate) — the only safe recovery is preparing and releasing the next
  // version instead, which can leave a gap (e.g. Template goes straight from
  // 0.8.7 to 0.9.1 because 0.9.0 was prepared but never actually tagged).
  // Accept any forward minor-version jump here so create-vireo can still adopt
  // that real, immutable Template release.
  if (targetMinor > currentMinor) return "minor";
  throw new Error("Template adoption version must be the exact next patch or a later minor release.");
}

function stageEmptySafeUpgrade(repositoryRoot, plan) {
  const packedPath = resolve(repositoryRoot, "packages/create-vireo/schema/vireo-upgrade-policy.json");
  const projectPath = resolve(repositoryRoot, "contracts/project-upgrade-policy.json");
  const packed = readJson(packedPath);
  const project = readJson(projectPath);
  const graph = packed.releaseGraph;
  const predecessor = graph?.publicRelease;
  const source = graph?.releases?.find(release => release.release === predecessor && release.status === "current");
  if (!source || graph.candidateRelease || project.publicationState !== "final")
    throw new Error("A safe Template adoption requires one finalized current upgrade graph.");
  const candidate = {
    ...structuredClone(source),
    release: plan.version,
    status: "candidate",
    templateCommit: plan.commit,
    rootVireoScript: `npx --yes --package=create-vireo@${plan.version} vireo`,
    starterJvmVersion: plan.maven.version,
  };
  graph.candidateRelease = plan.version;
  graph.releases.push(candidate);
  graph.edges.push({
    from: predecessor,
    to: plan.version,
    lockfileRefresh: "not-required",
    applicationOwnedActions: [],
  });
  project.candidateRelease = plan.version;
  project.publicationState = "candidate";
  project.finalization = { targetTemplateCommit: plan.commit };
  project.releaseCoordinates[plan.version] = {
    createVireo: plan.version,
    templateVersion: plan.version,
    templateCommit: plan.commit,
    starterJvmVersion: plan.maven.version,
    status: "candidate",
  };
  writeJson(packedPath, packed);
  writeJson(projectPath, project);
}

export function stageTemplateAdoption({ repositoryRoot = root, plan, dryRun = false }) {
  const receipt = adoptionReceipt(plan);
  const intentPath = resolve(repositoryRoot, "contracts/template-adoption-intent.json");
  const unresolvedPath = resolve(repositoryRoot, "contracts/template-adoption-unresolved.json");
  const sourcePath = resolve(repositoryRoot, "packages/create-vireo/src/index.ts");
  const ciPath = resolve(repositoryRoot, ".github/workflows/ci.yml");
  const changesetPath = resolve(repositoryRoot, ".changeset", `adopt-template-${plan.version}.md`);
  const existingIntent = readJson(intentPath);
  const currentVersion = readJson(resolve(repositoryRoot, "packages/create-vireo/package.json")).version;
  const bump = changesetBump(currentVersion, plan.version);
  if (existingIntent.status === "adopted" && existingIntent.template?.commit === plan.commit)
    return { action: "no-op", reason: "Immutable Template release is already adopted." };
  if (existsSync(unresolvedPath)) {
    const existing = readJson(unresolvedPath);
    if (existing.template?.commit !== plan.commit)
      throw new Error(
        "An unresolved Template adoption already exists; resolve it without overwriting maintainer work.",
      );
    return { action: "no-op", draft: true, reason: "Matching unresolved Template adoption already exists." };
  }
  const ready = plan.upgrade?.ready === true;
  const report = unresolvedReport(
    plan,
    plan.upgrade?.reason ?? "Template path classification requires reviewed Vireo project-upgrade transforms.",
  );
  assertNoPendingMarkdownChangesets(repositoryRoot);
  if (dryRun)
    return ready
      ? { action: "ready", receipt, receiptDigest: sha256(receipt) }
      : { action: "draft", receipt, unresolved: report, receiptDigest: sha256(receipt) };
  writeJson(intentPath, receipt);
  if (!ready) writeJson(unresolvedPath, report);
  writeFileSync(changesetPath, `---\n"create-vireo": ${bump}\n---\n\nAdopt immutable ${plan.tag} at ${plan.commit}.\n`);
  replaceExact(sourcePath, existingIntent.template.commit, plan.commit);
  replaceExact(ciPath, existingIntent.template.commit, plan.commit);
  if (ready) stageEmptySafeUpgrade(repositoryRoot, plan);
  return ready
    ? { action: "ready", receiptDigest: sha256(receipt), changeset: changesetPath }
    : { action: "draft", receiptDigest: sha256(receipt), unresolved: unresolvedPath, changeset: changesetPath };
}

function usage() {
  return "Usage: node scripts/stage-template-adoption.mjs --plan <plan.json> [--dry-run] [--json]";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseStageArguments();
  if (options.help) console.log(usage());
  else {
    const result = stageTemplateAdoption({ plan: readJson(resolve(root, options.plan)), dryRun: options.dryRun });
    console.log(
      options.json ? JSON.stringify(result) : `${result.action}: ${result.reason ?? result.unresolved ?? "staged"}`,
    );
  }
}
