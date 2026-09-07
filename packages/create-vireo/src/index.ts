import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { format, resolveConfig } from "prettier";
import { writeExampleManifest } from "./remove-example.js";
import {
  classifyProjectionPath,
  readApplicationProjectionContract,
  validateApplicationIdentity,
  validateApplicationProjectionContract,
} from "./application-projection-contract.mjs";
import { sha256 } from "./entity-generator.js";
import {
  currentFrontendProjectionRequirements,
  currentProjectionCompatibilityRequirements,
  currentVireoReleaseRequirements,
} from "./project-upgrade.js";

export {
  checkGeneratedEntities,
  ejectEntity,
  generateEntity,
  readProjectMetadata,
  sha256,
  stableJson,
  VIREO_GENERATOR_VERSION,
  VireoGeneratorError,
  type EntityGenerationFileResult,
  type EntityGenerationManifest,
  type GenerateEntityOptions,
  type GenerateEntityResult,
  type GeneratedContractCheck,
} from "./entity-generator.js";
export {
  EntitySchemaError,
  parseEntitySchema,
  readEntitySchema,
  VIREO_ENTITY_SCHEMA_VERSION,
  type EntityFieldSchema,
  type EntityFieldType,
  type EntityRelationshipSchema,
  type VireoEntitySchema,
} from "./entity-schema.js";
export {
  createWireContract,
  entityNames,
  type EntityNames,
  type VireoGenerationTarget,
  type WireContract,
} from "./entity-renderer.js";
export {
  upgradeVireoProject,
  vireoProjectStatus,
  VireoUpgradeError,
  type VireoProjectStatus,
  type VireoUpgradeCheck,
  type VireoUpgradeFile,
  type VireoUpgradeOptions,
  type VireoUpgradeResult,
} from "./project-upgrade.js";
export {
  findExampleReferences,
  removeExample,
  type RemoveExampleFile,
  type RemoveExampleResult,
} from "./remove-example.js";

const CREATE_VIREO_PACKAGE_VERSION = "0.8.7";
const TEMPLATE_VERSION = CREATE_VIREO_PACKAGE_VERSION;
const TEMPLATE_TAG = `starter-template@${TEMPLATE_VERSION}`;
const TEMPLATE_STARTER_JVM_BASELINE = "0.3.1";
const INITIAL_APPLICATION_VERSION = "0.1.0";
export const TEMPLATE_COMMIT = "0557990f024a8736b6e661f8fc264861deb99b65";
export const TEMPLATE_ARCHIVE_URL = `https://codeload.github.com/vireocodedev/vireo-template/tar.gz/${TEMPLATE_COMMIT}`;
const CREATE_VIREO_COMMAND = `npx --yes --package=create-vireo@${CREATE_VIREO_PACKAGE_VERSION} vireo`;

export type VireoDatabase = "postgresql" | "h2";
export type VireoPackageManager = "npm";
export type VireoProfile = "full-stack" | "frontend";
export type CreateVireoOptions = {
  directory: string;
  profile?: VireoProfile;
  projectName?: string;
  displayName?: string;
  ownerName?: string;
  repositoryUrl?: string;
  supportUrl?: string;
  securityContact?: string;
  javaPackage?: string;
  database?: VireoDatabase;
  packageManager?: VireoPackageManager;
  git?: boolean;
  dryRun?: boolean;
  templateDirectory?: string;
};
export type CreateVireoResult = {
  directory: string;
  projectName: string;
  displayName: string;
  profile: VireoProfile;
  javaPackage?: string;
  database?: VireoDatabase;
  packageManager: VireoPackageManager;
  gitInitialized: boolean;
  templateCommit: string;
  dryRun: boolean;
};

type ApplicationIdentity = {
  projectName: string;
  displayName: string;
  ownerName: string;
  repositoryUrl: string;
  supportUrl: string;
  securityContact: string;
};

type ProjectionContract = {
  defaultOptionalRuleIds?: string[];
  rules?: Array<{ id: string; category: string }>;
  identity?: Record<string, unknown>;
};

const applicationProjectionContract = readApplicationProjectionContract(
  fileURLToPath(new URL("../schema/application-projection-contract.json", import.meta.url)),
) as ProjectionContract;
const projectionContractProblems = validateApplicationProjectionContract(applicationProjectionContract);
if (projectionContractProblems.length > 0) {
  throw new Error(`Bundled application projection contract is invalid: ${projectionContractProblems.join("; ")}`);
}

function assertProjectName(name: string) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name))
    throw new Error("Project name must be lowercase kebab-case (for example `my-app`).");
}

function assertJavaPackage(value: string) {
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u.test(value))
    throw new Error("Java package must contain at least two lowercase dot-separated identifiers.");
}

function javaSuffix(name: string) {
  return name
    .split("-")
    .map(part => part.replace(/[^a-z0-9_]/gu, ""))
    .join("");
}

function displayName(name: string) {
  return name
    .split("-")
    .map(part => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function safeArchivePath(value: string) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || isAbsolute(normalized) || normalized.split("/").includes(".."))
    throw new Error(`Unsafe Template archive path: ${value}`);
  return normalized;
}

async function extractTarGzip(archive: Uint8Array, destination: string) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/su, "");
    const name = safeArchivePath(`${field(345, 155) ? `${field(345, 155)}/` : ""}${field(0, 100)}`);
    const stripped = name.split("/").slice(1).join("/");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const mode = Number.parseInt(field(100, 8).trim() || "644", 8);
    const type = field(156, 1) || "0";
    offset += 512;
    if (stripped) {
      const target = resolve(destination, stripped);
      if (relative(destination, target).startsWith(`..${sep}`))
        throw new Error(`Template archive escaped its destination: ${name}`);
      if (type === "5") await mkdir(target, { recursive: true });
      else if (type === "0") {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, tar.subarray(offset, offset + size));
        await chmod(target, mode & 0o777);
      } else if (type === "1" || type === "2")
        throw new Error(`Template archive contains an unsupported link: ${name}`);
    }
    offset += Math.ceil(size / 512) * 512;
  }
}

