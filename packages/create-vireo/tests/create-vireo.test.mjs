import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateCodexCustomization } from "../../../scripts/codex-customization-policy.mjs";
import {
  createVireo,
  findExampleReferences,
  removeExample,
  renderFrontendDoctorScript,
  TEMPLATE_COMMIT,
  vireoProjectStatus,
} from "../dist/index.js";

const createVireoVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const fixtureReleaseIdentity = JSON.parse(
  await readFile(new URL("../fixtures/release-identity.json", import.meta.url), "utf8"),
);
const createVireoSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const applicationSkillNames = [
  "vireo-app",
  "vireo-app-feature-author",
  "vireo-app-upgrader",
  "vireo-app-production-readiness",
  "vireo-app-generate",
  "vireo-app-operate",
];
const fixtureTemplateTag = `starter-template@${fixtureReleaseIdentity.createVireoVersion}`;
const fixtureTemplateReleaseContractUrl =
  `https://github.com/vireocodedev/vireo-template/blob/${encodeURIComponent(fixtureTemplateTag)}` +
  "/contracts/template-release-policy.json";
const immutable084ArchitectureCheck =
  "node --test scripts/architecture-policy.test.mjs && node scripts/check-architecture.mjs";
const immutable086ArchitectureCheck =
  "node --test scripts/architecture-policy.test.mjs scripts/storybook-config-policy.test.mjs && node scripts/check-architecture.mjs";

function gradleProperties(starterVersion) {
  return `org.gradle.caching=true\nstarterVersion=${starterVersion}\norg.gradle.jvmargs=-Xmx2g\n`;
}

function differentStarterVersion(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

test("test fixture release identity tracks the private create-vireo version and raw Template baseline", () => {
  assert.equal(fixtureReleaseIdentity.schemaVersion, 1);
  assert.equal(fixtureReleaseIdentity.createVireoVersion, createVireoVersion);
  assert.equal(
    fixtureReleaseIdentity.templateStarterJvmBaseline,
    createVireoSource.match(/TEMPLATE_STARTER_JVM_BASELINE = "([^"]+)"/u)?.[1],
  );
  assert.match(fixtureReleaseIdentity.generatedStarterJvmVersion, /^\d+\.\d+\.\d+$/u);
});

