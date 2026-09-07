import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { planCiChanges } from "./ci-change-plan.mjs";

const policy = JSON.parse(readFileSync(new URL("../contracts/ci-change-plan-policy.json", import.meta.url), "utf8"));

// These tracked files deliberately remain fail-closed: they alter repository
// governance, release evidence, toolchain configuration, or operational
// publication procedures. New ordinary source, docs, Storybook, or template
// files must be classified by the policy instead of being added here.
const intentionalFullVerification = [
  /^\.changeset\/config\.json$/u,
  /^\.github\//u,
  /^(?:\.gitignore|\.gitleaks\.toml|\.npmrc|\.prettierignore|\.prettierrc|LICENSE)$/u,
  /^(?:package(?:-lock)?\.json|turbo\.json|eslint\.config\.mjs)$/u,
  /^VIREO_THOUSANDS_OF_STARS_MASTER_ROADMAP\.md$/u,
  /^contracts\/(?:ci-change-plan-policy|ecosystem-publication-policy|github-actions-policy|history-record|public-beta-engineering-readiness|release-impact-policy|release-lifecycle-policy|verification-budget-policy)\.json$/u,
  /^contracts\/vireo-release-signing-key\.asc$/u,
  /^jvm\/config\/dependency-check-suppressions\.xml$/u,
  /^jvm\/scripts\/(?:audit-publication-artifacts|build-central-bundle|publish-central-deployment|upload-central-bundle|verify-central-consumer|verify-publication-consumer|wait-central-validation)\.sh$/u,
  /^jvm\/vireo-starter-publication-tests\/\.gitignore$/u,
  /^scripts\/(?:ci-change-plan(?:-coverage)?(?:\.test)?|public-repository-audit|verify-release-candidate)\.(?:mjs|sh)$/u,
];

test("tracked routine files are classified instead of silently expanding to the complete suite", () => {
  const result = spawnSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const trackedFiles = new Set([
    ...result.stdout.split("\0").filter(Boolean),
    // The policy files are new in this bootstrap branch. Include them before
    // they are tracked so this test also proves their own fail-closed intent.
    "contracts/ci-change-plan-policy.json",
    "scripts/ci-change-plan.mjs",
    "scripts/ci-change-plan.test.mjs",
    "scripts/ci-change-plan-coverage.test.mjs",
    "scripts/ci-required-contexts.test.mjs",
  ]);
  const unexpected = [...trackedFiles].filter(path => {
    const plan = planCiChanges([{ status: "M", path }], policy);
    return plan.full && !intentionalFullVerification.some(pattern => pattern.test(path));
  });
  assert.deepEqual(unexpected, []);
});
