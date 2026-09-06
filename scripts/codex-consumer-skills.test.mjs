import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyConsumerSkills, parseArguments, planConsumerSkills } from "./codex-consumer-skills.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vireo-skills-adoption-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "template");
  const target = join(root, "consumer");
  const skill = join(source, ".vireo/application/.agents/skills/vireo-app");
  await mkdir(join(skill, "agents"), { recursive: true });
  await mkdir(join(skill, "references"));
  await mkdir(target);
  await writeFile(join(source, ".vireo/template.json"), "{}\n");
  await writeFile(join(target, "package.json"), '{"name":"legacy-consumer"}\n');
  await writeFile(join(target, "AGENTS.md"), "Existing application guidance\n");
  await writeFile(
    join(skill, "SKILL.md"),
    '---\nname: vireo-app\ndescription: "Use for consumer workflows; not maintainer work."\n---\nRead [workflow](references/workflow.md).\n',
  );
  await writeFile(join(skill, "references/workflow.md"), "# Workflow\nPreserve application ownership.\n");
  await writeFile(
    join(skill, "agents/openai.yaml"),
    'interface:\n  display_name: "Vireo app"\n  short_description: "Consumer workflows"\n  default_prompt: "Use $vireo-app for this task."\n',
  );
  return { root, source, target, skill };
}

test("preview is deterministic and non-writing; approved adoption preserves legacy metadata and source", async t => {
  const options = await fixture(t);
  const initial = await readdir(options.target);
  const plan = await planConsumerSkills(options);
  assert.deepEqual(plan, await planConsumerSkills(options));
  assert.deepEqual(await readdir(options.target), initial);
  assert.equal(plan.files.length, 3);
  assert.ok(plan.files.every(file => file.ownership === "application-owned"));
  await applyConsumerSkills({ ...options, acceptApplicationOwned: true, expectDigest: plan.planDigest });
  assert.equal(await readFile(join(options.target, "AGENTS.md"), "utf8"), "Existing application guidance\n");
  assert.equal(await readFile(join(options.target, "package.json"), "utf8"), '{"name":"legacy-consumer"}\n');
  await assert.rejects(readFile(join(options.target, ".vireo/project.json")), /ENOENT/u);
  for (const file of plan.files)
    assert.deepEqual(
      await readFile(join(options.target, file.path)),
      await readFile(join(options.source, ".vireo/application", file.path)),
    );
  await assert.rejects(planConsumerSkills(options), /not be overwritten/u);
});

test("apply requires explicit acceptance and a current content-bound digest", async t => {
  const options = await fixture(t);
  const plan = await planConsumerSkills(options);
  await assert.rejects(applyConsumerSkills(options), /Apply requires/u);
  await assert.rejects(applyConsumerSkills({ ...options, expectDigest: plan.planDigest }), /Apply requires/u);
  await writeFile(join(options.skill, "references/workflow.md"), "# Changed\n");
  await assert.rejects(
    applyConsumerSkills({ ...options, acceptApplicationOwned: true, expectDigest: plan.planDigest }),
    /Plan changed/u,
  );
  await assert.rejects(readdir(join(options.target, ".agents")), /ENOENT/u);
});

test("target package changes invalidate approval", async t => {
  const options = await fixture(t);
  const plan = await planConsumerSkills(options);
  await writeFile(join(options.target, "package.json"), '{"name":"changed"}\n');
  await assert.rejects(
    applyConsumerSkills({ ...options, acceptApplicationOwned: true, expectDigest: plan.planDigest }),
    /Plan changed/u,
  );
});

test("managed paths are refused even if their files are missing", async t => {
  const options = await fixture(t);
  await mkdir(join(options.target, ".vireo"));
  await writeFile(
    join(options.target, ".vireo/managed-files.json"),
    JSON.stringify({ files: [{ path: ".agents/skills/vireo-app/SKILL.md", sha256: "old" }] }),
  );
  await assert.rejects(planConsumerSkills(options), /Managed path/u);
});

test("rejects existing files and leaves unrelated custom skills untouched", async t => {
  const options = await fixture(t);
  await mkdir(join(options.target, ".agents/skills/custom"), { recursive: true });
  await writeFile(join(options.target, ".agents/skills/custom/SKILL.md"), "custom");
  const plan = await planConsumerSkills(options);
  assert.ok(plan.files.every(file => file.path.startsWith(".agents/skills/vireo-app/")));
  await mkdir(join(options.target, ".agents/skills/vireo-app"));
  await writeFile(join(options.target, ".agents/skills/vireo-app/SKILL.md"), "preserve");
  await assert.rejects(planConsumerSkills(options), /not be overwritten/u);
  assert.equal(await readFile(join(options.target, ".agents/skills/vireo-app/SKILL.md"), "utf8"), "preserve");
});

test("rejects linked source files and linked target ancestors", async t => {
  const options = await fixture(t);
  await symlink(join(options.target, "AGENTS.md"), join(options.skill, "references/linked.md"));
  await assert.rejects(planConsumerSkills(options), /[Ss]ymlink|symbolic links/u);
  await rm(join(options.skill, "references/linked.md"));
  const outside = join(options.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(options.target, ".agents"));
  await assert.rejects(planConsumerSkills(options), /[Ss]ymlink/u);
  assert.deepEqual(await readdir(outside), []);
});

test("rejects a linked target root and nested source/target", async t => {
  const options = await fixture(t);
  const linked = join(options.root, "linked");
  await symlink(options.target, linked);
  await assert.rejects(planConsumerSkills({ ...options, target: linked }), /[Ss]ymlink/u);
  await assert.rejects(planConsumerSkills({ ...options, target: options.source }), /separate/u);
});

test("rejects maintainer targets, malformed ownership and unknown options", async t => {
  const options = await fixture(t);
  await mkdir(join(options.target, ".vireo"));
  await writeFile(join(options.target, ".vireo/template.json"), "{}");
  await assert.rejects(planConsumerSkills(options), /consumer/u);
  await rm(join(options.target, ".vireo/template.json"));
  await writeFile(join(options.target, ".vireo/managed-files.json"), '{"files":false}');
  await assert.rejects(planConsumerSkills(options), /Invalid managed-files/u);
  assert.throws(() => parseArguments(["--force"]), /Unknown option/u);
  assert.throws(() => parseArguments(["--source", "a", "--source", "b"]), /Duplicate/u);
  assert.throws(() => parseArguments(["--target", "--apply"]), /Missing value/u);
});
