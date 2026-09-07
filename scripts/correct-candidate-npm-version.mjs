import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Changesets computes a package's next version by applying a relative bump
 * (patch/minor/major) to its currently published version. A Template
 * adoption that skips an intermediate release (for example 0.8.7 straight to
 * 0.9.1, because 0.9.0 was prepared but never tagged; see
 * changesetBump in stage-template-adoption.mjs) still only ever declares a
 * single relative "minor" changeset, since Changesets has no concept of an
 * exact target version. That naive bump lands one patch short of the
 * immutable Template commit already pinned as the packed upgrade graph's
 * candidateRelease, which synchronizeDocumentationRelease then refuses to
 * finalize. Correct create-vireo's freshly bumped version (and its
 * just-written changelog heading) to the exact declared candidate before
 * finalization runs, whenever it falls short of that pinned target.
 */
export function correctCandidateNpmVersion(repositoryRoot) {
  const upgradePolicyPath = join(repositoryRoot, "packages/create-vireo/schema/vireo-upgrade-policy.json");
  const upgradePolicy = JSON.parse(readFileSync(upgradePolicyPath, "utf8"));
  const candidateRelease = upgradePolicy.releaseGraph?.candidateRelease;
  if (!candidateRelease) return { corrected: false };

  const packagePath = join(repositoryRoot, "packages/create-vireo/package.json");
  const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
  const bumpedVersion = manifest.version;
  if (bumpedVersion === candidateRelease) return { corrected: false };
  if (!/^\d+\.\d+\.\d+$/u.test(bumpedVersion) || !/^\d+\.\d+\.\d+$/u.test(candidateRelease))
    throw new Error(`create-vireo version ${bumpedVersion} or candidate ${candidateRelease} is not a plain semver.`);
  const bumpedParts = bumpedVersion.split(".").map(Number);
  const candidateParts = candidateRelease.split(".").map(Number);
  const isForwardPatch =
    bumpedParts[0] === candidateParts[0] &&
    (candidateParts[1] > bumpedParts[1] ||
      (candidateParts[1] === bumpedParts[1] && candidateParts[2] > bumpedParts[2]));
  if (!isForwardPatch)
    throw new Error(
      `Refusing to correct create-vireo from ${bumpedVersion} to a non-forward-patch candidate ${candidateRelease}.`,
    );

  manifest.version = candidateRelease;
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);

  const lockPath = join(repositoryRoot, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const lockEntry = lock.packages?.["packages/create-vireo"];
  if (lockEntry?.version === bumpedVersion) lockEntry.version = candidateRelease;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const changelogPath = join(repositoryRoot, "packages/create-vireo/CHANGELOG.md");
  if (existsSync(changelogPath)) {
    const changelog = readFileSync(changelogPath, "utf8");
    const heading = `## ${bumpedVersion}`;
    if (changelog.startsWith(`# create-vireo\n\n${heading}\n`)) {
      writeFileSync(changelogPath, changelog.replace(`${heading}\n`, `## ${candidateRelease}\n`));
    }
  }

  return { corrected: true, from: bumpedVersion, to: candidateRelease };
}
