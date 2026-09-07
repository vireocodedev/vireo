import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadataPrefix = ".release-impact/";
const changesetPrefix = ".changeset/";

function normalizeText(value) {
  return typeof value === "string" ? value.replaceAll("\r\n", "\n") : null;
}

export function parseChangeset(content, path = "changeset") {
  const normalized = normalizeText(content);
  const match = normalized?.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
  if (!match) throw new Error(`${path} must contain Changesets frontmatter and a summary`);
  const releases = [];
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const entry = line.match(/^(?:["']([^"']+)["']|([@A-Za-z0-9_./-]+)):\s*(major|minor|patch)$/u);
    if (!entry) throw new Error(`${path} has unsupported Changesets metadata: ${line}`);
    releases.push({ package: entry[1] ?? entry[2], bump: entry[3] });
  }
  if (releases.length === 0) throw new Error(`${path} must name at least one npm package`);
  if (new Set(releases.map(entry => entry.package)).size !== releases.length) {
    throw new Error(`${path} repeats an npm package`);
  }
  if (match[2].trim().length < 12) throw new Error(`${path} must include a meaningful changelog summary`);
  return { releases, summary: match[2].trim() };
}

function matchesPath(rule, path) {
  return (rule.paths ?? []).includes(path) || (rule.pathPrefixes ?? []).some(prefix => path.startsWith(prefix));
}

function validatePolicy(policy, ecosystemContract) {
  const problems = [];
  if (policy.schemaVersion !== 1) problems.push("release-impact policy schemaVersion must be 1");
  if (policy.metadataDirectory !== ".release-impact") {
    problems.push("release-impact metadataDirectory must be .release-impact");
  }
  if (!Number.isInteger(policy.minimumJustificationLength) || policy.minimumJustificationLength < 20) {
    problems.push("minimumJustificationLength must be an integer of at least 20");
  }
  if (!Number.isInteger(policy.minimumSummaryLength) || policy.minimumSummaryLength < 10) {
    problems.push("minimumSummaryLength must be an integer of at least 10");
  }

  const artifacts = policy.artifacts ?? [];
  const ids = artifacts.map(artifact => artifact.id);
  if (new Set(ids).size !== ids.length) problems.push("release-impact artifact IDs must be unique");
  for (const artifact of artifacts) {
    if (!["npm", "jvm", "application"].includes(artifact.kind)) {
      problems.push(`artifact ${artifact.id ?? "<missing>"} has unsupported kind ${artifact.kind}`);
    }
    if (!artifact.id || !artifact.name || !(artifact.pathPrefixes?.length > 0 || artifact.paths?.length > 0)) {
      problems.push(`artifact ${artifact.id ?? "<missing>"} must declare id, name, and affected paths`);
    }
  }

  const expectedNpm = (ecosystemContract.current?.npm ?? []).map(entry => entry.name).sort();
  const actualNpm = artifacts
    .filter(entry => entry.kind === "npm")
    .map(entry => entry.name)
    .sort();
  if (JSON.stringify(actualNpm) !== JSON.stringify(expectedNpm)) {
    problems.push("release-impact npm artifacts must exactly match the ecosystem release contract");
  }
  const expectedJvm = (ecosystemContract.current?.maven?.modules ?? [])
    .map(module => `${ecosystemContract.current.maven.group}:${module}`)
    .sort();
  const actualJvm = artifacts
    .filter(entry => entry.kind === "jvm")
    .map(entry => entry.name)
    .sort();
  if (JSON.stringify(actualJvm) !== JSON.stringify(expectedJvm)) {
    problems.push("release-impact JVM artifacts must exactly match the ecosystem release contract");
  }
  if (!artifacts.some(entry => entry.kind === "application")) {
    problems.push("release-impact policy must declare at least one deployable application artifact");
  }
  for (const rule of policy.sharedImpact ?? []) {
    for (const kind of rule.artifactKinds ?? []) {
      if (!["npm", "jvm", "application"].includes(kind)) {
        problems.push(`shared-impact rule references unsupported artifact kind ${kind}`);
      }
    }
  }
  return problems;
}

