import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseChangeset, validateReleaseImpact } from "./release-impact-policy.mjs";

const policy = JSON.parse(readFileSync(new URL("../contracts/release-impact-policy.json", import.meta.url), "utf8"));
const ecosystemContract = JSON.parse(
  readFileSync(new URL("../contracts/ecosystem-release-contract.json", import.meta.url), "utf8"),
);

const sourceChange = path => ({ status: "M", path, baseContent: null, headContent: null });
const versionedChangelog = (path, version) => ({
  status: "M",
  path,
  baseContent: "# Changelog\n",
  headContent: `# Changelog\n\n## ${version}\n`,
});
const changeset = (
  name,
  bump = "patch",
  summary = "Describe the user-visible release behavior.",
  path = ".changeset/example.md",
) => ({
  status: "A",
  path,
  baseContent: null,
  headContent: `---\n"${name}": ${bump}\n---\n${summary}\n`,
});
const impactRecord = record => ({
  status: "A",
  path: `.release-impact/${record.artifact.replaceAll(/[^a-z0-9]+/giu, "-")}.json`,
  baseContent: null,
  headContent: `${JSON.stringify({ schemaVersion: 1, ...record }, null, 2)}\n`,
});
const validate = changes => validateReleaseImpact({ policy, ecosystemContract, changes });
const consumedJvmImpactRecord = record => ({
  status: "D",
  path: `.release-impact/${record.artifact.replaceAll(/[^a-z0-9]+/giu, "-")}.json`,
  baseContent: `${JSON.stringify({ schemaVersion: 1, ...record }, null, 2)}\n`,
  headContent: null,
});
const jvmVersion = (before, after) => ({
  status: "M",
  path: "jvm/gradle.properties",
  baseContent: `group=com.vireocode\nversion=${before}\n`,
  headContent: `group=com.vireocode\nversion=${after}\n`,
});

test("requires an affected npm package to have a changed Changeset", () => {
  const result = validate([sourceChange("packages/sqlite/src/runtime.ts")]);

  assert.ok(result.problems.some(problem => problem.includes("npm:@vireocodedev/sqlite is affected")));
});

test("does not let another package's Changeset cover the affected package", () => {
  const result = validate([sourceChange("packages/sqlite/src/runtime.ts"), changeset("@vireocodedev/history")]);

  assert.ok(result.problems.some(problem => problem.includes("npm:@vireocodedev/sqlite is affected")));
});

test("requires decisions for both sides of a cross-artifact rename", () => {
  const result = validate([
    {
      status: "R",
      previousPath: "packages/history/src/moved.ts",
      path: "packages/sqlite/src/moved.ts",
      baseContent: null,
      headContent: null,
    },
    changeset("@vireocodedev/sqlite"),
  ]);

  assert.deepEqual(result.affected, ["npm:@vireocodedev/history", "npm:@vireocodedev/sqlite"]);
  assert.ok(result.problems.some(problem => problem.includes("npm:@vireocodedev/history is affected")));
});

test("accepts Changesets as npm release metadata", () => {
  const result = validate([sourceChange("packages/sqlite/src/runtime.ts"), changeset("@vireocodedev/sqlite", "minor")]);

  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.affected, ["npm:@vireocodedev/sqlite"]);
  assert.equal(result.decisions[0].decision, "release");
});

test("combines multiple Changesets for one package using the highest bump", () => {
  const result = validate([
    sourceChange("packages/sqlite/src/runtime.ts"),
    changeset("@vireocodedev/sqlite", "patch", "Correct the replay failure path.", ".changeset/fix.md"),
    changeset("@vireocodedev/sqlite", "minor", "Expose replay diagnostics to consumers.", ".changeset/api.md"),
  ]);

  assert.deepEqual(result.problems, []);
  assert.equal(result.decisions[0].bump, "minor");
});

test("requires maintainer-reviewable no-release justification", () => {
  const short = validate([
    sourceChange("packages/ui/tests/only.test.ts"),
    impactRecord({ artifact: "npm:@vireocodedev/ui", decision: "no-release", justification: "tests only" }),
  ]);
  assert.ok(short.problems.some(problem => problem.includes("at least 24 characters")));

  const justified = validate([
    sourceChange("packages/ui/tests/only.test.ts"),
    impactRecord({
      artifact: "npm:@vireocodedev/ui",
      decision: "no-release",
      justification: "Test-only coverage; packed runtime bytes and public behavior are unchanged.",
    }),
  ]);
  assert.deepEqual(justified.problems, []);
});

test("ignores stale metadata that is not changed by the pull request", () => {
  const result = validate([sourceChange("jvm/vireo-offline/src/main/java/example/Replay.java")]);

  assert.ok(result.problems.some(problem => problem.includes("jvm:vireo-offline is affected")));
});

