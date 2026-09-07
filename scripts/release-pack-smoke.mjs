import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertPackedProjectUpgradeBaselines,
  managedConsumerSkillPaths,
} from "./lib/packed-project-upgrade-baselines.mjs";
import { packedAdjacentFrontendSourceManifest } from "./lib/packed-adjacent-frontend-source-manifest.mjs";
import { assertPackableProjectUpgrade } from "./lib/project-upgrade-publication-state.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = join(repoRoot, "packages");
const rootNodeModules = join(repoRoot, "node_modules");
const rootLicense = readFileSync(join(repoRoot, "LICENSE"), "utf8");
const expectedRepositoryUrl = "git+https://github.com/vireocodedev/vireo.git";
const expectedRegistry = "https://registry.npmjs.org";
const portabilityPolicy = JSON.parse(readFileSync(join(repoRoot, "contracts/package-portability-policy.json"), "utf8"));
const projectUpgradeContract = JSON.parse(
  readFileSync(join(repoRoot, "contracts/project-upgrade-policy.json"), "utf8"),
);
const ecosystemContract = JSON.parse(readFileSync(join(repoRoot, "contracts/ecosystem-release-contract.json"), "utf8"));
const releasePackMode = process.env.VIREO_RELEASE_PACK_MODE ?? "merge";
const installLifecycleScripts = ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"];
const forbiddenPackedPath =
  /(?:^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|\.npmrc$|__tests__(?:\/|$)|coverage(?:\/|$)|node_modules(?:\/|$)|src(?:\/|$)|storybook-static(?:\/|$)|tests?(?:\/|$))/iu;
const sensitivePackedContent = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bnpm_[A-Za-z0-9]{20,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
  /(?:(?<![A-Za-z0-9._-])\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/u,
];

function publishedPackages() {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const directory = join(packagesRoot, entry.name);
      const manifestPath = join(directory, "package.json");
      if (!existsSync(manifestPath)) return undefined;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      return manifest.private ? undefined : { directory, manifest };
    })
    .filter(Boolean);
}

function entryTargets(target) {
  if (typeof target === "string") return [target];
  if (!target || typeof target !== "object") return [];
  return [target.types, target.import, target.default].filter(value => typeof value === "string");
}

