import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { validateCodexCustomization } from "./codex-customization-policy.mjs";

async function writeSkill(
  root,
  name,
  body = "",
  description = "Use for a focused test; not unrelated work.",
  skillRoot = ".agents/skills",
) {
  const skill = join(root, skillRoot, name);
  await mkdir(join(skill, "agents"), { recursive: true });
  await writeFile(join(skill, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`);
  await writeFile(
    join(skill, "agents", "openai.yaml"),
    `interface:\n  display_name: "Test Skill"\n  short_description: "A concise test skill description"\n  default_prompt: "Use $${name} for a focused test."\n`,
  );
  return skill;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vireo-codex-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("accepts optional invocation metadata for ordinary skills and literal booleans", async t => {
  const root = await fixture(t);
  const skill = await writeSkill(root, "ordinary-skill");
  const metadata = join(skill, "agents", "openai.yaml");
  const original = await readFile(metadata, "utf8");
  for (const policy of [
    "",
    "policy:\n  allow_implicit_invocation: true\n",
    "policy:\n  allow_implicit_invocation: false # explicit only\n",
  ]) {
    await writeFile(metadata, original + policy);
    assert.deepEqual(validateCodexCustomization(root), [], policy);
  }
});

test("requires literal false invocation policy only for the standard sensitive names", async t => {
  for (const name of ["vireo-release-operator", "vireo-app-operate"]) {
    const root = await fixture(t);
    const skill = await writeSkill(root, name);
    const metadata = join(skill, "agents", "openai.yaml");
    const original = await readFile(metadata, "utf8");
    for (const policy of ["", "policy:\n  allow_implicit_invocation: true\n", "policy:\n  other_setting: false\n"]) {
      await writeFile(metadata, original + policy);
      assert.match(
        validateCodexCustomization(root).join("\n"),
        /requires policy\.allow_implicit_invocation: false/u,
        name,
      );
    }
    await writeFile(metadata, original + "policy:\n  allow_implicit_invocation: false\n");
    assert.deepEqual(validateCodexCustomization(root), []);
  }
});

test("rejects malformed policy and nonliteral invocation values", async t => {
  const root = await fixture(t);
  const skill = await writeSkill(root, "ordinary-skill");
  const metadata = join(skill, "agents", "openai.yaml");
  const original = await readFile(metadata, "utf8");
  const policies = [
    ...['"false"', "'true'", "FALSE", "yes", "null", "0", "", "false extra", "[false]", "|\n    false"].map(
      value => `policy:\n  allow_implicit_invocation: ${value}\n`,
    ),
    "policy: false\n",
    "policy: null\n",
    "policy: []\n",
    "policy:\n",
    "allow_implicit_invocation: false\n",
    "  allow_implicit_invocation: false\n",
    "policy:\n  nested:\n    allow_implicit_invocation: false\n",
    "policy:\n  - allow_implicit_invocation: false\n",
    "policy:\n  allow_implicit_invocation:false\n",
    "policy:\n  allow_implicit_invocation: false\n    nested: true\n",
    "policy:\n  allow_implicit_invocation: false\n  allow_implicit_invocation: true\n",
    "policy:\n  allow_implicit_invocation: false\npolicy:\n  allow_implicit_invocation: false\n",
  ];
  for (const policy of policies) {
    await writeFile(metadata, original + policy);
    assert.notDeepEqual(validateCodexCustomization(root), [], policy);
  }
});

test("requires the frontmatter name to match the skill directory", async t => {
  const root = await fixture(t);
  const skill = await writeSkill(root, "first-skill");
  await rename(skill, join(root, ".agents", "skills", "wrong-folder"));
  assert.match(validateCodexCustomization(root).join("\n"), /name first-skill must match directory wrong-folder/u);
});

for (const target of [
  ".",
  "SKILL.md",
  "agents",
  "agents/openai.yaml",
  "references",
  "references/guide.md",
  "missing.md",
]) {
  test(`rejects a symbolic link at skill path ${target} without following it`, async t => {
    const root = await fixture(t);
    const skill = await writeSkill(root, "linked-skill");
    await mkdir(join(skill, "references"));
    await writeFile(join(skill, "references", "guide.md"), "[external](external-missing.md)\n");
    const source = join(skill, target);
    const destination = join(root, "link-target");
    if (target !== "missing.md") await rename(source, destination);
    await symlink(destination, source);
    const problems = validateCodexCustomization(root).join("\n");
    assert.match(problems, /symbolic links are not allowed/u);
    if (target === "." || target.startsWith("references")) assert.doesNotMatch(problems, /external-missing/u);
  });
}

test("rejects a symbolic-link skill root", async t => {
  const root = await fixture(t);
  await writeSkill(root, "linked-skill");
  const skills = join(root, ".agents", "skills");
  await rename(skills, join(root, "real-skills"));
  await symlink(join(root, "real-skills"), skills);
  assert.match(validateCodexCustomization(root).join("\n"), /symbolic links are not allowed/u);
});

test("accepts complete unique skills with resolvable local links", async () => {
  const root = await mkdtemp(join(tmpdir(), "vireo-codex-policy-"));
  try {
    await writeSkill(root, "first-skill", "Read [guide](../../../guide.md).\n");
    await writeFile(join(root, "guide.md"), "# Guide\n");
    await writeSkill(root, "second-skill");
    assert.deepEqual(validateCodexCustomization(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires descriptions to discriminate triggers from non-triggers", async () => {
  const root = await mkdtemp(join(tmpdir(), "vireo-codex-policy-"));
  try {
    await writeSkill(root, "vague-skill", "", "A generic helper.");
    assert.match(
      validateCodexCustomization(root).join("\n"),
      /description must state both a positive use case and a non-trigger boundary/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checks bundled markdown links relative to their containing document and decodes URI escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vireo-codex-policy-"));
  try {
    await writeSkill(root, "linked-skill", "Read [workflow](references/workflow.md).\n");
    const references = join(root, ".agents", "skills", "linked-skill", "references");
    await mkdir(references);
    await writeFile(join(references, "a guide.md"), "# Guide\n");
    await writeFile(
      join(references, "workflow.md"),
      "[guide](a%20guide.md#steps) [web](https://example.org/missing) [mail](mailto:test@example.org) [anchor](#local)\n",
    );
    assert.deepEqual(validateCodexCustomization(root), []);
    await rm(join(references, "a guide.md"));
    assert.match(
      validateCodexCustomization(root).join("\n"),
      /references\/workflow\.md: relative link a%20guide\.md#steps does not resolve/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects duplicate names, stale coordinates, missing metadata, and bad links", async () => {
  const root = await mkdtemp(join(tmpdir(), "vireo-codex-policy-"));
  try {
    await writeSkill(root, "first-skill", "Uses @vireocodedev/starter-ui and [missing](missing.md).\n");
    const duplicate = join(root, ".agents", "skills", "duplicate-skill");
    await mkdir(duplicate, { recursive: true });
    await writeFile(
      join(duplicate, "SKILL.md"),
      "---\nname: first-skill\ndescription: Duplicate.\n---\nSee /home/example.\n",
    );
    const problems = validateCodexCustomization(root).join("\n");
    assert.match(problems, /duplicate skill name first-skill/u);
    assert.match(problems, /obsolete package coordinate/u);
    assert.match(problems, /relative link missing\.md does not resolve/u);
    assert.match(problems, /must not contain an absolute local path/u);
    assert.match(problems, /missing agents\/openai\.yaml/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scans all supported bundled text files but checks links only in markdown", async t => {
  const root = await fixture(t);
  const skill = await writeSkill(root, "bundled-skill");
  await mkdir(join(skill, "references"));
  for (const extension of ["md", "yaml", "json", "mjs"]) {
    const file = join(skill, "references", `bundle.${extension}`);
    await writeFile(file, '"@vireocodedev/starter-ui /home/example/private"\n');
    const problems = validateCodexCustomization(root).join("\n");
    assert.match(problems, /obsolete.*package coordinate/u, extension);
    assert.match(problems, /must not contain an absolute local path/u, extension);
    await writeFile(file, '"[missing](not-a-document.md)"\n');
    if (extension === "md") assert.match(validateCodexCustomization(root).join("\n"), /does not resolve/u);
    else assert.deepEqual(validateCodexCustomization(root), [], extension);
    await rm(file);
  }
});

test("reports invalid URI escapes without throwing", async t => {
  const root = await fixture(t);
  await writeSkill(root, "linked-skill", "[broken](bad%ZZ.md)\n");
  assert.match(validateCodexCustomization(root).join("\n"), /invalid URI escapes/u);
});

test("accepts titled links and validates relative reference-style link definitions", async t => {
  const root = await fixture(t);
  const skill = await writeSkill(
    root,
    "linked-skill",
    '[guide](<a%20guide.md> "Guide")\n[details][guide]\n[guide]: a%20guide.md#details\n',
  );
  await writeFile(join(skill, "a guide.md"), "# Guide\n");
  assert.deepEqual(validateCodexCustomization(root), []);
  const doc = join(skill, "SKILL.md");
  const contents = await readFile(doc, "utf8");
  await writeFile(doc, contents.replace("[guide]: a%20guide.md#details", "[guide]: missing.md#details"));
  assert.match(validateCodexCustomization(root).join("\n"), /relative link missing\.md#details does not resolve/u);
});

test("requires frontmatter, bounded descriptions, and existing interface metadata", async t => {
  const root = await fixture(t);
  const skill = await writeSkill(root, "metadata-skill");
  for (const header of [
    "",
    "---\nname: metadata-skill\n---\n",
    "---\nname: metadata-skill\ndescription:\nnotes: Use for tests; not other work.\n---\n",
    "---\nname: metadata-skill\ndescription: A helper.\nnotes: Use for tests; not other work.\n---\n",
  ]) {
    await writeFile(join(skill, "SKILL.md"), header);
    assert.notDeepEqual(validateCodexCustomization(root), [], header);
  }
  await writeSkill(root, "metadata-skill");
  const metadata = join(skill, "agents", "openai.yaml");
  const original = await readFile(metadata, "utf8");
  for (const key of ["display_name", "short_description", "default_prompt"]) {
    await writeFile(metadata, original.replace(new RegExp(`^  ${key}:.*\\n`, "mu"), ""));
    assert.match(
      validateCodexCustomization(root).join("\n"),
      new RegExp(`${key} must be a quoted interface string`, "u"),
    );
  }
  await writeFile(metadata, original.replace("$metadata-skill", "$other-skill"));
  assert.match(validateCodexCustomization(root).join("\n"), /default_prompt must mention \$metadata-skill/u);
  await rm(metadata);
  assert.match(validateCodexCustomization(root).join("\n"), /missing agents\/openai\.yaml/u);
});

test("supports default and custom roots and rejects names duplicated across roots", async t => {
  const root = await fixture(t);
  await writeSkill(root, "vireo-framework");
  const personalRoot = "docs/codex/skills";
  await writeSkill(root, "vireo", "", undefined, personalRoot);
  assert.deepEqual(validateCodexCustomization(root), []);
  const duplicate = await writeSkill(root, "vireo-framework", "", undefined, personalRoot);
  assert.match(validateCodexCustomization(root).join("\n"), /duplicate skill name vireo-framework/u);
  await rm(duplicate, { recursive: true });
  await writeSkill(root, "custom-skill", "[missing](missing.md)", undefined, "custom-skills");
  assert.deepEqual(validateCodexCustomization(root), []);
  for (const skillRoot of ["custom-skills", join(root, "custom-skills")]) {
    assert.match(
      validateCodexCustomization(root, [skillRoot]).join("\n"),
      /relative link missing\.md does not resolve/u,
    );
  }
});

async function assertSkillSet(skillRoot, expected) {
  assert.deepEqual((await readdir(skillRoot)).sort(), [...expected].sort());
  for (const name of expected) {
    await readFile(join(skillRoot, name, "SKILL.md"), "utf8");
    await readFile(join(skillRoot, name, "agents", "openai.yaml"), "utf8");
  }
}

test("checked-in framework harness is valid and contains all required framework skills", async () => {
  const root = resolve(import.meta.dirname, "..");
  assert.deepEqual(validateCodexCustomization(root), []);
  await assertSkillSet(join(root, ".agents", "skills"), [
    "starter-ui-component-author",
    "vireo-framework-readiness-auditor",
    "vireo-generator-maintainer",
    "vireo-jvm-module-author",
    "vireo-npm-package-author",
    "vireo-release-operator",
    "vireo-framework",
    "vireo-project-create",
  ]);
  const personalRoot = join(root, "docs", "codex", "skills");
  if (existsSync(personalRoot)) await assertSkillSet(personalRoot, ["vireo"]);
});
