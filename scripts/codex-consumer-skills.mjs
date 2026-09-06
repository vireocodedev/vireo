import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCodexCustomization } from "./codex-customization-policy.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const skillName = /^vireo-app(?:-[a-z0-9]+)*$/u;

async function info(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Refuse existing symlink ancestors, including an explicitly supplied linked root.
// As with ordinary repository edits, the caller must exclude concurrent writers;
// these checks are not an OS sandbox against a hostile filesystem race.
async function checkedPath(path) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const segment of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, segment);
    const state = await info(current);
    if (state?.isSymbolicLink()) throw new Error(`Symlink is not permitted: ${current}`);
    if (state && current !== absolute && !state.isDirectory())
      throw new Error(`Ancestor is not a directory: ${current}`);
  }
  return absolute;
}

async function requireDirectory(path) {
  await checkedPath(path);
  if (!(await info(path))?.isDirectory()) throw new Error(`Directory is required: ${path}`);
}

async function readRegular(path, optional = false) {
  await checkedPath(path);
  const state = await info(path);
  if (!state && optional) return null;
  if (!state?.isFile()) throw new Error(`Regular file is required: ${path}`);
  if (state.size > 1024 * 1024) throw new Error(`Guidance or metadata file exceeds 1 MiB: ${path}`);
  return readFile(path);
}

function contains(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

async function collect(directory, root = directory) {
  await requireDirectory(directory);
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not permitted: ${path}`);
    if (entry.isDirectory()) files.push(...(await collect(path, root)));
    else if (entry.isFile()) files.push({ relative: relative(root, path).split(sep).join("/"), path });
    else throw new Error(`Unsupported filesystem entry: ${path}`);
  }
  return files;
}

/** Non-writing, content-addressed plan. This is skills adoption, not a project upgrade. */
export async function planConsumerSkills({ source, target }) {
  if (!source || !target) throw new Error("Both --source and --target are required.");
  const sourceRoot = await checkedPath(source);
  const targetRoot = await checkedPath(target);
  await requireDirectory(sourceRoot);
  await requireDirectory(targetRoot);
  if (contains(sourceRoot, targetRoot) || contains(targetRoot, sourceRoot))
    throw new Error("Source and target must be separate, non-nested repositories.");
  await readRegular(join(sourceRoot, ".vireo/template.json"));
  const sourceSkills = join(sourceRoot, ".vireo/application/.agents/skills");
  await requireDirectory(sourceSkills);
  for (const marker of [".vireo/template.json", "contracts/ecosystem-release-contract.json"]) {
    await checkedPath(join(targetRoot, marker));
    if (await info(join(targetRoot, marker)))
      throw new Error("Target must be a consumer, not a Vireo maintainer repository.");
  }
  const context = [];
  let managed = null;
  for (const path of ["package.json", "frontend/package.json", ".vireo/project.json", ".vireo/managed-files.json"]) {
    const bytes = await readRegular(join(targetRoot, path), path !== "package.json");
    if (bytes !== null) {
      const value = JSON.parse(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid JSON object: ${path}`);
      if (path === ".vireo/managed-files.json") managed = value;
    }
    context.push({ path, sha256: bytes === null ? null : digest(bytes) });
  }
  if (managed && (!Array.isArray(managed.files) || managed.files.some(file => typeof file?.path !== "string")))
    throw new Error("Invalid managed-files inventory; resolve ownership before adoption.");
  const managedPaths = new Set(managed?.files.map(file => file.path) ?? []);
  const names = (await readdir(sourceSkills)).filter(name => skillName.test(name)).sort();
  if (!names.includes("vireo-app")) throw new Error("Source must provide the vireo-app router.");
  const problems = validateCodexCustomization(
    sourceRoot,
    names.map(name => join(sourceSkills, name)),
  );
  if (problems.length) throw new Error(`Source skills are invalid:\n${problems.join("\n")}`);
  const files = [];
  for (const name of names) {
    const base = join(sourceSkills, name);
    await readRegular(join(base, "SKILL.md"));
    await readRegular(join(base, "agents/openai.yaml"));
    for (const file of await collect(base)) {
      const path = `.agents/skills/${name}/${file.relative}`;
      const destination = join(targetRoot, path);
      await checkedPath(destination);
      if (managedPaths.has(path)) throw new Error(`Managed path cannot be adopted as application-owned: ${path}`);
      if (await info(destination)) throw new Error(`Existing path will not be overwritten: ${path}`);
      const bytes = await readRegular(file.path);
      files.push({
        path,
        sha256: digest(bytes),
        bytes: bytes.length,
        action: "create",
        ownership: "application-owned",
      });
    }
  }
  const plan = { schemaVersion: 1, sourceRoot, targetRoot, context, files };
  return { ...plan, planDigest: digest(JSON.stringify(plan)) };
}

/** Applies only an approved missing-file plan. Existing files/metadata are never changed. */
export async function applyConsumerSkills(options) {
  if (options.acceptApplicationOwned !== true || !/^[a-f0-9]{64}$/u.test(options.expectDigest ?? ""))
    throw new Error("Apply requires --accept-application-owned and the preview's --expect-digest.");
  const plan = await planConsumerSkills(options);
  if (plan.planDigest !== options.expectDigest)
    throw new Error("Plan changed; preview again before authorizing apply.");
  const createdFiles = [];
  const createdDirectories = [];
  async function ensureDirectory(path) {
    await checkedPath(path);
    const state = await info(path);
    if (state) {
      if (!state.isDirectory()) throw new Error(`Directory is required: ${path}`);
      return;
    }
    await ensureDirectory(dirname(path));
    await mkdir(path);
    createdDirectories.push(path);
  }
  try {
    for (const file of plan.files) {
      const bytes = await readRegular(join(plan.sourceRoot, ".vireo/application", file.path));
      if (digest(bytes) !== file.sha256) throw new Error(`Source changed during apply: ${file.path}`);
      const target = join(plan.targetRoot, file.path);
      await ensureDirectory(dirname(target));
      await checkedPath(target);
      await writeFile(target, bytes, { flag: "wx", mode: 0o644 });
      createdFiles.push({ path: target, sha256: file.sha256 });
    }
  } catch (error) {
    // Roll back only our unchanged new files and now-empty directories.
    for (const file of createdFiles.reverse()) {
      try {
        const bytes = await readRegular(file.path, true);
        if (bytes !== null && digest(bytes) === file.sha256) await unlink(file.path);
      } catch {
        /* Preserve any concurrent modification rather than deleting it. */
      }
    }
    for (const path of createdDirectories.reverse()) {
      try {
        await rmdir(path);
      } catch {
        /* Nonempty or redirected paths are preserved. */
      }
    }
    throw error;
  }
  return { ...plan, applied: true };
}

export function parseArguments(args) {
  const options = {};
  const seen = new Set();
  const values = { "--source": "source", "--target": "target", "--expect-digest": "expectDigest" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (Object.hasOwn(values, flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value: ${flag}`);
      options[values[flag]] = value;
    } else if (flag === "--apply") options.apply = true;
    else if (flag === "--accept-application-owned") options.acceptApplicationOwned = true;
    else if (flag === "--help") options.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Preview: node scripts/codex-consumer-skills.mjs --source <template-root> --target <app-root>\nApply: add --apply --accept-application-owned --expect-digest <preview-digest>\nOnly missing vireo-app skills are copied. No application source, AGENTS.md, or ownership metadata is changed.",
      );
    } else {
      const result = options.apply ? await applyConsumerSkills(options) : await planConsumerSkills(options);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