async function downloadTemplate(destination: string) {
  const response = await fetch(TEMPLATE_ARCHIVE_URL, { headers: { "user-agent": "create-vireo" } });
  if (!response.ok) throw new Error(`Could not download the pinned Vireo Template (HTTP ${response.status}).`);
  await extractTarGzip(new Uint8Array(await response.arrayBuffer()), destination);
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async entry => {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Template source contains an unsupported link: ${path}`);
        if (entry.isDirectory()) return walk(path);
        if (entry.isFile()) return [path];
        throw new Error(`Template source contains an unsupported filesystem entry: ${path}`);
      }),
    )
  ).flat();
}

function normalizedRelative(root: string, path: string) {
  return relative(root, path).replaceAll("\\", "/");
}

function frontendDestination(path: string) {
  if (path.startsWith("frontend/")) return path.slice("frontend/".length);
  if (
    path === "LICENSE" ||
    path === "CODE_OF_CONDUCT.md" ||
    path === "CONTRIBUTING.md" ||
    path === "GOVERNANCE.md" ||
    path === "README.md" ||
    path === "SECURITY.md" ||
    path === "SUPPORT.md" ||
    path === ".github/pull_request_template.md" ||
    path.startsWith(".github/ISSUE_TEMPLATE/") ||
    path.startsWith(".vireo/examples/") ||
    path.startsWith(".vscode/")
  ) {
    return path;
  }
  return undefined;
}

function applicationGuidanceDestination(path: string) {
  const prefix = ".vireo/application/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function projectDestination(path: string, profile: VireoProfile) {
  const applicationGuidance = applicationGuidanceDestination(path);
  if (applicationGuidance) return applicationGuidance;
  return profile === "full-stack" ? path : frontendDestination(path);
}

function isWorkspaceArtifact(path: string) {
  const segments = path.split("/");
  const filename = segments[segments.length - 1] ?? "";
  if (
    path.startsWith(".vscode/") &&
    ![".vscode/extensions.json", ".vscode/launch.json", ".vscode/settings.json", ".vscode/tasks.json"].includes(path)
  ) {
    return true;
  }
  if (filename.startsWith(".env") && filename !== ".env.example") return true;
  if (filename === ".DS_Store" || filename.endsWith(".iml")) return true;
  if (segments.join("/") === "operations/evidence" || segments.join("/").startsWith("operations/evidence/"))
    return true;
  return segments.some(segment =>
    [
      ".git",
      ".data",
      ".gradle",
      ".idea",
      ".support-evidence",
      ".verification-evidence",
      ".performance-evidence",
      "node_modules",
      "dist",
      "storybook-static",
      "test-results",
      "playwright-report",
      ".pwa-update-fixture",
      "build",
      "bin",
      "out",
    ].includes(segment),
  );
}

async function assertNoLocalTemplateLinks(directory: string, root = directory): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = normalizedRelative(root, path);
    if (isWorkspaceArtifact(relativePath)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Template source contains an unsupported link: ${path}`);
    if (entry.isDirectory()) await assertNoLocalTemplateLinks(path, root);
    else if (!entry.isFile()) throw new Error(`Template source contains an unsupported filesystem entry: ${path}`);
  }
}

async function copyLocalTemplateDirectory(source: string, destination: string) {
  await assertNoLocalTemplateLinks(source);
  await cp(source, destination, {
    recursive: true,
    filter: path => path === source || !isWorkspaceArtifact(normalizedRelative(source, path)),
  });
}

async function projectTemplate(staging: string, profile: VireoProfile, ignoreWorkspaceArtifacts: boolean) {
  const projection = `${staging}-project`;
  const selectedOptionalRules = new Set(applicationProjectionContract.defaultOptionalRuleIds ?? []);
  const destinations = new Set<string>();
  const managedPaths = new Set<string>();
  try {
    for (const source of await walk(staging)) {
      const path = normalizedRelative(staging, source);
      // Local template directories may be working checkouts. Ignore only their
      // gitignored build and environment artifacts; pinned archives remain
      // fully classified by the projection contract.
      if (ignoreWorkspaceArtifacts && isWorkspaceArtifact(path)) continue;
      const classification = classifyProjectionPath(applicationProjectionContract, path, profile);
      if (!classification) throw new Error(`Pinned Template path is unclassified for ${profile}: ${path}`);
      if (classification.disposition === "exclude") continue;
      if (classification.disposition === "copy-when-selected" && !selectedOptionalRules.has(classification.ruleId)) {
        continue;
      }
      const destination = projectDestination(path, profile);
      if (!destination) {
        throw new Error(`Pinned Template path has no declared ${profile} destination: ${path}`);
      }
      if (destinations.has(destination)) throw new Error(`Pinned Template projects multiple files to ${destination}.`);
      destinations.add(destination);
      if (classification.category === "managed") managedPaths.add(destination);
      const target = join(projection, destination);
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { force: true, preserveTimestamps: true });
    }
    await rm(staging, { recursive: true, force: true });
    await rename(projection, staging);
    return [...managedPaths].sort();
  } catch (error) {
    await rm(projection, { recursive: true, force: true });
    throw error;
  }
}

async function replaceTextFiles(root: string, replacements: Array<[string, string]>) {
  for (const file of await walk(root)) {
    const contents = await readFile(file);
    if (contents.includes(0)) continue;
    let text = contents.toString("utf8");
    for (const [before, after] of replacements) text = text.replaceAll(before, after);
    await writeFile(file, text);
  }
}

async function replaceTextFile(path: string, replacements: Array<[string, string]>) {
  let text = await readFile(path, "utf8");
  for (const [before, after] of replacements) text = text.replaceAll(before, after);
  await writeFile(path, text);
}

type PwaIdentity = {
  id: string;
  name: string;
  shortName: string;
  description: string;
};

function createPwaIdentity(projectName: string, productName: string): PwaIdentity {
  const words = productName.split(/\s+/u).filter(Boolean);
  let shortName = "";
  for (const word of words) {
    const candidate = shortName ? `${shortName} ${word}` : word;
    if (candidate.length > 12) break;
    shortName = candidate;
  }
  if (shortName.length < 6 && words.length > 1) {
    shortName = productName.replaceAll(" ", "").slice(0, 12);
  }
  if (!shortName) shortName = words[0]?.slice(0, 12) ?? "";
  if (!shortName) throw new Error("Project name cannot produce a PWA short name.");
  return {
    id: `/${projectName}`,
    name: productName,
    shortName,
    description: `${productName} is a production-oriented application.`,
  };
}

/**
 * Render the one identity authority copied from the pinned Template. The
 * baseline checks deliberately fail closed if a future Template reshapes this
 * object, rather than silently leaving Vireo identity in a generated app.
 */
async function renderPwaIdentity(path: string, identity: PwaIdentity) {
  let source = await readFile(path, "utf8");
  const fields: Array<[string, string]> = [
    ['id: "/vireo-starter"', `id: ${JSON.stringify(identity.id)}`],
    ['name: "Vireo Starter"', `name: ${JSON.stringify(identity.name)}`],
    ['shortName: "Vireo"', `shortName: ${JSON.stringify(identity.shortName)}`],
    [
      'description: "A production-oriented full-stack PWA built on Vireo Starter."',
      `description: ${JSON.stringify(identity.description)}`,
    ],
  ];
  for (const [baseline, rendered] of fields) {
    const occurrences = source.split(baseline).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Pinned Template PWA identity must contain exactly one ${baseline}.`);
    }
    source = source.replace(baseline, rendered);
  }
  await writeFile(path, source);
}

async function renderLegacyTemplateIdentity(root: string, identity: PwaIdentity, frontendDirectory: string) {
  const replaceExactlyOnce = async (path: string, baseline: string, rendered: string) => {
    const source = await readFile(path, "utf8");
    const occurrences = source.split(baseline).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Legacy Template identity must contain exactly one ${baseline}.`);
    }
    await writeFile(path, source.replace(baseline, rendered));
  };

  await replaceExactlyOnce(
    join(root, frontendDirectory, "vite.config.ts"),
    'name: "Vireo Starter App"',
    `name: ${JSON.stringify(identity.name)}`,
  );
  await replaceExactlyOnce(
    join(root, frontendDirectory, "vite.config.ts"),
    'short_name: "Vireo"',
    `short_name: ${JSON.stringify(identity.shortName)}`,
  );
  for (const locale of ["app.en.ts", "app.hr.ts"]) {
    await replaceExactlyOnce(
      join(root, frontendDirectory, "src", "app", "ui", "localization", "resources", locale),
      'name: "Vireo Starter"',
      `name: ${JSON.stringify(identity.name)}`,
    );
  }
}

async function renderTemplateIdentity(root: string, identity: PwaIdentity, frontendDirectory = "frontend") {
  try {
    await renderPwaIdentity(join(root, frontendDirectory, "pwa-policy.mjs"), identity);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Release-pair upgrade fixtures intentionally materialize historical
    // Templates that predate the shared PWA identity authority. Keep their
    // original, strict identity contract readable without weakening the
    // fail-closed checks for current Templates.
    await renderLegacyTemplateIdentity(root, identity, frontendDirectory);
  }
}