function parseImpactRecord(change, artifactsById, policy, problems) {
  if (change.status === "D") return null;
  if (!change.path.endsWith(".json")) {
    problems.push(`${change.path} must be a JSON release-impact record`);
    return null;
  }
  let record;
  try {
    record = JSON.parse(change.headContent ?? "");
  } catch (error) {
    problems.push(`${change.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (record.schemaVersion !== 1) problems.push(`${change.path} schemaVersion must be 1`);
  const artifact = artifactsById.get(record.artifact);
  if (!artifact) {
    problems.push(`${change.path} references unknown artifact ${record.artifact ?? "<missing>"}`);
    return null;
  }
  if (!["release", "no-release"].includes(record.decision)) {
    problems.push(`${change.path} decision must be release or no-release`);
    return null;
  }
  if (record.decision === "no-release") {
    if (
      typeof record.justification !== "string" ||
      record.justification.trim().length < policy.minimumJustificationLength
    ) {
      problems.push(
        `${change.path} no-release justification must contain at least ${policy.minimumJustificationLength} characters`,
      );
    }
  } else {
    if (artifact.kind === "npm") {
      problems.push(`${change.path} cannot release npm artifact ${artifact.name}; add a Changeset instead`);
    }
    const allowedBumps = policy.releaseDecisions?.[artifact.kind] ?? [];
    if (!allowedBumps.includes(record.bump)) {
      problems.push(`${change.path} bump must be one of ${allowedBumps.join(", ")} for ${artifact.kind}`);
    }
    if (typeof record.summary !== "string" || record.summary.trim().length < policy.minimumSummaryLength) {
      problems.push(`${change.path} release summary must contain at least ${policy.minimumSummaryLength} characters`);
    }
  }
  return { artifact: artifact.id, decision: record.decision, source: change.path };
}

const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function parseStableSemver(value) {
  const match = typeof value === "string" ? value.match(stableSemverPattern) : null;
  return match?.slice(1) ?? null;
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
}

function compareStableSemver(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const comparison = compareNumericIdentifiers(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function changelogDeclaresVersion(changelog, version) {
  return new RegExp(`^## ${version.replaceAll(".", "\\.")}\\r?$`, "mu").test(changelog);
}

function changelogVersionHeadingCount(changelog, version) {
  return [...changelog.matchAll(new RegExp(`^## ${version.replaceAll(".", "\\.")}\\r?$`, "gmu"))].length;
}

function packageWasVersioned(artifact, changesByPath) {
  const prefix = artifact.pathPrefixes[0];
  const manifest = changesByPath.get(`${prefix}package.json`);
  const changelog = changesByPath.get(`${prefix}CHANGELOG.md`);
  if (!manifest || !changelog || manifest.status === "D" || changelog.status === "D") return false;
  try {
    const before = JSON.parse(manifest.baseContent ?? "null")?.version;
    const after = JSON.parse(manifest.headContent ?? "null")?.version;
    const beforeSemver = parseStableSemver(before);
    const afterSemver = parseStableSemver(after);
    return (
      beforeSemver !== null &&
      afterSemver !== null &&
      compareStableSemver(afterSemver, beforeSemver) > 0 &&
      typeof changelog.headContent === "string" &&
      changelogDeclaresVersion(changelog.headContent, after)
    );
  } catch {
    return false;
  }
}

const bumpRank = { patch: 1, minor: 2, major: 3 };

function bumpStableSemver(version, bump) {
  const parsed = parseStableSemver(version);
  if (!parsed || !bumpRank[bump]) return null;
  const [rawMajor, rawMinor, rawPatch] = parsed;
  const major = Number(rawMajor);
  const minor = Number(rawMinor);
  const patch = Number(rawPatch);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function jvmVersionFromProperties(content) {
  const version = typeof content === "string" ? content.match(/^version=(.+)$/mu)?.[1]?.trim() : null;
  return parseStableSemver(version) ? version : null;
}

function consumedJvmReleaseWasVersioned(bump, changesByPath) {
  const properties = changesByPath.get("jvm/gradle.properties");
  const changelog = changesByPath.get("jvm/CHANGELOG.md");
  if (!properties || !changelog || properties.status === "D" || changelog.status === "D") return false;
  const before = jvmVersionFromProperties(properties.baseContent);
  const after = jvmVersionFromProperties(properties.headContent);
  return (
    before !== null &&
    after === bumpStableSemver(before, bump) &&
    typeof changelog.baseContent === "string" &&
    typeof changelog.headContent === "string" &&
    changelogVersionHeadingCount(changelog.baseContent, after) === 0 &&
    changelogVersionHeadingCount(changelog.headContent, after) === 1
  );
}

function parseConsumedJvmReleaseRecord(change, artifactsById, policy, problems) {
  if (
    change.status !== "D" ||
    !change.path.startsWith(metadataPrefix) ||
    change.path === `${metadataPrefix}README.md` ||
    !change.path.endsWith(".json")
  ) {
    return null;
  }
  let record;
  try {
    record = JSON.parse(change.baseContent ?? "");
  } catch {
    return null;
  }
  const artifact = artifactsById.get(record.artifact);
  if (record.decision !== "release" || artifact?.kind !== "jvm") return null;
  const decision = parseImpactRecord(
    { ...change, status: "M", headContent: change.baseContent },
    artifactsById,
    policy,
    problems,
  );
  return decision ? { ...decision, bump: record.bump } : null;
}

function appliedPackageVersionSource(artifact) {
  const prefix = artifact.pathPrefixes[0];
  return `${prefix}package.json + ${prefix}CHANGELOG.md`;
}

export function validateReleaseImpact({ policy, ecosystemContract, changes }) {
  const problems = validatePolicy(policy, ecosystemContract);
  const artifacts = policy.artifacts ?? [];
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const npmByName = new Map(artifacts.filter(entry => entry.kind === "npm").map(entry => [entry.name, entry]));
  const changesByPath = new Map(changes.map(change => [change.path, change]));
  const nonImpactPaths = new Set(policy.nonImpactPaths ?? []);
  const affected = new Set();

  for (const change of changes) {
    const impactPaths = [change.path, change.previousPath].filter(
      path =>
        path && !path.startsWith(metadataPrefix) && !path.startsWith(changesetPrefix) && !nonImpactPaths.has(path),
    );
    for (const impactPath of impactPaths) {
      for (const artifact of artifacts) {
        if (matchesPath(artifact, impactPath)) affected.add(artifact.id);
      }
      for (const rule of policy.sharedImpact ?? []) {
        if (!matchesPath(rule, impactPath)) continue;
        for (const artifact of artifacts) {
          if ((rule.artifactKinds ?? []).includes(artifact.kind)) affected.add(artifact.id);
        }
      }
    }
  }

  const decisions = new Map();
  const addDecision = decision => {
    const existing = decisions.get(decision.artifact);
    if (existing) {
      if (existing.metadata === "changeset" && decision.metadata === "changeset") {
        const bumpRank = { patch: 1, minor: 2, major: 3 };
        if (bumpRank[decision.bump] > bumpRank[existing.bump]) existing.bump = decision.bump;
        existing.source = `${existing.source}, ${decision.source}`;
      } else {
        problems.push(
          `${decision.artifact} has multiple release-impact decisions: ${existing.source}, ${decision.source}`,
        );
      }
    } else {
      decisions.set(decision.artifact, decision);
    }
  };

  for (const change of changes.filter(
    entry =>
      entry.path.startsWith(changesetPrefix) && entry.path !== ".changeset/config.json" && entry.path.endsWith(".md"),
  )) {
    let parsed;
    try {
      parsed = parseChangeset(change.status === "D" ? change.baseContent : change.headContent, change.path);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    for (const release of parsed.releases) {
      const artifact = npmByName.get(release.package);
      if (!artifact) {
        problems.push(`${change.path} references unknown publishable npm package ${release.package}`);
        continue;
      }
      if (change.status === "D" && !packageWasVersioned(artifact, changesByPath)) {
        problems.push(`${change.path} was deleted without versioning ${release.package} and its changelog`);
        continue;
      }
      addDecision({
        artifact: artifact.id,
        decision: "release",
        bump: release.bump,
        metadata: "changeset",
        source: change.path,
      });
    }
  }

  for (const artifact of artifacts.filter(entry => entry.kind === "npm")) {
    if (!packageWasVersioned(artifact, changesByPath) || decisions.has(artifact.id)) continue;
    addDecision({
      artifact: artifact.id,
      decision: "release",
      bump: "applied-version",
      metadata: "applied-version",
      source: appliedPackageVersionSource(artifact),
    });
  }

  for (const change of changes.filter(
    entry => entry.path.startsWith(metadataPrefix) && entry.path !== `${metadataPrefix}README.md`,
  )) {
    const decision = parseImpactRecord(change, artifactsById, policy, problems);
    if (decision) addDecision(decision);
  }

  const consumedJvmDecisions = changes
    .map(change => parseConsumedJvmReleaseRecord(change, artifactsById, policy, problems))
    .filter(Boolean);
  if (consumedJvmDecisions.some(decision => affected.has(decision.artifact))) {
    const coordinatedBump = consumedJvmDecisions
      .map(decision => decision.bump)
      .sort((left, right) => bumpRank[right] - bumpRank[left])[0];
    if (consumedJvmReleaseWasVersioned(coordinatedBump, changesByPath)) {
      for (const decision of consumedJvmDecisions) {
        addDecision({
          artifact: decision.artifact,
          decision: decision.decision,
          source: `${decision.source} (consumed)`,
        });
      }
    } else {
      problems.push(
        "Consumed JVM release records require the exact coordinated JVM version bump in jvm/gradle.properties and its exact jvm/CHANGELOG.md heading",
      );
    }
  }

  for (const artifactId of [...affected].sort()) {
    if (!decisions.has(artifactId)) {
      const artifact = artifactsById.get(artifactId);
      const instruction =
        artifact.kind === "npm"
          ? `add a Changeset for ${artifact.name}`
          : `add a changed .release-impact JSON record for ${artifactId}`;
      problems.push(
        `${artifactId} is affected but has no release decision; ${instruction} or add a justified no-release exemption`,
      );
    }
  }

  return {
    problems,
    affected: [...affected].sort(),
    decisions: [...decisions.values()].sort((left, right) => left.artifact.localeCompare(right.artifact)),
  };
}

function runGit(arguments_, { allowFailure = false } = {}) {
  const result = spawnSync("git", arguments_, { cwd: repositoryRoot, encoding: "utf8" });
  if (result.error && result.status === null) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `git ${arguments_.join(" ")} failed`);
  }
  return result.status === 0 ? result.stdout : null;
}

function resolveCommit(reference, label) {
  if (!reference || reference.startsWith("-") || !/^[A-Za-z0-9_./@{}^~:+-]+$/u.test(reference)) {
    throw new Error(`${label} is not a safe Git revision`);
  }
  return runGit(["rev-parse", "--verify", `${reference}^{commit}`]).trim();
}

function readRevisionFile(revision, path) {
  return runGit(["show", `${revision}:${path}`], { allowFailure: true });
}

export function readGitChanges(baseReference, headReference) {
  const base = resolveCommit(baseReference, "base");
  const head = resolveCommit(headReference, "head");
  const output = runGit(["diff", "--name-status", "-z", "--find-renames=50%", base, head, "--"]);
  const tokens = output.split("\0");
  const changes = [];
  for (let index = 0; index < tokens.length && tokens[index];) {
    const rawStatus = tokens[index++];
    const status = rawStatus[0];
    let previousPath = null;
    let path = tokens[index++];
    if (status === "R" || status === "C") {
      previousPath = path;
      path = tokens[index++];
    }
    const needsContent =
      path.startsWith(metadataPrefix) ||
      path.startsWith(changesetPrefix) ||
      path.endsWith("/package.json") ||
      path.endsWith("/CHANGELOG.md") ||
      path === "jvm/gradle.properties";
    changes.push({
      status,
      path,
      previousPath,
      baseContent: needsContent ? readRevisionFile(base, previousPath ?? path) : null,
      headContent: needsContent ? readRevisionFile(head, path) : null,
    });
  }
  return { base, head, changes };
}

function parseArguments(arguments_) {
  let base;
  let head = "HEAD";
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || !["--base", "--head"].includes(option)) {
      throw new Error("Usage: node scripts/release-impact-policy.mjs --base <revision> [--head <revision>]");
    }
    if (option === "--base") base = value;
    else head = value;
  }
  if (!base) throw new Error("--base is required");
  return { base, head };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { base, head } = parseArguments(process.argv.slice(2));
    const comparison = readGitChanges(base, head);
    const policy = JSON.parse(readFileSync(join(repositoryRoot, "contracts/release-impact-policy.json"), "utf8"));
    const ecosystemContract = JSON.parse(
      readFileSync(join(repositoryRoot, "contracts/ecosystem-release-contract.json"), "utf8"),
    );
    const result = validateReleaseImpact({ policy, ecosystemContract, changes: comparison.changes });
    if (result.problems.length > 0) {
      console.error("Release-impact gate failed:");
      for (const problem of result.problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Release-impact gate passed for ${result.affected.length} affected artifact(s) between ${comparison.base.slice(0, 12)} and ${comparison.head.slice(0, 12)}.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
