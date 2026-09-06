#!/bin/sh
set -eu

corepack npm run codex:check

node --test \
  scripts/changeset-publish-adapter.test.mjs \
  scripts/ecosystem-publication-plan.test.mjs \
  scripts/finalize-jvm-release.test.mjs \
  scripts/finalize-npm-releases.test.mjs \
  scripts/codex-customization-policy.test.mjs \
  scripts/codex-consumer-skills.test.mjs \
  scripts/documentation-ownership-policy.test.mjs \
  scripts/npm-registry-retry.test.mjs \
  scripts/npm-release-maven-prerequisite-policy.test.mjs \
  scripts/local-vireo-candidate-fixture.test.mjs \
  scripts/generated-fixture-template-pin.test.mjs \
  scripts/local-vireo-maven-candidate-fixture.test.mjs \
  scripts/maven-central-publication.test.mjs \
  scripts/maven-central-release-state.test.mjs \
  scripts/maven-recovery-source-run.test.mjs \
  scripts/release-run-artifacts.test.mjs \
  scripts/package-bin.test.mjs \
  scripts/publish-verified-npm-candidates.test.mjs \
  scripts/report-npm-publication-result.test.mjs \
  scripts/release-workflow-activity.test.mjs \
  scripts/reference-symbol-anchors.test.mjs \
  scripts/ci-change-plan.test.mjs \
  scripts/ci-change-plan-coverage.test.mjs \
  scripts/ci-required-contexts.test.mjs \
  scripts/release-impact-policy.test.mjs \
  scripts/release-impact-version.test.mjs \
  scripts/release-lifecycle-policy.test.mjs \
  scripts/prepare-jvm-only-release-trigger.test.mjs \
  scripts/project-upgrade-publication-state.test.mjs \
  scripts/packed-project-upgrade-baselines.test.mjs \
  scripts/packed-adjacent-frontend-source-manifest.test.mjs \
  scripts/lib/project-upgrade-baseline-contract.test.mjs \
  scripts/lib/verification-evidence-source.test.mjs \
  scripts/lib/anonymous-public-evidence.test.mjs \
  scripts/lib/anonymous-public-maven-evidence.test.mjs \
  scripts/lib/maven-pom-evidence.test.mjs \
  scripts/lib/mit-license-evidence.test.mjs \
  scripts/lib/public-release-evidence-paths.test.mjs \
  scripts/lib/anonymous-consumer-final-evidence.test.mjs \
  scripts/lib/anonymous-consumer-release-preflight.test.mjs \
  scripts/anonymous-consumer-gauntlet.test.mjs \
  scripts/verify-anonymous-consumer-signed-sboms.test.mjs \
  scripts/verify-npm-public-release.test.mjs \
  scripts/synchronize-documentation-release.test.mjs \
  scripts/template-publication-eligibility.test.mjs \
  scripts/third-party-license-policy.test.mjs \
  site/build.test.mjs
sh -n site/bootstrap-vps.sh
sh -n site/deploy-vps.sh
sh -n site/stage-vps-bootstrap.sh
corepack npm run security:workflow
corepack npm run test:architecture
turbo run test
corepack npm run surface
corepack npm run api:policy
