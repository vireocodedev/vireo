import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function synchronizeDocumentationRelease(
  repositoryRoot,
  { createSnapshotArchive, serializeSnapshot, formatOutput } = {},
) {
  const contractsDirectory = join(repositoryRoot, "contracts");
  const ecosystemPath = join(contractsDirectory, "ecosystem-release-contract.json");
  const documentationPath = join(contractsDirectory, "documentation-release-policy.json");
  const lifecyclePath = join(contractsDirectory, "release-lifecycle-policy.json");
  const ecosystem = readJson(ecosystemPath);
  const oldTemplateCommit = ecosystem.current?.template?.commit;
  const oldTemplateVersion = ecosystem.current?.template?.version;
  if (!/^[a-f0-9]{40}$/u.test(oldTemplateCommit ?? "")) {
    throw new Error("Ecosystem current template must pin an exact starter-template commit");
  }
  if (!/^\d+\.\d+\.\d+$/u.test(oldTemplateVersion ?? "")) {
    throw new Error("Ecosystem current template must declare a semantic version");
  }
  const documentation = readJson(documentationPath);
  const lifecycle = readJson(lifecyclePath);
  const currentDocumentation = documentation.releases?.find(release => release.id === documentation.currentRelease);
  if (!currentDocumentation) {
    throw new Error(`Current documentation release ${documentation.currentRelease} is not declared`);
  }
  const priorCurrentJvmVersion = currentDocumentation.jvm?.version;
  if (!isStableSemver(priorCurrentJvmVersion)) {
    throw new Error("Current documentation release must declare a stable JVM version");
  }

  const publicWorkspacePackages = readdirSync(join(repositoryRoot, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      directory: entry.name,
      manifestPath: join(repositoryRoot, "packages", entry.name, "package.json"),
    }))
    .filter(record => existsSync(record.manifestPath))
    .map(({ directory, manifestPath }) => {
      const manifest = readJson(manifestPath);
      return manifest.private === true ? null : { directory, name: manifest.name, version: manifest.version };
    })
    .filter(Boolean);
  const packageVersions = new Map(publicWorkspacePackages.map(({ name, version }) => [name, version]));
  for (const { name, version } of publicWorkspacePackages) {
    if (!isStableSemver(version)) throw new Error(`Public workspace ${name} must declare a stable semantic version`);
  }
  const packageLockPath = join(repositoryRoot, "package-lock.json");
  const packageLock = readJson(packageLockPath);
  updatePublicWorkspaceLockEntries(packageLock, publicWorkspacePackages);
  const createVireoVersion = packageVersions.get("create-vireo");
  if (!createVireoVersion) throw new Error("create-vireo has no public workspace manifest");
  const templateVersion = createVireoVersion;
  const templateTag = `starter-template@${templateVersion}`;
  const templateReleaseUrl = `https://github.com/vireocodedev/vireo-template/releases/tag/${encodeURIComponent(templateTag)}`;

  const gradleProperties = readFileSync(join(repositoryRoot, "jvm", "gradle.properties"), "utf8");
  const jvmVersion = gradleProperties.match(/^version=(.+)$/mu)?.[1];
  if (!jvmVersion) throw new Error("jvm/gradle.properties has no version");
  const nextReleaseId = validateSynchronizedReleaseCoordinate({
    createVireoVersion,
    currentDocumentation,
    jvmVersion,
  });

  const createSourcePath = join(repositoryRoot, "packages", "create-vireo", "src", "index.ts");
  let createSource = readFileSync(createSourcePath, "utf8");
  let templateCommit = createSource.match(/TEMPLATE_COMMIT = "([a-f0-9]{40})"/u)?.[1];
  if (!templateCommit) throw new Error("create-vireo does not pin an exact starter-template commit");
  const declaredCreateVireoVersion = createSource.match(/CREATE_VIREO_PACKAGE_VERSION = "([^"]+)"/u)?.[1];
  if (!declaredCreateVireoVersion)
    throw new Error("create-vireo does not declare its generated-project package version");
  const declaredTemplateStarterJvmBaseline = createSource.match(/TEMPLATE_STARTER_JVM_BASELINE = "([^"]+)"/u)?.[1];
  if (!declaredTemplateStarterJvmBaseline) {
    throw new Error("create-vireo does not declare its starter JVM baseline");
  }
  if (!isStableSemver(declaredTemplateStarterJvmBaseline)) {
    throw new Error("create-vireo must declare a stable starter JVM baseline");
  }
  let templateStarterJvmBaseline = declaredTemplateStarterJvmBaseline;
  createSource = createSource.replace(
    `CREATE_VIREO_PACKAGE_VERSION = "${declaredCreateVireoVersion}"`,
    `CREATE_VIREO_PACKAGE_VERSION = "${createVireoVersion}"`,
  );

  const upgradePolicyPath = join(repositoryRoot, "packages", "create-vireo", "schema", "vireo-upgrade-policy.json");
  const upgradePolicy = readJson(upgradePolicyPath);
  const projectUpgradePath = join(repositoryRoot, "contracts", "project-upgrade-policy.json");
  const templateAdoptionIntentPath = join(repositoryRoot, "contracts", "template-adoption-intent.json");
  const projectUpgrade = readJson(projectUpgradePath);
  const templateAdoptionIntent = readJson(templateAdoptionIntentPath);
  const publicUpgradeRelease = upgradePolicy.releaseGraph?.publicRelease;
  const candidateUpgradeRelease = upgradePolicy.releaseGraph?.candidateRelease;
  const priorPublicUpgradeRelease = upgradePolicy.releaseGraph?.edges?.find(
    edge => edge.to === publicUpgradeRelease,
  )?.from;
  const priorHistoricalUpgradeRelease = upgradePolicy.releaseGraph?.edges?.find(
    edge => edge.to === priorPublicUpgradeRelease,
  )?.from;
  const candidateTemplateCommit = projectUpgrade.finalization?.targetTemplateCommit;
  const candidateUpgradeEdge = upgradePolicy.releaseGraph?.edges?.find(
    edge => edge.from === publicUpgradeRelease && edge.to === candidateUpgradeRelease,
  );
  const candidateLockfileRefresh = candidateUpgradeEdge?.lockfileRefresh ?? "required";
  if (
    upgradePolicy.releaseGraph?.candidateRelease !== undefined &&
    upgradePolicy.releaseGraph.candidateRelease !== createVireoVersion
  ) {
    throw new Error(
      `Candidate upgrade release ${upgradePolicy.releaseGraph.candidateRelease} cannot finalize until create-vireo is versioned to the same release`,
    );
  }
  if (
    upgradePolicy.releaseGraph?.candidateRelease === createVireoVersion &&
    typeof candidateTemplateCommit === "string" &&
    /^[a-f0-9]{40}$/u.test(candidateTemplateCommit)
  ) {
    createSource = createSource.replace(
      `TEMPLATE_COMMIT = "${templateCommit}"`,
      `TEMPLATE_COMMIT = "${candidateTemplateCommit}"`,
    );
    createSource = createSource.replace(
      `TEMPLATE_STARTER_JVM_BASELINE = "${declaredTemplateStarterJvmBaseline}"`,
      `TEMPLATE_STARTER_JVM_BASELINE = "${jvmVersion}"`,
    );
    templateStarterJvmBaseline = jvmVersion;
    templateCommit = candidateTemplateCommit;
  }
  finalizeCandidateUpgrade({ upgradePolicy, projectUpgrade, createVireoVersion, templateCommit });
  const currentUpgradeRelease = upgradePolicy.releaseGraph?.releases?.find(
    release =>
      release.release === (upgradePolicy.releaseGraph?.candidateRelease ?? upgradePolicy.releaseGraph?.publicRelease),
  );
  if (!currentUpgradeRelease || typeof currentUpgradeRelease.rootVireoScript !== "string") {
    throw new Error("create-vireo upgrade policy has no candidate/current release root Vireo script");
  }
  currentUpgradeRelease.rootVireoScript = `npx --yes --package=create-vireo@${createVireoVersion} vireo`;
  currentUpgradeRelease.templateCommit = templateCommit;
  currentUpgradeRelease.starterJvmVersion = jvmVersion;
  const currentReleaseCoordinate =
    projectUpgrade.releaseCoordinates?.[
      upgradePolicy.releaseGraph?.candidateRelease ?? upgradePolicy.releaseGraph?.publicRelease
    ];
  if (!currentReleaseCoordinate || typeof currentReleaseCoordinate !== "object") {
    throw new Error("Project-upgrade policy has no current release coordinate");
  }
  currentReleaseCoordinate.createVireo = createVireoVersion;
  currentReleaseCoordinate.templateVersion = templateVersion;
  currentReleaseCoordinate.templateCommit = templateCommit;
  currentReleaseCoordinate.starterJvmVersion = jvmVersion;
  const oldReleaseId = ecosystem.current?.id;
  if (!oldReleaseId || documentation.currentRelease !== oldReleaseId) {
    throw new Error("Ecosystem and documentation current release IDs do not match");
  }
  finalizeTemplateAdoptionIntent({
    intent: templateAdoptionIntent,
    createVireoVersion,
    templateCommit,
    jvmVersion,
    releaseId: nextReleaseId,
  });
  updateNpmEntries(ecosystem.current?.npm, packageVersions, "Ecosystem release");
  ecosystem.current.id = nextReleaseId;
  ecosystem.current.maven.version = jvmVersion;
  ecosystem.current.template.version = templateVersion;
  ecosystem.current.template.tag = templateTag;
  ecosystem.current.template.commit = templateCommit;
  ecosystem.current.template.releaseUrl = templateReleaseUrl;

  const compatibility = ecosystem.compatibility?.sets?.find(
    candidate => candidate.id === ecosystem.compatibility?.defaultSet,
  );
  if (!compatibility) throw new Error("Ecosystem default compatibility set is not declared");
  compatibility.release = nextReleaseId;
  compatibility.npm = Object.fromEntries(packageVersions);
  compatibility.mavenBom = `${ecosystem.current.maven.group}:vireo-bom:${jvmVersion}`;
  compatibility.templateVersion = templateVersion;
  compatibility.templateTag = templateTag;
  compatibility.templateCommit = templateCommit;
  compatibility.templateReleaseUrl = templateReleaseUrl;
  updateReleaseReferences(ecosystem.supportLines, oldReleaseId, nextReleaseId);

  updateNpmEntries(currentDocumentation.npm, packageVersions, "Documentation release", "package");
  currentDocumentation.id = nextReleaseId;
  currentDocumentation.jvm.version = jvmVersion;
  currentDocumentation.template.version = templateVersion;
  currentDocumentation.template.tag = templateTag;
  currentDocumentation.template.commit = templateCommit;
  currentDocumentation.template.releaseUrl = templateReleaseUrl;
  currentDocumentation.releaseLinks.jvmTag = `https://github.com/vireocodedev/vireo/releases/tag/jvm-v${jvmVersion}`;
  currentDocumentation.releaseLinks.template = templateReleaseUrl;
  documentation.currentRelease = nextReleaseId;
  updateReleaseReferences(lifecycle.supportLines, oldReleaseId, nextReleaseId);

  const compatibilityPath = join(repositoryRoot, "docs", "COMPATIBILITY.md");
  const portalPath = join(repositoryRoot, "docs", "DOCUMENTATION_PORTAL.md");
  let compatibilityMarkdown = readFileSync(compatibilityPath, "utf8");
  for (const [name, version] of packageVersions) {
    compatibilityMarkdown = replaceMarkdownTableVersion(compatibilityMarkdown, name, version, compatibilityPath);
  }
  compatibilityMarkdown = replaceMarkdownTableVersion(
    compatibilityMarkdown,
    `${ecosystem.current.maven.group}:vireo-*`,
    jvmVersion,
    compatibilityPath,
  );
  const portal = readFileSync(portalPath, "utf8").replaceAll(oldReleaseId, nextReleaseId);
  const jvmBomDocumentationOutputs = synchronizeJvmBomDocumentation({
    repositoryRoot,
    priorCurrentJvmVersion,
    jvmVersion,
  });
  const siteOutputs = replaceCurrentTemplateReferencesInSite(
    repositoryRoot,
    oldTemplateCommit,
    templateCommit,
    oldTemplateVersion,
    templateVersion,
  );
  const currentReleaseGuidance =
    candidateUpgradeRelease === createVireoVersion
      ? synchronizeCurrentReleaseGuidance({
          repositoryRoot,
          compatibilityMarkdown,
          oldTemplateCommit,
          templateCommit,
          oldTemplateVersion,
          templateVersion,
          priorHistoricalUpgradeRelease,
          priorPublicUpgradeRelease,
          publicUpgradeRelease,
          candidateUpgradeRelease,
          candidateLockfileRefresh,
          jvmVersion,
        })
      : undefined;

  const outputs = [
    [ecosystemPath, JSON.stringify(ecosystem)],
    [documentationPath, JSON.stringify(documentation)],
    [lifecyclePath, JSON.stringify(lifecycle)],
    [createSourcePath, createSource],
    [upgradePolicyPath, JSON.stringify(upgradePolicy)],
    [projectUpgradePath, JSON.stringify(projectUpgrade)],
    [templateAdoptionIntentPath, JSON.stringify(templateAdoptionIntent)],
    [
      join(repositoryRoot, "packages", "create-vireo", "fixtures", "release-identity.json"),
      JSON.stringify({
        schemaVersion: 1,
        createVireoVersion,
        templateStarterJvmBaseline,
        generatedStarterJvmVersion: jvmVersion,
      }),
    ],
    [packageLockPath, JSON.stringify(packageLock)],
    [compatibilityPath, currentReleaseGuidance?.compatibilityMarkdown ?? compatibilityMarkdown],
    [portalPath, portal],
    ...(currentReleaseGuidance?.outputs ?? []),
    ...jvmBomDocumentationOutputs,
    ...siteOutputs,
  ];
  const formatted = await Promise.all(
    outputs.map(([path, content]) => formatOutputDocument({ path, content, formatOutput })),
  );
  for (const [path, content] of formatted) writeFileSync(path, content);

  const snapshotFunctions = createSnapshotArchive && serializeSnapshot ? undefined : await import("../site/build.mjs");
  writeCurrentDocumentationSnapshot({
    repositoryRoot,
    currentDocumentation,
    createSnapshotArchive: createSnapshotArchive ?? snapshotFunctions.createCurrentSnapshotArchive,
    serializeSnapshot: serializeSnapshot ?? snapshotFunctions.serializeSnapshotArchive,
  });
  writeDocumentationSiteReleaseImpact({ repositoryRoot, currentDocumentation });
}

