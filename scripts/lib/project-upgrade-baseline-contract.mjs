export function templatePathForBaseline(profile, path) {
  if (path.startsWith(".agents/skills/")) return `.vireo/application/${path}`;
  if (profile === "frontend" && path.startsWith("scripts/")) return `frontend/${path}`;
  if (profile === "frontend" && path === "vitest.storybook.config.ts") return `frontend/${path}`;
  return path;
}

export function applyExactBaselineTransforms(source, file) {
  let output = source;
  for (const transform of file.transforms ?? []) {
    if (!transform?.from || typeof transform.to !== "string" || output.split(transform.from).length !== 2)
      throw new Error(`Baseline transform is not exact: ${file.path}`);
    output = output.replace(transform.from, transform.to);
  }
  return output;
}

export function projectedBaselineBytes(profile, templateBytes, file) {
  const output = applyExactBaselineTransforms(templateBytes, { ...file, transforms: file.projectionTransforms });
  if (
    profile === "frontend" &&
    file.path === "scripts/lighthouse-budget.mjs" &&
    !file.projectionTransforms?.some(
      transform =>
        transform.from === 'path.resolve(frontendRoot, "../.performance-evidence")' &&
        transform.to === 'path.resolve(frontendRoot, ".performance-evidence")',
    )
  ) {
    throw new Error("Frontend Lighthouse baseline must render project-local performance evidence.");
  }
  return output;
}

/** Exact projected source bytes retained by a prior generated release. */
export function projectedBaselineSourceBytes(templateBytes, file) {
  const output = applyExactBaselineTransforms(templateBytes, { ...file, transforms: file.sourceProjectionTransforms });
  if (file.sourceContent !== undefined && output !== file.sourceContent) {
    throw new Error(`Baseline projected source bytes differ from declared source content: ${file.path}`);
  }
  return output;
}

/**
 * A managed Storybook update must begin with the exact bytes projected by the
 * preceding release. This prevents an edge from inventing self-referential
 * source provenance instead of remaining compatible with existing consumers.
 */
export function assertStorybookBaselineContinuity(releaseGraph, edge) {
  const [sourceRelease, targetRelease] = edge.split("->");
  if (!sourceRelease || !targetRelease) throw new Error(`Baseline edge is invalid: ${edge}`);
  const activeBaselines = releaseGraph?.baselines?.[edge];
  const activeStorybookBaselines = new Map(
    ["full-stack", "frontend"]
      .map(profile => [profile, findManagedStorybookBaseline(activeBaselines?.[profile], profile)])
      .filter(([, baseline]) => baseline !== undefined),
  );
  if (activeStorybookBaselines.size === 0) return;
  const predecessorEdges = releaseGraph?.edges?.filter(candidate => candidate.to === sourceRelease) ?? [];
  if (predecessorEdges.length === 0) return;
  if (predecessorEdges.length !== 1) {
    throw new Error(`${edge} must have exactly one predecessor edge for Storybook provenance.`);
  }
  const predecessorEdge = `${predecessorEdges[0].from}->${sourceRelease}`;
  for (const [profile, current] of activeStorybookBaselines) {
    const predecessor = findManagedStorybookBaseline(releaseGraph?.baselines?.[predecessorEdge]?.[profile], profile);
    if (predecessor === undefined) {
      throw new Error(`${edge}:${profile} Storybook update has no ${predecessorEdge} target provenance.`);
    }
    if (
      typeof predecessor.targetSha256 !== "string" ||
      typeof predecessor.targetContent !== "string" ||
      typeof current.sourceSha256 !== "string" ||
      typeof current.sourceContent !== "string"
    ) {
      throw new Error(`${edge}:${profile} Storybook baseline must retain exact predecessor/source provenance.`);
    }
    if (predecessor.targetSha256 !== current.sourceSha256 || predecessor.targetContent !== current.sourceContent) {
      throw new Error(`${edge}:${profile} Storybook source must match ${predecessorEdge} target provenance.`);
    }
  }
}

function findManagedStorybookBaseline(files, profile) {
  const matches = (files ?? []).filter(
    file => file?.operation === "update" && file.path?.endsWith("vitest.storybook.config.ts"),
  );
  if (matches.length > 1)
    throw new Error(`${profile} must declare at most one managed Storybook configuration baseline.`);
  return matches[0];
}