function packageSpecifiers(manifest) {
  return Object.keys(manifest.exports ?? { ".": manifest.main }).map(subpath =>
    subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
  );
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function createPackMetadata(packageDirectory, tarballPath, manifest) {
  const files = walkFiles(packageDirectory).map(file => ({
    path: relative(packageDirectory, file).replaceAll("\\", "/"),
    size: statSync(file).size,
  }));
  const tarball = readFileSync(tarballPath);
  return {
    name: manifest.name,
    size: tarball.length,
    unpackedSize: files.reduce((total, file) => total + file.size, 0),
    shasum: createHash("sha1").update(tarball).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    files,
    entryCount: files.length,
  };
}

function validateManifest(sourceDirectory, sourceManifest, packedManifest) {
  const expectedDirectory = relative(repoRoot, sourceDirectory).replaceAll("\\", "/");
  if (packedManifest.name !== sourceManifest.name || packedManifest.version !== sourceManifest.version) {
    throw new Error(`${sourceManifest.name} packed identity differs from its source manifest.`);
  }
  if (packedManifest.private === true) throw new Error(`${sourceManifest.name} is marked private.`);
  if (packedManifest.license !== "MIT") throw new Error(`${sourceManifest.name} must declare the MIT license.`);
  if (typeof packedManifest.description !== "string" || packedManifest.description.trim() === "") {
    throw new Error(`${sourceManifest.name} must have a package description.`);
  }
  if (
    packedManifest.repository?.type !== "git" ||
    packedManifest.repository?.url !== expectedRepositoryUrl ||
    packedManifest.repository?.directory !== expectedDirectory
  ) {
    throw new Error(`${sourceManifest.name} has incomplete or incorrect repository metadata.`);
  }
  if (packedManifest.publishConfig?.registry !== expectedRegistry) {
    throw new Error(`${sourceManifest.name} does not target the reviewed package registry.`);
  }
  if (packedManifest.publishConfig?.access !== "public") {
    throw new Error(`${sourceManifest.name} does not explicitly publish with public access.`);
  }
  if (packedManifest.publishConfig?.provenance !== true) {
    throw new Error(`${sourceManifest.name} does not require npm provenance.`);
  }
  const expectedFiles = sourceManifest.name === "create-vireo" ? ["dist", "schema"] : ["dist"];
  if (JSON.stringify(packedManifest.files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${sourceManifest.name} must publish only its reviewed file allowlist.`);
  }
  if (
    packedManifest.name === "@vireocodedev/ui" &&
    !packedManifest.sideEffects?.includes("./dist/integrations/localization/services/dayjsSetup.js")
  ) {
    throw new Error("@vireocodedev/ui must preserve its Day.js runtime initialization during tree shaking.");
  }
  const unsafeScripts = installLifecycleScripts.filter(script => packedManifest.scripts?.[script]);
  if (unsafeScripts.length > 0) {
    throw new Error(`${sourceManifest.name} publishes install lifecycle hooks: ${unsafeScripts.join(", ")}`);
  }
}

function validatePackageContents(packageDirectory, sourceDirectory, sourceManifest, packMetadata) {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  validateManifest(sourceDirectory, sourceManifest, manifest);

  const files = readdirSync(packageDirectory, { withFileTypes: true });
  const allowedDirectories = new Set(["dist", ...(manifest.name === "create-vireo" ? ["schema"] : [])]);
  const unexpected = files
    .map(entry => entry.name)
    .filter(name => !allowedDirectories.has(name) && name !== "package.json" && !/^(?:README|LICENSE)/iu.test(name));
  if (unexpected.length > 0) {
    throw new Error(`${manifest.name} publishes unexpected top-level files: ${unexpected.join(", ")}`);
  }

  for (const required of ["README.md", "LICENSE"]) {
    if (!existsSync(join(packageDirectory, required))) {
      throw new Error(`${manifest.name} tarball is missing ${required}.`);
    }
  }
  if (manifest.name === "create-vireo" && !existsSync(join(packageDirectory, "schema/vireo-entity.schema.json"))) {
    throw new Error("create-vireo must publish its canonical entity schema.");
  }
  if (manifest.name === "create-vireo" && !existsSync(join(packageDirectory, "schema/vireo-upgrade-policy.json"))) {
    throw new Error("create-vireo must publish its project upgrade policy.");
  }
  if (manifest.name === "create-vireo") {
    const upgradePolicy = JSON.parse(readFileSync(join(packageDirectory, "schema/vireo-upgrade-policy.json"), "utf8"));
    assertPackableProjectUpgrade(projectUpgradeContract, upgradePolicy, releasePackMode);
    const graph = upgradePolicy.releaseGraph;
    if (
      upgradePolicy.schemaVersion !== 2 ||
      !graph?.edges?.some(
        edge => edge.from === graph.previousRelease && edge.to === (graph.candidateRelease ?? graph.publicRelease),
      ) ||
      !graph?.releases?.some(release => release.release === graph.publicRelease && release.status === "current")
    ) {
      throw new Error("create-vireo must pack an executable adjacent project-upgrade graph.");
    }
  }
  if (readFileSync(join(packageDirectory, "LICENSE"), "utf8") !== rootLicense) {
    throw new Error(`${manifest.name} publishes license text that differs from the repository license.`);
  }

  const forbiddenPaths = packMetadata.files.map(file => file.path).filter(path => forbiddenPackedPath.test(path));
  if (forbiddenPaths.length > 0) {
    throw new Error(`${manifest.name} publishes forbidden paths: ${forbiddenPaths.join(", ")}`);
  }
  const packedFiles = walkFiles(packageDirectory);
  for (const file of packedFiles) {
    const contents = readFileSync(file);
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    if (sensitivePackedContent.some(pattern => pattern.test(text))) {
      throw new Error(`${manifest.name} publishes sensitive content in ${relative(packageDirectory, file)}.`);
    }
  }

  const sourceMaps = packedFiles.filter(file => file.endsWith(".map"));
  const sourceMapDisposition = portabilityPolicy.sourceMaps.packages[sourceManifest.name];
  if (!sourceMapDisposition) {
    throw new Error(`${sourceManifest.name} has no source-map disposition in the portability policy.`);
  }
  if (sourceMapDisposition === "required" && sourceMaps.length === 0) {
    throw new Error(`${sourceManifest.name} must publish its reviewed source maps.`);
  }
  if (sourceMapDisposition === "forbidden" && sourceMaps.length > 0) {
    throw new Error(`${sourceManifest.name} must not publish source maps.`);
  }
  for (const sourceMapPath of sourceMaps) {
    let sourceMap;
    try {
      sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"));
    } catch {
      throw new Error(
        `${sourceManifest.name} publishes an invalid source map at ${relative(packageDirectory, sourceMapPath)}.`,
      );
    }
    if (sourceMap.version !== 3 || !Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
      throw new Error(
        `${sourceManifest.name} publishes a malformed v3 source map at ${relative(packageDirectory, sourceMapPath)}.`,
      );
    }
    if (
      portabilityPolicy.sourceMaps.requireRelativeSources &&
      sourceMap.sources.some(
        source =>
          typeof source !== "string" ||
          source.startsWith("/") ||
          source.startsWith("file:") ||
          /^[A-Za-z]:[\\/]/u.test(source),
      )
    ) {
      throw new Error(
        `${sourceManifest.name} publishes an absolute source path in ${relative(packageDirectory, sourceMapPath)}.`,
      );
    }
    if (!portabilityPolicy.sourceMaps.allowSourcesContent && sourceMap.sourcesContent != null) {
      throw new Error(`${sourceManifest.name} embeds source content contrary to the portability policy.`);
    }
  }

  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    const targets = entryTargets(target);
    if (targets.length === 0) throw new Error(`${manifest.name} ${subpath} has no publishable export target.`);
    for (const targetPath of targets) {
      if (!existsSync(join(packageDirectory, targetPath))) {
        throw new Error(`${manifest.name} ${subpath} points to missing packed file ${targetPath}.`);
      }
    }
  }

  return manifest;
}

function installedVersion(name, packageDirectories = []) {
  const manifestPath = [rootNodeModules, ...packageDirectories.map(directory => join(directory, "node_modules"))]
    .map(nodeModules => join(nodeModules, name, "package.json"))
    .find(existsSync);
  if (!manifestPath) {
    throw new Error(`The clean-consumer fixture requires ${name}; run npm ci first.`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")).version;
}

function externalRuntimeVersions(packages) {
  const names = new Set();
  const packageDirectories = packages.map(({ directory }) => directory);
  for (const { manifest } of packages) {
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (!name.startsWith("@vireocodedev/")) names.add(name);
      }
    }
  }
  return Object.fromEntries([...names].sort().map(name => [name, installedVersion(name, packageDirectories)]));
}

const auditRoot = mkdtempSync(join(tmpdir(), "starter-release-smoke-"));
const tarballRoot = join(auditRoot, "tarballs");
const consumerRoot = join(auditRoot, "consumer");
const consumerNodeModules = join(consumerRoot, "node_modules");

try {
  mkdirSync(tarballRoot, { recursive: true });
  mkdirSync(consumerRoot, { recursive: true });

  execFileSync(
    "corepack",
    ["npm", "pack", "--workspaces", "--pack-destination", tarballRoot, "--ignore-scripts", "--silent"],
    {
      cwd: repoRoot,
      env: { ...process.env, npm_config_cache: join(auditRoot, "npm-cache") },
      stdio: "ignore",
    },
  );

  const packages = publishedPackages();
  const tarballs = readdirSync(tarballRoot).filter(file => file.endsWith(".tgz"));
  if (tarballs.length !== packages.length) {
    throw new Error(`Expected ${packages.length} tarballs, but npm produced ${tarballs.length}.`);
  }

  const localPackages = Object.fromEntries(
    packages.map(({ manifest }) => {
      const filename = `${manifest.name.replace(/^@/u, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
      return [manifest.name, `file:${join(tarballRoot, filename)}`];
    }),
  );
  const packageDirectories = packages.map(({ directory }) => directory);
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "vireo-packed-consumer",
        private: true,
        type: "module",
        dependencies: { ...externalRuntimeVersions(packages), ...localPackages },
        devDependencies: {
          "@types/react-transition-group": installedVersion("@types/react-transition-group", packageDirectories),
          typescript: installedVersion("typescript", packageDirectories),
          vite: installedVersion("vite", packageDirectories),
        },
      },
      null,
      2,
    )}\n`,
  );
  execFileSync(
    "corepack",
    ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--strict-peer-deps"],
    {
      cwd: consumerRoot,
      env: { ...process.env, npm_config_cache: join(auditRoot, "consumer-npm-cache") },
      stdio: "inherit",
    },
  );
  execFileSync("corepack", ["npm", "ls", "--all", "--silent"], {
    cwd: consumerRoot,
    env: { ...process.env, npm_config_cache: join(auditRoot, "consumer-npm-cache") },
    stdio: "ignore",
  });

  const nodeSpecifiers = [];
  const browserSpecifiers = [];
  const summary = [];
  for (const { directory: sourceDirectory, manifest: sourceManifest } of packages) {
    const prefix = `${sourceManifest.name.replace(/^@/u, "").replace(/\//gu, "-")}-${sourceManifest.version}`;
    const tarball = tarballs.find(file => file === `${prefix}.tgz`);
    if (!tarball) throw new Error(`No tarball was produced for ${sourceManifest.name}.`);

    const packageDirectory = join(consumerNodeModules, ...sourceManifest.name.split("/"));
    mkdirSync(packageDirectory, { recursive: true });
    execFileSync("tar", ["-xzf", join(tarballRoot, tarball), "-C", packageDirectory, "--strip-components=1"]);

    if (lstatSync(packageDirectory).isSymbolicLink()) {
      throw new Error(`${sourceManifest.name} was linked rather than installed from its tarball.`);
    }
    if (!realpathSync(packageDirectory).startsWith(`${realpathSync(consumerRoot)}/`)) {
      throw new Error(`${sourceManifest.name} resolved outside the isolated consumer.`);
    }
    const metadata = createPackMetadata(packageDirectory, join(tarballRoot, tarball), sourceManifest);
    const packedManifest = validatePackageContents(packageDirectory, sourceDirectory, sourceManifest, metadata);
    const packageEntries = packageSpecifiers(packedManifest);
    if (packedManifest.name === "@vireocodedev/ui") browserSpecifiers.push(...packageEntries);
    else nodeSpecifiers.push(...packageEntries);
    summary.push({
      name: packedManifest.name,
      entries: packageEntries.length,
      files: metadata.entryCount,
      size: metadata.size,
      unpackedSize: metadata.unpackedSize,
      integrity: metadata.integrity,
      tarball,
    });
  }

  const smokeSource = `
    const specifiers = JSON.parse(process.argv[1]);
    const expectedRoot = process.argv[2];
    for (const specifier of specifiers) {
      const resolved = import.meta.resolve(specifier);
      if (!resolved.startsWith(expectedRoot)) {
        throw new Error(specifier + " resolved outside packed consumer: " + resolved);
      }
      await import(specifier);
    }
  `;
  const expectedRoot = pathToFileURL(`${consumerNodeModules}/`).href;
  execFileSync("node", ["--input-type=module", "--eval", smokeSource, JSON.stringify(nodeSpecifiers), expectedRoot], {
    cwd: consumerRoot,
    stdio: "inherit",
  });

  const createPackage = join(consumerNodeModules, "create-vireo");
  const createDryRun = JSON.parse(
    execFileSync(
      "node",
      [
        join(createPackage, "dist/cli.js"),
        join(auditRoot, "generated-smoke"),
        "--yes",
        "--dry-run",
        "--json",
        "--no-git",
      ],
      { cwd: consumerRoot, encoding: "utf8" },
    ),
  );
  if (createDryRun.projectName !== "generated-smoke" || createDryRun.dryRun !== true) {
    throw new Error("The packed create-vireo executable failed its non-writing CLI smoke test.");
  }
  const packedPolicy = JSON.parse(readFileSync(join(createPackage, "schema/vireo-upgrade-policy.json"), "utf8"));
  const packedSource = packedPolicy.releaseGraph.releases.find(
    release => release.release === packedPolicy.releaseGraph.previousRelease,
  );
  const packedTargetRelease = packedPolicy.releaseGraph.candidateRelease ?? packedPolicy.releaseGraph.publicRelease;
  const packedTarget = packedPolicy.releaseGraph.releases.find(release => release.release === packedTargetRelease);
  const rootTarget = projectUpgradeContract.releaseCoordinates?.[packedTarget.release];
  if (
    packedTarget.starterJvmVersion !== ecosystemContract.current?.maven?.version ||
    rootTarget?.starterJvmVersion !== packedTarget.starterJvmVersion
  ) {
    throw new Error(
      "Packed current upgrade JVM target must match both the ecosystem Maven release and root coordinates.",
    );
  }
  const { managedSkillBaselines, skillsAddedByCurrentEdge } = assertPackedProjectUpgradeBaselines(packedPolicy);
  const upgradeFixture = join(auditRoot, "packed-adjacent-upgrade-fixture");
  mkdirSync(join(upgradeFixture, ".vireo"), { recursive: true });
  const upgradeDependencies = { ...packedSource.frontendDependencies, react: "^19.0.0" };
  writeFileSync(
    join(upgradeFixture, "package.json"),
    `${JSON.stringify(
      packedAdjacentFrontendSourceManifest({ packedSource, packedTarget, dependencies: upgradeDependencies }),
      null,
      2,
    )}\n`,
  );
  const activeBaselineKey = `${packedSource.release}->${packedTarget.release}`;
  const activeFrontendBaselines = packedPolicy.releaseGraph.baselines?.[activeBaselineKey]?.frontend ?? [];
  const activeSourceManagedFiles = [];
  for (const baseline of activeFrontendBaselines) {
    if (baseline.operation === "add") continue;
    let sourceBytes = baseline.sourceContent;
    if (sourceBytes === undefined && baseline.path === "scripts/vireo-frontend-doctor.mjs") {
      sourceBytes = readFileSync(
        join(repoRoot, "packages", "create-vireo", "fixtures", "project-upgrades", "vireo-frontend-doctor.0.8.1.mjs"),
        "utf8",
      );
    }
    if (
      typeof sourceBytes !== "string" ||
      createHash("sha256").update(sourceBytes).digest("hex") !== baseline.sourceSha256
    )
      throw new Error(`Packed active source baseline lacks canonical bytes: ${baseline.path}`);
    const path = join(upgradeFixture, baseline.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, sourceBytes);
    activeSourceManagedFiles.push({ path: baseline.path, sha256: baseline.sourceSha256 });
  }
  writeFileSync(
    join(upgradeFixture, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: upgradeDependencies } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(upgradeFixture, ".vireo/project.json"),
    `${JSON.stringify({ schemaVersion: 1, profile: "frontend", projectName: "packed-adjacent-upgrade-fixture", templateCommit: packedSource.templateCommit, createdBy: `create-vireo@${packedSource.release}` }, null, 2)}\n`,
  );
  if (packedSource.release === "0.8.4" && packedTarget.release === "0.8.6") {
    const examplePath = "src/features/item/public.ts";
    const exampleContents = "export type Item = { id: number };\n";
    mkdirSync(dirname(join(upgradeFixture, examplePath)), { recursive: true });
    writeFileSync(join(upgradeFixture, examplePath), exampleContents);
    writeFileSync(
      join(upgradeFixture, ".vireo/example-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          templateCommit: packedSource.templateCommit,
          files: { [examplePath]: createHash("sha256").update(exampleContents).digest("hex") },
        },
        null,
        2,
      )}\n`,
    );
  }
  if (!skillsAddedByCurrentEdge) {
    const activeManagedPaths = new Set(activeSourceManagedFiles.map(file => file.path));
    const retainedSkillBaselines = managedSkillBaselines.filter(baseline => !activeManagedPaths.has(baseline.path));
    for (const baseline of retainedSkillBaselines) {
      const path = join(upgradeFixture, baseline.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, baseline.targetContent);
    }
    writeFileSync(
      join(upgradeFixture, ".vireo", "managed-files.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          templateCommit: packedSource.templateCommit,
          files: [
            {
              path: "package.json",
              sha256: createHash("sha256")
                .update(readFileSync(join(upgradeFixture, "package.json")))
                .digest("hex"),
            },
            ...activeSourceManagedFiles,
            ...retainedSkillBaselines.map(baseline => ({ path: baseline.path, sha256: baseline.targetSha256 })),
          ],
        },
        null,
        2,
      )}\n`,
    );
  }
  const applicationAgentsPath = join(upgradeFixture, "AGENTS.md");
  writeFileSync(applicationAgentsPath, "application-owned packed guidance\n");
  const packedStatus = JSON.parse(
    execFileSync("node", [join(createPackage, "dist/vireo-cli.js"), "status", "--json", "--project", upgradeFixture], {
      cwd: consumerRoot,
      encoding: "utf8",
    }),
  );
  if (
    packedStatus.currentRelease !== projectUpgradeContract.publicRelease ||
    packedStatus.nextHop !== packedTarget.release
  ) {
    throw new Error("The packed vireo status executable did not report the adjacent upgrade graph.");
  }
  let packedUpgrade;
  if (packedPolicy.releaseGraph.candidateRelease) {
    try {
      execFileSync(
        "node",
        [
          join(createPackage, "dist/vireo-cli.js"),
          "upgrade",
          "--to",
          packedTarget.release,
          "--dry-run",
          "--json",
          "--project",
          upgradeFixture,
        ],
        { cwd: consumerRoot, encoding: "utf8", stdio: "pipe" },
      );
      throw new Error("The packed vireo executable accepted an unpublished candidate upgrade.");
    } catch (error) {
      const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
      if (!output.includes("VIR-UPG-008")) throw error;
    }
  } else {
    packedUpgrade = JSON.parse(
      execFileSync(
        "node",
        [
          join(createPackage, "dist/vireo-cli.js"),
          "upgrade",
          "--to",
          packedTarget.release,
          "--dry-run",
          "--json",
          "--project",
          upgradeFixture,
        ],
        { cwd: consumerRoot, encoding: "utf8" },
      ),
    );
    if (
      !packedUpgrade.dryRun ||
      JSON.stringify(
        packedUpgrade.files
          .filter(file => managedConsumerSkillPaths.includes(file.path))
          .map(file => [file.path, file.status])
          .sort((left, right) => left[0].localeCompare(right[0])),
      ) !==
        JSON.stringify(
          (skillsAddedByCurrentEdge ? managedConsumerSkillPaths.map(path => [path, "create"]) : []).sort(
            (left, right) => left[0].localeCompare(right[0]),
          ),
        ) ||
      packedUpgrade.files.some(file => file.path.startsWith(".vireo/application/.agents/"))
    ) {
      throw new Error("The packed vireo executable did not preserve the declared consumer-skill upgrade behavior.");
    }
    const packedApply = JSON.parse(
      execFileSync(
        "node",
        [
          join(createPackage, "dist/vireo-cli.js"),
          "upgrade",
          "--to",
          packedTarget.release,
          "--apply",
          "--accept-application-owned",
          "--json",
          "--project",
          upgradeFixture,
        ],
        { cwd: consumerRoot, encoding: "utf8" },
      ),
    );
    if (packedApply.dryRun) throw new Error("The packed vireo executable did not apply the accepted adjacent upgrade.");
  }
  const expectedSkillContentByPath = new Map(
    managedSkillBaselines.map(baseline => [baseline.path, baseline.targetContent]),
  );
  for (const [path, targetContent] of expectedSkillContentByPath) {
    if (readFileSync(join(upgradeFixture, path), "utf8") !== targetContent)
      throw new Error("The packed vireo executable wrote incorrect managed skill bytes at " + path + ".");
  }
  if (existsSync(join(upgradeFixture, ".vireo", "application", ".agents"))) {
    throw new Error("The packed vireo executable wrote managed skills into the Template-only provenance directory.");
  }
  if (readFileSync(applicationAgentsPath, "utf8") !== "application-owned packed guidance\n") {
    throw new Error("The packed vireo executable overwrote application-owned AGENTS.md.");
  }
  const packedManaged = JSON.parse(readFileSync(join(upgradeFixture, ".vireo", "managed-files.json"), "utf8"));
  if (!packedPolicy.releaseGraph.candidateRelease) {
    for (const baseline of activeFrontendBaselines) {
      const path = join(upgradeFixture, baseline.path);
      const managed = packedManaged.files.find(file => file.path === baseline.path);
      if (baseline.operation === "delete") {
        if (existsSync(path) || managed)
          throw new Error(`Packed upgrade retained deleted managed baseline ${baseline.path}.`);
      } else {
        if (!existsSync(path)) throw new Error(`Packed upgrade omitted managed baseline ${baseline.path}.`);
        const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
        if (digest !== baseline.targetSha256 || managed?.sha256 !== baseline.targetSha256)
          throw new Error(`Packed upgrade wrote incoherent managed baseline provenance for ${baseline.path}.`);
      }
    }
  }
  if (
    managedConsumerSkillPaths.some(path => !packedManaged.files.some(file => file.path === path)) ||
    packedManaged.files.some(file => file.path.startsWith(".vireo/application/.agents/"))
  ) {
    throw new Error("Packed managed-file provenance must record consumer skill paths only.");
  }

  const typecheckEntry = join(consumerRoot, "consumer.ts");
  const typecheckConfig = join(consumerRoot, "tsconfig.json");
  const allSpecifiers = [...nodeSpecifiers, ...browserSpecifiers];
  writeFileSync(
    typecheckEntry,
    allSpecifiers
      .map((specifier, index) => `import type * as Package${index} from ${JSON.stringify(specifier)};`)
      .join("\n"),
  );
  writeFileSync(
    typecheckConfig,
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: portabilityPolicy.typescriptConsumer.module,
          moduleResolution: portabilityPolicy.typescriptConsumer.moduleResolution,
          noEmit: true,
          skipLibCheck: portabilityPolicy.typescriptConsumer.skipLibCheck,
          strict: true,
          target: portabilityPolicy.typescriptConsumer.target,
        },
        files: [typecheckEntry],
      },
      null,
      2,
    )}\n`,
  );
  execFileSync("node", [join(consumerNodeModules, "typescript/bin/tsc"), "--project", typecheckConfig], {
    cwd: consumerRoot,
    stdio: "inherit",
  });

  const browserEntry = join(consumerRoot, "browser-entry.mjs");
  const viteConfig = join(consumerRoot, "vite.config.mjs");
  writeFileSync(
    browserEntry,
    `${browserSpecifiers.map(specifier => `import ${JSON.stringify(specifier)};`).join("\n")}