async function formatOutputDocument({ path, content, formatOutput }) {
  if (formatOutput) return [path, await formatOutput({ path, content })];
  const { format, resolveConfig } = await import("prettier");
  const prettierOptions = (await resolveConfig(path)) ?? {};
  return [path, await format(content, { ...prettierOptions, filepath: path })];
}

function synchronizeJvmBomDocumentation({ repositoryRoot, priorCurrentJvmVersion, jvmVersion }) {
  const documents = [
    { path: "docs/PUBLIC_API.md", coordinateReferences: 1, mavenReferences: 0 },
    { path: "jvm/README.md", coordinateReferences: 1, mavenReferences: 0 },
    { path: "jvm/vireo-auth/README.md", coordinateReferences: 1, mavenReferences: 1 },
    { path: "jvm/vireo-bom/README.md", coordinateReferences: 1, mavenReferences: 1 },
    { path: "jvm/vireo-core/README.md", coordinateReferences: 1, mavenReferences: 1 },
    { path: "jvm/vireo-offline/README.md", coordinateReferences: 1, mavenReferences: 0 },
    { path: "jvm/vireo-query/README.md", coordinateReferences: 1, mavenReferences: 0 },
  ];
  const priorCoordinate = `com.vireocode:vireo-bom:${priorCurrentJvmVersion}`;
  const currentCoordinate = `com.vireocode:vireo-bom:${jvmVersion}`;
  const priorMavenCoordinate = `<artifactId>vireo-bom</artifactId>\n      <version>${priorCurrentJvmVersion}</version>`;
  const currentMavenCoordinate = `<artifactId>vireo-bom</artifactId>\n      <version>${jvmVersion}</version>`;
  return documents.map(({ path, coordinateReferences, mavenReferences }) => {
    const documentPath = join(repositoryRoot, path);
    let content = replaceExactCount(
      readFileSync(documentPath, "utf8"),
      priorCoordinate,
      currentCoordinate,
      coordinateReferences,
      `${path} current JVM BOM coordinate`,
    );
    if (mavenReferences > 0) {
      content = replaceExactCount(
        content,
        priorMavenCoordinate,
        currentMavenCoordinate,
        mavenReferences,
        `${path} current Maven BOM coordinate`,
      );
    }
    return [documentPath, content];
  });
}