async function renameJavaPackage(root: string, javaPackage: string) {
  for (const sourceSet of ["main", "test"]) {
    const source = join(root, "src", sourceSet, "java", "com", "vireocode", "startertemplate");
    try {
      if (!(await stat(source)).isDirectory()) continue;
    } catch {
      continue;
    }
    const destination = join(root, "src", sourceSet, "java", ...javaPackage.split("."));
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
  }
}

function projectIdentityPolicySource(profile: VireoProfile) {
  if (!applicationProjectionContract.identity)
    throw new Error("Bundled application projection contract has no identity policy.");
  return `import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IDENTITY_CONTRACT = ${JSON.stringify(applicationProjectionContract.identity, null, 2)};
const EXPECTED_PROFILE = ${JSON.stringify(profile)};
const options = new Set(process.argv.slice(2));
const supportedOptions = new Set(["--release", "--json"]);
const unsupportedOptions = [...options].filter(option => !supportedOptions.has(option));
const phase = options.has("--release") ? "release" : "creation";
const json = options.has("--json");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CONTROL_CHARACTERS = /[\\u0000-\\u001F\\u007F]/u;

function parseHttpsUrl(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("https://") ||
    /\\s/u.test(value) ||
    CONTROL_CHARACTERS.test(value) ||
    value.includes("\\\\")
  ) {
    return undefined;
  }
  try {
    const route = new URL(value);
    const authority = value.slice("https://".length).split(/[/?#]/u, 1)[0];
    if (
      route.protocol !== "https:" ||
      route.host.length === 0 ||
      route.hostname === "." ||
      route.hostname === ".." ||
      authority.length === 0 ||
      route.username.length > 0 ||
      route.password.length > 0 ||
      authority.includes("@")
    ) {
      return undefined;
    }
    return route;
  } catch {
    return undefined;
  }
}

function isMailtoUrl(value) {
  if (typeof value !== "string" || !value.startsWith("mailto:") || /\\s/u.test(value) || CONTROL_CHARACTERS.test(value))
    return false;
  const address = value.slice("mailto:".length);
  const at = address.indexOf("@");
  return at > 0 && at === address.lastIndexOf("@") && at < address.length - 1;
}

function matchesFormat(format, value) {
  if (format === "kebab-case") return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
  if (format === "non-empty") return value.trim().length > 0;
  if (format === "https-url") return parseHttpsUrl(value) !== undefined;
  if (format === "https-or-mailto-url") return parseHttpsUrl(value) !== undefined || isMailtoUrl(value);
  return false;
}

function normalizedReleaseRouteIdentity(value) {
  if (typeof value !== "string") return undefined;
  if (isMailtoUrl(value)) return "mailto:" + value.slice("mailto:".length).toLowerCase();
  const route = parseHttpsUrl(value);
  if (!route) return undefined;
  const pathname = route.pathname.length > 1 && route.pathname.endsWith("/") ? route.pathname.slice(0, -1) : route.pathname;
  return route.protocol + "//" + route.host + pathname + route.search + route.hash;
}

function validateIdentity(values) {
  const problems = [];
  if (!values || typeof values !== "object" || Array.isArray(values)) return ["application identity must be an object"];
  for (const field of IDENTITY_CONTRACT.fields) {
    const value = values[field.name];
    const required = field.requiredBy === "creation" || phase === "release";
    if (typeof value !== "string" || value.length === 0) {
      if (required) problems.push(field.name + " is required by " + field.requiredBy);
      continue;
    }
    if (value.startsWith(IDENTITY_CONTRACT.unresolvedMarkerPrefix)) {
      if (value !== field.unresolvedMarker) problems.push(field.name + " must use its explicit unresolved marker");
      else if (phase === "release" || field.requiredBy === "creation") problems.push(field.name + " is unresolved");
      continue;
    }
    if (!matchesFormat(field.format, value)) problems.push(field.name + " must use " + field.format + " format");
  }
  if (phase === "release") {
    for (const field of ["repositoryUrl", "supportUrl", "securityContact"]) {
      const route = String(values[field] ?? "").toLowerCase();
      for (const inherited of IDENTITY_CONTRACT.releaseRequirements.forbiddenInheritedHosts ?? []) {
        if (route.includes(String(inherited).toLowerCase())) {
          problems.push(field + " must not inherit a Vireo repository, support, or security route");
        }
      }
    }
    const supportRoute = normalizedReleaseRouteIdentity(values.supportUrl);
    const securityRoute = normalizedReleaseRouteIdentity(values.securityContact);
    if (supportRoute !== undefined && supportRoute === securityRoute) {
      problems.push("supportUrl and securityContact must be distinct release routes");
    }
  }
  return problems;
}

function remedy(problem) {
  if (problem.startsWith("schemaVersion")) return "Set schemaVersion to 1 in " + IDENTITY_CONTRACT.metadataPath + ".";
  if (problem.startsWith("profile")) return "Set profile to " + EXPECTED_PROFILE + " in " + IDENTITY_CONTRACT.metadataPath + ".";
  const field = IDENTITY_CONTRACT.fields.find(candidate => problem.startsWith(candidate.name + " "));
  if (problem.includes("unresolved") || problem.includes("required")) {
    return "Set " + (field?.name ?? "the missing field") + " in " + IDENTITY_CONTRACT.metadataPath + ".";
  }
  if (problem.includes("format")) return "Use the format declared for " + (field?.name ?? "this field") + " in the project identity policy.";
  if (problem.includes("inherit")) return "Replace the inherited Vireo route with an application-owned route.";
  if (problem.includes("distinct")) return "Configure separate support and private security reporting routes.";
  return "Repair " + IDENTITY_CONTRACT.metadataPath + " and rerun this command.";
}

let problems = unsupportedOptions.map(option => "unsupported option " + option);
try {
  const metadata = JSON.parse(readFileSync(resolve(root, IDENTITY_CONTRACT.metadataPath), "utf8"));
  if (metadata.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (metadata.profile !== EXPECTED_PROFILE) problems.push("profile must be " + EXPECTED_PROFILE);
  problems = problems.concat(validateIdentity(metadata));
} catch {
  problems.push("project metadata is missing or invalid at " + IDENTITY_CONTRACT.metadataPath);
}
const ok = problems.length === 0;
if (json) {
  console.log(JSON.stringify({ phase, ok, problems }));
} else if (ok) {
  console.log("Project identity is valid for " + phase + ".");
} else {
  console.error("Project identity check failed for " + phase + ":");
  for (const problem of problems) console.error("- " + problem + "\\n  Remedy: " + remedy(problem));
}
if (!ok) process.exitCode = 1;
`;
}

async function renderProjectIdentityPolicy(staging: string, profile: VireoProfile) {
  const path = join(staging, "scripts", "project-identity-policy.mjs");
  await mkdir(dirname(path), { recursive: true });
  const config = (await resolveConfig(path)) ?? {};
  await writeFile(path, await format(projectIdentityPolicySource(profile), { ...config, filepath: path }));
  await chmod(path, 0o755);
}

const FRONTEND_VERIFY_SCRIPT = `#!/usr/bin/env bash

set -euo pipefail

steps=(
  "Project identity|node scripts/project-identity-policy.mjs"
  "Published package boundary|corepack npm run starter:boundary:check"
  "Architecture|corepack npm run architecture:check"
  "Formatting|corepack npm run format:check"
  "Lint|corepack npm run lint"
  "Types|corepack npm run typecheck"
  "Tests|corepack npm run test"
  "PWA source contract|corepack npm run pwa:check:source"
  "Application build|corepack npm run build"
  "PWA built contract|corepack npm run pwa:check:built"
)

for step in "\${steps[@]}"; do
  label=\${step%%|*}
  command=\${step#*|}
  printf '%s...\\n' "$label"
  bash -lc "$command"
done

printf 'Frontend-only verification passed: %d/%d steps.\\n' "\${#steps[@]}" "\${#steps[@]}"
`;