test("fresh frontend Doctor projection matches the frozen 0.8.2 upgrade byte contract", async () => {
  // Formatting is part of the public managed-byte contract: use the package's
  // checked-in projection path so Prettier resolves the same repository config.
  const path = fileURLToPath(new URL("../fixtures/project-upgrades/vireo-frontend-doctor.0.8.1.mjs", import.meta.url));
  const rendered = await renderFrontendDoctorScript(path);
  const target = JSON.parse(
    await readFile(
      new URL("../fixtures/project-upgrades/vireo-frontend-doctor.0.8.2.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  const upgradePolicy = JSON.parse(
    await readFile(new URL("../schema/vireo-upgrade-policy.json", import.meta.url), "utf8"),
  );
  const baseline = upgradePolicy.releaseGraph.baselines["0.8.1->0.8.2"].frontend.find(
    file => file.path === "scripts/vireo-frontend-doctor.mjs",
  );
  const digest = createHash("sha256").update(rendered).digest("hex");
  assert.equal(digest, target.sha256);
  assert.equal(Buffer.byteLength(rendered), target.bytes);
  assert.equal(digest, baseline.targetSha256);
});

async function writeApplicationSkill(template, name) {
  const skill = join(template, ".vireo", "application", ".agents", "skills", name);
  await mkdir(join(skill, "agents"), { recursive: true });
  const workflow = name === "vireo-app" ? "references/workflow.md" : "../vireo-app/references/workflow.md";
  await writeFile(
    join(skill, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use for consumer fixture work; not maintainer operations.\n---\nRead [workflow](${workflow}).\n`,
  );
  await writeFile(
    join(skill, "agents", "openai.yaml"),
    `interface:\n  display_name: "Fixture App Skill"\n  short_description: "Fixture consumer skill"\n  default_prompt: "Use $${name} for fixture work."\n${name === "vireo-app-operate" ? "policy:\n  allow_implicit_invocation: false\n" : ""}`,
  );
  if (name === "vireo-app") {
    await mkdir(join(skill, "references"));
    await writeFile(
      join(skill, "references/workflow.md"),
      "# Application workflow\nPreserve application-owned source.\n",
    );
  }
}

async function assertProjectedApplicationGuidance(target) {
  assert.match(await readFile(join(target, "AGENTS.md"), "utf8"), /Application guidance/u);
  const managed = JSON.parse(await readFile(join(target, ".vireo", "managed-files.json"), "utf8"));
  const managedPaths = new Set(managed.files.map(file => file.path));
  assert.equal(managedPaths.has("AGENTS.md"), false, "application-owned AGENTS.md is not managed");
  for (const name of applicationSkillNames) {
    assert.match(await readFile(join(target, ".agents", "skills", name, "SKILL.md"), "utf8"), new RegExp(name, "u"));
    assert.equal(managedPaths.has(`.agents/skills/${name}/SKILL.md`), true, `${name} skill is managed`);
    assert.equal(managedPaths.has(`.agents/skills/${name}/agents/openai.yaml`), true, `${name} metadata is managed`);
  }
  assert.equal(managedPaths.has(".agents/skills/vireo-app/references/workflow.md"), true);
  assert.deepEqual(validateCodexCustomization(target), [], "projected references and metadata remain valid");
  await assert.rejects(readFile(join(target, ".agents", "skills", "vireo-template-maintainer", "SKILL.md")), /ENOENT/u);
}

async function fixture(root) {
  const template = join(root, "template");
  await mkdir(join(template, ".vireo"), { recursive: true });
  await mkdir(join(template, ".vireo", "application"), { recursive: true });
  await mkdir(join(template, ".agents", "skills", "vireo-template-maintainer", "agents"), { recursive: true });
  await mkdir(join(template, "src/main/java/com/vireocode/startertemplate"), { recursive: true });
  await writeFile(join(template, ".vireo/template.json"), "{}\n");
  await writeFile(join(template, "AGENTS.md"), "# Template maintainer guidance\n");
  await writeFile(
    join(template, ".agents", "skills", "vireo-template-maintainer", "SKILL.md"),
    "---\nname: vireo-template-maintainer\ndescription: Fixture maintainer skill.\n---\n",
  );
  await writeFile(
    join(template, ".agents", "skills", "vireo-template-maintainer", "agents", "openai.yaml"),
    'interface:\n  display_name: "Fixture Template Maintainer"\n  short_description: "Fixture maintainer skill"\n  default_prompt: "Use $vireo-template-maintainer for fixture work."\n',
  );
  await writeFile(join(template, ".vireo", "application", "AGENTS.md"), "# Application guidance\n");
  for (const name of applicationSkillNames) await writeApplicationSkill(template, name);
  await mkdir(join(template, ".github"), { recursive: true });
  await mkdir(join(template, ".github", "workflows"), { recursive: true });
  await mkdir(join(template, "contracts"), { recursive: true });
  await mkdir(join(template, "docs"), { recursive: true });
  await mkdir(join(template, "scripts"), { recursive: true });
  await mkdir(join(template, ".vscode"), { recursive: true });
  await writeFile(
    join(template, ".github/dependabot.yml"),
    "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /frontend\n",
  );
  await writeFile(
    join(template, ".github/workflows/ci.yml"),
    "concurrency:\n  group: verify-${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\nsteps:\n  - run: ./scripts/verify-template.sh silent\n",
  );
  await writeFile(
    join(template, "contracts/github-actions-policy.json"),
    JSON.stringify({
      requiredConcurrencyWorkflows: {
        "ci.yml": { group: "verify-${{ github.workflow }}-${{ github.ref }}", cancelInProgress: true },
        "template-release.yml": {},
      },
    }),
  );
  await writeFile(
    join(template, "scripts/verify.sh"),
    '#!/usr/bin/env bash\nset -euo pipefail\nsteps=(\n  "development-database|Development database modes|true"\n)\n',
  );
  await writeFile(
    join(template, "docs/generated-capabilities.md"),
    `The [\`${fixtureTemplateTag}\` release contract](${fixtureTemplateReleaseContractUrl}) is immutable.\n`,
  );
  for (const directory of ["docs", "frontend/docs"]) {
    await mkdir(join(template, directory), { recursive: true });
    for (const filename of ["database-recovery.md", "incident-response.md", "operations.md"]) {
      await writeFile(
        join(template, directory, filename),
        `The [maintainer rehearsal](hosted-demo-recovery-rehearsal-2026-09-01.md) is retained upstream.\n`,
      );
    }
  }
  for (const path of [
    "docs/provider-controls-2026-08-31.md",
    "docs/hosted-demo-recovery-rehearsal-2026-09-01.md",
    "docs/verification-trend-review-2026-09-01.md",
    "scripts/repository-security-policy.mjs",
  ]) {
    await writeFile(join(template, path), "maintainer-only fixture\n");
  }
  await writeFile(
    join(template, "scripts/toolchain-policy.mjs"),
    `const policy = readJson("contracts/toolchain-policy.json");
const platformPolicy = readJson("contracts/platform-support-policy.json");
expectEqual(
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

export {};
`,
  );
  await writeFile(
    join(template, ".vscode/settings.json"),
    '{"java.import.gradle.enabled":true,"files.exclude":{"frontend/dist":true}}\n',
  );
  await writeFile(join(template, "settings.gradle"), "rootProject.name = 'starter-template'\n");
  await writeFile(
    join(template, "gradle.properties"),
    gradleProperties(fixtureReleaseIdentity.templateStarterJvmBaseline),
  );
  await writeFile(join(template, "README.md"), "# Vireo Starter Template\n");
  await writeFile(
    join(template, "package.json"),
    JSON.stringify({
      name: "starter-template",
      version: "0.6.0",
      scripts: {
        vireo: "npx --yes --package=create-vireo@0.3.0 vireo",
        "release:policy": "node scripts/template-release-policy.mjs",
      },
    }),
  );
  await mkdir(join(template, "frontend/src/app/ui/localization/resources"), { recursive: true });
  await mkdir(join(template, "frontend/public/icons"), { recursive: true });
  await mkdir(join(template, "frontend/tests/pwa"), { recursive: true });
  await mkdir(join(template, "frontend/tests/demo"), { recursive: true });
  await mkdir(join(template, "frontend/tests/deployment"), { recursive: true });
  await mkdir(join(template, "frontend/tests/e2e"), { recursive: true });
  await mkdir(join(template, "frontend/tests/integration"), { recursive: true });
  await mkdir(join(template, "frontend/tests/unit"), { recursive: true });
  await mkdir(join(template, "frontend/scripts"), { recursive: true });
  await mkdir(join(template, "frontend/src/app/shell/layout"), { recursive: true });
  await mkdir(join(template, "frontend/docs/architecture"), { recursive: true });
  await writeFile(
    join(template, "frontend/package.json"),
    JSON.stringify({
      name: "starter-template-frontend",
      version: "0.6.0",
      scripts: {
        dev: "vite",
        build: "vite build",
        typecheck: "tsc --noEmit",
        lint: "eslint src",
        format: "prettier --write .",
        "format:check": "prettier --check .",
        test: "vitest run",
        "test:storybook": "vitest --run",
        storybook: "storybook dev",
        "build-storybook": "storybook build",
        "starter:mode:published": "node scripts/mode.mjs",
        "starter:boundary:check": "node scripts/boundary.mjs",
        "architecture:check": immutable084ArchitectureCheck,
        "bundle:check": "node scripts/bundle.mjs",
        "performance:policy:test":
          "node --test scripts/lighthouse-policy.test.mjs scripts/lighthouse-audit-support.test.mjs",
        "performance:audit": "corepack npm run performance:policy:test && node scripts/lighthouse-budget.mjs",
        "pwa:check:source": "node scripts/check-pwa-contract.mjs --source --require-nginx",
        "pwa:check:built": "node scripts/check-pwa-contract.mjs --built",
        "pretest:pwa": "node scripts/prepare-pwa-update-fixture.mjs",
        "test:pwa": "playwright test --config=playwright.pwa.config.ts",
        "toolchain:check": "node ../scripts/toolchain-policy.mjs && node ../scripts/platform-support-policy.mjs",
        preview: "vite preview",
      },
      dependencies: { "@vireocodedev/ui": "^0.2.2" },
    }),
  );
  await writeFile(
    join(template, "frontend/package-lock.json"),
    JSON.stringify({
      name: "starter-template-frontend",
      version: "0.6.0",
      lockfileVersion: 3,
      packages: { "": { name: "starter-template-frontend", version: "0.6.0" } },
    }),
  );
  await writeFile(join(template, "frontend/vite.config.ts"), 'import { createPwaManifest } from "./pwa-policy.mjs";\n');
  const candidatePolicy = JSON.parse(
    await readFile(new URL("../schema/vireo-upgrade-policy.json", import.meta.url), "utf8"),
  );
  const activeTarget = candidatePolicy.releaseGraph.candidateRelease ?? candidatePolicy.releaseGraph.publicRelease;
  const activeEdge = `${candidatePolicy.releaseGraph.previousRelease}->${activeTarget}`;
  const storybookBaseline = candidatePolicy.releaseGraph.baselines[activeEdge]["full-stack"].find(
    file => file.path === "frontend/vitest.storybook.config.ts",
  );
  await writeFile(join(template, "frontend/vitest.storybook.config.ts"), storybookBaseline.sourceContent);
  const storybookConfigPolicyBaseline = candidatePolicy.releaseGraph.baselines[activeEdge]["full-stack"].find(
    file => file.path === "frontend/scripts/storybook-config-policy.test.mjs",
  );
  if (storybookConfigPolicyBaseline?.sourceContent !== undefined) {
    await writeFile(
      join(template, "frontend/scripts/storybook-config-policy.test.mjs"),
      storybookConfigPolicyBaseline.sourceContent,
    );
  }
  await writeFile(
    join(template, "frontend/pwa-policy.mjs"),
    `export const APP_IDENTITY = Object.freeze({
  id: "/vireo-starter",
  name: "Vireo Starter",
  shortName: "Vireo",
  description: "A production-oriented full-stack PWA built on Vireo Starter.",
});
`,
  );
  await writeFile(
    join(template, "frontend/scripts/pwa-contract.mjs"),
    "// Item PWA contract\nexport const checkPwaSourceContract = () => []; export const formatPwaContractProblems = () => '';\n",
  );
  await writeFile(join(template, "frontend/scripts/architecture-policy.test.mjs"), "// Item architecture contract\n");
  await writeFile(join(template, "frontend/scripts/check-pwa-contract.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/prepare-pwa-update-fixture.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/serve-pwa-update-fixture.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/pwa-update-fixture.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/pwa-update-fixture.d.mts"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/app-identity-html.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/lighthouse-audit-support.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/lighthouse-audit-support.test.mjs"), "export {};\n");
  await writeFile(
    join(template, "frontend/scripts/lighthouse-budget.mjs"),
    'const evidenceDirectory = path.resolve(frontendRoot, "../.performance-evidence");\n',
  );
  await writeFile(join(template, "frontend/scripts/lighthouse-policy.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/lighthouse-policy.test.mjs"), "export {};\n");
  await writeFile(join(template, "frontend/scripts/verify.sh"), "#!/usr/bin/env bash\nset -euo pipefail\n");
  await writeFile(
    join(template, "frontend/tests/pwa/production-pwa.spec.ts"),
    "// Item production PWA contract\nexport {};\n",
  );
  await writeFile(
    join(template, "frontend/tests/deployment/item-persistence.spec.ts"),
    "// Item deployment persistence\n",
  );
  await writeFile(join(template, "frontend/tests/demo/flagship-demo.spec.ts"), "export {};\n");
  await writeFile(join(template, "frontend/tests/deployment/smoke.spec.ts"), "export {};\n");
  await writeFile(join(template, "frontend/tests/e2e/login.spec.ts"), "export {};\n");
  await writeFile(join(template, "frontend/tests/e2e/overview.spec.ts"), "export {};\n");
  await writeFile(join(template, "frontend/playwright.demo.config.ts"), "export {};\n");
  await writeFile(join(template, "frontend/playwright.deployment.config.ts"), "export {};\n");
  await writeFile(
    join(template, "frontend/src/app/shell/layout/AppPageHeader.stories.tsx"),
    'export const Default = { args: { title: "Items", description: "Manage items.", label: "Create item" } };\n',
  );
  await writeFile(
    join(template, "frontend/tests/integration/app-page-header.integration.test.tsx"),
    'const title = "Items"; const description = "Manage workspace items."; const label = "Create item";\n',
  );
  await writeFile(
    join(template, "frontend/tests/integration/app-shell-layout.integration.test.tsx"),
    `const navigationLabel = "Items";
const VireoMobileBottomNavigation = ({
    items,
    onChange,
  }: {
    items: readonly { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => items.map(item => item.label);
`,
  );
  await writeFile(
    join(template, "frontend/tests/integration/session-expiry.integration.test.tsx"),
    'const route = "/items?search=active"; const label = "Items";\n',
  );
  await writeFile(
    join(template, "frontend/tests/unit/app-query-error-reporting.test.ts"),
    'const key = ["history", "ITEM", "1"]; const mutation = "save-item";\n',
  );
  await writeFile(
    join(template, "frontend/tests/unit/is-app-route-active.test.ts"),
    'const route = "/items"; const nested = "/items/42/history";\n',
  );
  await writeFile(join(template, "frontend/tests/unit/app-pages.test.ts"), 'const itemPage = "Items";\n');
  await writeFile(join(template, "scripts/verify-deployment.sh"), "#!/usr/bin/env bash\n# Item deployment smoke\n");
  await writeFile(
    join(template, "scripts/verify-database-recovery.sh"),
    `#!/usr/bin/env bash
source_item_count="1"
source_user_count="1"
source_migration_count="1"
target_item_count="1"
target_user_count="1"
target_migration_count="1"
target_marker_count="1"
if [[ "$source_item_count" != "$target_item_count" || "$source_user_count" != "$target_user_count" || "$source_migration_count" != "$target_migration_count" || "$target_marker_count" != 1 ]]; then
  exit 1
fi
printf 'Database recovery rehearsal passed: %s items, %s users, %s migrations.\n' "$target_item_count" "$target_user_count" "$target_migration_count"
`,
  );
  await writeFile(join(template, "frontend/public/icons/icon-192x192.png"), "fixture\n");
  await mkdir(join(template, "frontend/src/features/item"), { recursive: true });
  await writeFile(join(template, "frontend/src/features/item/public.ts"), "export type Item = { id: number };\n");
  await writeFile(join(template, "frontend/src/features/item/sample.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(
    join(template, "src/main/java/com/vireocode/startertemplate/App.java"),
    "package com.vireocode.startertemplate;\n",
  );
  await mkdir(join(template, "src/test/java/com/vireocode/startertemplate"), { recursive: true });
  await writeFile(
    join(template, "src/test/java/com/vireocode/startertemplate/MainApplicationTest.java"),
    'package com.vireocode.startertemplate; class MainApplicationTest { String sample = "Item"; }\n',
  );
  await writeFile(
    join(template, "src/test/java/com/vireocode/startertemplate/SecurityContractIntegrationTest.java"),
    'package com.vireocode.startertemplate; class SecurityContractIntegrationTest { String route = "/api/items/search"; }\n',
  );
  await writeFile(
    join(template, "src/test/java/com/vireocode/startertemplate/OpenApiCompatibilityIntegrationTest.java"),
    'package com.vireocode.startertemplate; class OpenApiCompatibilityIntegrationTest { String schema = "ItemDTO"; }\n',
  );
  await mkdir(join(template, "src/test/resources/contracts"), { recursive: true });
  await writeFile(
    join(template, "src/test/resources/contracts/openapi-compatibility.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        operations: {
          "GET /api/auth/me": { responses: ["200"] },
          "GET /api/history": { responses: ["200"] },
          "POST /api/items/search": { responses: ["200"] },
        },
        schemaNames: ["ApiError", "HistoryActor", "HistoryRecord", "ItemDTO", "JsonNode", "PageItemDTO"],
        schemas: { ApiError: { required: [], properties: [] }, ItemDTO: { required: [], properties: [] } },
        securitySchemes: {},
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(template, "src/main/resources/db/migration"), { recursive: true });
  await writeFile(
    join(template, "src/main/resources/db/migration/V3__enforce_item_value_constraints.sql"),
    "ALTER TABLE item ADD CONSTRAINT ck_item_name_not_blank CHECK (name <> '');\n",
  );
  return template;
}

test(
  "projects real consumer skill bundles into both profiles without maintainer leakage",
  {
    skip: !process.env.VIREO_CODEX_TEMPLATE_DIR,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "vireo-codex-projection-"));
    try {
      const template = await fixture(root);
      const source = join(process.env.VIREO_CODEX_TEMPLATE_DIR, ".vireo/application/.agents/skills");
      await rm(join(template, ".vireo/application/.agents/skills"), { recursive: true, force: true });
      await cp(source, join(template, ".vireo/application/.agents/skills"), { recursive: true });
      for (const profile of ["frontend", "full-stack"]) {
        const target = join(root, `real-skills-${profile}`);
        await createVireo({ directory: target, profile, git: false, templateDirectory: template });
        await assertProjectedApplicationGuidance(target);
        const managed = JSON.parse(await readFile(join(target, ".vireo/managed-files.json"), "utf8"));
        for (const file of managed.files.filter(file => file.path.startsWith(".agents/skills/"))) {
          assert.deepEqual(
            await readFile(join(target, file.path)),
            await readFile(join(source, file.path.slice(".agents/skills/".length))),
            `${profile}: ${file.path} preserves exact reviewed skill bytes`,
          );
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("creates and customizes a project atomically from a local fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "sample-app");
    const result = await createVireo({
      directory: target,
      javaPackage: "dev.example.sample",
      database: "h2",
      git: false,
      templateDirectory: template,
    });
    assert.equal(result.templateCommit, TEMPLATE_COMMIT);
    assert.match(await readFile(join(target, "settings.gradle"), "utf8"), /sample-app/u);
    assert.match(await readFile(join(target, "README.md"), "utf8"), /^# Sample App$/mu);
    const generatedCapabilities = await readFile(join(target, "docs", "generated-capabilities.md"), "utf8");
    assert.ok(generatedCapabilities.includes(fixtureTemplateTag));
    assert.ok(generatedCapabilities.includes(fixtureTemplateReleaseContractUrl));
    assert.equal(generatedCapabilities.includes(`sample-app@${fixtureReleaseIdentity.createVireoVersion}`), false);
    assert.equal(generatedCapabilities.includes(`sample-app%40${fixtureReleaseIdentity.createVireoVersion}`), false);
    for (const path of [
      "docs/provider-controls-2026-08-31.md",
      "docs/hosted-demo-recovery-rehearsal-2026-09-01.md",
      "docs/verification-trend-review-2026-09-01.md",
      "scripts/repository-security-policy.mjs",
    ]) {
      await assert.rejects(readFile(join(target, path)), /ENOENT/u);
    }
    await assertProjectedApplicationGuidance(target);
    const identity = await readFile(join(target, "frontend/pwa-policy.mjs"), "utf8");
    assert.match(identity, /id: "\/sample-app"/u);
    assert.match(identity, /name: "Sample App"/u);
    assert.match(identity, /shortName: "Sample App"/u);
    assert.match(identity, /description: "Sample App is a production-oriented application\."/u);
    assert.doesNotMatch(identity, /Vireo Starter/u);
    assert.ok((await readFile(join(target, "package.json"), "utf8")).includes(`create-vireo@${createVireoVersion}`));
    const frontendPackage = JSON.parse(await readFile(join(target, "frontend/package.json"), "utf8"));
    assert.equal(
      frontendPackage.scripts["performance:policy:test"],
      "node --test scripts/lighthouse-policy.test.mjs scripts/lighthouse-audit-support.test.mjs",
    );
    assert.equal(
      frontendPackage.scripts["performance:audit"],
      "corepack npm run performance:policy:test && node scripts/lighthouse-budget.mjs",
    );
    assert.equal(frontendPackage.scripts["architecture:check"], immutable086ArchitectureCheck);
    assert.match(
      await readFile(join(target, "frontend/vitest.storybook.config.ts"), "utf8"),
      /include: \["@preact\/signals-react\/runtime", "@testing-library\/dom", "@vireocodedev\/sqlite"\]/u,
    );
    for (const path of [
      "frontend/scripts/lighthouse-audit-support.mjs",
      "frontend/scripts/lighthouse-audit-support.test.mjs",
      "frontend/scripts/lighthouse-budget.mjs",
      "frontend/scripts/lighthouse-policy.mjs",
      "frontend/scripts/lighthouse-policy.test.mjs",
    ]) {
      await assert.doesNotReject(readFile(join(target, path)), path);
    }
    assert.equal(
      await readFile(join(target, "gradle.properties"), "utf8"),
      gradleProperties(fixtureReleaseIdentity.generatedStarterJvmVersion),
    );
    assert.match(
      await readFile(join(target, "src/main/java/dev/example/sample/App.java"), "utf8"),
      /package dev\.example\.sample/u,
    );
    const metadata = JSON.parse(await readFile(join(target, ".vireo/project.json"), "utf8"));
    const managedFiles = JSON.parse(await readFile(join(target, ".vireo/managed-files.json"), "utf8"));
    for (const path of [
      "frontend/scripts/lighthouse-audit-support.mjs",
      "frontend/scripts/lighthouse-audit-support.test.mjs",
      "frontend/scripts/lighthouse-budget.mjs",
      "frontend/scripts/lighthouse-policy.mjs",
      "frontend/scripts/lighthouse-policy.test.mjs",
    ]) {
      assert.ok(
        managedFiles.files.some(file => file.path === path),
        `${path} is managed`,
      );
    }
    assert.equal(metadata.createdBy, `create-vireo@${createVireoVersion}`);
    assert.deepEqual(
      {
        templateCommit: metadata.templateCommit,
        templateVersion: metadata.templateVersion,
        templateTag: metadata.templateTag,
      },
      {
        templateCommit: TEMPLATE_COMMIT,
        templateVersion: createVireoVersion,
        templateTag: `starter-template@${createVireoVersion}`,
      },
    );
    assert.deepEqual(
      { projectName: metadata.projectName, javaPackage: metadata.javaPackage, database: metadata.database },
      { projectName: "sample-app", javaPackage: "dev.example.sample", database: "h2" },
    );
    assert.deepEqual(
      {
        displayName: metadata.displayName,
        ownerName: metadata.ownerName,
        repositoryUrl: metadata.repositoryUrl,
        supportUrl: metadata.supportUrl,
        securityContact: metadata.securityContact,
      },
      {
        displayName: "Sample App",
        ownerName: "UNRESOLVED_VIREO_OWNER_NAME",
        repositoryUrl: "UNRESOLVED_VIREO_REPOSITORY_URL",
        supportUrl: "UNRESOLVED_VIREO_SUPPORT_URL",
        securityContact: "UNRESOLVED_VIREO_SECURITY_CONTACT",
      },
    );
    const runIdentityCheck = args =>
      execFileSync(process.execPath, ["scripts/project-identity-policy.mjs", ...args], {
        cwd: target,
        encoding: "utf8",
        stdio: "pipe",
      });
    const assertIdentityFailure = (args, expected) =>
      assert.throws(
        () => runIdentityCheck(args),
        error => expected.test(String(error.stderr)),
      );
    assert.doesNotThrow(() => runIdentityCheck([]));
    assertIdentityFailure(["--release"], /ownerName is unresolved/u);
    const resolvedIdentity = {
      ...metadata,
      ownerName: "Example Application Team",
      repositoryUrl: "https://example.test/sample-app",
      supportUrl: "mailto:support@example.test",
      securityContact: "https://security.example.test/sample-app",
    };
    await writeFile(join(target, ".vireo/project.json"), `${JSON.stringify(resolvedIdentity, null, 2)}\n`);
    assert.doesNotThrow(() => runIdentityCheck(["--release", "--json"]));
    await writeFile(
      join(target, ".vireo/project.json"),
      `${JSON.stringify({ ...resolvedIdentity, schemaVersion: 2 }, null, 2)}\n`,
    );
    assertIdentityFailure([], /schemaVersion must be 1/u);
    assertIdentityFailure(["--release"], /schemaVersion must be 1/u);
    await writeFile(
      join(target, ".vireo/project.json"),
      `${JSON.stringify({ ...resolvedIdentity, profile: "frontend" }, null, 2)}\n`,
    );
    assertIdentityFailure([], /profile must be full-stack/u);
    assertIdentityFailure(["--release"], /profile must be full-stack/u);
    await writeFile(
      join(target, ".vireo/project.json"),
      `${JSON.stringify(
        {
          ...resolvedIdentity,
          supportUrl: "https://support.example.test/sample-app",
          securityContact: "https://support.example.test/sample-app/",
        },
        null,
        2,
      )}\n`,
    );
    assertIdentityFailure(["--release"], /supportUrl and securityContact must be distinct/u);
    await writeFile(
      join(target, ".vireo/project.json"),
      `${JSON.stringify(
        {
          ...resolvedIdentity,
          supportUrl: "mailto:Security@example.test",
          securityContact: "mailto:security@example.test",
        },
        null,
        2,
      )}\n`,
    );
    assertIdentityFailure(["--release"], /supportUrl and securityContact must be distinct/u);
    await writeFile(
      join(target, ".vireo/project.json"),
      `${JSON.stringify({ ...resolvedIdentity, repositoryUrl: "https://github.com/vireocodedev/vireo" }, null, 2)}\n`,
    );
    assertIdentityFailure(["--release"], /repositoryUrl must not inherit a Vireo/u);
    await writeFile(
      join(target, ".vireo/project.json"),
      `${JSON.stringify({ ...resolvedIdentity, securityContact: resolvedIdentity.supportUrl }, null, 2)}\n`,
    );
    assertIdentityFailure(["--release"], /supportUrl and securityContact must be distinct/u);
    const generatedPackage = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    assert.equal(generatedPackage.scripts["identity:check"], "node scripts/project-identity-policy.mjs");
    assert.equal(
      generatedPackage.scripts["identity:check:release"],
      "node scripts/project-identity-policy.mjs --release",
    );
    assert.equal(
      generatedPackage.scripts["verify:release"],
      "corepack npm run identity:check:release && corepack npm run verify",
    );
    assert.equal(generatedPackage.version, "0.1.0");
    assert.equal(generatedPackage.scripts["release:policy"], undefined);
    const generatedFrontendPackage = JSON.parse(await readFile(join(target, "frontend", "package.json"), "utf8"));
    assert.equal(generatedFrontendPackage.scripts["toolchain:check"], "node ../scripts/toolchain-policy.mjs");
    assert.doesNotMatch(
      await readFile(join(target, "scripts", "toolchain-policy.mjs"), "utf8"),
      /platform-support-policy/u,
    );
    const generatedWorkflowPolicy = JSON.parse(
      await readFile(join(target, "contracts", "github-actions-policy.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(generatedWorkflowPolicy.requiredConcurrencyWorkflows).sort(), ["ci.yml"]);
    const fullStackIdentityPolicy = await readFile(join(target, "scripts/project-identity-policy.mjs"), "utf8");
    assert.match(fullStackIdentityPolicy, /IDENTITY_CONTRACT/u);
    assert.match(fullStackIdentityPolicy, /EXPECTED_PROFILE = "full-stack"/u);
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ["--check", "scripts/project-identity-policy.mjs"], {
        cwd: target,
        encoding: "utf8",
        stdio: "pipe",
      }),
    );
    assert.match(await readFile(join(target, "scripts/verify.sh"), "utf8"), /project-identity\|Project identity/u);
    for (const path of ["README.md", "SECURITY.md", "SUPPORT.md"]) {
      assert.doesNotMatch(await readFile(join(target, path), "utf8"), /vireocodedev\/starter(?:-template)?/u);
    }
    const issueConfig = await readFile(join(target, ".github/ISSUE_TEMPLATE/config.yml"), "utf8");
    assert.match(issueConfig, /contact_links: \[\]/u);
    assert.doesNotMatch(issueConfig, /UNRESOLVED_VIREO_|mailto:/u);
    assert.match(await readFile(join(target, ".github/dependabot.yml"), "utf8"), /directory: \/frontend/u);
    assert.match(await readFile(join(target, ".vscode/settings.json"), "utf8"), /java\.import\.gradle/u);
    for (const path of [
      "frontend/playwright.demo.config.ts",
      "frontend/playwright.deployment.config.ts",
      "frontend/tests/demo/flagship-demo.spec.ts",
      "frontend/tests/deployment/smoke.spec.ts",
      "frontend/tests/e2e/login.spec.ts",
      "frontend/tests/e2e/overview.spec.ts",
    ]) {
      assert.match(await readFile(join(target, path), "utf8"), /export/u);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projects self-contained documentation when excluded evidence is linked upstream", async () => {
  for (const profile of ["full-stack", "frontend"]) {
    const root = await mkdtemp(join(tmpdir(), "create-vireo-documentation-test-"));
    try {
      const template = await fixture(root);
      const target = join(root, `${profile}-app`);
      await createVireo({
        directory: target,
        profile,
        git: false,
        templateDirectory: template,
      });
      for (const document of ["docs/database-recovery.md", "docs/incident-response.md", "docs/operations.md"]) {
        const contents = await readFile(join(target, document), "utf8");
        assert.doesNotMatch(contents, /hosted-demo-recovery-rehearsal-2026-09-01\.md/u, document);
        assert.match(contents, /maintainer rehearsal/u, document);
      }
      await assert.rejects(readFile(join(target, "docs/hosted-demo-recovery-rehearsal-2026-09-01.md")), /ENOENT/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("normalizes the immutable Template JVM baseline only for full-stack projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-jvm-release-"));
  try {
    const template = await fixture(root);
    const fullStack = join(root, "full-stack-app");
    const frontend = join(root, "frontend-app");
    await createVireo({ directory: fullStack, git: false, templateDirectory: template });
    await createVireo({ directory: frontend, profile: "frontend", git: false, templateDirectory: template });
    assert.equal(
      await readFile(join(template, "gradle.properties"), "utf8"),
      gradleProperties(fixtureReleaseIdentity.templateStarterJvmBaseline),
    );
    assert.equal(
      await readFile(join(fullStack, "gradle.properties"), "utf8"),
      gradleProperties(fixtureReleaseIdentity.generatedStarterJvmVersion),
    );
    await assert.rejects(readFile(join(frontend, "gradle.properties")), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses malformed, missing, duplicate, or drifted Template starterVersion baselines", async () => {
  const cases = [
    "",
    "starterVersion=not-a-version\n",
    `starterVersion=${differentStarterVersion(fixtureReleaseIdentity.templateStarterJvmBaseline)}\n`,
    `starterVersion=${fixtureReleaseIdentity.templateStarterJvmBaseline}\nstarterVersion=${fixtureReleaseIdentity.templateStarterJvmBaseline}\n`,
  ];
  for (const [index, gradleProperties] of cases.entries()) {
    const root = await mkdtemp(join(tmpdir(), `create-vireo-jvm-baseline-${index}-`));
    try {
      const template = await fixture(root);
      await writeFile(join(template, "gradle.properties"), gradleProperties);
      await assert.rejects(
        createVireo({ directory: join(root, "invalid-app"), git: false, templateDirectory: template }),
        error =>
          error.message.includes(
            `exactly one starterVersion=${fixtureReleaseIdentity.templateStarterJvmBaseline} baseline`,
          ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("never overwrites an existing target", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "existing-app");
    await mkdir(target);
    await assert.rejects(createVireo({ directory: target, templateDirectory: template }), /already exists/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derives historical ci workflow concurrency when the policy predates it", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-historical-workflow-policy-test-"));
  try {
    const template = await fixture(root);
    await writeFile(join(template, "contracts", "github-actions-policy.json"), "{}\n");
    await writeFile(
      join(template, ".github", "workflows", "ci.yml"),
      "name: Verify\nconcurrency:\n  group: verify-${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\njobs: {}\n",
    );

    const target = join(root, "historical-workflow-policy-app");
    await createVireo({ directory: target, git: false, templateDirectory: template });
    const policy = JSON.parse(await readFile(join(target, "contracts", "github-actions-policy.json"), "utf8"));
    assert.deepEqual(policy.requiredConcurrencyWorkflows, {
      "ci.yml": {
        group: "verify-${{ github.workflow }}-${{ github.ref }}",
        cancelInProgress: true,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects declared ci workflow concurrency that drifts from ci.yml", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-workflow-policy-drift-test-"));
  try {
    const template = await fixture(root);
    await writeFile(
      join(template, "contracts", "github-actions-policy.json"),
      JSON.stringify({
        requiredConcurrencyWorkflows: {
          "ci.yml": { group: "verify-different", cancelInProgress: true },
        },
      }),
    );
    await assert.rejects(
      createVireo({ directory: join(root, "workflow-policy-drift-app"), git: false, templateDirectory: template }),
      /ci\.yml concurrency policy must exactly match ci\.yml/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects historical workflow policies without parseable ci concurrency", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-malformed-workflow-policy-test-"));
  try {
    const template = await fixture(root);
    await writeFile(join(template, "contracts", "github-actions-policy.json"), "{}\n");
    await writeFile(join(template, ".github", "workflows", "ci.yml"), "name: Verify\njobs: {}\n");
    await assert.rejects(
      createVireo({ directory: join(root, "missing-concurrency-app"), git: false, templateDirectory: template }),
      /ci\.yml must declare a concurrency block/u,
    );
    await writeFile(
      join(template, ".github", "workflows", "ci.yml"),
      "name: Verify\nconcurrency:\n  group: verify-${{ github.workflow }}-${{ github.ref }}\njobs: {}\n",
    );
    await assert.rejects(
      createVireo({ directory: join(root, "malformed-concurrency-app"), git: false, templateDirectory: template }),
      /concurrency block must declare one group and cancel-in-progress value/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normalizes historical public-contract budgets from retained verifier stages", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-historical-budget-test-"));
  try {
    const template = await fixture(root);
    await writeFile(
      join(template, "scripts", "verify.sh"),
      '#!/usr/bin/env bash\nset -euo pipefail\nsteps=(\n  "public-contract|Public contract|true"\n)\n',
    );
    await writeFile(
      join(template, "contracts", "verification-budget-policy.json"),
      JSON.stringify({
        stages: {
          "public-contract": {
            label: "Public contract",
            baselineMs: 500,
            warningMs: 5000,
            failureMs: 10000,
            baselineRssKiB: 80000,
            warningRssKiB: 262144,
            failureRssKiB: 524288,
          },
        },
      }),
    );

    const target = join(root, "historical-budget-app");
    await createVireo({ directory: target, git: false, templateDirectory: template });
    const verify = await readFile(join(target, "scripts", "verify.sh"), "utf8");
    const budget = JSON.parse(await readFile(join(target, "contracts", "verification-budget-policy.json"), "utf8"));
    assert.match(verify, /project-identity\|Project identity/u);
    assert.doesNotMatch(verify, /public-contract/u);
    assert.deepEqual(Object.keys(budget.stages).sort(), ["project-identity"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local template directories ignore ordinary checkout artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-artifacts-test-"));
  try {
    const template = await fixture(root);
    await mkdir(join(template, ".gradle", "cache"), { recursive: true });
    await mkdir(join(template, "frontend", "dist"), { recursive: true });
    await mkdir(join(template, "operations", "evidence"), { recursive: true });
    await writeFile(join(template, ".gradle", "cache", "state.bin"), "local\n");
    await writeFile(join(template, "frontend", "dist", "bundle.js"), "local\n");
    await writeFile(join(template, "operations", "evidence", "run.json"), "local\n");
    await writeFile(join(template, ".env.local"), "LOCAL_ONLY=true\n");
    await writeFile(join(template, "frontend", "scratch.iml"), "local\n");

    const target = join(root, "artifact-safe-app");
    await createVireo({ directory: target, git: false, templateDirectory: template });
    for (const path of [
      ".gradle/cache/state.bin",
      "frontend/dist/bundle.js",
      "operations/evidence/run.json",
      ".env.local",
      "frontend/scratch.iml",
    ]) {
      await assert.rejects(readFile(join(target, path)), /ENOENT/u);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local template directories reject symbolic links", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-link-test-"));
  try {
    const template = await fixture(root);
    await symlink("README.md", join(template, "linked-readme.md"));
    await assert.rejects(
      createVireo({ directory: join(root, "linked-app"), git: false, templateDirectory: template }),
      /unsupported link/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a standalone frontend profile without Java, Gradle, or database files", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-frontend-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "operations-ui");
    const result = await createVireo({
      directory: target,
      profile: "frontend",
      git: false,
      templateDirectory: template,
    });

    assert.equal(result.profile, "frontend");
    assert.equal(result.javaPackage, undefined);
    assert.equal(result.database, undefined);
    const identity = await readFile(join(target, "pwa-policy.mjs"), "utf8");
    assert.match(identity, /id: "\/operations-ui"/u);
    assert.match(identity, /name: "Operations Ui"/u);
    assert.match(identity, /shortName: "Operations"/u);
    assert.doesNotMatch(identity, /Vireo Starter/u);
    await assertProjectedApplicationGuidance(target);
    const environment = await readFile(join(target, ".env.development"), "utf8");
    assert.match(environment, /VITE_API_MODE=mock/u);
    assert.doesNotMatch(environment, /VITE_APP_NAME/u);
    assert.match(await readFile(join(target, ".gitignore"), "utf8"), /^\.pwa-update-fixture\/$/mu);
    assert.match(await readFile(join(target, ".gitignore"), "utf8"), /^\.performance-evidence\/$/mu);
    assert.match(await readFile(join(target, ".gitignore"), "utf8"), /^!\.env\.development$/mu);
    const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    const frontendManaged = JSON.parse(await readFile(join(target, ".vireo/managed-files.json"), "utf8"));
    assert.equal(packageJson.version, "0.1.0");
    assert.equal(packageJson.scripts["release:policy"], undefined);
    for (const script of ["pwa:check:source", "pwa:check:built", "pretest:pwa", "test:pwa"]) {
      assert.equal(typeof packageJson.scripts[script], "string", `${script} is retained`);
    }
    assert.equal(packageJson.scripts["identity:check"], "node scripts/project-identity-policy.mjs");
    assert.equal(packageJson.scripts["identity:check:release"], "node scripts/project-identity-policy.mjs --release");
    assert.equal(packageJson.scripts["doctor:json"], "node scripts/vireo-frontend-doctor.mjs --json");
    assert.equal(
      packageJson.scripts["performance:policy:test"],
      "node --test scripts/lighthouse-policy.test.mjs scripts/lighthouse-audit-support.test.mjs",
    );
    assert.equal(
      packageJson.scripts["performance:audit"],
      "corepack npm run performance:policy:test && node scripts/lighthouse-budget.mjs",
    );
    assert.equal(packageJson.scripts["architecture:check"], immutable086ArchitectureCheck);
    assert.match(
      await readFile(join(target, "scripts/lighthouse-budget.mjs"), "utf8"),
      /path\.resolve\(frontendRoot, "\.performance-evidence"\)/u,
    );
    assert.match(
      await readFile(join(target, "vitest.storybook.config.ts"), "utf8"),
      /include: \["@preact\/signals-react\/runtime", "@testing-library\/dom", "@vireocodedev\/sqlite"\]/u,
    );
    for (const path of [
      "scripts/lighthouse-audit-support.mjs",
      "scripts/lighthouse-audit-support.test.mjs",
      "scripts/lighthouse-budget.mjs",
      "scripts/lighthouse-policy.mjs",
      "scripts/lighthouse-policy.test.mjs",
    ]) {
      await assert.doesNotReject(readFile(join(target, path)), path);
      assert.ok(
        frontendManaged.files.some(file => file.path === path),
        `${path} is managed`,
      );
    }
    assert.equal(
      packageJson.scripts["verify:release"],
      "corepack npm run identity:check:release && corepack npm run verify",
    );
    const lock = JSON.parse(await readFile(join(target, "package-lock.json"), "utf8"));
    assert.equal(lock.version, "0.1.0");
    assert.equal(lock.packages[""].version, "0.1.0");
    const verify = await readFile(join(target, "scripts/verify-frontend-profile.sh"), "utf8");
    assert.match(verify, /Project identity[\s\S]*pwa:check:source[\s\S]*Application build[\s\S]*pwa:check:built/u);
    const frontendIdentityPolicy = await readFile(join(target, "scripts/project-identity-policy.mjs"), "utf8");
    assert.match(frontendIdentityPolicy, /IDENTITY_CONTRACT/u);
    assert.match(frontendIdentityPolicy, /EXPECTED_PROFILE = "frontend"/u);
    const doctor = await readFile(join(target, "scripts/vireo-frontend-doctor.mjs"), "utf8");
    assert.match(doctor, /Frontend profile/u);
    assert.match(doctor, /VIR-VERIFY-001/u);
    assert.match(doctor, /checkPwaSourceContract/u);
    assert.match(await readFile(join(target, "scripts/pwa-contract.mjs"), "utf8"), /checkPwaSourceContract/u);
    assert.match(await readFile(join(target, "scripts/pwa-update-fixture.mjs"), "utf8"), /export/u);
    assert.match(await readFile(join(target, "tests/pwa/production-pwa.spec.ts"), "utf8"), /export/u);
    assert.match(await readFile(join(target, "README.md"), "utf8"), /Ubuntu 24\.04 x86-64/u);
    await mkdir(join(target, "node_modules"));
    const readyDoctor = spawnSync(process.execPath, ["scripts/vireo-frontend-doctor.mjs", "--json"], {
      cwd: target,
      encoding: "utf8",
    });
    assert.equal(readyDoctor.status, 0, readyDoctor.stderr);
    assert.equal(readyDoctor.stderr, "");
    assert.doesNotMatch(readyDoctor.stdout, /Frontend profile is ready/u);
    const readyReport = JSON.parse(readyDoctor.stdout);
    assert.deepEqual(
      {
        schemaVersion: readyReport.schemaVersion,
        ok: readyReport.ok,
        project: readyReport.project,
        profile: readyReport.profile,
        databaseMode: readyReport.databaseMode,
        hasDatabase: Object.hasOwn(readyReport, "database"),
      },
      {
        schemaVersion: 1,
        ok: true,
        project: "operations-ui",
        profile: "frontend",
        databaseMode: "frontend",
        hasDatabase: false,
      },
    );
    assert.ok(Array.isArray(readyReport.results));
    assert.ok(readyReport.results.every(result => typeof result.code === "string"));

    await rm(join(target, "node_modules"), { recursive: true, force: true });
    const preSetupDoctor = spawnSync(process.execPath, ["scripts/vireo-frontend-doctor.mjs", "--json"], {
      cwd: target,
      encoding: "utf8",
    });
    assert.equal(preSetupDoctor.status, 1, preSetupDoctor.stderr);
    assert.equal(preSetupDoctor.stderr, "");
    assert.doesNotMatch(preSetupDoctor.stdout, /Resolve the failed checks/u);
    const preSetupReport = JSON.parse(preSetupDoctor.stdout);
    assert.deepEqual(
      {
        schemaVersion: preSetupReport.schemaVersion,
        ok: preSetupReport.ok,
        project: preSetupReport.project,
        profile: preSetupReport.profile,
        databaseMode: preSetupReport.databaseMode,
        hasDatabase: Object.hasOwn(preSetupReport, "database"),
      },
      {
        schemaVersion: 1,
        ok: false,
        project: "operations-ui",
        profile: "frontend",
        databaseMode: "frontend",
        hasDatabase: false,
      },
    );
    assert.deepEqual(
      preSetupReport.results.find(result => result.code === "VIR-DEPS-001"),
      {
        code: "VIR-DEPS-001",
        status: "fail",
        summary: "Frontend dependency installation",
        remedy: "Run corepack npm run setup.",
      },
    );
    const metadata = JSON.parse(await readFile(join(target, ".vireo/project.json"), "utf8"));
    assert.equal(metadata.profile, "frontend");
    assert.deepEqual(
      {
        templateCommit: metadata.templateCommit,
        templateVersion: metadata.templateVersion,
        templateTag: metadata.templateTag,
        createdBy: metadata.createdBy,
      },
      {
        templateCommit: TEMPLATE_COMMIT,
        templateVersion: createVireoVersion,
        templateTag: `starter-template@${createVireoVersion}`,
        createdBy: `create-vireo@${createVireoVersion}`,
      },
    );
    await assert.rejects(readFile(join(target, ".github/dependabot.yml")), /ENOENT/u);
    await assert.rejects(readFile(join(target, "scripts/verify.sh")), /ENOENT/u);
    await assert.rejects(readFile(join(target, ".vscode/settings.json")), /ENOENT/u);
    for (const path of [
      "playwright.demo.config.ts",
      "playwright.deployment.config.ts",
      "tests/demo/flagship-demo.spec.ts",
      "tests/deployment/smoke.spec.ts",
      "tests/e2e/login.spec.ts",
      "tests/e2e/overview.spec.ts",
    ]) {
      await assert.rejects(readFile(join(target, path)), /ENOENT/u);
      assert.equal(
        frontendManaged.files.some(file => file.path === path),
        false,
        `${path} is excluded`,
      );
    }
    await assert.rejects(readFile(join(target, "settings.gradle")), /ENOENT/u);
    await assert.rejects(readFile(join(target, "src/main/java/App.java")), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frontend performance projection materializes immutable candidate bytes when an adjacent Template omits them", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-frontend-performance-baseline-"));
  try {
    const template = await fixture(root);
    const templatePackagePath = join(template, "frontend/package.json");
    const templatePackage = JSON.parse(await readFile(templatePackagePath, "utf8"));
    delete templatePackage.scripts["performance:policy:test"];
    delete templatePackage.scripts["performance:audit"];
    await writeFile(templatePackagePath, `${JSON.stringify(templatePackage, null, 2)}\n`);
    for (const path of [
      "lighthouse-audit-support.mjs",
      "lighthouse-audit-support.test.mjs",
      "lighthouse-budget.mjs",
      "lighthouse-policy.mjs",
      "lighthouse-policy.test.mjs",
    ]) {
      await rm(join(template, "frontend/scripts", path));
    }
    const target = join(root, "operations-ui");
    await createVireo({ directory: target, profile: "frontend", git: false, templateDirectory: template });
    const policy = JSON.parse(await readFile(new URL("../schema/vireo-upgrade-policy.json", import.meta.url), "utf8"));
    const lighthouseBaselines = policy.releaseGraph.baselines["0.8.3->0.8.4"].frontend.filter(baseline =>
      baseline.path.startsWith("scripts/lighthouse-"),
    );
    assert.deepEqual(lighthouseBaselines.map(baseline => baseline.path).sort(), [
      "scripts/lighthouse-audit-support.mjs",
      "scripts/lighthouse-audit-support.test.mjs",
      "scripts/lighthouse-budget.mjs",
      "scripts/lighthouse-policy.mjs",
      "scripts/lighthouse-policy.test.mjs",
    ]);
    for (const baseline of lighthouseBaselines) {
      assert.equal(await readFile(join(target, baseline.path), "utf8"), baseline.targetContent, baseline.path);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creation normalizes the Template-only 0.8.7 architecture command for both profiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-template-source-architecture-"));
  try {
    const template = await fixture(root);
    for (const profile of ["full-stack", "frontend"]) {
      const target = join(root, profile);
      await createVireo({ directory: target, profile, git: false, templateDirectory: template });
      const manifestPath = join(target, profile === "frontend" ? "package.json" : "frontend/package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(manifest.scripts["architecture:check"], immutable086ArchitectureCheck);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projection compatibility composes every immutable Storybook baseline from the pinned public Template", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-storybook-baseline-chain-"));
  try {
    const template = await fixture(root);
    const policy = JSON.parse(await readFile(new URL("../schema/vireo-upgrade-policy.json", import.meta.url), "utf8"));
    for (const profile of ["full-stack", "frontend"]) {
      const templatePath = "frontend/vitest.storybook.config.ts";
      const projectedPath = profile === "frontend" ? "vitest.storybook.config.ts" : templatePath;
      const sourceBaseline = policy.releaseGraph.baselines["0.8.6->0.8.7"][profile].find(
        file => file.path === projectedPath,
      );
      const targetBaseline = policy.releaseGraph.baselines["0.8.7->0.9.1"][profile].find(
        file => file.path === projectedPath,
      );
      await writeFile(join(template, templatePath), sourceBaseline.sourceContent);

      const target = join(root, `composed-${profile}`);
      await createVireo({ directory: target, profile, git: false, templateDirectory: template });

      let expected = targetBaseline.targetContent;
      if (expected === undefined) {
        expected = targetBaseline.sourceContent;
        for (const transform of targetBaseline.transforms ?? [])
          expected = expected.replace(transform.from, transform.to);
      }
      assert.equal(await readFile(join(target, projectedPath), "utf8"), expected);

      await writeFile(join(template, templatePath), "// application-owned customization\n");
      const customizedTarget = join(root, `customized-${profile}`);
      await assert.rejects(
        createVireo({ directory: customizedTarget, profile, git: false, templateDirectory: template }),
        /Pinned Template compatibility baseline is customized/u,
      );
      await assert.rejects(readFile(join(customizedTarget, "package.json")), /ENOENT/u);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frontend performance projection refuses incompatible Template commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-frontend-performance-command-"));
  try {
    const template = await fixture(root);
    const path = join(template, "frontend/package.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.scripts["performance:policy:test"] = "node unexpected.mjs";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      createVireo({
        directory: join(root, "operations-ui"),
        profile: "frontend",
        git: false,
        templateDirectory: template,
      }),
      /incompatible performance:policy:test command/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses a readable short PWA name and truncates a single long word deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-pwa-name-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "supercalifragilistic-app");
    await createVireo({ directory: target, profile: "frontend", git: false, templateDirectory: template });
    const identity = await readFile(join(target, "pwa-policy.mjs"), "utf8");
    assert.match(identity, /shortName: "Supercalifra"/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses the compact fallback when a short first word would waste the PWA name budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-pwa-name-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "my-supercalifragilistic-app");
    await createVireo({ directory: target, profile: "frontend", git: false, templateDirectory: template });
    const identity = await readFile(join(target, "pwa-policy.mjs"), "utf8");
    assert.match(identity, /shortName: "MySupercalif"/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when the pinned template does not provide the PWA identity baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-pwa-test-"));
  try {
    const template = await fixture(root);
    await writeFile(join(template, "frontend/pwa-policy.mjs"), "export const APP_IDENTITY = Object.freeze({});\n");
    await assert.rejects(
      createVireo({ directory: join(root, "sample-app"), git: false, templateDirectory: template }),
      /Pinned Template PWA identity/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supports the strict identity baseline used by historical pre-policy templates", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-legacy-pwa-test-"));
  try {
    const template = await fixture(root);
    await rm(join(template, "frontend/pwa-policy.mjs"));
    await writeFile(
      join(template, "frontend/vite.config.ts"),
      'const manifest = { name: "Vireo Starter App", short_name: "Vireo" };\n',
    );
    for (const locale of ["app.en.ts", "app.hr.ts"]) {
      await writeFile(
        join(template, "frontend/src/app/ui/localization/resources", locale),
        'export default { brand: { name: "Vireo Starter" } };\n',
      );
    }

    const target = join(root, "supercalifragilistic-legacy-app");
    await createVireo({ directory: target, git: false, templateDirectory: template });
    assert.match(
      await readFile(join(target, "frontend/vite.config.ts"), "utf8"),
      /name: "Supercalifragilistic Legacy App"/u,
    );
    assert.match(await readFile(join(target, "frontend/vite.config.ts"), "utf8"), /short_name: "Supercalifra"/u);
    for (const locale of ["app.en.ts", "app.hr.ts"]) {
      assert.match(
        await readFile(join(target, "frontend/src/app/ui/localization/resources", locale), "utf8"),
        /name: "Supercalifragilistic Legacy App"/u,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when neither the current nor historical identity baseline exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-pwa-test-"));
  try {
    const template = await fixture(root);
    await rm(join(template, "frontend/pwa-policy.mjs"));
    await assert.rejects(
      createVireo({ directory: join(root, "sample-app"), git: false, templateDirectory: template }),
      /Legacy Template identity/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generator source uses the current PWA identity renderer and isolates historical substitutions", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /renderPwaIdentity\(join\(root, frontendDirectory, "pwa-policy\.mjs"\)/u);
  assert.match(source, /async function renderLegacyTemplateIdentity/u);
  assert.match(source, /await renderTemplateIdentity\(\s*staging,/u);
  assert.match(source, /await projectTemplate\(staging, profile, options\.templateDirectory !== undefined\)/u);
  assert.match(
    source,
    /const staging = await mkdtemp\(join\(dirname\(directory\), `\.\$\{basename\(directory\)\}\.vireo-`\)\)/u,
  );
  assert.doesNotMatch(source, /randomBytes/u);
});

test("a failed creation removes only its mkdtemp-owned staging directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-staging-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "sample-app");
    const unrelatedSibling = join(root, ".sample-app.vireo-unrelated");
    await mkdir(unrelatedSibling);
    await writeFile(join(unrelatedSibling, "sentinel.txt"), "preserve me\n");
    await writeFile(join(template, "frontend/pwa-policy.mjs"), "export const APP_IDENTITY = Object.freeze({});\n");

    await assert.rejects(
      createVireo({ directory: target, git: false, templateDirectory: template }),
      /Pinned Template PWA identity/u,
    );
    assert.equal(await readFile(join(unrelatedSibling, "sentinel.txt"), "utf8"), "preserve me\n");
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith(".sample-app.vireo-")).sort(), [
      ".sample-app.vireo-unrelated",
    ]);
    await assert.rejects(readFile(target), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the generated release identity policy rejects malformed HTTPS routes and retains mailto support", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-generated-identity-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "sample-app");
    await createVireo({ directory: target, git: false, templateDirectory: template });
    const metadataPath = join(target, ".vireo/project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const resolvedIdentity = {
      ...metadata,
      ownerName: "Example Application Team",
      repositoryUrl: "https://example.test/sample-app",
      supportUrl: "mailto:Security@example.test",
      securityContact: "mailto:security@example.test",
    };
    const runReleasePolicy = () =>
      execFileSync(process.execPath, ["scripts/project-identity-policy.mjs", "--release"], {
        cwd: target,
        encoding: "utf8",
        stdio: "pipe",
      });
    const assertReleaseFailure = expected =>
      assert.throws(
        () => runReleasePolicy(),
        error => expected.test(String(error.stderr)),
      );
    await writeFile(metadataPath, `${JSON.stringify(resolvedIdentity, null, 2)}\n`);
    assertReleaseFailure(/supportUrl and securityContact must be distinct/u);

    for (const repositoryUrl of [
      "https:///missing-host",
      "https://.",
      "https://..",
      "https://user@example.test/sample-app",
      "https://example.test/invalid\\path",
      "https://example.test/invalid\u0000path",
    ]) {
      await writeFile(
        metadataPath,
        `${JSON.stringify({ ...resolvedIdentity, repositoryUrl, securityContact: "mailto:security-team@example.test" }, null, 2)}\n`,
      );
      assertReleaseFailure(/repositoryUrl must use https-url format/u);
    }

    await writeFile(
      metadataPath,
      `${JSON.stringify({ ...resolvedIdentity, securityContact: "mailto:security-team@example.test" }, null, 2)}\n`,
    );
    assert.doesNotThrow(() => runReleasePolicy());

    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          ...resolvedIdentity,
          supportUrl: "https://SUPPORT.example.test:443/sample-app/",
          securityContact: "https://support.example.test/sample-app",
        },
        null,
        2,
      )}\n`,
    );
    assertReleaseFailure(/supportUrl and securityContact must be distinct/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry run validates without writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-test-"));
  try {
    const target = join(root, "dry-app");
    const result = await createVireo({ directory: target, dryRun: true });
    assert.equal(result.dryRun, true);
    await assert.rejects(readFile(target), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an inherited Vireo public route even during creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "create-vireo-identity-test-"));
  try {
    await assert.rejects(
      createVireo({
        directory: join(root, "identity-app"),
        git: false,
        dryRun: true,
        repositoryUrl: "https://github.com/vireocodedev/vireo-template",
      }),
      /must not inherit a Vireo repository/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remove-example is dry-run first, rejects drift, removes owned references, and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "remove-vireo-example-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "sample-app");
    await createVireo({ directory: target, git: false, templateDirectory: template });
    const samplePath = join(target, "frontend/src/features/item/public.ts");
    const managedManifestPath = join(target, ".vireo/managed-files.json");
    const managedBefore = JSON.parse(await readFile(managedManifestPath, "utf8"));
    for (const invalidManifest of [
      { ...managedBefore, templateCommit: "0".repeat(40) },
      { ...managedBefore, files: [] },
    ]) {
      await writeFile(managedManifestPath, `${JSON.stringify(invalidManifest, null, 2)}\n`);
      await assert.rejects(removeExample(target, true), /Managed-file provenance is invalid/u);
    }
    await writeFile(managedManifestPath, `${JSON.stringify(managedBefore, null, 2)}\n`);
    const customizedManagedPath = "frontend/scripts/check-pwa-contract.mjs";
    const originalManagedHash = managedBefore.files.find(file => file.path === customizedManagedPath)?.sha256;
    assert.match(originalManagedHash, /^[a-f0-9]{64}$/u);
    await writeFile(
      join(target, customizedManagedPath),
      `${await readFile(join(target, customizedManagedPath), "utf8")}\n// consumer customization\n`,
    );
    const retainedMaintainerEvidence = new Map(
      [
        "docs/provider-controls-2026-08-31.md",
        "docs/hosted-demo-recovery-rehearsal-2026-09-01.md",
        "docs/verification-trend-review-2026-09-01.md",
        "scripts/repository-security-policy.mjs",
      ].map(path => [path, "Item maintainer-only evidence\n"]),
    );
    const ownership = JSON.parse(await readFile(join(target, ".vireo/example-manifest.json"), "utf8"));
    const overviewPath = "frontend/tests/e2e/overview.spec.ts";
    const overviewContents = await readFile(join(target, overviewPath));
    assert.equal(
      ownership.files[overviewPath],
      createHash("sha256").update(overviewContents).digest("hex"),
      "fresh full-stack generation records the Overview sample as example-owned",
    );
    assert.equal(
      ownership.files["frontend/src/features/item/sample.bin"],
      createHash("sha256")
        .update(Buffer.from([0, 1, 2, 3]))
        .digest("hex"),
    );
    for (const [path, content] of retainedMaintainerEvidence) {
      await writeFile(join(target, path), content);
      ownership.files[path] = createHash("sha256").update(content).digest("hex");
    }
    await writeFile(join(target, ".vireo/example-manifest.json"), `${JSON.stringify(ownership, null, 2)}\n`);
    const protectedInfrastructure = new Map(
      await Promise.all(
        [
          "frontend/scripts/architecture-policy.test.mjs",
          "frontend/scripts/check-pwa-contract.mjs",
          "frontend/tests/pwa/production-pwa.spec.ts",
        ].map(async path => [path, await readFile(join(target, path), "utf8")]),
      ),
    );

    const preview = await removeExample(target);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.state, "present");
    assert.match(await readFile(samplePath, "utf8"), /Item/u);
    assert.equal(preview.files.find(file => file.path === overviewPath)?.status, "delete");
    for (const path of protectedInfrastructure.keys()) {
      assert.equal(
        preview.files.some(file => file.path === path && file.status === "delete"),
        false,
        path,
      );
    }
    for (const path of retainedMaintainerEvidence.keys()) {
      assert.equal(
        preview.files.some(file => file.path === path && file.status === "delete"),
        false,
        path,
      );
    }
    const metadata = JSON.parse(await readFile(join(target, ".vireo/project.json"), "utf8"));
    const javaTestRoot = `src/test/java/${metadata.javaPackage.replaceAll(".", "/")}`;
    const genericCoverage = [
      "frontend/src/app/shell/layout/AppPageHeader.stories.tsx",
      "frontend/tests/integration/app-page-header.integration.test.tsx",
      "frontend/tests/integration/app-shell-layout.integration.test.tsx",
      "frontend/tests/integration/session-expiry.integration.test.tsx",
      "frontend/tests/unit/app-query-error-reporting.test.ts",
      "frontend/tests/unit/is-app-route-active.test.ts",
      "frontend/tests/unit/app-pages.test.ts",
      "frontend/tests/deployment/item-persistence.spec.ts",
      "scripts/verify-deployment.sh",
      "scripts/verify-database-recovery.sh",
      `${javaTestRoot}/MainApplicationTest.java`,
      `${javaTestRoot}/SecurityContractIntegrationTest.java`,
      `${javaTestRoot}/OpenApiCompatibilityIntegrationTest.java`,
      "src/test/resources/contracts/openapi-compatibility.json",
    ];
    for (const path of genericCoverage) {
      assert.equal(preview.files.find(file => file.path === path)?.status, "update", path);
    }
    await writeFile(samplePath, "export type Item = { id: number; customized: true };\n");
    await assert.rejects(removeExample(target, true), /customized example file/u);
    await writeFile(samplePath, "export type Item = { id: number };\n");

    await writeFile(join(target, overviewPath), `${overviewContents}\n// consumer customization\n`);
    await assert.rejects(removeExample(target, true), /customized example file/u);
    await writeFile(join(target, overviewPath), overviewContents);

    const staleOwnership = structuredClone(ownership);
    delete staleOwnership.files[overviewPath];
    await writeFile(join(target, ".vireo/example-manifest.json"), `${JSON.stringify(staleOwnership, null, 2)}\n`);
    await assert.rejects(removeExample(target, true), /unowned example references/u);
    await writeFile(join(target, ".vireo/example-manifest.json"), `${JSON.stringify(ownership, null, 2)}\n`);

    const unowned = join(target, "custom-item-note.md");
    await writeFile(unowned, "The Item integration is customized here.\n");
    await assert.rejects(removeExample(target, true), /unowned example references/u);
    await rm(unowned);

    const binarySentinel = join(target, "frontend/src/features/item/consumer-sentinel.bin");
    const binarySentinelContents = Buffer.from([0, 255, 1, 254]);
    await writeFile(binarySentinel, binarySentinelContents);
    await assert.rejects(removeExample(target, true), /unowned example references/u);
    assert.deepEqual(await readFile(binarySentinel), binarySentinelContents);
    await assert.rejects(readFile(join(target, ".vireo/remove-example.json")), /ENOENT/u);
    await rm(binarySentinel);

    const javaBinarySentinel = join(
      target,
      "src/main/java",
      metadata.javaPackage.replaceAll(".", "/"),
      "app/item/consumer-sentinel.bin",
    );
    await mkdir(join(target, "src/main/java", metadata.javaPackage.replaceAll(".", "/"), "app/item"), {
      recursive: true,
    });
    await writeFile(javaBinarySentinel, binarySentinelContents);
    await assert.rejects(removeExample(target, true), /unowned example references/u);
    assert.deepEqual(await readFile(javaBinarySentinel), binarySentinelContents);
    await rm(javaBinarySentinel);

    const outsideLinkSentinel = join(root, "outside-item-symlink-sentinel.txt");
    const outsideLinkContents = "consumer-owned sentinel\n";
    const linkedSentinel = join(target, "frontend/src/features/item/consumer-sentinel-link.txt");
    await writeFile(outsideLinkSentinel, outsideLinkContents);
    await symlink(outsideLinkSentinel, linkedSentinel, "file");
    await assert.rejects(removeExample(target, true), /unowned example references/u);
    assert.equal(await readFile(outsideLinkSentinel, "utf8"), outsideLinkContents);
    await assert.rejects(readFile(join(target, ".vireo/remove-example.json")), /ENOENT/u);
    await rm(linkedSentinel);

    const applied = await removeExample(target, true);
    assert.equal(applied.state, "removed");
    const residualReferences = await findExampleReferences(target);
    assert.deepEqual(residualReferences, []);
    assert.equal(
      residualReferences.includes("frontend/src/pages/home/AppPageHomeView.tsx"),
      false,
      "the rewritten product-neutral home page is not retained as a sample reference",
    );
    await assert.rejects(readFile(samplePath), /ENOENT/u);
    await assert.rejects(readFile(join(target, overviewPath)), /ENOENT/u);
    assert.match(await readFile(join(target, "frontend/tests/e2e/login.spec.ts"), "utf8"), /export/u);
    await assert.rejects(
      readFile(join(target, "src/main/resources/db/migration/V3__enforce_item_value_constraints.sql")),
      /ENOENT/u,
    );
    for (const [path, contents] of protectedInfrastructure) {
      assert.equal(await readFile(join(target, path), "utf8"), contents, path);
    }
    for (const [path, contents] of retainedMaintainerEvidence) {
      assert.equal(await readFile(join(target, path), "utf8"), contents, path);
    }
    for (const path of genericCoverage) {
      assert.doesNotMatch(
        await readFile(join(target, path), "utf8"),
        /features\/item|pages\/items|\/items\b|\bItems?(?:[A-Z]\w*)?\b|\bITEMS?\b|app[/.]item|create_item/u,
        path,
      );
    }
    const shellCoverage = await readFile(
      join(target, "frontend/tests/integration/app-shell-layout.integration.test.tsx"),
      "utf8",
    );
    assert.match(shellCoverage, /\bitems: readonly/u);
    assert.match(shellCoverage, /\bitems\.map/u);
    assert.doesNotMatch(shellCoverage, /\brecords: readonly|\brecords\.map/u);
    const openApiCoverage = JSON.parse(
      await readFile(join(target, "src/test/resources/contracts/openapi-compatibility.json"), "utf8"),
    );
    assert.equal(openApiCoverage.operations["GET /api/history"], undefined);
    assert.equal(openApiCoverage.operations["POST /api/items/search"], undefined);
    assert.deepEqual(openApiCoverage.schemaNames, ["ApiError"]);
    const deploymentSmoke = await readFile(join(target, "scripts/verify-deployment.sh"), "utf8");
    assert.match(deploymentSmoke, /POSTGRES_RUNTIME_USER:-sample_app_runtime/u);
    assert.match(deploymentSmoke, /POSTGRES_DB:-sample_app/u);
    assert.doesNotMatch(
      deploymentSmoke,
      /starter_template|persisted CRUD|has_table_privilege\('\$runtime_user', 'item'/u,
    );
    assert.match(
      await readFile(join(target, "frontend/tests/deployment/item-persistence.spec.ts"), "utf8"),
      /authenticates and preserves a session/u,
    );
    const recoverySmoke = await readFile(join(target, "scripts/verify-database-recovery.sh"), "utf8");
    assert.match(recoverySmoke, /"\$target_user_count" "\$target_migration_count"/u);
    assert.doesNotMatch(recoverySmoke, /^\+\s/mu);
    const managed = JSON.parse(await readFile(join(target, ".vireo/managed-files.json"), "utf8"));
    const managedByPath = new Map(managed.files.map(file => [file.path, file.sha256]));
    for (const path of [
      ...[...protectedInfrastructure.keys()].filter(path => path !== customizedManagedPath),
      "scripts/verify.sh",
      "scripts/verify-deployment.sh",
      "frontend/tests/deployment/item-persistence.spec.ts",
    ]) {
      const content = await readFile(join(target, path));
      assert.equal(managedByPath.get(path), createHash("sha256").update(content).digest("hex"), path);
    }
    const customizedContents = await readFile(join(target, customizedManagedPath));
    assert.equal(managedByPath.get(customizedManagedPath), originalManagedHash);
    assert.notEqual(createHash("sha256").update(customizedContents).digest("hex"), originalManagedHash);
    const status = await vireoProjectStatus(target);
    assert.equal(status.managedFiles.find(file => file.path === customizedManagedPath)?.state, "customized");
    assert.equal((await removeExample(target)).state, "removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remove-example refuses symbolic-link targets before applying a sample removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "remove-vireo-symlink-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "sample-app");
    await createVireo({ directory: target, git: false, templateDirectory: template });
    const sampleDirectory = join(target, "frontend/src/features/item");
    const sampleFile = join(sampleDirectory, "public.ts");
    const outsideDirectory = join(root, "outside-item");
    const outsideSentinel = join(outsideDirectory, "public.ts");
    const original = await readFile(sampleFile);
    await mkdir(outsideDirectory);
    await writeFile(outsideSentinel, original);
    await rm(sampleFile);
    await symlink(outsideSentinel, sampleFile, "file");

    await assert.rejects(removeExample(target, true), /symbolic link/u);
    assert.deepEqual(await readFile(outsideSentinel), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remove-example retains framework contract infrastructure in standalone frontend projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "remove-vireo-frontend-example-test-"));
  try {
    const template = await fixture(root);
    const target = join(root, "sample-frontend");
    await createVireo({ directory: target, profile: "frontend", git: false, templateDirectory: template });
    const ownership = JSON.parse(await readFile(join(target, ".vireo/example-manifest.json"), "utf8"));
    assert.equal(ownership.files["tests/e2e/overview.spec.ts"], undefined);
    await assert.rejects(readFile(join(target, "tests/e2e/overview.spec.ts")), /ENOENT/u);
    const protectedInfrastructure = new Map(
      await Promise.all(
        ["scripts/architecture-policy.test.mjs", "scripts/pwa-contract.mjs", "tests/pwa/production-pwa.spec.ts"].map(
          async path => [path, await readFile(join(target, path), "utf8")],
        ),
      ),
    );

    const preview = await removeExample(target);
    for (const path of protectedInfrastructure.keys()) {
      assert.equal(
        preview.files.some(file => file.path === path && file.status === "delete"),
        false,
        `${path} is retained for the standalone frontend profile`,
      );
    }

    await removeExample(target, true);
    for (const [path, contents] of protectedInfrastructure) {
      assert.equal(await readFile(join(target, path), "utf8"), contents, path);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