test("requires JVM release intent and validates its bump and changelog summary", () => {
  const missing = validate([sourceChange("jvm/vireo-offline/src/main/java/example/Replay.java")]);
  assert.ok(missing.problems.some(problem => problem.includes("jvm:vireo-offline is affected")));

  const accepted = validate([
    sourceChange("jvm/vireo-offline/src/main/java/example/Replay.java"),
    impactRecord({
      artifact: "jvm:vireo-offline",
      decision: "release",
      bump: "patch",
      summary: "Dispatch offline commands without credential-bearing self-HTTP.",
    }),
  ]);
  assert.deepEqual(accepted.problems, []);
});

test("accepts consumed JVM release records only with their exact coordinated version and changelog", () => {
  const result = validate([
    sourceChange("jvm/vireo-auth/src/main/java/example/Authentication.java"),
    sourceChange("jvm/vireo-core/src/main/java/example/Service.java"),
    consumedJvmImpactRecord({
      artifact: "jvm:vireo-auth",
      decision: "release",
      bump: "minor",
      summary: "Publish the reusable browser-session security chain.",
    }),
    consumedJvmImpactRecord({
      artifact: "jvm:vireo-core",
      decision: "release",
      bump: "minor",
      summary: "Publish request-aware CRUD services and coded API errors.",
    }),
    jvmVersion("0.3.1", "0.4.0"),
    versionedChangelog("jvm/CHANGELOG.md", "0.4.0"),
  ]);

  assert.deepEqual(result.problems, []);
  assert.deepEqual(
    result.decisions.map(({ artifact, decision, source }) => ({ artifact, decision, source })),
    [
      {
        artifact: "jvm:vireo-auth",
        decision: "release",
        source: ".release-impact/jvm-vireo-auth.json (consumed)",
      },
      {
        artifact: "jvm:vireo-core",
        decision: "release",
        source: ".release-impact/jvm-vireo-core.json (consumed)",
      },
    ],
  );
});

test("rejects consumed JVM release records when their coordinated version or changelog is not exact", () => {
  const record = consumedJvmImpactRecord({
    artifact: "jvm:vireo-auth",
    decision: "release",
    bump: "minor",
    summary: "Publish the reusable browser-session security chain.",
  });
  const wrongVersion = validate([
    sourceChange("jvm/vireo-auth/src/main/java/example/Authentication.java"),
    record,
    jvmVersion("0.3.1", "0.3.2"),
    versionedChangelog("jvm/CHANGELOG.md", "0.3.2"),
  ]);
  assert.ok(wrongVersion.problems.some(problem => problem.includes("exact coordinated JVM version bump")));

  const missingHeading = validate([
    sourceChange("jvm/vireo-auth/src/main/java/example/Authentication.java"),
    record,
    jvmVersion("0.3.1", "0.4.0"),
    versionedChangelog("jvm/CHANGELOG.md", "0.3.2"),
  ]);
  assert.ok(missingHeading.problems.some(problem => problem.includes("exact coordinated JVM version bump")));

  const existingHeading = validate([
    sourceChange("jvm/vireo-auth/src/main/java/example/Authentication.java"),
    record,
    jvmVersion("0.3.1", "0.4.0"),
    {
      status: "M",
      path: "jvm/CHANGELOG.md",
      baseContent: "# Vireo JVM changelog\n\n## 0.4.0\n\n- Existing release notes.\n",
      headContent: "# Vireo JVM changelog\n\n## 0.4.0\n\n- Existing release notes.\n\n- Unrelated edit.\n",
    },
  ]);
  assert.ok(existingHeading.problems.some(problem => problem.includes("exact coordinated JVM version bump")));
});

test("ignores deletion of an already-consumed JVM record when no JVM artifact is affected", () => {
  const result = validate([
    consumedJvmImpactRecord({
      artifact: "jvm:vireo-auth",
      decision: "release",
      bump: "minor",
      summary: "Publish the reusable browser-session security chain.",
    }),
  ]);

  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.decisions, []);
});

test("does not accept a record-shaped deleted JSON file outside release-impact metadata", () => {
  const record = consumedJvmImpactRecord({
    artifact: "jvm:vireo-auth",
    decision: "release",
    bump: "minor",
    summary: "Publish the reusable browser-session security chain.",
  });
  const result = validate([
    sourceChange("jvm/vireo-auth/src/main/java/example/Authentication.java"),
    { ...record, path: "fixtures/consumed-jvm-record.json" },
    jvmVersion("0.3.1", "0.4.0"),
    versionedChangelog("jvm/CHANGELOG.md", "0.4.0"),
  ]);

  assert.ok(
    result.problems.some(problem => problem.includes("jvm:vireo-auth is affected but has no release decision")),
  );
});

test("requires deploy intent for the documentation application", () => {
  const rejected = validate([
    sourceChange("site/content/index.md"),
    impactRecord({
      artifact: "application:documentation-site",
      decision: "release",
      bump: "patch",
      summary: "Publish revised public documentation.",
    }),
  ]);
  assert.ok(rejected.problems.some(problem => problem.includes("bump must be one of deploy")));

  const accepted = validate([
    sourceChange("site/content/index.md"),
    impactRecord({
      artifact: "application:documentation-site",
      decision: "release",
      bump: "deploy",
      summary: "Publish revised public documentation.",
    }),
  ]);
  assert.deepEqual(accepted.problems, []);
});