const FRONTEND_DOCTOR_SCRIPT = `import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPwaSourceContract, formatPwaContractProblems } from "./pwa-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.slice(2).includes("--json");
const results = [];
const add = (code, status, summary, remedy) =>
  results.push({ code, status, summary, ...(remedy ? { remedy } : {}) });

const nodeMajor = Number(process.versions.node.split(".")[0]);
add(
  "VIR-ENV-001",
  nodeMajor === 24 ? "pass" : "fail",
  \`Node \${process.versions.node}\`,
  "Install Node 24.15 or newer, but below 25.",
);

const osRelease = existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : "";
const kernelRelease = existsSync("/proc/sys/kernel/osrelease")
  ? readFileSync("/proc/sys/kernel/osrelease", "utf8")
  : "";
const ubuntu2404 = /^ID=ubuntu$/mu.test(osRelease) && /^VERSION_ID="?24\\.04"?$/mu.test(osRelease);
const wsl = /microsoft/iu.test(kernelRelease);
const commandIsGnu = executable => {
  const completed = spawnSync(executable, ["--version"], { encoding: "utf8" });
  return completed.status === 0 && /GNU/iu.test(\`\${completed.stdout ?? ""}\\n\${completed.stderr ?? ""}\`);
};
const supportedHost = process.platform === "linux" && process.arch === "x64" && ubuntu2404 && !wsl;
const verificationTools = commandIsGnu("/usr/bin/time") && commandIsGnu("date");
add(
  "VIR-VERIFY-001",
  supportedHost && verificationTools ? "pass" : supportedHost ? "fail" : "warn",
  supportedHost && verificationTools
    ? "Authoritative verification host: Ubuntu 24.04 x86-64 with GNU time/date"
    : supportedHost
      ? "Ubuntu 24.04 x86-64 is missing GNU time or GNU date"
      : (wsl ? "Windows/WSL2" : process.platform + "/" + process.arch) +
        " is outside the supported local verification host",
  supportedHost
    ? "Install GNU time and coreutils before running corepack npm run verify."
    : "Use Ubuntu 24.04 x86-64 for release evidence; this host remains untested until an automated support lane exists.",
);

let metadata;
try {
  metadata = JSON.parse(readFileSync(resolve(root, ".vireo/project.json"), "utf8"));
  add(
    "VIR-PROJECT-001",
    metadata.profile === "frontend" ? "pass" : "fail",
    \`Vireo profile: \${metadata.profile ?? "missing"}\`,
    "Restore frontend profile metadata.",
  );
} catch {
  add("VIR-PROJECT-001", "fail", "Project metadata is missing or invalid", "Restore .vireo/project.json.");
}
try {
  const managed = JSON.parse(readFileSync(resolve(root, ".vireo/managed-files.json"), "utf8"));
  const valid = managed.schemaVersion === 1 && typeof managed.templateCommit === "string" && Array.isArray(managed.files) && managed.files.every(file => typeof file?.path === "string" && /^[a-f0-9]{64}$/u.test(file?.sha256 ?? ""));
  add(
    "VIR-PROJECT-002",
    valid ? "pass" : "fail",
    valid ? "Managed-file provenance is ready" : "Managed-file provenance is invalid",
    "Run the declared Vireo upgrade dry run and restore .vireo/managed-files.json before applying it.",
  );
} catch {
  add(
    "VIR-PROJECT-002",
    "warn",
    "Managed-file provenance is unavailable",
    "Projects created before 0.7 receive provenance during the reviewed 0.6-to-0.7 upgrade.",
  );
}

add(
  "VIR-DEPS-001",
  existsSync(resolve(root, "node_modules")) ? "pass" : "fail",
  "Frontend dependency installation",
  "Run corepack npm run setup.",
);
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const vireoVersions = Object.entries(packageJson.dependencies ?? {})
  .filter(([name]) => name.startsWith("@vireocodedev/"))
  .map(([, version]) => version);
add(
  "VIR-DEPS-002",
  vireoVersions.length > 0 && new Set(vireoVersions).size <= 2 ? "pass" : "fail",
  "Vireo package compatibility",
  "Use the versions generated by the pinned Template.",
);

const environment = existsSync(resolve(root, ".env.development"))
  ? readFileSync(resolve(root, ".env.development"), "utf8")
  : "";
add(
  "VIR-API-001",
  /VITE_API_MODE=(?:mock|http)/u.test(environment) ? "pass" : "warn",
  "Frontend API mode is explicit",
  "Declare VITE_API_MODE=mock or http.",
);

const pwaProblems = checkPwaSourceContract({ frontendRoot: root });
add(
  "VIR-PWA-001",
  pwaProblems.length === 0 ? "pass" : "fail",
  pwaProblems.length === 0 ? "PWA source contract" : formatPwaContractProblems(pwaProblems),
  "Restore the shared PWA policy, metadata, and icons; run corepack npm run pwa:check:source for details.",
);

const portAvailable = await new Promise(resolveCheck => {
  const socket = createConnection({ host: "127.0.0.1", port: 3000 });
  socket.unref();
  socket.setTimeout(500);
  socket.once("connect", () => {
    socket.destroy();
    resolveCheck(false);
  });
  socket.once("error", () => resolveCheck(true));
  socket.once("timeout", () => {
    socket.destroy();
    resolveCheck(true);
  });
});
add(
  "VIR-PORT-002",
  portAvailable ? "pass" : "fail",
  "Frontend port 3000 availability",
  "Stop the process using port 3000.",
);

const ok = results.every(result => result.status !== "fail");
const warnings = results.some(result => result.status === "warn");
const report = {
  schemaVersion: 1,
  ok,
  project: metadata?.projectName ?? "unknown",
  profile: "frontend",
  databaseMode: "frontend",
  results,
};
if (jsonMode) console.log(JSON.stringify(report, null, 2));
else {
  for (const result of results)
    console.log(
      \`\${result.status === "pass" ? "✓" : result.status === "warn" ? "!" : "✗"} \${result.code} \${result.summary}\`,
    );
  console.log(
    ok
      ? warnings
        ? "Frontend profile is ready for development with unverified platform warnings."
        : "Frontend profile is ready."
      : "Resolve the failed checks and rerun the doctor.",
  );
}
if (!ok) process.exitCode = 1;
`;

/**
 * The frontend projection owns this script rather than the Template. Keep its
 * renderer public so release evidence can independently reproduce the frozen
 * managed baseline without reading the upgrade policy itself.
 */
export async function renderFrontendDoctorScript(path: string) {
  const config = (await resolveConfig(path)) ?? {};
  return format(FRONTEND_DOCTOR_SCRIPT, { ...config, filepath: path });
}

