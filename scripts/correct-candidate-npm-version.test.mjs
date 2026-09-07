import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { correctCandidateNpmVersion } from "./correct-candidate-npm-version.mjs";

function writeUpgradePolicy(root, candidateRelease) {
  mkdirSync(join(root, "packages", "create-vireo", "schema"), { recursive: true });
  writeFileSync(
    join(root, "packages", "create-vireo", "schema", "vireo-upgrade-policy.json"),
    JSON.stringify({ releaseGraph: { candidateRelease } }),
  );
}

function writeCreateVireoPackage(root, version) {
  writeFileSync(
    join(root, "packages", "create-vireo", "package.json"),
    JSON.stringify({ name: "create-vireo", version }),
  );
}

function writeLock(root, version) {
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ packages: { "packages/create-vireo": { version } } }),
  );
}

test("corrects a naive changeset bump that falls short of the pinned candidate release", () => {
  const root = mkdtempSync(join(tmpdir(), "vireo-candidate-npm-version-"));
  try {
    writeUpgradePolicy(root, "0.9.1");
    writeCreateVireoPackage(root, "0.9.0");
    writeLock(root, "0.9.0");
    writeFileSync(
      join(root, "packages", "create-vireo", "CHANGELOG.md"),
      "# create-vireo\n\n## 0.9.0\n\n### Minor Changes\n\n- abc1234: Adopt the Template release.\n",
    );

    const result = correctCandidateNpmVersion(root);

    assert.deepEqual(result, { corrected: true, from: "0.9.0", to: "0.9.1" });
    assert.equal(
      JSON.parse(readFileSync(join(root, "packages", "create-vireo", "package.json"), "utf8")).version,
      "0.9.1",
    );
    assert.equal(
      JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages["packages/create-vireo"].version,
      "0.9.1",
    );
    assert.match(
      readFileSync(join(root, "packages", "create-vireo", "CHANGELOG.md"), "utf8"),
      /^# create-vireo\n\n## 0\.9\.1\n/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does nothing when the changeset bump already matches the candidate release", () => {
  const root = mkdtempSync(join(tmpdir(), "vireo-candidate-npm-version-"));
  try {
    writeUpgradePolicy(root, "0.9.1");
    writeCreateVireoPackage(root, "0.9.1");
    writeLock(root, "0.9.1");

    assert.deepEqual(correctCandidateNpmVersion(root), { corrected: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does nothing when no candidate release is pending", () => {
  const root = mkdtempSync(join(tmpdir(), "vireo-candidate-npm-version-"));
  try {
    writeUpgradePolicy(root, undefined);
    writeCreateVireoPackage(root, "0.8.7");
    writeLock(root, "0.8.7");

    assert.deepEqual(correctCandidateNpmVersion(root), { corrected: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses to correct across a major version or backwards", () => {
  const root = mkdtempSync(join(tmpdir(), "vireo-candidate-npm-version-"));
  try {
    writeUpgradePolicy(root, "1.0.0");
    writeCreateVireoPackage(root, "0.9.0");
    writeLock(root, "0.9.0");
    assert.throws(() => correctCandidateNpmVersion(root), /non-forward-patch candidate/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
