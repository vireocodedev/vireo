import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const obsoleteCoordinates = ["@vireocodedev/starter-ui"];
const absoluteLocalPath = /(?:^|[\s"'`(<])(?:\/(?:home|Users|tmp)\/|[A-Za-z]:[\\/])/u;
const sensitiveSkills = new Set(["vireo-release-operator", "vireo-app-operate"]);

// Check the optional block-style policy without interpreting YAML strings as booleans.
function validateInvocationPolicy(yaml, metadata, name, problems) {
  const lines = yaml.split(/\r?\n/u).filter(line => !/^\s*(?:#.*)?$/u.test(line));
  const policies = lines.filter(line => /^\s*policy\s*:/u.test(line));
  const declarations = lines.filter(line => /^\s*allow_implicit_invocation\s*:/u.test(line));
  let children = [];
  let indentation = "";
  if (policies.length > 0) {
    const start = lines.indexOf(policies[0]);
    const end = lines.findIndex((line, index) => index > start && /^\S/u.test(line));
    children = lines.slice(start + 1, end === -1 ? undefined : end);
    indentation = children[0]?.match(/^ +/u)?.[0] ?? "";
    if (
      policies.length !== 1 ||
      !/^policy:[ \t]*(?:#.*)?$/u.test(policies[0]) ||
      !indentation ||
      children.some(line => !line.startsWith(indentation)) ||
      children.some(line => {
        const entry = line.slice(indentation.length);
        return !entry.startsWith(" ") && !/^[\w-]+:/u.test(entry);
      })
    ) {
      problems.push(`${metadata}: policy must be a single block mapping`);
      children = [];
    }
  }

  let allowImplicitInvocation;
  if (declarations.length > 0) {
    const declaration = declarations[0];
    const value = declaration.match(/allow_implicit_invocation:[ \t]+(true|false)(?:[ \t]+#.*)?[ \t]*$/u)?.[1];
    const nextChild = children[children.indexOf(declaration) + 1];
    if (
      declarations.length !== 1 ||
      !children.includes(declaration) ||
      declaration.match(/^ */u)[0] !== indentation ||
      nextChild?.startsWith(`${indentation} `) ||
      !value
    )
      problems.push(`${metadata}: policy.allow_implicit_invocation must be a single literal true or false`);
    else allowImplicitInvocation = value === "true";
  }
  if (sensitiveSkills.has(name) && allowImplicitInvocation !== false)
    problems.push(`${metadata}: ${name} requires policy.allow_implicit_invocation: false`);
}

function walkFiles(directory, problems) {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isSymbolicLink()) {
    problems.push(`${directory}: symbolic links are not allowed`);
    return [];
  }
  if (!stat.isDirectory()) {
    problems.push(`${directory}: skill root must be a directory`);
    return [];
  }
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) problems.push(`${path}: symbolic links are not allowed`);
    else if (entry.isDirectory()) result.push(...walkFiles(path, problems));
    else if (entry.isFile()) result.push(path);
    else problems.push(`${path}: only regular skill files and directories are allowed`);
  }
  return result;
}

function frontmatter(contents) {
  return contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u)?.[1];
}

function yamlString(contents, key) {
  const value = contents.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "mu"))?.[1]?.trim();
  return value?.match(/^"(.*)"$/u)?.[1];
}

function localMarkdownLinks(contents) {
  const inline = contents.matchAll(/\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gu);
  const definitions = contents.matchAll(/^[ \t]{0,3}\[[^\]]+\]:[ \t]*(<[^>]+>|\S+)/gmu);
  return [...inline, ...definitions].map(match => match[1].replace(/^<|>$/gu, ""));
}

function hasRoutingBoundary(description) {
  return /\buse for\b/iu.test(description) && /\bnot\b/iu.test(description);
}

function validateSkill(path, files, names, problems) {
  const contents = readFileSync(path, "utf8");
  const header = frontmatter(contents);
  if (!header) {
    problems.push(`${path}: missing YAML frontmatter`);
    return;
  }
  const name = header.match(/^name:\s*([a-z0-9-]+)\s*$/mu)?.[1];
  const description = header.match(/^description:[ \t]*([^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*)/mu)?.[1]?.trim();
  if (!name) problems.push(`${path}: frontmatter name must use lowercase letters, digits, and hyphens`);
  else if (names.has(name)) problems.push(`${path}: duplicate skill name ${name} (also ${names.get(name)})`);
  else names.set(name, path);
  if (name && name !== basename(dirname(path)))
    problems.push(`${path}: name ${name} must match directory ${basename(dirname(path))}`);
  if (!description) problems.push(`${path}: missing frontmatter description`);
  else if (!hasRoutingBoundary(description))
    problems.push(`${path}: description must state both a positive use case and a non-trigger boundary`);

  const metadata = join(dirname(path), "agents", "openai.yaml");
  if (!files.has(metadata)) problems.push(`${path}: missing agents/openai.yaml (regular file required)`);
  else {
    const yaml = readFileSync(metadata, "utf8");
    for (const key of ["display_name", "short_description", "default_prompt"]) {
      if (!yamlString(yaml, key)) problems.push(`${metadata}: ${key} must be a quoted interface string`);
    }
    if (name && !yamlString(yaml, "default_prompt")?.includes(`$${name}`))
      problems.push(`${metadata}: default_prompt must mention $${name}`);
    validateInvocationPolicy(yaml, metadata, name, problems);
  }
}

function validateBundleFile(path, problems) {
  if (![".md", ".yaml", ".json", ".mjs"].includes(extname(path))) return;
  const contents = readFileSync(path, "utf8");
  for (const coordinate of obsoleteCoordinates) {
    if (contents.includes(coordinate)) problems.push(`${path}: obsolete package coordinate ${coordinate}`);
  }
  if (absoluteLocalPath.test(contents)) problems.push(`${path}: must not contain an absolute local path`);

  if (extname(path) !== ".md") return;
  for (const target of localMarkdownLinks(contents)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(target)) continue;
    let localTarget;
    try {
      localTarget = decodeURIComponent(target.split(/[?#]/u, 1)[0]);
    } catch {
      problems.push(`${path}: relative link ${target} has invalid URI escapes`);
      continue;
    }
    if (!localTarget) continue;
    const resolved = resolve(dirname(path), localTarget);
    if (!existsSync(resolved)) problems.push(`${path}: relative link ${target} does not resolve`);
  }
}

export function validateCodexCustomization(root = process.cwd(), skillRoots = [".agents/skills", "docs/codex/skills"]) {
  const problems = [];
  const names = new Map();
  for (const skillRoot of skillRoots) {
    const files = new Set(walkFiles(resolve(root, skillRoot), problems));
    for (const path of files) {
      if (basename(path) === "SKILL.md") validateSkill(path, files, names, problems);
      validateBundleFile(path, problems);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(process.cwd());
  const problems = validateCodexCustomization(root);
  if (problems.length > 0) {
    console.error("Codex customization policy failed:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else console.log("Codex customization policy passed.");
}
