import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { checkGeneratedEntities } from "./entity-generator.js";

type DependencyMap = Record<string, string>;
type ReleaseRequirements = {
  rootVireoScript: string;
  starterJvmVersion: string;
  frontendDependencies: DependencyMap;
  managedRootScripts?: DependencyMap;
  managedFrontendScripts?: Partial<Record<"full-stack" | "frontend", DependencyMap>>;
  /** Exact pinned Template scripts accepted only while creating a new projection. */
  templateSourceFrontendScripts?: Partial<Record<"full-stack" | "frontend", DependencyMap>>;
  /** Exact adjacent generated-consumer scripts that the staged projection may replace. */
  projectionSourceFrontendScripts?: Partial<Record<"full-stack" | "frontend", DependencyMap>>;
};
type ApplicationOwnedActionPolicy = {
  id: string;
  paths: string[];
  requirement: string;
  verificationCommands: string[];
};
type ReleaseNode = ReleaseRequirements & {
  release: string;
  templateCommit: string;
  status: "historical" | "current" | "candidate";
};
type UpgradeEdge = {
  from: string;
  to: string;
  lockfileRefresh?: "required" | "not-required";
  applicationOwnedActions: ApplicationOwnedActionPolicy[];
};
type UpgradePolicy = {
  schemaVersion: 2;
  releaseGraph: {
    publicRelease: string;
    candidateRelease?: string;
    previousRelease: string;
    releases: ReleaseNode[];
    edges: UpgradeEdge[];
    baselines?: Record<string, Record<"full-stack" | "frontend", EdgeBaseline[]>>;
  };
};
type EdgeBaseline = {
  path: string;
  operation: "add" | "update" | "delete";
  sourceSha256?: string;
  sourceContent?: string;
  targetSha256?: string;
  targetContent?: string;
  transforms?: Array<{ from: string; to: string }>;
  sourceProjectionTransforms?: Array<{ from: string; to: string }>;
  projectionTransforms?: Array<{ from: string; to: string }>;
};
type ProjectMetadata = Record<string, unknown> & {
  templateCommit?: unknown;
  createdBy?: unknown;
  lastUpgradedBy?: unknown;
  lastUpgrade?: unknown;
};
type PackageManifest = Record<string, unknown> & {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
};
type PackageLock = Record<string, unknown> & { packages?: Record<string, { dependencies?: Record<string, unknown> }> };
type ManagedManifest = { schemaVersion: 1; templateCommit: string; files: Array<{ path: string; sha256: string }> };
type ExampleManifest = { schemaVersion: 1; templateCommit: string; files: Record<string, string> };
type RemovalReceipt = { schemaVersion: 1; templateCommit: string; removed: true };
const TEMPLATE_COMMIT_PENDING_RELEASE = "TEMPLATE_COMMIT_PENDING_RELEASE";
const FULL_STACK_OVERVIEW_SPEC = "frontend/tests/e2e/overview.spec.ts";
const PRISTINE_084_OVERVIEW_SPEC_SHA256 = "aea0494de1223a26a132f64d4cad8e3f753348c5aa7f41519edf16798af4d3e3";

export type VireoUpgradeOptions = {
  projectDirectory: string;
  targetRelease: string;
  dryRun?: boolean;
  acceptApplicationOwned?: boolean;
};
export type VireoUpgradeCheck = {
  id: "source" | "dependencies" | "lockfile" | "migrations" | "generated-contracts" | "application-owned";
  status: "pass" | "manual";
  detail: string;
};
export type VireoUpgradeFile = { path: string; status: "create" | "update" | "delete" | "unchanged" };
export type VireoUpgradeManualAction = ApplicationOwnedActionPolicy & { status: "pending" };
export type VireoUpgradeResult = {
  sourceRelease: string;
  targetRelease: string;
  targetTemplateCommit: string;
  dryRun: boolean;
  checks: VireoUpgradeCheck[];
  files: VireoUpgradeFile[];
  manualActions: VireoUpgradeManualAction[];
};
export type VireoProjectStatus = {
  recordedRelease: string | null;
  templateCommit: string | null;
  currentRelease: string;
  targetRelease: string | null;
  targetTemplateCommit: string | null;
  nextHop: string | null;
  interruptedUpgrade: boolean;
  managedFiles: Array<{
    path: string;
    state: "clean" | "customized" | "missing" | "add" | "update" | "delete" | "unchanged" | "conflict" | "untracked";
  }>;
  applicationOwnedActions: VireoUpgradeManualAction[];
  capabilities: Array<{ name: string; state: "managed" | "ejected" }>;
};

export class VireoUpgradeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "VireoUpgradeError";
  }
}

export function formatVireoUpgradeText(result: VireoUpgradeResult) {
  return [
    `${result.dryRun ? "Validated" : "Managed Vireo migration applied"} ${result.sourceRelease} -> ${result.targetRelease}.`,
    ...result.checks.map(check => `${check.status.toUpperCase().padEnd(6)} ${check.id}: ${check.detail}`),
    ...result.files.map(file => `${file.status.padEnd(10)} ${file.path}`),
    "Application-owned actions remain pending:",
    ...result.manualActions.flatMap(action => [
      `  [${action.status.toUpperCase()}] ${action.id}`,
      `    Requirement: ${action.requirement}`,
      `    Affected paths: ${action.paths.join(", ")}`,
      ...action.verificationCommands.map(command => `    Verify: ${command}`),
    ]),
    result.dryRun
      ? "No files were written; application-owned actions remain pending."
      : result.checks.find(check => check.id === "lockfile")?.status === "manual"
        ? "Managed migration applied; refresh the lockfile before verification."
        : "Managed migration applied; no lockfile refresh is required.",
  ];
}
export function formatVireoStatusText(result: VireoProjectStatus) {
  return [
    `Recorded create-vireo: ${result.recordedRelease ?? "unknown"}; Template: ${result.templateCommit ?? "unknown"}.`,
    `Current public release: ${result.currentRelease}; target: ${result.targetRelease ?? "none"} (${result.targetTemplateCommit ?? "none"}); next hop: ${result.nextHop ?? "none"}.`,
    ...(result.interruptedUpgrade
      ? [
          "PENDING    An interrupted upgrade journal is present; run vireo upgrade --apply to recover it before any preview or apply.",
        ]
      : []),
    ...result.managedFiles.map(file => `${file.state.toUpperCase().padEnd(10)} ${file.path}`),
    ...result.capabilities.map(
      capability => `${capability.state.toUpperCase().padEnd(10)} generated capability ${capability.name}`,
    ),
    ...result.applicationOwnedActions.map(action => `PENDING    ${action.id}: ${action.requirement}`),
    "Status is read-only; use the target CLI's upgrade --dry-run before applying an edge.",
  ];
}