function finalizeTemplateAdoptionIntent({ intent, createVireoVersion, templateCommit, jvmVersion, releaseId }) {
  if (intent?.status === "adopted") return;
  if (
    intent?.status !== "candidate" ||
    intent?.createVireoVersion !== createVireoVersion ||
    intent?.template?.commit !== templateCommit ||
    intent?.template?.version !== createVireoVersion ||
    intent?.maven?.version !== jvmVersion ||
    intent?.ecosystemRelease !== releaseId
  ) {
    throw new Error("Template adoption receipt is not exact enough to finalize the create-vireo release.");
  }
  intent.status = "adopted";
}

function writeCurrentDocumentationSnapshot({
  repositoryRoot,
  currentDocumentation,
  createSnapshotArchive,
  serializeSnapshot,
}) {
  const archive = createSnapshotArchive({ root: repositoryRoot });
  if (archive.documentationVersion !== currentDocumentation.documentationVersion) {
    throw new Error("Current documentation snapshot version does not match the synchronized documentation release");
  }
  const serialized = serializeSnapshot(archive);
  const snapshotPath = join(
    repositoryRoot,
    "site",
    "content",
    "snapshots",
    `${currentDocumentation.documentationVersion}.json`,
  );
  writeFileSync(snapshotPath, `${JSON.stringify(serialized, null, 2)}\n`);
}

