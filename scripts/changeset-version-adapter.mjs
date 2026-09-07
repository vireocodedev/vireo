import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { synchronizeDocumentationRelease } from "./synchronize-documentation-release.mjs";
import { applyJvmReleaseImpact } from "./release-impact-version.mjs";
import { consumeJvmOnlyReleaseTrigger } from "./prepare-jvm-only-release-trigger.mjs";
import { correctCandidateNpmVersion } from "./correct-candidate-npm-version.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localNpx = join(repositoryRoot, "node_modules", ".bin", "npx");
const declaredNpx = join(repositoryRoot, "scripts", "with-declared-npx.sh");

if (existsSync(localNpx)) {
  throw new Error(`Refusing to replace an existing local npx executable: ${localNpx}`);
}

symlinkSync(relative(dirname(localNpx), declaredNpx), localNpx);
try {
  // A JVM-only generated release PR is opened by the pinned Changesets action
  // using an untracked sentinel. Remove only the exact sentinel before the
  // Changesets CLI reads metadata, preventing a synthetic npm bump.
  consumeJvmOnlyReleaseTrigger({ repositoryRoot });
  const result = spawnSync("changeset", ["version", ...process.argv.slice(2)], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    correctCandidateNpmVersion(repositoryRoot);
    applyJvmReleaseImpact(repositoryRoot);
    await synchronizeDocumentationRelease(repositoryRoot);
  }
} finally {
  unlinkSync(localNpx);
}
