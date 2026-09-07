export const managedConsumerSkillPaths = [
  ".agents/skills/vireo-app-feature-author/SKILL.md",
  ".agents/skills/vireo-app-feature-author/agents/openai.yaml",
  ".agents/skills/vireo-app-production-readiness/SKILL.md",
  ".agents/skills/vireo-app-production-readiness/agents/openai.yaml",
  ".agents/skills/vireo-app-upgrader/SKILL.md",
  ".agents/skills/vireo-app-upgrader/agents/openai.yaml",
];

function fail(message) {
  throw new Error(`Packed project-upgrade baselines: ${message}`);
}

function isManagedSkillAdditionSet(baselines) {
  return (
    Array.isArray(baselines) &&
    baselines.length === managedConsumerSkillPaths.length &&
    baselines.every(
      baseline =>
        baseline?.operation === "add" &&
        managedConsumerSkillPaths.includes(baseline.path) &&
        typeof baseline.targetContent === "string" &&
        /^[a-f0-9]{64}$/u.test(baseline.targetSha256 ?? ""),
    ) &&
    new Set(baselines.map(baseline => baseline.path)).size === managedConsumerSkillPaths.length
  );
}

function profileBaselines(graph, edge) {
  const baselines = graph.baselines?.[edge];
  if (!Array.isArray(baselines?.["full-stack"]) || !Array.isArray(baselines.frontend)) {
    fail(`${edge} must declare full-stack and frontend baseline arrays`);
  }
  return baselines;
}

/**
 * Consumer skills are introduced once by a managed edge and then retained by
 * subsequent release metadata/provenance upgrades. A packed policy must retain
 * their immutable origin bytes for projects that still traverse the introducing
 * edge, without requiring later patch edges to add them again.
 */
export function assertPackedProjectUpgradeBaselines(packedPolicy) {
  const graph = packedPolicy?.releaseGraph;
  const source = graph?.releases?.find(release => release.release === graph.previousRelease);
  const targetRelease = graph?.candidateRelease ?? graph?.publicRelease;
  const target = graph?.releases?.find(release => release.release === targetRelease);
  if (!source || !target) fail("must declare previous and public release nodes");
  const adjacentEdge = `${source.release}->${target.release}`;
  const currentBaselines = profileBaselines(graph, adjacentEdge);
  const currentAddsSkills = [currentBaselines["full-stack"], currentBaselines.frontend].some(baselines =>
    baselines.some(baseline => baseline?.operation === "add" && managedConsumerSkillPaths.includes(baseline.path)),
  );

  if (currentAddsSkills) {
    if (
      !isManagedSkillAdditionSet(currentBaselines["full-stack"]) ||
      !isManagedSkillAdditionSet(currentBaselines.frontend) ||
      JSON.stringify(currentBaselines["full-stack"]) !== JSON.stringify(currentBaselines.frontend)
    ) {
      fail(`${adjacentEdge} must add the six consumer skills identically for both profiles`);
    }
    return {
      adjacentEdge,
      retainedSkillEdge: adjacentEdge,
      managedSkillBaselines: currentBaselines.frontend,
      skillsAddedByCurrentEdge: true,
    };
  }

  const retainedSkillEdges = Object.entries(graph.baselines ?? {}).filter(
    ([, baselines]) =>
      isManagedSkillAdditionSet(baselines?.["full-stack"]) &&
      isManagedSkillAdditionSet(baselines?.frontend) &&
      JSON.stringify(baselines["full-stack"]) === JSON.stringify(baselines.frontend),
  );
  if (retainedSkillEdges.length !== 1) {
    fail("must retain exactly one immutable six-skill consumer baseline origin");
  }
  const [retainedSkillEdge, retainedSkillBaselines] = retainedSkillEdges[0];
  return {
    adjacentEdge,
    retainedSkillEdge,
    managedSkillBaselines: retainedSkillBaselines.frontend,
    skillsAddedByCurrentEdge: false,
  };
}