async function projectFrontendTemplate(staging: string, projectName: string, productName: string) {
  const packagePath = join(staging, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown> & {
    scripts: Record<string, string>;
  };
  packageJson.name = projectName;
  packageJson.version = INITIAL_APPLICATION_VERSION;
  const requiredScript = (name: string) => {
    const script = packageJson.scripts?.[name];
    if (typeof script !== "string" || script.trim().length === 0)
      throw new Error(`Pinned Template frontend package.json must define ${name}.`);
    return script;
  };
  const performance = await currentFrontendProjectionRequirements();
  for (const [name, expected] of Object.entries(performance.scripts)) {
    const templateValue = packageJson.scripts?.[name];
    const templateSourceValue = performance.templateSourceScripts[name];
    if (templateValue !== undefined && templateValue !== expected && templateValue !== templateSourceValue)
      throw new Error(`Pinned Template frontend package.json defines an incompatible ${name} command.`);
  }
  packageJson.scripts = {
    setup: "corepack npm ci",
    doctor: "node scripts/vireo-frontend-doctor.mjs",
    "doctor:json": "node scripts/vireo-frontend-doctor.mjs --json",
    dev: packageJson.scripts.dev,
    build: packageJson.scripts.build,
    typecheck: packageJson.scripts.typecheck,
    lint: packageJson.scripts.lint,
    format: packageJson.scripts.format,
    "format:check": packageJson.scripts["format:check"],
    test: packageJson.scripts.test,
    "test:storybook": packageJson.scripts["test:storybook"],
    storybook: packageJson.scripts.storybook,
    "build-storybook": packageJson.scripts["build-storybook"],
    "starter:mode:published": packageJson.scripts["starter:mode:published"],
    "starter:boundary:check": packageJson.scripts["starter:boundary:check"],
    "architecture:check": packageJson.scripts["architecture:check"],
    "bundle:check": packageJson.scripts["bundle:check"],
    ...performance.scripts,
    "pwa:check:source": requiredScript("pwa:check:source"),
    "pwa:check:built": requiredScript("pwa:check:built"),
    "pretest:pwa": requiredScript("pretest:pwa"),
    "test:pwa": requiredScript("test:pwa"),
    preview: packageJson.scripts.preview,
    vireo: CREATE_VIREO_COMMAND,
    "generate:check": "corepack npm run vireo -- check",
    "identity:check": "node scripts/project-identity-policy.mjs",
    "identity:check:release": "node scripts/project-identity-policy.mjs --release",
    verify: "bash scripts/verify-frontend-profile.sh",
    "verify:release": "corepack npm run identity:check:release && corepack npm run verify",
  };
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  for (const file of performance.files) {
    if (typeof file.contents !== "string")
      throw new Error(`Active frontend performance baseline has no target bytes: ${file.path}`);
    const path = join(staging, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.contents);
  }

  const lockPath = join(staging, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    name?: string;
    version?: string;
    packages?: Record<string, { name?: string; version?: string }>;
  };
  lock.name = projectName;
  lock.version = INITIAL_APPLICATION_VERSION;
  if (lock.packages?.[""]) {
    lock.packages[""].name = projectName;
    lock.packages[""].version = INITIAL_APPLICATION_VERSION;
  }
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  await writeFile(
    join(staging, "README.md"),
    `# ${productName}\n\nA standalone Vireo frontend. It runs without Java or a database by default through application-owned mock adapters.\n\nThe authoritative local verification host is Ubuntu 24.04 x86-64 with GNU time/coreutils. Other Linux releases, macOS, Windows/WSL2, and ARM64 may work for development but remain untested; Doctor reports this boundary.\n\n\`\`\`bash\ncorepack npm run setup\ncorepack npm run doctor\ncorepack npm run dev\n\`\`\`\n\nSign in with \`demo\` / \`demo123\`. Replace the adapters exported from \`src/app/adapters/public.ts\` when connecting the company API. See \`docs/architecture/frontend-only-adoption.md\`.\n`,
  );
  await writeFile(join(staging, ".env.development"), "VITE_API_MODE=mock\nVITE_API_BASE_URL=/api\n");
  await writeFile(
    join(staging, ".gitignore"),
    `node_modules/
dist/
.pwa-update-fixture/
playwright-report/
test-results/
storybook-static/
.performance-evidence/
.env
.env.*
!.env.example
!.env.development
`,
  );
  await writeFile(join(staging, "scripts", "verify-frontend-profile.sh"), FRONTEND_VERIFY_SCRIPT);
  await chmod(join(staging, "scripts", "verify-frontend-profile.sh"), 0o755);
  const doctorPath = join(staging, "scripts", "vireo-frontend-doctor.mjs");
  await writeFile(doctorPath, await renderFrontendDoctorScript(doctorPath));
  return performance.files.map(file => file.path);
}

async function applyFullStackPerformanceProjection(staging: string) {
  const performance = await currentFrontendProjectionRequirements("full-stack");
  const packagePath = join(staging, "frontend", "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  if (!packageJson.scripts) throw new Error("Pinned Template frontend/package.json does not declare scripts.");
  for (const [name, expected] of Object.entries(performance.scripts)) {
    const templateValue = packageJson.scripts[name];
    const templateSourceValue = performance.templateSourceScripts[name];
    if (templateValue !== undefined && templateValue !== expected && templateValue !== templateSourceValue)
      throw new Error(`Pinned Template frontend/package.json defines an incompatible ${name} command.`);
    packageJson.scripts[name] = expected;
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  for (const file of performance.files) {
    if (typeof file.contents !== "string")
      throw new Error(`Active full-stack performance baseline has no target bytes: ${file.path}`);
    const path = join(staging, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.contents);
  }
  return performance.files.map(file => file.path);
}

async function applyProjectionCompatibility(staging: string, profile: VireoProfile) {
  const files = await currentProjectionCompatibilityRequirements(profile);
  for (const file of files) {
    if (file.compatibleContents.length === 0 || typeof file.contents !== "string")
      throw new Error(`Active projection compatibility baseline has incomplete immutable bytes: ${file.path}`);
    const path = join(staging, file.path);
    const existing = await readFile(path, "utf8").catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(`Pinned Template compatibility baseline is missing: ${file.path}`);
      throw error;
    });
    if (!file.compatibleContents.includes(existing))
      throw new Error(`Pinned Template compatibility baseline is customized: ${file.path}`);
    await writeFile(path, file.contents);
  }
  return files.map(file => file.path);
}

async function pinGeneratedProjectCli(staging: string) {
  const packagePath = join(staging, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    version?: string;
    scripts?: Record<string, string>;
  };
  if (!packageJson.scripts) throw new Error("The pinned Template package.json does not declare scripts.");
  packageJson.version = INITIAL_APPLICATION_VERSION;
  delete packageJson.scripts["release:policy"];
  packageJson.scripts.vireo = CREATE_VIREO_COMMAND;
  packageJson.scripts["identity:check"] = "node scripts/project-identity-policy.mjs";
  packageJson.scripts["identity:check:release"] = "node scripts/project-identity-policy.mjs --release";
  packageJson.scripts.verify = "bash scripts/verify.sh";
  packageJson.scripts["verify:release"] = "corepack npm run identity:check:release && corepack npm run verify";
  packageJson.scripts["test:scripts"] =
    "node --test scripts/database-development.test.mjs scripts/verification-host.test.mjs";
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function normalizeGeneratedStarterJvmVersion(staging: string) {
  const requirements = await currentVireoReleaseRequirements();
  const path = join(staging, "gradle.properties");
  const source = await readFile(path, "utf8");
  const declarations = [...source.matchAll(/^starterVersion=([^\r\n]+)\r?$/gmu)];
  if (
    declarations.length !== 1 ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(declarations[0]?.[1] ?? "") ||
    declarations[0]?.[1] !== TEMPLATE_STARTER_JVM_BASELINE
  ) {
    throw new Error(
      `Pinned Template gradle.properties must declare exactly one starterVersion=${TEMPLATE_STARTER_JVM_BASELINE} baseline.`,
    );
  }
  const declaration = declarations[0];
  await writeFile(
    path,
    `${source.slice(0, declaration.index)}starterVersion=${requirements.starterJvmVersion}${source.slice(
      declaration.index! + declaration[0].length,
    )}`,
  );
}

async function normalizeGeneratedAppToolchainPolicy(staging: string) {
  const path = join(staging, "scripts", "toolchain-policy.mjs");
  const source = await readFile(path, "utf8");
  const platformPolicyDeclaration = 'const platformPolicy = readJson("contracts/platform-support-policy.json");\n';
  const platformAlignment = `expectEqual(
  "platform Node exact",
  policy.node,
  platformPolicy.toolchains.node.exact,
);
expectEqual(
  "platform Node range",
  policy.nodeRange,
  platformPolicy.toolchains.node.range,
);
expectEqual("platform npm", policy.npm, platformPolicy.toolchains.npm.exact);
expectEqual(
  "platform Java",
  policy.java,
  platformPolicy.toolchains.java.compile,
);
expectEqual("platform Gradle", policy.gradle, platformPolicy.toolchains.gradle);
expectEqual(
  "platform Spring Boot",
  policy.springBoot,
  platformPolicy.toolchains.springBoot,
);
expectEqual(
  "platform canonical runner",
  policy.canonicalRunner,
  platformPolicy.canonicalHost.os,
);

`;
  if (!source.includes(platformPolicyDeclaration) || !source.includes(platformAlignment)) {
    throw new Error("Pinned Template toolchain policy must declare the platform-support alignment block.");
  }
  const rendered = source.replace(platformPolicyDeclaration, "").replace(platformAlignment, "");
  await writeFile(path, rendered);

  const frontendPackagePath = join(staging, "frontend", "package.json");
  const frontendPackage = JSON.parse(await readFile(frontendPackagePath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  if (!frontendPackage.scripts?.["toolchain:check"])
    throw new Error("Pinned Template frontend package.json must declare toolchain:check.");
  frontendPackage.scripts["toolchain:check"] = "node ../scripts/toolchain-policy.mjs";
  await writeFile(frontendPackagePath, `${JSON.stringify(frontendPackage, null, 2)}\n`);
}

async function normalizeGeneratedAppWorkflowPolicy(staging: string) {
  const path = join(staging, "contracts", "github-actions-policy.json");
  const policy = JSON.parse(await readFile(path, "utf8")) as {
    requiredConcurrencyWorkflows?: Record<string, unknown>;
  };
  if (policy.requiredConcurrencyWorkflows === undefined) {
    policy.requiredConcurrencyWorkflows = {};
  } else if (!policy.requiredConcurrencyWorkflows || Array.isArray(policy.requiredConcurrencyWorkflows)) {
    throw new Error("Pinned Template GitHub Actions policy must declare concurrency workflows as an object.");
  }
  const ciConcurrency = await readCiWorkflowConcurrency(staging);
  if (!Object.prototype.hasOwnProperty.call(policy.requiredConcurrencyWorkflows, "ci.yml")) {
    policy.requiredConcurrencyWorkflows["ci.yml"] = ciConcurrency;
  } else if (!hasExactConcurrencyPolicy(policy.requiredConcurrencyWorkflows["ci.yml"], ciConcurrency)) {
    throw new Error("Pinned Template GitHub Actions ci.yml concurrency policy must exactly match ci.yml.");
  }
  delete policy.requiredConcurrencyWorkflows["template-release.yml"];
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`);
}

async function readCiWorkflowConcurrency(staging: string) {
  const source = await readFile(join(staging, ".github", "workflows", "ci.yml"), "utf8");
  const concurrency = source.match(/^concurrency:\s*\n(?<body>(?:^[ \t]+[^\n]*(?:\n|$))*)/mu)?.groups?.body;
  if (!concurrency) throw new Error("Pinned Template ci.yml must declare a concurrency block.");
  const groups = [...concurrency.matchAll(/^\s+group:\s*(\S(?:.*\S)?)\s*$/gmu)].map(match => match[1]);
  const cancelValues = [...concurrency.matchAll(/^\s+cancel-in-progress:\s*(true|false)\s*$/gmu)].map(
    match => match[1],
  );
  if (groups.length !== 1 || cancelValues.length !== 1) {
    throw new Error("Pinned Template ci.yml concurrency block must declare one group and cancel-in-progress value.");
  }
  return { group: groups[0], cancelInProgress: cancelValues[0] === "true" };
}

function hasExactConcurrencyPolicy(value: unknown, expected: { group: string; cancelInProgress: boolean }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  return (
    Object.keys(policy).length === 2 &&
    policy.group === expected.group &&
    policy.cancelInProgress === expected.cancelInProgress
  );
}

const PROJECT_IDENTITY_BUDGET_STAGE = {
  label: "Project identity",
  baselineMs: 50,
  warningMs: 5000,
  failureMs: 10000,
  baselineRssKiB: 50000,
  warningRssKiB: 131072,
  failureRssKiB: 262144,
};

const DEVELOPMENT_DATABASE_BUDGET_STAGE = {
  label: "Development database modes",
  baselineMs: 500,
  warningMs: 5000,
  failureMs: 10000,
  baselineRssKiB: 80000,
  warningRssKiB: 262144,
  failureRssKiB: 524288,
};

async function normalizeGeneratedAppVerification(staging: string) {
  const path = join(staging, "scripts", "verify.sh");
  const source = await readFile(path, "utf8");
  const templateOnlyStages = [
    "verification-pipeline",
    "vireo-compatibility",
    "public-contract",
    "flagship-demo",
    "flagship-proof",
  ];
  let rendered = source
    .split("\n")
    .filter(line => !templateOnlyStages.some(stage => line.includes(`"${stage}|`)))
    .join("\n");
  if (!rendered.includes('"project-identity|')) {
    const stepsOpening = "steps=(\n";
    if (!rendered.includes(stepsOpening)) throw new Error("Pinned Template verifier must declare a steps array.");
    rendered = rendered.replace(
      stepsOpening,
      `${stepsOpening}  "project-identity|Project identity|node scripts/project-identity-policy.mjs"\n`,
    );
  }
  if (rendered !== source) await writeFile(path, rendered);
  await chmod(path, 0o755);

  const budgetPath = join(staging, "contracts", "verification-budget-policy.json");
  try {
    const budget = JSON.parse(await readFile(budgetPath, "utf8")) as { stages?: Record<string, unknown> };
    if (!budget.stages || typeof budget.stages !== "object") {
      throw new Error("Pinned Template verification budget must declare stages.");
    }
    const stageIds = [...rendered.matchAll(/^\s*"([a-z0-9-]+)\|/gmu)].map(match => match[1]);
    delete budget.stages["public-contract"];
    if (
      stageIds.includes("development-database") &&
      !Object.prototype.hasOwnProperty.call(budget.stages, "development-database")
    )
      budget.stages["development-database"] = DEVELOPMENT_DATABASE_BUDGET_STAGE;
    if (!Object.prototype.hasOwnProperty.call(budget.stages, "project-identity")) {
      budget.stages["project-identity"] = PROJECT_IDENTITY_BUDGET_STAGE;
    } else if (JSON.stringify(budget.stages["project-identity"]) !== JSON.stringify(PROJECT_IDENTITY_BUDGET_STAGE)) {
      throw new Error("Pinned Template project-identity budget stage has unexpected thresholds.");
    }
    await writeFile(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
    const sortedStageIds = stageIds.sort();
    const budgetStageIds = Object.keys(budget.stages).sort();
    if (JSON.stringify(sortedStageIds) !== JSON.stringify(budgetStageIds)) {
      throw new Error(
        `Pinned Template verification stages and budget disagree: verifier=${sortedStageIds.join(",")} budget=${budgetStageIds.join(",")}`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const workflowPath = join(staging, ".github", "workflows", "ci.yml");
  try {
    await replaceTextFile(workflowPath, [["./scripts/verify-template.sh", "./scripts/verify.sh"]]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function replaceApplicationDocumentation(path: string, replacements: Array<[string, string]>) {
  try {
    await replaceTextFile(path, replacements);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Historical and maintainer-only evidence stays in the Template repository, not
 * in projects created from it. Retain the surrounding operational guidance,
 * but render a plain-language reference when that evidence was linked from a
 * copied document. This keeps a projected project self-contained instead of
 * leaving a relative link to an intentionally excluded file.
 */
async function removeExcludedDocumentationLinks(staging: string, profile: VireoProfile) {
  const excludedDocumentation = new Set(
    (applicationProjectionContract.rules ?? [])
      .filter(rule => ["historical", "maintainer-only"].includes(rule.category))
      .flatMap(rule => (rule as { paths?: unknown }).paths ?? [])
      .filter((path): path is string => typeof path === "string" && path.startsWith("docs/") && path.endsWith(".md")),
  );
  const documentationRoots =
    profile === "frontend" ? [join(staging, "docs")] : [join(staging, "docs"), join(staging, "frontend", "docs")];
  for (const documentationRoot of documentationRoots) {
    try {
      for (const path of await walk(documentationRoot)) {
        if (!path.endsWith(".md")) continue;
        const source = await readFile(path, "utf8");
        const documentPath = normalizedRelative(staging, path);
        let rendered = source;
        for (const excludedPath of excludedDocumentation) {
          const relativeTarget = relative(dirname(documentPath), excludedPath).replaceAll("\\", "/");
          const pattern = new RegExp(`\\[([^\\]]+)\\]\\(${escapeRegExp(relativeTarget)}\\)`, "gu");
          rendered = rendered.replace(pattern, "$1");
        }
        if (rendered !== source) await writeFile(path, rendered);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function renderApplicationDocumentation(staging: string, profile: VireoProfile, projectName: string) {
  await replaceApplicationDocumentation(join(staging, "docs", "generated-capabilities.md"), [
    [`${projectName}@${TEMPLATE_VERSION}`, TEMPLATE_TAG],
    [`${projectName}%40${TEMPLATE_VERSION}`, `starter-template%40${TEMPLATE_VERSION}`],
  ]);
  if (profile === "full-stack") {
    await replaceApplicationDocumentation(join(staging, "docs", "comparison.md"), [
      ["[flagship path](flagship.md)", "framework evaluation guidance"],
    ]);
    await replaceApplicationDocumentation(join(staging, "docs", "deployment.md"), [
      [
        "the isolated [flagship demo operations contract](flagship-demo.md). It adds deterministic public seed data, a scoped reset procedure, and an external synthetic journey",
        "an application-owned disposable deployment rehearsal with synthetic data and a scoped reset procedure",
      ],
    ]);
    await replaceApplicationDocumentation(join(staging, "docs", "starter-compatibility.md"), [
      [
        "[Platform support evidence](platform-support-evidence.md).",
        "Project platform-support evidence is application-owned.",
      ],
    ]);
  }
  const frontendDocs = profile === "frontend" ? join(staging, "docs") : join(staging, "frontend", "docs");
  await replaceApplicationDocumentation(join(frontendDocs, "LOADING_STATES.md"), [
    [
      "The [template audit and remediation record](LOADING_STATE_AUDIT.md) records the current route and feature baseline, geometry targets, completed vertical slices, and enforcement contracts.",
      "Maintain a project-owned loading-state audit for current routes, geometry targets, completed vertical slices, and enforcement contracts.",
    ],
  ]);
  await removeExcludedDocumentationLinks(staging, profile);
}

function unresolvedIdentity(field: keyof Omit<ApplicationIdentity, "projectName" | "displayName">) {
  return `UNRESOLVED_VIREO_${field.replace(/([A-Z])/gu, "_$1").toUpperCase()}`;
}

function isUnresolvedIdentity(value: string) {
  return value.startsWith("UNRESOLVED_VIREO_");
}

function assertNoInheritedVireoRoutes(identity: ApplicationIdentity) {
  const forbidden = [
    "github.com/vireocodedev/starter",
    "github.com/vireocodedev/starter-template",
    "github.com/vireocodedev/vireo",
    "github.com/vireocodedev/vireo-template",
  ];
  for (const [field, value] of Object.entries({
    repositoryUrl: identity.repositoryUrl,
    supportUrl: identity.supportUrl,
    securityContact: identity.securityContact,
  })) {
    if (!isUnresolvedIdentity(value) && forbidden.some(route => value.toLowerCase().includes(route))) {
      throw new Error(`${field} must not inherit a Vireo repository, support, or security route.`);
    }
  }
}

function renderedRoute(value: string, label: string) {
  return isUnresolvedIdentity(value) ? `Set ${label} before release.` : `[${label}](${value})`;
}

function githubIssueContactLinks(identity: ApplicationIdentity) {
  const contacts = [
    ["Support", identity.supportUrl, "Use the application support route."],
    ["Security report", identity.securityContact, "Report suspected vulnerabilities privately."],
  ].filter(([, value]) => /^https:\/\/[^\s]+$/u.test(value));
  if (contacts.length === 0) return "contact_links: []\n";
  return `contact_links:\n${contacts
    .map(([name, value, about]) => `  - name: ${name}\n    url: ${JSON.stringify(value)}\n    about: ${about}`)
    .join("\n")}\n`;
}

async function renderPublicIdentity(root: string, identity: ApplicationIdentity, profile: VireoProfile) {
  const securityRoute = renderedRoute(identity.securityContact, "security reporting route");
  const supportRoute = renderedRoute(identity.supportUrl, "support route");
  const profileDescription =
    profile === "frontend"
      ? "A standalone frontend application generated with Vireo integration contracts."
      : "A full-stack application generated with Vireo integration contracts.";
  const frontendAdoptionGuidance =
    profile === "frontend"
      ? "\n\nThis standalone application starts with mock adapters. Replace the adapters exported from src/app/adapters/public.ts when connecting the company API.\n\nThe authoritative local verification host is Ubuntu 24.04 x86-64 with GNU time/coreutils. Other environments may work for development but remain unverified for release evidence."
      : "";
  await writeFile(
    join(root, "README.md"),
    `# ${identity.displayName}\n\n${profileDescription}${frontendAdoptionGuidance}\n\nThis repository is owned by ${isUnresolvedIdentity(identity.ownerName) ? "the application team" : identity.ownerName}. Configure its release identity in .vireo/project.json before publishing or deploying.\n\n## Run locally\n\n\`\`\`bash\ncorepack npm run setup\ncorepack npm run doctor\ncorepack npm run dev\n\`\`\`\n\n## Release readiness\n\nAfter resolving the owner, repository, support, and security routes in .vireo/project.json, run:\n\n\`\`\`bash\ncorepack npm run verify:release\n\`\`\`\n\n## Project routes\n\n- Repository: ${renderedRoute(identity.repositoryUrl, "repository route")}\n- Support: ${supportRoute}\n- Security: ${securityRoute}\n`,
  );
  await writeFile(
    join(root, "SECURITY.md"),
    `# Security policy\n\nReport suspected vulnerabilities through ${securityRoute}\n\nDo not open a public issue with vulnerability details. This project must set a private security route before release.\n`,
  );
  await writeFile(
    join(root, "SUPPORT.md"),
    `# Support\n\nFor help with this application, use ${supportRoute}\n\nApplication owners maintain support for derived projects; framework maintainers do not receive application support requests by default.\n`,
  );
  await writeFile(
    join(root, "CONTRIBUTING.md"),
    `# Contributing\n\nContributions are reviewed by the application owners. Read the project README and use the configured support route for questions.\n`,
  );
  await writeFile(
    join(root, "GOVERNANCE.md"),
    `# Governance\n\nThe application owner is responsible for project decisions, releases, and security response. Update .vireo/project.json with the resolved owner and repository before release.\n`,
  );
  await mkdir(join(root, ".github", "ISSUE_TEMPLATE"), { recursive: true });
  await writeFile(
    join(root, ".github", "ISSUE_TEMPLATE", "config.yml"),
    `blank_issues_enabled: false\n${githubIssueContactLinks(identity)}`,
  );
  await writeFile(
    join(root, ".github", "ISSUE_TEMPLATE", "bug_report.yml"),
    `name: Bug report\ndescription: Report a reproducible application defect.\nbody:\n  - type: textarea\n    attributes:\n      label: What happened?\n    validations:\n      required: true\n`,
  );
  await writeFile(
    join(root, ".github", "ISSUE_TEMPLATE", "feature_request.yml"),
    `name: Feature request\ndescription: Propose an application improvement.\nbody:\n  - type: textarea\n    attributes:\n      label: What problem would this solve?\n    validations:\n      required: true\n`,
  );
  await writeFile(
    join(root, ".github", "pull_request_template.md"),
    `## Summary\n\nDescribe the application change and its verification.\n\n## Checklist\n\n- [ ] I updated application documentation when needed.\n- [ ] I considered support and security impact.\n`,
  );
}

export async function createVireo(options: CreateVireoOptions): Promise<CreateVireoResult> {
  const directory = resolve(options.directory);
  const projectName = options.projectName ?? basename(directory);
  const profile = options.profile ?? "full-stack";
  const productName = options.displayName ?? displayName(projectName);
  const identity: ApplicationIdentity = {
    projectName,
    displayName: productName,
    ownerName: options.ownerName ?? unresolvedIdentity("ownerName"),
    repositoryUrl: options.repositoryUrl ?? unresolvedIdentity("repositoryUrl"),
    supportUrl: options.supportUrl ?? unresolvedIdentity("supportUrl"),
    securityContact: options.securityContact ?? unresolvedIdentity("securityContact"),
  };
  const javaPackage = options.javaPackage ?? `com.example.${javaSuffix(projectName)}`;
  const database = options.database ?? "postgresql";
  const packageManager = options.packageManager ?? "npm";
  assertProjectName(projectName);
  const identityProblems = validateApplicationIdentity(applicationProjectionContract, identity, "creation");
  if (identityProblems.length > 0) throw new Error(`Invalid application identity: ${identityProblems.join("; ")}`);
  assertNoInheritedVireoRoutes(identity);
  if (profile === "full-stack") assertJavaPackage(javaPackage);
  if (profile !== "full-stack" && profile !== "frontend")
    throw new Error("Profile must be `full-stack` or `frontend`.");
  if (profile === "frontend" && (options.javaPackage !== undefined || options.database !== undefined))
    throw new Error("The frontend profile does not accept Java package or database options.");
  if (!(["postgresql", "h2"] as string[]).includes(database)) throw new Error("Database must be `postgresql` or `h2`.");
  if (packageManager !== "npm") throw new Error("Phase 2 supports npm as the canonical package manager.");
  try {
    await stat(directory);
    throw new Error(`Target already exists: ${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const result: CreateVireoResult = {
    directory,
    projectName,
    displayName: productName,
    profile,
    ...(profile === "full-stack" ? { javaPackage, database } : {}),
    packageManager,
    gitInitialized: false,
    templateCommit: TEMPLATE_COMMIT,
    dryRun: options.dryRun ?? false,
  };
  if (options.dryRun) return result;

  await mkdir(dirname(directory), { recursive: true });
  const staging = await mkdtemp(join(dirname(directory), `.${basename(directory)}.vireo-`));
  try {
    if (options.templateDirectory) {
      const templateDirectory = resolve(options.templateDirectory);
      // Dirent-based inspection rejects projected links rather than following
      // a target outside the Template; cp also skips local checkout artifacts.
      await copyLocalTemplateDirectory(templateDirectory, staging);
    } else await downloadTemplate(staging);
    const projectedManagedPaths = await projectTemplate(staging, profile, options.templateDirectory !== undefined);
    await replaceTextFiles(staging, [
      ["com.vireocode.startertemplate", javaPackage],
      ["starter_template", projectName.replaceAll("-", "_")],
      ["starter-template-frontend", `${projectName}-frontend`],
      ["starter-template", projectName],
    ]);
    await renderTemplateIdentity(
      staging,
      createPwaIdentity(projectName, productName),
      profile === "frontend" ? "." : "frontend",
    );
    await renameJavaPackage(staging, javaPackage);
    const frontendPerformancePaths =
      profile === "frontend" ? await projectFrontendTemplate(staging, projectName, productName) : [];
    const fullStackPerformancePaths =
      profile === "full-stack" ? await applyFullStackPerformanceProjection(staging) : [];
    if (profile !== "frontend") {
      await pinGeneratedProjectCli(staging);
      await normalizeGeneratedStarterJvmVersion(staging);
      await normalizeGeneratedAppToolchainPolicy(staging);
      await normalizeGeneratedAppVerification(staging);
      await normalizeGeneratedAppWorkflowPolicy(staging);
    }
    const projectionCompatibilityPaths = await applyProjectionCompatibility(staging, profile);
    await renderProjectIdentityPolicy(staging, profile);
    await renderApplicationDocumentation(staging, profile, projectName);
    await renderPublicIdentity(staging, identity, profile);
    await rm(join(staging, ".vireo", "template.json"), { force: true });
    await mkdir(join(staging, ".vireo"), { recursive: true });
    await writeFile(
      join(staging, ".vireo", "project.json"),
      `${JSON.stringify({ schemaVersion: 1, profile, ...identity, ...(profile === "full-stack" ? { javaPackage, database, databaseName: projectName.replaceAll("-", "_") } : {}), packageManager, templateCommit: TEMPLATE_COMMIT, templateVersion: TEMPLATE_VERSION, templateTag: TEMPLATE_TAG, createdBy: `create-vireo@${CREATE_VIREO_PACKAGE_VERSION}` }, null, 2)}\n`,
    );
    const managedPaths = [
      ...new Set([
        ...projectedManagedPaths,
        ...frontendPerformancePaths,
        ...fullStackPerformancePaths,
        ...projectionCompatibilityPaths,
        ...(profile === "full-stack"
          ? ["package.json", "frontend/package.json", "gradle.properties"]
          : ["package.json"]),
      ]),
    ].sort();
    await writeFile(
      join(staging, ".vireo", "managed-files.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          templateCommit: TEMPLATE_COMMIT,
          files: (
            await Promise.all(
              managedPaths.map(async path => {
                try {
                  return { path, sha256: sha256(await readFile(join(staging, path))) };
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
                  throw error;
                }
              }),
            )
          ).filter((file): file is { path: string; sha256: string } => file !== undefined),
        },
        null,
        2,
      )}\n`,
    );
    await writeExampleManifest(staging, TEMPLATE_COMMIT, profile);
    if (options.git !== false) {
      const initialized = spawnSync("git", ["init", "--quiet"], { cwd: staging });
      if (initialized.status !== 0) throw new Error("Git initialization failed. Retry with `--no-git` or install Git.");
      result.gitInitialized = true;
    }
    await rename(staging, directory);
    return result;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