import { VireoTemporalLocalizationProvider } from "@vireocodedev/ui/localization";
globalThis.__vireoTemporalLocalizationProvider = VireoTemporalLocalizationProvider;
`,
  );
  writeFileSync(
    viteConfig,
    `export default {
      logLevel: "silent",
      build: {
        lib: { entry: ${JSON.stringify(browserEntry)}, formats: ["es"], fileName: "browser-smoke" },
        rollupOptions: {
          external: id => !id.startsWith("@vireocodedev/") && !id.startsWith(".") && !id.startsWith("/")
        }
      }
    };`,
  );
  execFileSync("node", [join(consumerNodeModules, "vite/bin/vite.js"), "build", "--config", viteConfig], {
    cwd: consumerRoot,
    stdio: "inherit",
  });
  const browserBundle = readFileSync(join(consumerRoot, "dist/browser-smoke.js"), "utf8");
  if (!browserBundle.includes("dayjs/plugin/utc")) {
    throw new Error("The packed UI localization bundle tree-shook away Day.js UTC initialization.");
  }

  console.log("Packed release and isolated consumer smoke test passed.");
  console.log("Package                                      Exports  Files  Packed KiB  Unpacked KiB");
  console.log("-------------------------------------------  -------  -----  ----------  ------------");
  for (const item of summary) {
    console.log(
      `${item.name.padEnd(43)}  ${String(item.entries).padStart(7)}  ${String(item.files).padStart(5)}  ${(item.size / 1024).toFixed(1).padStart(10)}  ${(item.unpackedSize / 1024).toFixed(1).padStart(12)}`,
    );
  }
  console.log("");
  console.log(
    `Validated ${summary.length} licensed packages and ${nodeSpecifiers.length + browserSpecifiers.length} public runtime entry points (${nodeSpecifiers.length} native ESM, ${browserSpecifiers.length} browser-bundled).`,
  );
  console.log(
    "The clean install resolved a valid dependency tree and compiled every entry point with skipLibCheck disabled.",
  );
  console.log("Source-map publication and portable source paths match the reviewed package policy.");
  console.log("A locally computed and recorded content-integrity digest covers every tarball.");
} finally {
  rmSync(auditRoot, { recursive: true, force: true });
}