const policyUrl = new URL("../schema/vireo-upgrade-policy.json", import.meta.url);
const managedSurfaces = [
  "package.json#scripts.vireo",
  "frontend/package.json#dependencies",
  "gradle.properties#starterVersion",
  ".vireo/project.json#templateCommit,templateVersion,templateTag,lastUpgradedBy,lastUpgrade",
  ".vireo/managed-files.json",
] as const;
async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      `Cannot read required JSON ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
async function optionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function optionalText(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function releaseFrom(value: unknown) {
  return typeof value === "string" ? /^create-vireo@(\d+\.\d+\.\d+)$/u.exec(value)?.[1] : undefined;
}
function recordedReleaseFromMetadata(metadata: ProjectMetadata, policy: UpgradePolicy) {
  const known = new Set(policy.releaseGraph.releases.map(release => release.release));
  const created = releaseFrom(metadata.createdBy);
  if (!created || !known.has(created))
    throw new VireoUpgradeError(
      "VIR-UPG-002",
      ".vireo/project.json must record a recognized createdBy create-vireo release.",
    );
  if (metadata.lastUpgradedBy === undefined) return created;
  const upgraded = releaseFrom(metadata.lastUpgradedBy);
  if (!upgraded || !known.has(upgraded))
    throw new VireoUpgradeError(
      "VIR-UPG-002",
      ".vireo/project.json has an invalid lastUpgradedBy create-vireo release.",
    );
  return upgraded;
}
function assertEqual(actual: unknown, expected: unknown, surface: string, code = "VIR-UPG-003") {
  if (actual !== expected)
    throw new VireoUpgradeError(
      code,
      `${surface} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}. Resolve this managed-file customization before upgrading.`,
    );
}
function starterVersionDeclaration(gradle: string, surface: string) {
  const declarations = [...gradle.matchAll(/^starterVersion=([^\r\n]+)\r?$/gmu)];
  if (declarations.length !== 1 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(declarations[0]?.[1] ?? ""))
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      `${surface} must declare exactly one well-formed starterVersion=<semver> value.`,
    );
  return declarations[0];
}
function replaceStarterVersion(gradle: string, expected: string, surface: string) {
  const declaration = starterVersionDeclaration(gradle, surface);
  return `${gradle.slice(0, declaration.index)}starterVersion=${expected}${gradle.slice(
    declaration.index! + declaration[0].length,
  )}`;
}

export function validateApplicationOwnedActions(actions: unknown): asserts actions is ApplicationOwnedActionPolicy[] {
  validateEdgeActions(actions);
  const expected = [
    "navigation-landmark-and-links",
    "responsive-table-live-announcements",
    "accessible-name-contracts",
    "surface-palette-ownership",
    "full-frontend-verification",
  ];
  if (actions.length !== expected.length || expected.some(id => !actions.some(action => action.id === id)))
    throw new VireoUpgradeError("VIR-UPG-001", "Historical 0.2.0-to-0.3.0 actions must remain complete.");
}
function validateEdgeActions(actions: unknown): asserts actions is ApplicationOwnedActionPolicy[] {
  if (!Array.isArray(actions))
    throw new VireoUpgradeError("VIR-UPG-001", "Upgrade edge application-owned actions must be an array.");
  const seen = new Set<string>();
  for (const action of actions) {
    const value = action as Partial<ApplicationOwnedActionPolicy>;
    if (
      !value ||
      typeof value.id !== "string" ||
      !value.id.trim() ||
      seen.has(value.id) ||
      !Array.isArray(value.paths) ||
      value.paths.length === 0 ||
      value.paths.some(path => typeof path !== "string" || !path.trim()) ||
      typeof value.requirement !== "string" ||
      !value.requirement.trim() ||
      !Array.isArray(value.verificationCommands) ||
      value.verificationCommands.length === 0 ||
      value.verificationCommands.some(command => typeof command !== "string" || !command.trim())
    )
      throw new VireoUpgradeError("VIR-UPG-001", "Upgrade edge application-owned actions must be unique and complete.");
    seen.add(value.id);
  }
}
async function readPolicy(override?: unknown): Promise<UpgradePolicy> {
  const policy = (override ?? (await readJson<UpgradePolicy>(fileURLToPath(policyUrl)))) as UpgradePolicy;
  if (policy.schemaVersion !== 2) throw new VireoUpgradeError("VIR-UPG-001", "Unsupported upgrade-policy schema.");
  const graph = policy.releaseGraph;
  if (!graph || !Array.isArray(graph.releases) || !Array.isArray(graph.edges))
    throw new VireoUpgradeError("VIR-UPG-001", "Upgrade policy requires a release graph.");
  const releases = new Map(graph.releases.map(release => [release.release, release]));
  if (releases.size !== graph.releases.length)
    throw new VireoUpgradeError("VIR-UPG-001", "Upgrade graph release nodes must be unique.");
  if (
    graph.releases.filter(release => release.status === "current").length !== 1 ||
    graph.releases.filter(release => release.status === "candidate").length > 1
  )
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      "Upgrade graph must have one public current node and at most one candidate.",
    );
  if (
    !releases.has(graph.publicRelease) ||
    !releases.has(graph.previousRelease) ||
    releases.get(graph.publicRelease)?.status !== "current"
  )
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      "Upgrade graph public and previous releases must be declared, with a current public node.",
    );
  const targetRelease = graph.candidateRelease ?? graph.publicRelease;
  if (!releases.has(targetRelease) || (graph.candidateRelease && releases.get(targetRelease)?.status !== "candidate"))
    throw new VireoUpgradeError("VIR-UPG-001", "Upgrade graph candidate must be a declared candidate node.");
  if (!graph.edges.some(edge => edge.from === graph.previousRelease && edge.to === targetRelease))
    throw new VireoUpgradeError("VIR-UPG-001", "Upgrade graph must retain the prior-current edge.");
  const edges = new Set<string>();
  for (const edge of graph.edges) {
    if (
      !releases.has(edge.from) ||
      !releases.has(edge.to) ||
      edge.from === edge.to ||
      edges.has(`${edge.from}->${edge.to}`)
    )
      throw new VireoUpgradeError("VIR-UPG-001", "Upgrade graph edges must be unique edges between declared releases.");
    if (edge.lockfileRefresh !== undefined && !["required", "not-required"].includes(edge.lockfileRefresh))
      throw new VireoUpgradeError("VIR-UPG-001", "Upgrade edge lockfile refresh policy is invalid.");
    validateEdgeActions(edge.applicationOwnedActions);
    edges.add(`${edge.from}->${edge.to}`);
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (release: string): void => {
    if (visiting.has(release))
      throw new VireoUpgradeError("VIR-UPG-001", "Upgrade graph must not contain a release cycle.");
    if (visited.has(release)) return;
    visiting.add(release);
    for (const target of outgoing.get(release) ?? []) visit(target);
    visiting.delete(release);
    visited.add(release);
  };
  for (const release of releases.keys()) visit(release);
  for (const release of graph.releases) {
    const pendingTemplateCommit =
      release.release === graph.candidateRelease &&
      release.status === "candidate" &&
      release.templateCommit === TEMPLATE_COMMIT_PENDING_RELEASE;
    if (
      !/^\d+\.\d+\.\d+$/u.test(release.release) ||
      (!/^[a-f0-9]{40}$/u.test(release.templateCommit) && !pendingTemplateCommit) ||
      typeof release.rootVireoScript !== "string" ||
      !release.rootVireoScript.trim() ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(release.starterJvmVersion) ||
      !release.frontendDependencies ||
      typeof release.frontendDependencies !== "object" ||
      Array.isArray(release.frontendDependencies) ||
      Object.entries(release.frontendDependencies).some(
        ([name, version]) => !name || typeof version !== "string" || !version.trim(),
      ) ||
      (release.managedRootScripts !== undefined &&
        (typeof release.managedRootScripts !== "object" ||
          Array.isArray(release.managedRootScripts) ||
          Object.entries(release.managedRootScripts).some(
            ([name, value]) => !name || typeof value !== "string" || !value.trim(),
          ))) ||
      (release.managedFrontendScripts !== undefined &&
        (typeof release.managedFrontendScripts !== "object" ||
          Array.isArray(release.managedFrontendScripts) ||
          Object.entries(release.managedFrontendScripts).some(
            ([profile, scripts]) =>
              !["full-stack", "frontend"].includes(profile) ||
              !scripts ||
              typeof scripts !== "object" ||
              Array.isArray(scripts) ||
              Object.entries(scripts).some(([name, value]) => !name || typeof value !== "string" || !value.trim()),
          ))) ||
      (release.templateSourceFrontendScripts !== undefined &&
        (typeof release.templateSourceFrontendScripts !== "object" ||
          Array.isArray(release.templateSourceFrontendScripts) ||
          Object.entries(release.templateSourceFrontendScripts).some(
            ([profile, scripts]) =>
              !["full-stack", "frontend"].includes(profile) ||
              !scripts ||
              typeof scripts !== "object" ||
              Array.isArray(scripts) ||
              Object.entries(scripts).some(([name, value]) => !name || typeof value !== "string" || !value.trim()),
          ))) ||
      (release.projectionSourceFrontendScripts !== undefined &&
        (typeof release.projectionSourceFrontendScripts !== "object" ||
          Array.isArray(release.projectionSourceFrontendScripts) ||
          Object.entries(release.projectionSourceFrontendScripts).some(
            ([profile, scripts]) =>
              !["full-stack", "frontend"].includes(profile) ||
              !scripts ||
              typeof scripts !== "object" ||
              Array.isArray(scripts) ||
              Object.entries(scripts).some(([name, value]) => !name || typeof value !== "string" || !value.trim()),
          )))
    )
      throw new VireoUpgradeError("VIR-UPG-001", `Upgrade graph release ${release.release} has invalid requirements.`);
    const outgoing = graph.edges.filter(edge => edge.from === release.release);
    if (outgoing.length > 1)
      throw new VireoUpgradeError("VIR-UPG-001", `Upgrade graph branches at ${release.release}.`);
    if (release.status === "historical" && outgoing.length > 1)
      throw new VireoUpgradeError("VIR-UPG-001", `Historical release ${release.release} must not branch.`);
  }
  if (graph.candidateRelease === undefined) {
    const current = releases.get(graph.publicRelease)!;
    if (graph.edges.some(edge => edge.from === current.release))
      throw new VireoUpgradeError("VIR-UPG-001", "The final current release must be terminal.");
  }
  return policy;
}
/** @internal Shared validated release requirements for generated full-stack consumers. */
export async function currentVireoReleaseRequirements(): Promise<ReleaseRequirements> {
  const policy = await readPolicy();
  const release = policy.releaseGraph.releases.find(node => node.release === policy.releaseGraph.publicRelease);
  if (!release) throw new VireoUpgradeError("VIR-UPG-001", "Upgrade graph has no current public release requirements.");
  return {
    rootVireoScript: release.rootVireoScript,
    starterJvmVersion: release.starterJvmVersion,
    frontendDependencies: release.frontendDependencies,
    managedRootScripts: release.managedRootScripts,
    managedFrontendScripts: release.managedFrontendScripts,
  };
}
/** @internal Managed frontend projection bytes for the active public/candidate release. */
export async function currentFrontendProjectionRequirements(profile: "full-stack" | "frontend" = "frontend") {
  const policy = await readPolicy();
  const graph = policy.releaseGraph;
  const targetRelease = graph.candidateRelease ?? graph.publicRelease;
  const target = graph.releases.find(release => release.release === targetRelease);
  if (!target)
    throw new VireoUpgradeError("VIR-UPG-001", "Frontend projection requirements have no adjacent release nodes.");
  const baselinePrefix = profile === "frontend" ? "scripts/lighthouse-" : "frontend/scripts/lighthouse-";
  const baselines = activeManagedProjectionBaselines(policy, target.release, profile, baselinePrefix);
  return {
    scripts: managedScriptsForProfile(target, profile === "frontend"),
    templateSourceScripts: target.templateSourceFrontendScripts?.[profile] ?? {},
    files: baselines.map(baseline => ({ path: baseline.path, contents: resolveBaselineTargetContent(baseline) })),
  };
}

/**
 * A staged edge may leave existing managed projection bytes unchanged. Walk the
 * declared linear history backwards so creation still uses their latest exact
 * baseline instead of silently dropping a managed surface at the next release.
 */
function activeManagedProjectionBaselines(
  policy: UpgradePolicy,
  targetRelease: string,
  profile: "full-stack" | "frontend",
  prefix: string,
) {
  const baselines = new Map<string, EdgeBaseline>();
  const visited = new Set<string>();
  let release = targetRelease;
  while (!visited.has(release)) {
    visited.add(release);
    const incoming = policy.releaseGraph.edges.filter(edge => edge.to === release);
    if (incoming.length === 0) break;
    if (incoming.length !== 1)
      throw new VireoUpgradeError("VIR-UPG-001", "Managed projection history must have one incoming edge per release.");
    const [edge] = incoming;
    for (const baseline of edgeBaselines(policy, edge.from, edge.to, profile)) {
      if (baseline.path.startsWith(prefix) && !baselines.has(baseline.path)) baselines.set(baseline.path, baseline);
    }
    release = edge.from;
  }
  return [...baselines.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** @internal Immutable managed compatibility bytes that bridge the public Template to the staged release. */
export async function currentProjectionCompatibilityRequirements(profile: "full-stack" | "frontend") {
  const policy = await readPolicy();
  const graph = policy.releaseGraph;
  const targetRelease = graph.candidateRelease ?? graph.publicRelease;
  const source = graph.releases.find(release => release.release === graph.previousRelease);
  const target = graph.releases.find(release => release.release === targetRelease);
  if (!source || !target)
    throw new VireoUpgradeError("VIR-UPG-001", "Projection compatibility requirements have no adjacent release nodes.");
  const edgeBaselineFiles = edgeBaselines(policy, source.release, target.release, profile);
  const optimizerFiles = edgeBaselineFiles.filter(baseline => baseline.path.endsWith("vitest.storybook.config.ts"));
  if (optimizerFiles.length !== 1)
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      `Active projection compatibility for ${profile} must declare one immutable Storybook optimizer baseline.`,
    );
  const optimizerTestFiles = edgeBaselineFiles.filter(baseline =>
    baseline.path.endsWith("storybook-config-policy.test.mjs"),
  );
  if (optimizerTestFiles.length > 1)
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      `Active projection compatibility for ${profile} must declare at most one immutable Storybook optimizer test baseline.`,
    );
  const files = [...optimizerFiles, ...optimizerTestFiles];
  return files.map(baseline => {
    const compatibleContents = new Set<string>();
    const visitedReleases = new Set<string>();
    let release = target.release;
    while (true) {
      if (visitedReleases.has(release))
        throw new VireoUpgradeError("VIR-UPG-001", "Managed projection history contains a release cycle.");
      visitedReleases.add(release);
      const incoming = graph.edges.filter(edge => edge.to === release);
      if (incoming.length === 0) break;
      if (incoming.length !== 1)
        throw new VireoUpgradeError(
          "VIR-UPG-001",
          "Managed projection history must have one incoming edge per release.",
        );
      const [edge] = incoming;
      const historical = edgeBaselines(policy, edge.from, edge.to, profile).find(file => file.path === baseline.path);
      if (historical) {
        if (historical.sourceContent !== undefined) compatibleContents.add(historical.sourceContent);
        const historicalTarget = resolveBaselineTargetContent(historical);
        if (historicalTarget !== undefined) compatibleContents.add(historicalTarget);
      }
      release = edge.from;
    }
    return {
      path: baseline.path,
      compatibleContents: [...compatibleContents],
      contents: resolveBaselineTargetContent(baseline),
    };
  });
}
function requirementsMatch(
  manifest: PackageManifest,
  frontend: PackageManifest,
  gradle: string | undefined,
  lock: PackageLock,
  expected: ReleaseRequirements,
  checkLock: boolean,
  frontendOnly: boolean,
) {
  assertEqual(manifest.scripts?.vireo, expected.rootVireoScript, "package.json scripts.vireo");
  const scriptManifest = frontendOnly ? manifest : frontend;
  for (const [name, value] of Object.entries(managedScriptsForProfile(expected, frontendOnly)))
    assertEqual(
      scriptManifest.scripts?.[name],
      value,
      `${frontendOnly ? "package.json" : "frontend/package.json"} scripts.${name}`,
    );
  if (gradle !== undefined)
    assertEqual(
      starterVersionDeclaration(gradle, "gradle.properties")[1],
      expected.starterJvmVersion,
      "gradle.properties starterVersion",
    );
  for (const [name, version] of Object.entries(expected.frontendDependencies)) {
    assertEqual(frontend.dependencies?.[name], version, `frontend dependency ${name}`);
    if (checkLock)
      assertEqual(
        lock.packages?.[""]?.dependencies?.[name],
        version,
        `frontend lockfile declaration ${name}`,
        "VIR-UPG-004",
      );
  }
}
function managedScriptsForProfile(release: ReleaseRequirements, frontendOnly: boolean): DependencyMap {
  const profile = frontendOnly ? "frontend" : "full-stack";
  const legacy = frontendOnly ? (release.managedRootScripts ?? {}) : {};
  const profileScripts = release.managedFrontendScripts?.[profile] ?? {};
  for (const [name, value] of Object.entries(profileScripts)) {
    if (legacy[name] !== undefined && legacy[name] !== value)
      throw new VireoUpgradeError("VIR-UPG-001", `Managed script ${name} has conflicting profile requirements.`);
  }
  return { ...legacy, ...profileScripts };
}
async function migrationVersions(projectDirectory: string) {
  const directory = join(projectDirectory, "src/main/resources/db/migration");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const versions = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("V")) continue;
    const match = /^V([0-9]+(?:[._][0-9]+)*)__.+\.sql$/u.exec(entry.name);
    if (!match)
      throw new VireoUpgradeError("VIR-UPG-005", `Versioned migration has an unsupported filename: ${entry.name}`);
    const version = match[1].replaceAll("_", ".");
    if (versions.has(version)) throw new VireoUpgradeError("VIR-UPG-005", `Duplicate Flyway version ${version}.`);
    versions.set(version, entry.name);
  }
  return [...versions.values()].sort();
}
async function recoverInterruptedUpgrade(projectDirectory: string) {
  const journalPath = join(projectDirectory, ".vireo", "upgrade-journal.json");
  const journal = await optionalJson<{
    schemaVersion?: unknown;
    changes?: Array<{ path?: unknown; previousBase64?: unknown }>;
  }>(journalPath);
  if (!journal) return;
  if (journal.schemaVersion !== 1 || !Array.isArray(journal.changes))
    throw new VireoUpgradeError(
      "VIR-UPG-009",
      "Upgrade journal is invalid; restore it from version control before retrying.",
    );
  for (const change of [...journal.changes].reverse()) {
    if (typeof change.path !== "string")
      throw new VireoUpgradeError("VIR-UPG-009", "Upgrade journal has an invalid path.");
    assertBaselinePath(change.path);
    await safeFileState(projectDirectory, change.path);
    const path = join(projectDirectory, change.path);
    if (change.previousBase64 === null) await rm(path, { force: true });
    else if (typeof change.previousBase64 === "string")
      await writeFile(path, Buffer.from(change.previousBase64, "base64"));
    else throw new VireoUpgradeError("VIR-UPG-009", "Upgrade journal has invalid backup bytes.");
  }
  await rm(journalPath, { force: true });
}
async function writeAtomically(
  projectDirectory: string,
  changes: Array<{ path: string; contents: string | null; previous?: string }>,
) {
  const suffix = randomBytes(6).toString("hex");
  const staged = changes.map(change => ({ ...change, temporary: `${change.path}.vireo-${suffix}.tmp` }));
  const journalPath = join(projectDirectory, ".vireo", "upgrade-journal.json");
  const journal = {
    schemaVersion: 1,
    changes: staged.map(change => ({
      path: change.path.slice(projectDirectory.length + 1),
      previousBase64: change.previous === undefined ? null : Buffer.from(change.previous).toString("base64"),
    })),
  };
  await writeFile(journalPath, `${JSON.stringify(journal)}\n`);
  try {
    for (const change of staged) {
      if (change.contents !== null) {
        await mkdir(dirname(change.path), { recursive: true });
        await writeFile(change.temporary, change.contents);
      }
    }
    for (const change of staged) {
      if (change.contents === null) await rm(change.path, { force: true });
      else await rename(change.temporary, change.path);
    }
    await rm(journalPath, { force: true });
  } catch (error) {
    for (const change of staged) await rm(change.temporary, { force: true });
    throw error;
  }
}
async function managedManifest(
  projectDirectory: string,
  templateCommit: string,
  frontendOnly = false,
): Promise<ManagedManifest> {
  const files = frontendOnly ? ["package.json"] : ["package.json", "frontend/package.json", "gradle.properties"];
  return {
    schemaVersion: 1,
    templateCommit,
    files: await Promise.all(
      files.map(async path => ({ path, sha256: sha256(await readFile(join(projectDirectory, path))) })),
    ),
  };
}
async function ejectedCapabilities(projectDirectory: string) {
  const value = await optionalJson<{ capabilities?: unknown }>(
    join(projectDirectory, ".vireo/ejected-capabilities.json"),
  );
  return Array.isArray(value?.capabilities)
    ? value.capabilities.filter((item): item is string => typeof item === "string")
    : [];
}
async function legacyEjectedCapabilities(root: string, directory = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", ".vireo"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await legacyEjectedCapabilities(root, path)));
    else if (entry.isFile()) {
      try {
        if ((await readFile(path, "utf8")).includes("@vireo-ejected"))
          found.push(`legacy:${path.slice(root.length + 1).replaceAll("\\", "/")}`);
      } catch {
        /* binary application-owned files are not evidence */
      }
    }
  }
  return found;
}
function assertBaselinePath(path: string) {
  if (
    !/^(?:\.vireo\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(path) ||
    path.includes("\\") ||
    path.split("/").some(segment => segment === "" || segment === "." || segment === "..")
  ) {
    throw new VireoUpgradeError("VIR-UPG-001", `Unsafe managed baseline path: ${path}`);
  }
}
function validateManagedManifest(value: ManagedManifest | undefined): asserts value is ManagedManifest | undefined {
  if (!value) return;
  if (value.schemaVersion !== 1 || !/^[a-f0-9]{40}$/u.test(value.templateCommit) || !Array.isArray(value.files))
    throw new VireoUpgradeError("VIR-UPG-001", "Managed-file provenance has an invalid schema.");
  const paths = new Set<string>();
  for (const file of value.files) {
    assertBaselinePath(file.path);
    if (paths.has(file.path) || !/^[a-f0-9]{64}$/u.test(file.sha256))
      throw new VireoUpgradeError("VIR-UPG-001", "Managed-file provenance contains duplicate paths or invalid hashes.");
    paths.add(file.path);
  }
}
function validateExampleManifest(value: unknown, templateCommit: string): asserts value is ExampleManifest {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<ExampleManifest>).schemaVersion !== 1 ||
    (value as Partial<ExampleManifest>).templateCommit !== templateCommit ||
    !(value as Partial<ExampleManifest>).files ||
    typeof (value as Partial<ExampleManifest>).files !== "object" ||
    Array.isArray((value as Partial<ExampleManifest>).files)
  ) {
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      "Example ownership provenance must be a schema version 1 manifest for the source Template commit.",
    );
  }
  for (const [path, digest] of Object.entries((value as ExampleManifest).files)) {
    assertBaselinePath(path);
    if (!/^[a-f0-9]{64}$/u.test(digest))
      throw new VireoUpgradeError("VIR-UPG-003", "Example ownership provenance has an invalid file digest.");
  }
}
function validateRemovalReceipt(value: unknown, templateCommit: string): asserts value is RemovalReceipt {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<RemovalReceipt>).schemaVersion !== 1 ||
    (value as Partial<RemovalReceipt>).templateCommit !== templateCommit ||
    (value as Partial<RemovalReceipt>).removed !== true
  ) {
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      "Removal receipt must be a completed schema version 1 receipt for the source Template commit.",
    );
  }
}
function validateExistingUpgradeReceipt(
  contents: string,
  source: ReleaseNode,
  target: ReleaseNode,
  expectedManagedSurfaces: string[],
  lockfileRefresh: "required" | "not-required",
  actions: VireoUpgradeManualAction[],
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      `Existing upgrade receipt is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new VireoUpgradeError("VIR-UPG-003", "Existing upgrade receipt must be a JSON object.");
  const receipt = parsed as Record<string, unknown>;
  const expectedKeys = [
    "schemaVersion",
    "from",
    "to",
    "sourceTemplateCommit",
    "targetTemplateCommit",
    "managedSurfaces",
    "lockfileRefresh",
    "applicationOwnedActions",
  ].sort();
  const actualKeys = Object.keys(receipt).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index]))
    throw new VireoUpgradeError("VIR-UPG-003", "Existing upgrade receipt has an unsupported top-level field.");
  const actualSurfaces = receipt.managedSurfaces;
  if (
    receipt.schemaVersion !== 2 ||
    receipt.from !== source.release ||
    receipt.to !== target.release ||
    receipt.sourceTemplateCommit !== source.templateCommit ||
    receipt.targetTemplateCommit !== target.templateCommit ||
    receipt.lockfileRefresh !== lockfileRefresh ||
    !Array.isArray(actualSurfaces) ||
    actualSurfaces.some(surface => typeof surface !== "string") ||
    !Array.isArray(receipt.applicationOwnedActions) ||
    JSON.stringify(receipt.applicationOwnedActions) !== JSON.stringify(actions)
  ) {
    throw new VireoUpgradeError("VIR-UPG-003", "Existing upgrade receipt is invalid for this managed release edge.");
  }
  const isExampleSurface = (surface: string) =>
    surface === ".vireo/example-manifest.json" || surface === ".vireo/remove-example.json";
  const comparable = (surfaces: string[]) =>
    surfaces.map(surface =>
      isOverviewManifestMigration(source, target) && isExampleSurface(surface) ? "<example-state>" : surface,
    );
  if (JSON.stringify(comparable(actualSurfaces)) !== JSON.stringify(comparable(expectedManagedSurfaces)))
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      "Existing upgrade receipt has incompatible managed surfaces for this release edge.",
    );
}
function isOverviewManifestMigration(source: ReleaseNode, target: ReleaseNode) {
  return source.release === "0.8.4" && target.release === "0.8.6";
}
async function migrateExampleManifest(
  projectDirectory: string,
  source: ReleaseNode,
  target: ReleaseNode,
  frontendOnly: boolean,
) {
  if (!isOverviewManifestMigration(source, target)) return undefined;
  const manifestPath = ".vireo/example-manifest.json";
  const receiptPath = ".vireo/remove-example.json";
  await safeFileState(projectDirectory, manifestPath);
  const previous = await optionalText(join(projectDirectory, manifestPath));
  const hasReceipt = await safeFileState(projectDirectory, receiptPath);
  if (previous === undefined) {
    if (!hasReceipt)
      throw new VireoUpgradeError(
        "VIR-UPG-003",
        "Example ownership provenance is missing and no completed removal receipt was found.",
      );
    let receipt: unknown;
    try {
      receipt = JSON.parse(await readFile(join(projectDirectory, receiptPath), "utf8"));
    } catch (error) {
      throw new VireoUpgradeError(
        "VIR-UPG-003",
        `Removal receipt is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    validateRemovalReceipt(receipt, source.templateCommit);
    // A completed removal deliberately replaces the example manifest. Do not
    // recreate ownership after removal, regardless of which profile was removed.
    const targetReceipt = structuredClone(receipt);
    targetReceipt.templateCommit = target.templateCommit;
    return {
      path: join(projectDirectory, receiptPath),
      contents: `${JSON.stringify(targetReceipt, null, 2)}\n`,
      previous: await readFile(join(projectDirectory, receiptPath), "utf8"),
    };
  }
  if (hasReceipt)
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      "Example ownership manifest conflicts with a completed removal receipt.",
    );
  let sourceManifest: unknown;
  try {
    sourceManifest = JSON.parse(previous);
  } catch (error) {
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      `Example ownership provenance is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateExampleManifest(sourceManifest, source.templateCommit);
  const targetManifest = structuredClone(sourceManifest);
  if (frontendOnly) {
    if (FULL_STACK_OVERVIEW_SPEC in targetManifest.files)
      throw new VireoUpgradeError(
        "VIR-UPG-003",
        "Frontend-only example provenance must not claim the full-stack Overview sample.",
      );
  } else {
    if (!(await safeFileState(projectDirectory, FULL_STACK_OVERVIEW_SPEC)))
      throw new VireoUpgradeError(
        "VIR-UPG-003",
        "The full-stack Overview sample is missing; restore or adapt it before upgrading.",
      );
    const overview = await readFile(join(projectDirectory, FULL_STACK_OVERVIEW_SPEC));
    if (sha256(overview) !== PRISTINE_084_OVERVIEW_SPEC_SHA256)
      throw new VireoUpgradeError(
        "VIR-UPG-003",
        "The full-stack Overview sample differs from the immutable 0.8.4 baseline; restore or adapt it before upgrading.",
      );
    const declaredDigest = targetManifest.files[FULL_STACK_OVERVIEW_SPEC];
    if (declaredDigest !== undefined && declaredDigest !== PRISTINE_084_OVERVIEW_SPEC_SHA256)
      throw new VireoUpgradeError(
        "VIR-UPG-003",
        "Example ownership provenance has a customized full-stack Overview sample digest.",
      );
    targetManifest.files[FULL_STACK_OVERVIEW_SPEC] = PRISTINE_084_OVERVIEW_SPEC_SHA256;
  }
  targetManifest.templateCommit = target.templateCommit;
  return {
    path: join(projectDirectory, manifestPath),
    contents: `${JSON.stringify(targetManifest, null, 2)}\n`,
    previous,
  };
}
async function recordedExampleProvenancePath(projectDirectory: string, source: ReleaseNode, target: ReleaseNode) {
  if (!isOverviewManifestMigration(source, target)) return undefined;
  const manifestPath = ".vireo/example-manifest.json";
  const receiptPath = ".vireo/remove-example.json";
  const hasManifest = await safeFileState(projectDirectory, manifestPath);
  const hasReceipt = await safeFileState(projectDirectory, receiptPath);
  if (hasManifest === hasReceipt)
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      "Example ownership provenance must contain exactly one of the manifest or completed removal receipt.",
    );
  return hasManifest ? manifestPath : receiptPath;
}
async function safeFileState(root: string, path: string) {
  assertBaselinePath(path);
  const target = resolve(root, path);
  const inside = relative(root, target);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || !target.startsWith(resolve(root) + sep)) {
    throw new VireoUpgradeError("VIR-UPG-003", `Managed path escapes the project: ${path}`);
  }
  const realRoot = await realpath(resolve(root));
  let cursor = resolve(root);
  for (const segment of path.split("/")) {
    cursor = join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new VireoUpgradeError("VIR-UPG-003", `Managed path contains a symbolic link: ${path}`);
      const resolvedCursor = await realpath(cursor);
      if (resolvedCursor !== realRoot && !resolvedCursor.startsWith(`${realRoot}${sep}`)) {
        throw new VireoUpgradeError("VIR-UPG-003", `Managed path resolves outside the project: ${path}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}
function edgeBaselines(policy: UpgradePolicy, from: string | null, to: string | undefined, profile: unknown) {
  if (!from || !to) return [];
  const selectedProfile = profile === "frontend" ? "frontend" : "full-stack";
  const files = policy.releaseGraph.baselines?.[`${from}->${to}`]?.[selectedProfile] ?? [];
  const paths = new Set<string>();
  for (const file of files) {
    assertBaselinePath(file.path);
    if (paths.has(file.path) || !["add", "update", "delete"].includes(file.operation))
      throw new VireoUpgradeError("VIR-UPG-001", "Managed baseline paths and operations must be unique and supported.");
    paths.add(file.path);
    if (file.sourceSha256 && !/^[a-f0-9]{64}$/u.test(file.sourceSha256))
      throw new VireoUpgradeError("VIR-UPG-001", `Invalid source hash for ${file.path}`);
    if (file.targetSha256 && !/^[a-f0-9]{64}$/u.test(file.targetSha256))
      throw new VireoUpgradeError("VIR-UPG-001", `Invalid target hash for ${file.path}`);
    if (file.sourceContent !== undefined && sha256(file.sourceContent) !== file.sourceSha256)
      throw new VireoUpgradeError("VIR-UPG-001", `Source content hash differs for ${file.path}`);
    const transformedTarget = resolveBaselineTargetContent(file);
    if (transformedTarget !== undefined && sha256(transformedTarget) !== file.targetSha256)
      throw new VireoUpgradeError("VIR-UPG-001", `Target content hash differs for ${file.path}`);
    if (file.operation === "add") {
      if (file.sourceSha256 !== undefined || file.sourceContent !== undefined)
        throw new VireoUpgradeError("VIR-UPG-001", `Managed add baseline must not declare source bytes: ${file.path}`);
      if (!file.targetSha256 || transformedTarget === undefined)
        throw new VireoUpgradeError("VIR-UPG-001", `Managed add baseline requires target bytes: ${file.path}`);
    } else if (file.operation === "update") {
      if (!file.sourceSha256 || !file.targetSha256 || (transformedTarget === undefined && !file.transforms))
        throw new VireoUpgradeError(
          "VIR-UPG-001",
          `Managed update baseline requires source and target bytes: ${file.path}`,
        );
    } else {
      if (!file.sourceSha256 || file.sourceContent === undefined)
        throw new VireoUpgradeError("VIR-UPG-001", `Managed delete baseline requires source bytes: ${file.path}`);
      if (file.targetSha256 !== undefined || file.targetContent !== undefined || file.transforms !== undefined)
        throw new VireoUpgradeError(
          "VIR-UPG-001",
          `Managed delete baseline must not declare target bytes: ${file.path}`,
        );
    }
  }
  return files;
}
function resolveBaselineTargetContent(baseline: EdgeBaseline) {
  if (baseline.targetContent !== undefined) return baseline.targetContent;
  if (!baseline.transforms || baseline.sourceContent === undefined) return undefined;
  return applyBaselineTransforms(baseline, baseline.sourceContent);
}
function applyBaselineTransforms(baseline: EdgeBaseline, source: string): string {
  if (!baseline.transforms) {
    if (baseline.targetContent === undefined)
      throw new VireoUpgradeError("VIR-UPG-001", `Managed baseline has no target content: ${baseline.path}`);
    return baseline.targetContent;
  }
  let output = source;
  for (const transform of baseline.transforms) {
    if (
      !transform ||
      typeof transform.from !== "string" ||
      !transform.from ||
      typeof transform.to !== "string" ||
      output.split(transform.from).length !== 2
    )
      throw new VireoUpgradeError("VIR-UPG-001", `Managed baseline transform is not exact for ${baseline.path}`);
    output = output.replace(transform.from, transform.to);
  }
  if (baseline.targetSha256 && sha256(output) !== baseline.targetSha256)
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      `Managed baseline transform differs from target hash for ${baseline.path}`,
    );
  return output;
}
async function baselineWriteContents(projectDirectory: string, baseline: EdgeBaseline): Promise<string | null> {
  if (baseline.operation === "delete") return null;
  if (baseline.transforms) {
    if (baseline.operation !== "update")
      throw new VireoUpgradeError("VIR-UPG-001", `Only managed updates may use transforms: ${baseline.path}`);
    const source = await readFile(join(projectDirectory, baseline.path), "utf8");
    return applyBaselineTransforms(baseline, source);
  }
  const target = resolveBaselineTargetContent(baseline);
  if (target === undefined)
    throw new VireoUpgradeError("VIR-UPG-001", `Managed baseline has no resolved target content: ${baseline.path}`);
  return target;
}
function baselineTargetHash(baseline: EdgeBaseline | undefined) {
  if (!baseline?.targetSha256)
    throw new VireoUpgradeError("VIR-UPG-001", `Managed baseline has no target hash: ${baseline?.path ?? "unknown"}`);
  return baseline.targetSha256;
}
function profileActions(actions: ApplicationOwnedActionPolicy[], profile: unknown): VireoUpgradeManualAction[] {
  const lockRefresh =
    profile === "frontend"
      ? "corepack npm install --package-lock-only"
      : "corepack npm install --package-lock-only --prefix frontend";
  return actions.map(action => ({
    ...action,
    verificationCommands: action.verificationCommands.map(command => {
      if (command.startsWith("corepack npm install --package-lock-only")) return lockRefresh;
      if (command === "corepack npm run performance:policy:test" || command === "corepack npm run performance:audit")
        return profile === "frontend"
          ? command
          : `corepack npm --prefix frontend run ${command.slice("corepack npm run ".length)}`;
      return command;
    }),
    status: "pending" as const,
  }));
}
async function baselineState(root: string, baseline: EdgeBaseline) {
  const path = join(root, baseline.path);
  const exists = await safeFileState(root, baseline.path);
  const current = exists ? sha256(await readFile(path)) : undefined;
  if (baseline.operation === "add")
    return !exists
      ? ("add" as const)
      : current === baseline.targetSha256
        ? ("unchanged" as const)
        : ("conflict" as const);
  if (baseline.operation === "delete")
    return !exists
      ? ("unchanged" as const)
      : current === baseline.sourceSha256
        ? ("delete" as const)
        : ("conflict" as const);
  return !exists
    ? ("missing" as const)
    : current === baseline.targetSha256
      ? ("unchanged" as const)
      : current === baseline.sourceSha256
        ? ("update" as const)
        : ("conflict" as const);
}

async function projectStatusWithPolicy(
  projectDirectory: string,
  policyOverride?: unknown,
): Promise<VireoProjectStatus> {
  const root = resolve(projectDirectory),
    policy = await readPolicy(policyOverride);
  const metadata = (await safeFileState(root, ".vireo/project.json"))
    ? await optionalJson<ProjectMetadata>(join(root, ".vireo/project.json"))
    : undefined;
  const recordedRelease = metadata ? recordedReleaseFromMetadata(metadata, policy) : null,
    edge = recordedRelease
      ? policy.releaseGraph.edges.find(candidate => candidate.from === recordedRelease)
      : undefined;
  const manifest = (await safeFileState(root, ".vireo/managed-files.json"))
    ? await optionalJson<ManagedManifest>(join(root, ".vireo/managed-files.json"))
    : undefined;
  validateManagedManifest(manifest);
  const manifestFiles = manifest?.files
    ? await Promise.all(
        manifest.files.map(async file => {
          const path = join(root, file.path);
          if (!(await safeFileState(root, file.path))) return { path: file.path, state: "missing" as const };
          return {
            path: file.path,
            state: sha256(await readFile(path)) === file.sha256 ? ("clean" as const) : ("customized" as const),
          };
        }),
      )
    : ["package.json", "frontend/package.json", "gradle.properties"].map(path => ({
        path,
        state: "untracked" as const,
      }));
  const baselineFiles = await Promise.all(
    edgeBaselines(policy, recordedRelease, edge?.to, metadata?.profile).map(async baseline => ({
      path: baseline.path,
      state: await baselineState(root, baseline),
    })),
  );
  const managedFiles = [
    ...manifestFiles.filter(file => !baselineFiles.some(baseline => baseline.path === file.path)),
    ...baselineFiles,
  ];
  const generatedDirectory = join(root, ".vireo/generated"),
    managed = (await pathExists(generatedDirectory))
      ? (await readdir(generatedDirectory)).filter(name => name.endsWith(".json")).map(name => name.slice(0, -5))
      : [],
    ejected = [...new Set([...(await ejectedCapabilities(root)), ...(await legacyEjectedCapabilities(root))])];
  const target = edge ? policy.releaseGraph.releases.find(release => release.release === edge.to) : undefined;
  const interruptedUpgrade = await safeFileState(root, ".vireo/upgrade-journal.json");
  return {
    recordedRelease,
    templateCommit: typeof metadata?.templateCommit === "string" ? metadata.templateCommit : null,
    currentRelease: policy.releaseGraph.publicRelease,
    targetRelease: target?.release ?? null,
    targetTemplateCommit: target?.templateCommit ?? null,
    nextHop: edge?.to ?? null,
    interruptedUpgrade,
    managedFiles,
    applicationOwnedActions: profileActions(edge?.applicationOwnedActions ?? [], metadata?.profile),
    capabilities: [
      ...managed.map(name => ({ name, state: "managed" as const })),
      ...ejected.filter(name => !managed.includes(name)).map(name => ({ name, state: "ejected" as const })),
    ].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function upgradeProjectWithPolicy(
  options: VireoUpgradeOptions,
  policyOverride?: unknown,
): Promise<VireoUpgradeResult> {
  const projectDirectory = resolve(options.projectDirectory);
  const dryRun = options.dryRun ?? true;
  if (await safeFileState(projectDirectory, ".vireo/upgrade-journal.json")) {
    if (dryRun)
      throw new VireoUpgradeError(
        "VIR-UPG-009",
        "An interrupted upgrade journal is present. Preview is read-only; run vireo upgrade --apply to recover it first.",
      );
    await recoverInterruptedUpgrade(projectDirectory);
  }
  const policy = await readPolicy(policyOverride),
    graph = policy.releaseGraph,
    target = graph.releases.find(release => release.release === options.targetRelease);
  if (!target)
    throw new VireoUpgradeError("VIR-UPG-002", `Target ${options.targetRelease} is not declared by this CLI.`);
  if (target.status === "candidate") {
    throw new VireoUpgradeError(
      "VIR-UPG-008",
      `Target ${target.release} is an unpublished candidate and cannot be previewed or applied.`,
    );
  }
  for (const path of [".vireo/project.json", "package.json"]) await safeFileState(projectDirectory, path);
  const metadataPath = join(projectDirectory, ".vireo/project.json"),
    rootManifestPath = join(projectDirectory, "package.json");
  const metadataText = await readFile(metadataPath, "utf8").catch(error => {
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      `Project is missing required upgrade input: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const metadata = JSON.parse(metadataText) as ProjectMetadata,
    frontendOnly = metadata.profile === "frontend";
  const frontendManifestPath = frontendOnly ? rootManifestPath : join(projectDirectory, "frontend/package.json"),
    frontendLockPath = frontendOnly
      ? join(projectDirectory, "package-lock.json")
      : join(projectDirectory, "frontend/package-lock.json"),
    gradlePropertiesPath = join(projectDirectory, "gradle.properties");
  for (const path of frontendOnly
    ? ["package-lock.json"]
    : ["frontend/package.json", "frontend/package-lock.json", "gradle.properties"])
    await safeFileState(projectDirectory, path);
  const [rootManifestText, frontendManifestText, frontendLockText, gradleProperties] = await Promise.all([
    readFile(rootManifestPath, "utf8"),
    frontendOnly ? Promise.resolve("") : readFile(frontendManifestPath, "utf8"),
    readFile(frontendLockPath, "utf8"),
    frontendOnly ? Promise.resolve(undefined) : readFile(gradlePropertiesPath, "utf8"),
  ]).catch(error => {
    throw new VireoUpgradeError(
      "VIR-UPG-001",
      `Project is missing required upgrade input: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const rootManifest = JSON.parse(rootManifestText) as PackageManifest,
    frontendManifest = frontendOnly ? rootManifest : (JSON.parse(frontendManifestText) as PackageManifest),
    frontendLock = JSON.parse(frontendLockText) as PackageLock;
  const recordedRelease = recordedReleaseFromMetadata(metadata, policy);
  const source = graph.releases.find(release => release.release === recordedRelease);
  if (!source) throw new VireoUpgradeError("VIR-UPG-002", `Release ${recordedRelease} is not declared by this CLI.`);
  const edge = graph.edges.find(candidate => candidate.from === recordedRelease && candidate.to === target.release),
    alreadyTarget = recordedRelease === target.release;
  if (!edge && !alreadyTarget)
    throw new VireoUpgradeError(
      "VIR-UPG-002",
      `No adjacent upgrade edge ${recordedRelease} -> ${target.release} is declared.`,
    );
  if (
    !alreadyTarget &&
    isOverviewManifestMigration(source, target) &&
    (await safeFileState(projectDirectory, ".vireo/upgrade-0.8.4-to-0.8.6.json"))
  )
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      "A target-edge upgrade receipt already exists; resolve the conflicting provenance before upgrading.",
    );
  assertEqual(metadata.templateCommit, source.templateCommit, "source Template commit", "VIR-UPG-002");
  if (metadata.templateVersion !== undefined)
    assertEqual(metadata.templateVersion, source.release, "source Template version", "VIR-UPG-002");
  if (metadata.templateTag !== undefined)
    assertEqual(metadata.templateTag, `starter-template@${source.release}`, "source Template tag", "VIR-UPG-002");
  requirementsMatch(
    rootManifest,
    frontendManifest,
    gradleProperties,
    frontendLock,
    source,
    !alreadyTarget,
    frontendOnly,
  );
  await safeFileState(projectDirectory, ".vireo/managed-files.json");
  const existingManaged = await optionalJson<ManagedManifest>(join(projectDirectory, ".vireo/managed-files.json"));
  validateManagedManifest(existingManaged);
  if (existingManaged) {
    assertEqual(existingManaged.templateCommit, source.templateCommit, "managed source Template commit", "VIR-UPG-002");
    for (const file of existingManaged.files) {
      const path = join(projectDirectory, file.path);
      if (!(await safeFileState(projectDirectory, file.path)) || sha256(await readFile(path)) !== file.sha256) {
        throw new VireoUpgradeError(
          "VIR-UPG-003",
          `Managed baseline differs at ${file.path}; resolve or eject the customization before upgrading.`,
        );
      }
    }
  }
  const exampleStateChange = await migrateExampleManifest(projectDirectory, source, target, frontendOnly);
  const managedBaselines = edgeBaselines(policy, source.release, edge?.to, metadata.profile);
  const baselineFiles = await Promise.all(
    managedBaselines.map(async baseline => ({ baseline, state: await baselineState(projectDirectory, baseline) })),
  );
  const baselineConflicts = baselineFiles.filter(file => file.state === "conflict" || file.state === "missing");
  if (baselineConflicts.length)
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      `Managed baseline drift: ${baselineConflicts.map(file => file.baseline.path).join(", ")}`,
    );
  const migrations = await migrationVersions(projectDirectory),
    generated = await checkGeneratedEntities(projectDirectory),
    generatedProblems = generated.flatMap(result => result.problems.map(problem => `${result.entity}: ${problem}`));
  if (generatedProblems.length)
    throw new VireoUpgradeError("VIR-UPG-006", `Generated/wire-contract drift: ${generatedProblems.join("; ")}`);
  const targetRootManifest = structuredClone(rootManifest);
  const targetFrontendManifest = frontendOnly ? targetRootManifest : structuredClone(frontendManifest);
  const targetScriptManifest = frontendOnly ? targetRootManifest : targetFrontendManifest;
  const sourceManagedScripts = managedScriptsForProfile(source, frontendOnly);
  const targetManagedScripts = managedScriptsForProfile(target, frontendOnly);
  const targetProjectionSourceScripts =
    target.projectionSourceFrontendScripts?.[frontendOnly ? "frontend" : "full-stack"] ?? {};
  for (const [name, value] of Object.entries(targetManagedScripts)) {
    const current = targetScriptManifest.scripts?.[name];
    const sourceValue = sourceManagedScripts[name] ?? targetProjectionSourceScripts[name];
    if (current === value || (sourceValue !== undefined && current === sourceValue)) continue;
    // A script with no declared source is an addition on this edge. Preserve the
    // historical omission, but reject any consumer-owned value rather than
    // silently replacing it. A declared projection source is required and
    // therefore cannot be absent.
    if (sourceValue === undefined && current === undefined) continue;
    throw new VireoUpgradeError(
      "VIR-UPG-003",
      `Managed package.json scripts.${name} differs from the declared source or target; resolve the customization before upgrading.`,
    );
  }
  targetRootManifest.scripts = {
    ...targetRootManifest.scripts,
    vireo: target.rootVireoScript,
  };
  targetScriptManifest.scripts = {
    ...targetScriptManifest.scripts,
    ...targetManagedScripts,
  };
  targetFrontendManifest.dependencies = { ...targetFrontendManifest.dependencies, ...target.frontendDependencies };
  const targetGradleProperties =
    gradleProperties === undefined
      ? undefined
      : replaceStarterVersion(gradleProperties, target.starterJvmVersion, "gradle.properties");
  const targetMetadata = structuredClone(metadata);
  targetMetadata.templateCommit = target.templateCommit;
  targetMetadata.templateVersion = target.release;
  targetMetadata.templateTag = `starter-template@${target.release}`;
  targetMetadata.lastUpgradedBy = `create-vireo@${target.release}`;
  if (edge)
    targetMetadata.lastUpgrade = {
      schemaVersion: 2,
      from: source.release,
      to: target.release,
      sourceTemplateCommit: source.templateCommit,
      targetTemplateCommit: target.templateCommit,
      sourceTemplateVersion: source.release,
      targetTemplateVersion: target.release,
      sourceTemplateTag: `starter-template@${source.release}`,
      targetTemplateTag: `starter-template@${target.release}`,
      lockfileRefresh: edge.lockfileRefresh ?? "required",
    };
  const previousUpgrade =
    metadata.lastUpgrade && typeof metadata.lastUpgrade === "object"
      ? (metadata.lastUpgrade as Record<string, unknown>)
      : undefined;
  const recordedEdge =
    edge ??
    (typeof previousUpgrade?.from === "string"
      ? graph.edges.find(candidate => candidate.from === previousUpgrade.from && candidate.to === target.release)
      : undefined);
  const recordSource = recordedEdge ? graph.releases.find(release => release.release === recordedEdge.from)! : source;
  const recordedExampleProvenance = await recordedExampleProvenancePath(projectDirectory, recordSource, target);
  const receiptBaselines = recordedEdge
    ? edgeBaselines(policy, recordSource.release, target.release, metadata.profile)
    : managedBaselines;
  const receiptManagedSurfaces = [
    ...managedSurfaces,
    ...(recordedExampleProvenance ? [recordedExampleProvenance] : []),
    ...Object.keys(targetManagedScripts).map(
      name => `${frontendOnly ? "package.json" : "frontend/package.json"}#scripts.${name}`,
    ),
    ...receiptBaselines.map(baseline => baseline.path),
  ];
  const actions = profileActions(recordedEdge?.applicationOwnedActions ?? [], metadata.profile),
    recordPath = join(projectDirectory, ".vireo", `upgrade-${recordSource.release}-to-${target.release}.json`);
  const renderedRecordContents = await format(
    JSON.stringify({
      schemaVersion: 2,
      from: recordSource.release,
      to: target.release,
      sourceTemplateCommit: recordSource.templateCommit,
      targetTemplateCommit: target.templateCommit,
      managedSurfaces: receiptManagedSurfaces,
      lockfileRefresh: recordedEdge?.lockfileRefresh ?? "required",
      applicationOwnedActions: actions,
    }),
    { ...(await resolveConfig(recordPath)), filepath: recordPath },
  );
  const existingRecordContents = await optionalText(recordPath);
  let recordContents = renderedRecordContents;
  if (alreadyTarget && existingRecordContents !== undefined) {
    validateExistingUpgradeReceipt(
      existingRecordContents,
      recordSource,
      target,
      receiptManagedSurfaces,
      recordedEdge?.lockfileRefresh ?? "required",
      actions,
    );
    recordContents = existingRecordContents;
  }
  const sourceManaged =
    existingManaged ?? (await managedManifest(projectDirectory, source.templateCommit, frontendOnly));
  const baselineByPath = new Map(baselineFiles.map(file => [file.baseline.path, file.baseline]));
  const targetManagedFiles = [
    ...sourceManaged.files
      .filter(
        file =>
          !baselineFiles.some(
            baseline => baseline.baseline.path === file.path && baseline.baseline.operation === "delete",
          ),
      )
      .map(file => ({
        ...file,
        sha256:
          baselineByPath.get(file.path)?.operation === "update"
            ? baselineTargetHash(baselineByPath.get(file.path))
            : file.path === "package.json"
              ? sha256(`${JSON.stringify(frontendOnly ? targetFrontendManifest : targetRootManifest, null, 2)}\n`)
              : file.path === "frontend/package.json"
                ? sha256(`${JSON.stringify(targetFrontendManifest, null, 2)}\n`)
                : file.path === "gradle.properties" && targetGradleProperties !== undefined
                  ? sha256(targetGradleProperties)
                  : file.sha256,
      })),
    ...baselineFiles
      .filter(
        file =>
          !sourceManaged.files.some(sourceFile => sourceFile.path === file.baseline.path) &&
          file.baseline.operation !== "delete",
      )
      .map(file => ({ path: file.baseline.path, sha256: baselineTargetHash(file.baseline) })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const managedContents = `${JSON.stringify({ schemaVersion: 1, templateCommit: target.templateCommit, files: targetManagedFiles }, null, 2)}\n`;
  const candidates = [
    {
      path: rootManifestPath,
      contents: `${JSON.stringify(frontendOnly ? targetFrontendManifest : targetRootManifest, null, 2)}\n`,
      previous: rootManifestText,
    },
    ...(frontendOnly
      ? []
      : [
          {
            path: frontendManifestPath,
            contents: `${JSON.stringify(targetFrontendManifest, null, 2)}\n`,
            previous: frontendManifestText,
          },
          { path: gradlePropertiesPath, contents: targetGradleProperties!, previous: gradleProperties },
        ]),
    ...(await Promise.all(
      baselineFiles
        .filter(file => file.state === "add" || file.state === "update" || file.state === "delete")
        .map(async file => ({
          path: join(projectDirectory, file.baseline.path),
          contents: await baselineWriteContents(projectDirectory, file.baseline),
          previous: undefined,
        })),
    )),
    ...(exampleStateChange ? [exampleStateChange] : []),
    { path: metadataPath, contents: `${JSON.stringify(targetMetadata, null, 2)}\n`, previous: metadataText },
    {
      path: join(projectDirectory, ".vireo/managed-files.json"),
      contents: managedContents,
      previous: await optionalText(join(projectDirectory, ".vireo/managed-files.json")),
    },
    { path: recordPath, contents: recordContents, previous: await optionalText(recordPath) },
  ];
  for (const candidate of candidates)
    if (candidate.previous === undefined && (await pathExists(candidate.path)))
      candidate.previous = await readFile(candidate.path, "utf8");
  const files = candidates.map(change => ({
    path: change.path.slice(projectDirectory.length + 1),
    status:
      change.contents === null
        ? ("delete" as const)
        : change.previous === change.contents
          ? ("unchanged" as const)
          : change.previous === undefined
            ? ("create" as const)
            : ("update" as const),
  }));
  const lockCommand = frontendOnly
    ? "corepack npm install --package-lock-only"
    : "corepack npm install --package-lock-only --prefix frontend";
  const lockfileRefresh = edge?.lockfileRefresh ?? "required";
  const checks: VireoUpgradeCheck[] = [
    { id: "source", status: "pass", detail: `${source.release} -> ${target.release} is a declared adjacent edge.` },
    {
      id: "dependencies",
      status: "pass",
      detail: "Vireo npm declarations and JVM BOM version match the release edge.",
    },
    lockfileRefresh === "required"
      ? {
          id: "lockfile" as const,
          status: "manual" as const,
          detail: `No resolved dependency versions were edited. Run ${lockCommand} before verification.`,
        }
      : {
          id: "lockfile" as const,
          status: "pass" as const,
          detail: "This edge changes no dependency declarations; the existing application lockfile is preserved.",
        },
    {
      id: "migrations",
      status: "pass",
      detail: `${migrations.length} application Flyway migration version(s) are unique.`,
    },
    {
      id: "generated-contracts",
      status: "pass",
      detail: `${generated.length} managed generated capability contract(s) have no drift.`,
    },
    {
      id: "application-owned",
      status: actions.length ? "manual" : "pass",
      detail: actions.length
        ? `${actions.length} application-owned action(s) remain pending.`
        : "No application-owned actions are declared for this edge.",
    },
  ];
  if (!dryRun) {
    if (!/^[a-f0-9]{40}$/u.test(target.templateCommit))
      throw new VireoUpgradeError("VIR-UPG-008", "The target Template commit is not an immutable Git SHA.");
    if (!options.acceptApplicationOwned)
      throw new VireoUpgradeError(
        "VIR-UPG-007",
        "Apply requires --accept-application-owned after reviewing the target Template diff and rollback plan.",
      );
    await writeAtomically(
      projectDirectory,
      candidates.filter((_, index) => files[index].status !== "unchanged"),
    );
  }
  return {
    sourceRelease: source.release,
    targetRelease: target.release,
    targetTemplateCommit: target.templateCommit,
    dryRun,
    checks,
    files,
    manualActions: actions,
  };
}

export function vireoProjectStatus(projectDirectory: string): Promise<VireoProjectStatus> {
  return projectStatusWithPolicy(projectDirectory);
}

export function upgradeVireoProject(options: VireoUpgradeOptions): Promise<VireoUpgradeResult> {
  return upgradeProjectWithPolicy(options);
}

/** @internal Test-only entry point; the package root never exports policy injection. */
export function vireoProjectStatusForTest(projectDirectory: string, policy: unknown): Promise<VireoProjectStatus> {
  return projectStatusWithPolicy(projectDirectory, policy);
}

/** @internal Test-only entry point; the package root never exports policy injection. */
export function upgradeVireoProjectForTest(options: VireoUpgradeOptions, policy: unknown): Promise<VireoUpgradeResult> {
  return upgradeProjectWithPolicy(options, policy);
}