test("rejects unknown artifacts and npm release records that bypass Changesets", () => {
  const unknown = validate([
    impactRecord({
      artifact: "jvm:not-real",
      decision: "no-release",
      justification: "This deliberately references an artifact outside the contract.",
    }),
  ]);
  assert.ok(unknown.problems.some(problem => problem.includes("unknown artifact")));

  const bypass = validate([
    sourceChange("packages/history/src/index.ts"),
    impactRecord({
      artifact: "npm:@vireocodedev/history",
      decision: "release",
      bump: "patch",
      summary: "Attempt to bypass Changesets metadata.",
    }),
  ]);
  assert.ok(bypass.problems.some(problem => problem.includes("add a Changeset instead")));
});

test("accepts a consumed Changeset only when the version PR changes version and changelog", () => {
  const deletedChangeset = {
    status: "D",
    path: ".changeset/released.md",
    baseContent: `---\n"@vireocodedev/sqlite": patch\n---\nShip the queued replay correction.\n`,
    headContent: null,
  };
  const incomplete = validate([
    deletedChangeset,
    {
      status: "M",
      path: "packages/sqlite/package.json",
      baseContent: '{"version":"0.2.2"}',
      headContent: '{"version":"0.2.3"}',
    },
  ]);
  assert.ok(incomplete.problems.some(problem => problem.includes("deleted without versioning")));

  const complete = validate([
    deletedChangeset,
    {
      status: "M",
      path: "packages/sqlite/package.json",
      baseContent: '{"version":"0.2.2"}',
      headContent: '{"version":"0.2.3"}',
    },
    versionedChangelog("packages/sqlite/CHANGELOG.md", "0.2.3"),
  ]);
  assert.deepEqual(complete.problems, []);
});

test("accepts an applied npm version only when manifest and changelog both change", () => {
  const manifest = {
    status: "M",
    path: "packages/create-vireo/package.json",
    baseContent: '{"version":"0.5.1"}',
    headContent: '{"version":"0.6.0"}',
  };
  const changelog = versionedChangelog("packages/create-vireo/CHANGELOG.md", "0.6.0");
  const accepted = validate([sourceChange("packages/create-vireo/src/index.ts"), manifest, changelog]);
  assert.deepEqual(accepted.problems, []);
  assert.deepEqual(accepted.decisions, [
    {
      artifact: "npm:create-vireo",
      decision: "release",
      bump: "applied-version",
      metadata: "applied-version",
      source: "packages/create-vireo/package.json + packages/create-vireo/CHANGELOG.md",
    },
  ]);

  const manifestOnly = validate([sourceChange("packages/create-vireo/src/index.ts"), manifest]);
  assert.ok(manifestOnly.problems.some(problem => problem.includes("npm:create-vireo is affected")));

  const changelogOnly = validate([sourceChange("packages/create-vireo/src/index.ts"), changelog]);
  assert.ok(changelogOnly.problems.some(problem => problem.includes("npm:create-vireo is affected")));

  for (const [label, version, changelogHead] of [
    ["invalid semver", "0.06.0", "## 0.06.0\n"],
    ["downgrade", "0.5.0", "## 0.5.0\n"],
    ["equal version", "0.5.1", "## 0.5.1\n"],
    ["missing exact heading", "0.6.0", "## v0.6.0\n"],
  ]) {
    const rejected = validate([
      sourceChange("packages/create-vireo/src/index.ts"),
      { ...manifest, headContent: JSON.stringify({ version }) },
      { ...changelog, headContent: changelogHead },
    ]);
    assert.ok(
      rejected.problems.some(problem => problem.includes("npm:create-vireo is affected")),
      label,
    );
  }
});

test("parses metadata as data and rejects executable or ambiguous Changesets syntax", () => {
  assert.throws(
    () => parseChangeset('---\n"@vireocodedev/ui": patch; rm -rf /\n---\nA meaningful summary.\n', "evil.md"),
    /unsupported Changesets metadata/u,
  );
});

test("runs the pull-request gate with exact revisions and no privileged execution", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = workflow.match(/^ {2}changes:\n([\s\S]*?)(?=^ {2}[a-z][a-z-]+:\n)/mu)?.[0];

  assert.ok(job, "CI must define the policy and verification routing coordinator");
  assert.match(workflow, /^ {2}pull_request:\n/mu);
  assert.doesNotMatch(workflow, /pull_request_target:/u);
  assert.match(job, /^ {4}name: Policy and verification routing$/mu);
  assert.match(job, /permissions:\n {6}contents: read/u);
  assert.match(job, /persist-credentials: false/u);
  assert.match(job, /fetch-depth: 0/u);
  assert.match(job, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(job, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(job, /git worktree add --detach "\$gate_root" "\$BASE_SHA"/u);
  assert.match(job, /node "\$gate_root\/scripts\/release-impact-policy\.mjs" --base "\$BASE_SHA" --head "\$HEAD_SHA"/u);
  assert.match(job, /trusted base release-impact gate is unavailable/u);
  assert.doesNotMatch(job, /npm (?:ci|install)|secrets\./u);
});