function writeDocumentationSiteReleaseImpact({ repositoryRoot, currentDocumentation }) {
  const coordinateDigest = createHash("sha256").update(stableJson(currentDocumentation)).digest("hex");
  const releaseId = currentDocumentation.id;
  const record = {
    schemaVersion: 1,
    artifact: "application:documentation-site",
    decision: "release",
    bump: "deploy",
    summary: `Deploy the synchronized Vireo documentation snapshot for ${releaseId} (${coordinateDigest}).`,
  };
  const directory = join(repositoryRoot, ".release-impact");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "documentation-site-current-release.json"), `${JSON.stringify(record, null, 2)}\n`);
}

function validateSynchronizedReleaseCoordinate({ createVireoVersion, currentDocumentation, jvmVersion }) {
  if (!isStableSemver(createVireoVersion)) {
    throw new Error("create-vireo must declare a stable semantic version before documentation synchronization");
  }
  if (!isStableSemver(jvmVersion)) {
    throw new Error(
      "jvm/gradle.properties must declare a stable semantic version before documentation synchronization",
    );
  }
  if (!isFriendlyDocumentationVersion(currentDocumentation.documentationVersion)) {
    throw new Error("Current documentation release must declare a friendly 0.x documentationVersion");
  }
  if (!isDocumentationReleaseId(currentDocumentation.id)) {
    throw new Error("Current documentation release must declare a safe npm-<version>_jvm-<version> ID");
  }
  const releaseId = `npm-${createVireoVersion}_jvm-${jvmVersion}`;
  if (!isDocumentationReleaseId(releaseId)) {
    throw new Error("Synchronized documentation release ID is not safe");
  }
  return releaseId;
}

function isStableSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value ?? "");
}

function isFriendlyDocumentationVersion(value) {
  return /^0\.\d+$/u.test(value ?? "");
}

function isDocumentationReleaseId(value) {
  return /^npm-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)_jvm-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(
    value ?? "",
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(entry => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function finalizeCandidateUpgrade({ upgradePolicy, projectUpgrade, createVireoVersion, templateCommit }) {
  const graph = upgradePolicy.releaseGraph;
  if (!graph?.candidateRelease) return;
  const candidateRelease = graph.candidateRelease;
  if (createVireoVersion !== candidateRelease) {
    throw new Error(
      `Candidate upgrade release ${candidateRelease} cannot finalize until create-vireo is versioned to the same release`,
    );
  }
  const current = graph.releases?.find(release => release.release === graph.publicRelease);
  const candidate = graph.releases?.find(release => release.release === candidateRelease);
  const currentCoordinate = projectUpgrade.releaseCoordinates?.[graph.publicRelease];
  const candidateCoordinate = projectUpgrade.releaseCoordinates?.[candidateRelease];
  if (
    !current ||
    current.status !== "current" ||
    !/^[a-f0-9]{40}$/u.test(current.templateCommit ?? "") ||
    !candidate ||
    candidate.status !== "candidate" ||
    candidate.templateCommit !== templateCommit ||
    !/^[a-f0-9]{40}$/u.test(templateCommit) ||
    !graph.edges?.some(edge => edge.from === current.release && edge.to === candidate.release) ||
    projectUpgrade.publicationState !== "candidate" ||
    projectUpgrade.publicRelease !== current.release ||
    projectUpgrade.candidateRelease !== candidate.release ||
    projectUpgrade.previousRelease !== current.release ||
    projectUpgrade.finalization?.targetTemplateCommit !== templateCommit ||
    currentCoordinate?.status !== "current" ||
    candidateCoordinate?.status !== "candidate" ||
    candidateCoordinate?.templateCommit !== templateCommit
  ) {
    throw new Error("Candidate project-upgrade release is not ready for immutable finalization");
  }

  current.status = "historical";
  candidate.status = "current";
  graph.publicRelease = candidate.release;
  graph.previousRelease = current.release;
  delete graph.candidateRelease;

  currentCoordinate.status = "historical";
  candidateCoordinate.status = "current";
  projectUpgrade.publicRelease = candidate.release;
  projectUpgrade.previousRelease = current.release;
  projectUpgrade.publicationState = "final";
  delete projectUpgrade.candidateRelease;
  delete projectUpgrade.finalization;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function updatePublicWorkspaceLockEntries(packageLock, publicWorkspacePackages) {
  if (!packageLock.packages || typeof packageLock.packages !== "object") {
    throw new Error("Root package-lock.json must declare workspace package entries");
  }
  for (const { directory, name, version } of publicWorkspacePackages) {
    const path = `packages/${directory}`;
    const entry = packageLock.packages[path];
    if (!entry || typeof entry !== "object") {
      throw new Error(`Root package-lock.json is missing public workspace entry ${path} (${name})`);
    }
    entry.version = version;
  }
}

function replaceCurrentTemplateReferencesInSite(
  repositoryRoot,
  oldTemplateCommit,
  templateCommit,
  oldTemplateVersion,
  templateVersion,
) {
  if (oldTemplateCommit === templateCommit && oldTemplateVersion === templateVersion) return [];
  const currentReferences = [
    { path: "content/offline.md", commits: 2, versionReference: `pinned ${oldTemplateVersion} Template` },
    {
      path: "content/design-system-overview.md",
      commits: 7,
      versionReference: `current ${oldTemplateVersion} Template`,
    },
    { path: "content/manifest.json", commits: 9 },
    { path: "verify.mjs", commits: 2 },
    { path: "build.test.mjs", commits: 2 },
  ];
  return currentReferences.map(reference => {
    const path = join(repositoryRoot, "site", reference.path);
    let content = replaceExactCount(
      readFileSync(path, "utf8"),
      oldTemplateCommit,
      templateCommit,
      reference.commits,
      `site/${reference.path} current Template commit`,
    );
    if (reference.versionReference) {
      content = replaceRequired(
        content,
        reference.versionReference,
        reference.versionReference.replace(oldTemplateVersion, templateVersion),
        `site/${reference.path} current Template version`,
      );
    }
    return [path, content];
  });
}

function synchronizeCurrentReleaseGuidance({
  repositoryRoot,
  compatibilityMarkdown,
  oldTemplateCommit,
  templateCommit,
  oldTemplateVersion,
  templateVersion,
  priorHistoricalUpgradeRelease,
  priorPublicUpgradeRelease,
  publicUpgradeRelease,
  candidateUpgradeRelease,
  candidateLockfileRefresh,
  jvmVersion,
}) {
  if (!priorPublicUpgradeRelease || !publicUpgradeRelease || !candidateUpgradeRelease) {
    throw new Error("Candidate finalization must retain the prior public project-upgrade edge");
  }
  const historicalEdge = `${priorPublicUpgradeRelease}→${publicUpgradeRelease}`;
  const currentEdge = `${publicUpgradeRelease}→${candidateUpgradeRelease}`;
  let updatedCompatibility = replaceRequired(
    compatibilityMarkdown,
    `edge is ${historicalEdge};`,
    `edge is ${currentEdge}; ${historicalEdge} remains retained historical evidence;`,
    "docs/COMPATIBILITY.md current project-upgrade edge",
  );
  updatedCompatibility = replaceCurrentTemplateBaseline(
    updatedCompatibility,
    oldTemplateVersion,
    templateVersion,
    publicUpgradeRelease,
    candidateUpgradeRelease,
    jvmVersion,
    "docs/COMPATIBILITY.md current Template baseline",
  );

  const createReadmePath = join(repositoryRoot, "packages", "create-vireo", "README.md");
  let createReadme = readFileSync(createReadmePath, "utf8").replaceAll(oldTemplateCommit, templateCommit);
  createReadme = replaceRequired(
    createReadme,
    `The current supported adjacent release pair is a project created by \`create-vireo\`\n${priorPublicUpgradeRelease} upgraded to ${publicUpgradeRelease}.`,
    `The current supported adjacent release pair is a project created by \`create-vireo\`\n${publicUpgradeRelease} upgraded to ${candidateUpgradeRelease}. The ${historicalEdge} edge remains historical evidence.`,
    "packages/create-vireo/README.md current project-upgrade pair",
  );
  for (const mode of ["--dry-run", "--apply --accept-application-owned"]) {
    createReadme = replaceRequired(
      createReadme,
      `vireo upgrade --to ${publicUpgradeRelease} ${mode}`,
      `vireo upgrade --to ${candidateUpgradeRelease} ${mode}`,
      `packages/create-vireo/README.md current ${mode} command`,
    );
  }
  createReadme = replacePatternOnce(
    createReadme,
    /wire-contract drift\. Apply changes only (?:Vireo-managed metadata and the pinned CLI\s+script|the managed surfaces explicitly declared by\s+the selected edge)\./u,
    "wire-contract drift. Apply changes only the managed surfaces explicitly declared by the selected edge.",
    "packages/create-vireo/README.md managed edge scope",
  );
  createReadme = replacePatternOnce(
    createReadme,
    /For the current \d+\.\d+\.\d+→\d+\.\d+\.\d+\nedge, Vireo [\s\S]*?\.github`\s*review policy\./u,
    `For the current ${currentEdge}\nedge, Vireo applies only the declared managed edge surfaces, including dependency declarations and release identity/provenance where the edge declares them. ${candidateLockfileRefresh === "required" ? "The lockfile remains application-owned and must be refreshed manually." : "This edge changes no dependency declarations, so Vireo preserves the application-owned lockfile without a refresh."} Vireo never overwrites the application-owned root\n\`AGENTS.md\`, source, deployment descriptors, or \`.github\` review policy.`,
    "packages/create-vireo/README.md current managed edge description",
  );
  createReadme = replaceCurrentTemplateBaseline(
    createReadme,
    oldTemplateVersion,
    templateVersion,
    publicUpgradeRelease,
    candidateUpgradeRelease,
    jvmVersion,
    "packages/create-vireo/README.md current Template baseline",
  );

  const npmReleasePath = join(repositoryRoot, "docs", "NPM_RELEASE.md");
  const npmRelease = replaceRequired(
    readFileSync(npmReleasePath, "utf8"),
    `\`starter-template@${oldTemplateVersion}\` release is already published`,
    `\`starter-template@${templateVersion}\` release is already published`,
    "docs/NPM_RELEASE.md current Template release prerequisite",
  );
  const additionalGuidanceOutputs = synchronizeAdditionalCurrentGuidance({
    repositoryRoot,
    oldTemplateCommit,
    templateCommit,
    oldTemplateVersion,
    templateVersion,
    priorHistoricalUpgradeRelease,
    priorPublicUpgradeRelease,
    publicUpgradeRelease,
    candidateUpgradeRelease,
  });
  return {
    compatibilityMarkdown: updatedCompatibility,
    outputs: [[createReadmePath, createReadme], [npmReleasePath, npmRelease], ...additionalGuidanceOutputs],
  };
}

function synchronizeAdditionalCurrentGuidance({
  repositoryRoot,
  oldTemplateCommit,
  templateCommit,
  oldTemplateVersion,
  templateVersion,
  priorHistoricalUpgradeRelease,
  priorPublicUpgradeRelease,
  publicUpgradeRelease,
  candidateUpgradeRelease,
}) {
  const historicalEdge = `${priorPublicUpgradeRelease}→${publicUpgradeRelease}`;
  const currentEdge = `${publicUpgradeRelease}→${candidateUpgradeRelease}`;
  const historicalHyphenEdge = `${priorPublicUpgradeRelease}-to-${publicUpgradeRelease}`;
  const currentHyphenEdge = `${publicUpgradeRelease}-to-${candidateUpgradeRelease}`;
  const retainedBacklogSuffix = priorHistoricalUpgradeRelease
    ? `; ${escapeRegExp(`${priorHistoricalUpgradeRelease}→${priorPublicUpgradeRelease}`)} remains retained historical evidence`
    : "";
  const frontendProfilePath = join(repositoryRoot, "docs", "architecture", "frontend-only-profile.md");
  let frontendProfile = replaceRequired(
    readFileSync(frontendProfilePath, "utf8"),
    `is \`create-vireo@${publicUpgradeRelease}\`.`,
    `is \`create-vireo@${candidateUpgradeRelease}\`.`,
    "docs/architecture/frontend-only-profile.md current profile contract",
  );
  frontendProfile = replaceRequired(
    frontendProfile,
    `The public \`create-vireo@${publicUpgradeRelease}\` CLI unit suite`,
    `The public \`create-vireo@${candidateUpgradeRelease}\` CLI unit suite`,
    "docs/architecture/frontend-only-profile.md current profile evidence",
  );

  const generatedOwnershipPath = join(repositoryRoot, "docs", "architecture", "generated-code-ownership.md");
  const generatedOwnership = replaceRequired(
    readFileSync(generatedOwnershipPath, "utf8"),
    `The current supported ${historicalHyphenEdge} project upgrade admits declared manifests without\nregeneration.`,
    `The current supported ${currentHyphenEdge} project upgrade admits declared manifests without\nregeneration. The ${historicalHyphenEdge} edge remains retained historical evidence.`,
    "docs/architecture/generated-code-ownership.md current project-upgrade edge",
  );

  const phaseBacklogPath = join(repositoryRoot, "docs", "roadmap", "phase-4", "backlog.md");
  const phaseBacklog = replacePatternOnce(
    readFileSync(phaseBacklogPath, "utf8"),
    new RegExp(
      `The current public \`create-vireo@${escapeRegExp(publicUpgradeRelease)}\` line and its supported ${escapeRegExp(historicalEdge)}\\nadjacent upgrade fixture are complete${retainedBacklogSuffix}\\.`,
      "u",
    ),
    `The current public \`create-vireo@${candidateUpgradeRelease}\` line and its supported ${currentEdge}\nadjacent upgrade fixture are complete; ${historicalEdge} remains retained historical evidence.`,
    "docs/roadmap/phase-4/backlog.md current release contract",
  );

  const readinessPath = join(repositoryRoot, "docs", "roadmap", "phase-4", "production-readiness-criteria.md");
  const readinessCriteria = replaceRequired(
    readFileSync(readinessPath, "utf8"),
    `Public \`create-vireo\` ${publicUpgradeRelease} declares the current ${historicalEdge} edge with dry run, explicit apply, refusal, ownership and rollback guidance;`,
    `Public \`create-vireo\` ${candidateUpgradeRelease} declares the current ${currentEdge} edge with dry run, explicit apply, refusal, ownership and rollback guidance;`,
    "docs/roadmap/phase-4/production-readiness-criteria.md current release compatibility",
  );

  const humanHandoffPath = join(repositoryRoot, "docs", "roadmap", "public-beta-human-handoff-2026-09-01.md");
  let humanHandoff = replaceRequired(
    readFileSync(humanHandoffPath, "utf8"),
    `For a new frontend app, use the release-prepared ${publicUpgradeRelease} generator rather than cloning either`,
    `For a new frontend app, use the release-prepared ${candidateUpgradeRelease} generator rather than cloning either`,
    "docs/roadmap/public-beta-human-handoff-2026-09-01.md current generator prose",
  );
  humanHandoff = replaceRequired(
    humanHandoff,
    `npm create vireo@${publicUpgradeRelease} my-frontend-app -- --profile frontend --yes`,
    `npm create vireo@${candidateUpgradeRelease} my-frontend-app -- --profile frontend --yes`,
    "docs/roadmap/public-beta-human-handoff-2026-09-01.md current generator command",
  );

  const remainingWorkPath = join(repositoryRoot, "docs", "roadmap", "remaining-non-human-work.md");
  const remainingWork = replaceRequired(
    readFileSync(remainingWorkPath, "utf8"),
    `the current release-prepared frontend profile is \`create-vireo@${publicUpgradeRelease}\`.`,
    `the current release-prepared frontend profile is \`create-vireo@${candidateUpgradeRelease}\`.`,
    "docs/roadmap/remaining-non-human-work.md current release",
  );

  const phaseTwoBacklogPath = join(repositoryRoot, "docs", "roadmap", "phase-2", "backlog.md");
  const phaseTwoBacklog = replaceRequired(
    readFileSync(phaseTwoBacklogPath, "utf8"),
    `Done; \`create-vireo@${publicUpgradeRelease}\` is public, anonymously verified, and attested`,
    `Done; \`create-vireo@${candidateUpgradeRelease}\` is public, anonymously verified, and attested`,
    "docs/roadmap/phase-2/backlog.md current public verified coordinate",
  );

  const gapRegisterPath = join(repositoryRoot, "docs", "roadmap", "phase-0", "gap-register.md");
  const gapRegister = replaceRequired(
    readFileSync(gapRegisterPath, "utf8"),
    `Public \`create-vireo\` ${publicUpgradeRelease} declares the current ${historicalEdge} dry-run/apply/refusal/ownership edge; frontend/full-stack fixtures exercise the transactional managed additions and sample-removal provenance while preserving application-owned source. Earlier supported pairs remain retained historical evidence`,
    `Public \`create-vireo\` ${candidateUpgradeRelease} declares the current ${currentEdge} dry-run/apply/refusal/ownership edge; frontend/full-stack fixtures exercise the transactional managed additions and sample-removal provenance while preserving application-owned source. Earlier supported pairs remain retained historical evidence`,
    "docs/roadmap/phase-0/gap-register.md current adjacent release edge",
  );

  const topologyPath = join(repositoryRoot, "docs", "roadmap", "phase-0", "repository-topology.md");
  const topology = replaceRequired(
    readFileSync(topologyPath, "utf8"),
    `Canonical Template implementation at immutable ${oldTemplateVersion} commit \`${oldTemplateCommit}\``,
    `Canonical Template implementation at immutable ${templateVersion} commit \`${templateCommit}\``,
    "docs/roadmap/phase-0/repository-topology.md current Template release",
  );
  return [
    [frontendProfilePath, frontendProfile],
    [generatedOwnershipPath, generatedOwnership],
    [phaseBacklogPath, phaseBacklog],
    [readinessPath, readinessCriteria],
    [humanHandoffPath, humanHandoff],
    [remainingWorkPath, remainingWork],
    [phaseTwoBacklogPath, phaseTwoBacklog],
    [gapRegisterPath, gapRegister],
    [topologyPath, topology],
  ];
}

function replaceCurrentTemplateBaseline(
  markdown,
  oldTemplateVersion,
  templateVersion,
  publicUpgradeRelease,
  candidateUpgradeRelease,
  jvmVersion,
  label,
) {
  const stableSemverCapture = "((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*))";
  const pattern = new RegExp(
    "The immutable `starter-template@" +
      escapeRegExp(oldTemplateVersion) +
      "` source baseline uses\\n`starterVersion=" +
      stableSemverCapture +
      "`; `create-vireo@" +
      escapeRegExp(publicUpgradeRelease) +
      "` generates and upgrades\\nfull-stack consumers with the coordinated `\\1` JVM release\\.",
    "u",
  );
  const replacement = `The immutable \`starter-template@${templateVersion}\` source baseline uses\n\`starterVersion=${jvmVersion}\`; \`create-vireo@${candidateUpgradeRelease}\` generates and upgrades\nfull-stack consumers with the coordinated \`${jvmVersion}\` JVM release.`;
  return replacePatternOnce(markdown, pattern, replacement, label);
}

function replaceRequired(markdown, from, to, label) {
  return replaceExactCount(markdown, from, to, 1, label);
}

function replaceExactCount(markdown, from, to, expectedCount, label) {
  const matches = markdown.split(from).length - 1;
  if (matches !== expectedCount)
    throw new Error(`${label} must contain exactly ${expectedCount} current-state reference(s)`);
  return markdown.replaceAll(from, to);
}

function replacePatternOnce(markdown, pattern, replacement, label) {
  const matches = [...markdown.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label} must contain exactly one current-state reference`);
  return markdown.replace(pattern, replacement);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function updateNpmEntries(entries, packageVersions, label, nameKey = "name") {
  if (!Array.isArray(entries)) throw new Error(`${label} npm artifacts are not declared`);
  const declaredNames = new Set(entries.map(entry => entry[nameKey]));
  const workspaceNames = new Set(packageVersions.keys());
  if (
    declaredNames.size !== entries.length ||
    declaredNames.size !== workspaceNames.size ||
    [...workspaceNames].some(name => !declaredNames.has(name))
  ) {
    throw new Error(`${label} npm artifacts do not match the public workspaces`);
  }
  for (const entry of entries) entry.version = packageVersions.get(entry[nameKey]);
}

function updateReleaseReferences(lines, oldReleaseId, nextReleaseId) {
  if (!Array.isArray(lines)) throw new Error("Release support lines are not declared");
  let replacements = 0;
  for (const line of lines) {
    if (line.release !== oldReleaseId) continue;
    line.release = nextReleaseId;
    replacements += 1;
  }
  if (replacements === 0) throw new Error(`No support line references current release ${oldReleaseId}`);
}

function replaceMarkdownTableVersion(markdown, artifact, version, path) {
  let matches = 0;
  const lines = markdown.split("\n").map(line => {
    if (!line.startsWith("|")) return line;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map(cell => cell.trim());
    if (cells.length < 2 || !cells[0].includes(artifact)) return line;
    matches += 1;
    cells[1] = version;
    return `| ${cells.join(" | ")} |`;
  });
  if (matches !== 1) throw new Error(`${path} must contain exactly one table row for ${artifact}`);
  return lines.join("\n");
}
