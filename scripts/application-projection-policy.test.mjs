import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APPLICATION_PROJECTION_CATEGORIES,
  classifyProjectionPath,
  validateApplicationIdentity,
  validateApplicationProjectionContract,
} from "./lib/application-projection-contract.mjs";

const contract = JSON.parse(readFileSync("contracts/application-projection-contract.json", "utf8"));
const clone = value => structuredClone(value);
const templateProviderOnlyPaths = [
  ".github/environments/template-release.deployment-branch-policies.json",
  ".github/environments/template-release.live-assertions.json",
  ".github/rulesets/main.json",
  ".github/settings/actions.json",
  ".github/settings/selected-actions.json",
  ".github/settings/template-release-automation.required-variables.json",
  ".github/settings/workflow-permissions.json",
];
const durableTemplateReleaseRecoveryPaths = [
  ".github/workflows/template-release-recover.yml",
  "scripts/template-release-reconciliation.mjs",
  "scripts/template-release-reconciliation.test.mjs",
];
const hostedTemplatePreparationPaths = [
  ".github/workflows/template-release-preparation.yml",
  ".github/workflows/template-release-preparation-reconcile.yml",
  ".github/environments/template-preparation.json",
  ".github/environments/template-preparation.deployment-branch-policies.json",
  ".github/environments/template-preparation.live-assertions.json",
  ".github/environments/template-preparation.required-credentials.json",
  "scripts/template-release-preparation-workflow.mjs",
  "scripts/template-release-preparation-workflow.test.mjs",
  "scripts/template-release-preparation-reconciler.mjs",
  "scripts/template-release-preparation-reconciler.test.mjs",
];

test("the checked-in application projection contract is semantically valid", () => {
  assert.deepEqual(validateApplicationProjectionContract(contract), []);
  assert.deepEqual(Object.keys(contract.categories).sort(), [...APPLICATION_PROJECTION_CATEGORIES].sort());
});

test("flagship operations and historical evidence are excluded from every project profile", () => {
  for (const profile of contract.profiles) {
    for (const path of [
      ".github/workflows/flagship-demo.yml",
      ".github/workflows/support-evidence.yml",
      ".performance-evidence/lighthouse.json",
      ".verification-evidence/latest.json",
      "contracts/flagship-demo-policy.json",
      "deploy/hetzner/deploy.sh",
      "deploy/hetzner/flagship-host-deploy.sh",
      "docs/flagship.md",
    ]) {
      assert.equal(classifyProjectionPath(contract, path, profile)?.disposition, "exclude", `${profile}: ${path}`);
    }
  }
});

test("template release operations are excluded from every project profile", () => {
  for (const profile of contract.profiles) {
    for (const path of [
      ".github/workflows/template-release.yml",
      ...durableTemplateReleaseRecoveryPaths,
      ...hostedTemplatePreparationPaths,
      ...templateProviderOnlyPaths,
      ".github/rulesets/starter-template-0.8.0.json",
      ".github/rulesets/starter-template-0.8.1.json",
      ".github/rulesets/starter-template-0.8.2.json",
      ".github/rulesets/starter-template-0.8.3.json",
      ".github/rulesets/starter-template-0.8.4.json",
      ".github/rulesets/starter-template-0.8.5.json",
      ".github/rulesets/starter-template-0.8.6.json",
      ".github/rulesets/starter-template-0.8.7.json",
      "scripts/vireo-package-compatibility.test.mjs",
      "contracts/template-release-policy.json",
      "scripts/template-release-policy.mjs",
      "scripts/template-release-policy.test.mjs",
      "scripts/write-template-release-manifest.mjs",
      "scripts/template-release-artifacts.mjs",
      "scripts/template-release-coordinate-change.mjs",
      "scripts/template-release-state.mjs",
      "scripts/template-release-state.test.mjs",
    ]) {
      const classification = classifyProjectionPath(contract, path, profile);
      assert.equal(classification?.category, "maintainer-only", `${profile}: ${path}`);
      assert.equal(classification?.disposition, "exclude", `${profile}: ${path}`);
    }
  }
});

test("template maintainer policy wrappers are excluded from full-stack projects", () => {
  for (const path of [
    "scripts/codex-customization-policy.test.mjs",
    "contracts/platform-support-policy.json",
    "scripts/platform-support-policy.mjs",
    "scripts/public-contract-policy.mjs",
    "scripts/verification-pipeline-policy.mjs",
    "scripts/vireo-package-compatibility-policy.mjs",
  ]) {
    const classification = classifyProjectionPath(contract, path, "full-stack");
    assert.equal(classification?.category, "maintainer-only", path);
    assert.equal(classification?.disposition, "exclude", path);
    assert.equal(classifyProjectionPath(contract, path, "frontend")?.disposition, "exclude", `frontend: ${path}`);
  }
});

test("the Template platform-support wrapper test is excluded from both project profiles", () => {
  const path = "scripts/platform-support-policy.test.mjs";
  for (const profile of contract.profiles) {
    const classification = classifyProjectionPath(contract, path, profile);
    assert.equal(classification?.category, "maintainer-only", profile);
    assert.equal(classification?.disposition, "exclude", profile);
  }
});

test("classification is profile-aware, specificity-based, and fail closed", () => {
  assert.equal(classifyProjectionPath(contract, "frontend/src/app/App.tsx", "frontend")?.category, "application-owned");
  assert.equal(
    classifyProjectionPath(contract, "frontend/package.json", "frontend")?.category,
    "substitution-required",
  );
  assert.equal(classifyProjectionPath(contract, "scripts/setup.mjs", "full-stack")?.category, "managed");
  assert.equal(
    classifyProjectionPath(contract, "docs/recipes/rehearse-demo-reset.md", "full-stack")?.category,
    "maintainer-only",
  );
  assert.equal(
    classifyProjectionPath(contract, "docs/recipes/rehearse-demo-reset.md", "frontend")?.category,
    "maintainer-only",
  );
  assert.equal(
    classifyProjectionPath(contract, "frontend/pwa-policy.mjs", "full-stack")?.category,
    "substitution-required",
  );
  assert.equal(classifyProjectionPath(contract, "pwa-policy.mjs", "frontend")?.category, "substitution-required");
  assert.equal(
    classifyProjectionPath(contract, "frontend/scripts/app-identity-html.mjs", "full-stack")?.category,
    "managed",
  );
  assert.equal(classifyProjectionPath(contract, "scripts/app-identity-html.mjs", "frontend")?.category, "managed");
  assert.equal(
    classifyProjectionPath(contract, "frontend/scripts/app-identity-html.d.mts", "full-stack")?.category,
    "managed",
  );
  for (const path of [
    "frontend/scripts/lighthouse-audit-support.mjs",
    "frontend/scripts/lighthouse-audit-support.test.mjs",
    "frontend/scripts/lighthouse-budget.mjs",
    "frontend/scripts/lighthouse-policy.mjs",
    "frontend/scripts/lighthouse-policy.test.mjs",
  ]) {
    for (const profile of contract.profiles)
      assert.equal(classifyProjectionPath(contract, path, profile)?.category, "managed", `${profile}: ${path}`);
  }
  assert.equal(
    classifyProjectionPath(contract, "docs/verification-performance.md", "full-stack")?.category,
    "historical",
  );
  assert.equal(
    classifyProjectionPath(contract, "frontend/tests/demo/flagship-demo.spec.ts", "full-stack")?.category,
    "optional",
  );
  assert.equal(
    classifyProjectionPath(contract, "frontend/tests/e2e/overview.spec.ts", "frontend")?.category,
    "maintainer-only",
  );
  assert.equal(classifyProjectionPath(contract, "scripts/app-identity-html.d.mts", "frontend")?.category, "managed");
  assert.equal(
    classifyProjectionPath(contract, "frontend/tests/contract/pwa-contract.test.mjs", "full-stack")?.category,
    "managed",
  );
  assert.equal(
    classifyProjectionPath(contract, "tests/contract/pwa-contract.test.mjs", "frontend")?.category,
    "managed",
  );
  assert.equal(classifyProjectionPath(contract, ".gitignore", "frontend")?.category, "maintainer-only");
  assert.equal(classifyProjectionPath(contract, "frontend/scripts/verify.sh", "full-stack")?.category, "managed");
  assert.equal(classifyProjectionPath(contract, "frontend/scripts/verify.sh", "frontend")?.category, "maintainer-only");
  assert.equal(
    classifyProjectionPath(contract, "scripts/project-identity-policy.mjs", "full-stack")?.category,
    "managed",
  );
  assert.equal(
    classifyProjectionPath(contract, "scripts/public-contract-policy.mjs", "full-stack")?.category,
    "maintainer-only",
  );
  assert.equal(classifyProjectionPath(contract, ".vscode/settings.json", "full-stack")?.category, "optional");
  assert.equal(classifyProjectionPath(contract, ".vscode/settings.json", "frontend")?.category, "maintainer-only");
  assert.equal(
    classifyProjectionPath(contract, "frontend/tests/pwa/production-pwa.spec.ts", "full-stack")?.category,
    "managed",
  );
  assert.equal(classifyProjectionPath(contract, "tests/pwa/production-pwa.spec.ts", "frontend")?.category, "managed");
  assert.equal(classifyProjectionPath(contract, "frontend/vite.config.ts", "full-stack")?.category, "managed");
  assert.equal(classifyProjectionPath(contract, "vite.config.ts", "frontend")?.category, "managed");
  for (const path of [
    "index.html",
    "nginx.conf",
    "playwright.pwa.config.ts",
    "scripts/verify-frontend-profile.sh",
    "scripts/vireo-frontend-doctor.mjs",
    "scripts/project-identity-policy.mjs",
  ]) {
    assert.equal(classifyProjectionPath(contract, path, "frontend")?.category, "managed", path);
  }
  assert.equal(
    classifyProjectionPath(contract, "frontend/src/app/ui/localization/resources/app.en.ts", "full-stack")?.category,
    "application-owned",
  );
  assert.equal(
    classifyProjectionPath(contract, "src/app/ui/localization/resources/app.en.ts", "frontend")?.category,
    "maintainer-only",
  );
  assert.equal(
    classifyProjectionPath(contract, "frontend/src/app/ui/localization/resources/app.en.ts", "frontend")?.category,
    "application-owned",
  );
  for (const profile of contract.profiles) {
    assert.equal(classifyProjectionPath(contract, "AGENTS.md", profile)?.category, "maintainer-only");
    assert.equal(
      classifyProjectionPath(contract, ".vireo/application/AGENTS.md", profile)?.category,
      "application-owned",
    );
    for (const path of [
      ".vireo/application/.agents/skills/vireo-app-feature-author/SKILL.md",
      ".vireo/application/.agents/skills/vireo-app-feature-author/agents/openai.yaml",
      ".vireo/application/.agents/skills/vireo-app-production-readiness/SKILL.md",
      ".vireo/application/.agents/skills/vireo-app-production-readiness/agents/openai.yaml",
      ".vireo/application/.agents/skills/vireo-app-upgrader/SKILL.md",
      ".vireo/application/.agents/skills/vireo-app-upgrader/agents/openai.yaml",
    ]) {
      assert.equal(classifyProjectionPath(contract, path, profile)?.category, "managed", path);
    }
    for (const path of [
      ".github/rulesets/starter-template-0.8.0.json",
      ".github/rulesets/starter-template-0.8.1.json",
      ".github/rulesets/starter-template-0.8.2.json",
      ".github/rulesets/starter-template-0.8.3.json",
      ".github/rulesets/starter-template-0.8.4.json",
      ".github/rulesets/starter-template-0.8.5.json",
      ".github/rulesets/starter-template-0.8.6.json",
      ".github/rulesets/starter-template-0.8.7.json",
      "scripts/vireo-package-compatibility.test.mjs",
    ]) {
      assert.equal(classifyProjectionPath(contract, path, profile)?.category, "maintainer-only");
    }
    for (const path of templateProviderOnlyPaths) {
      assert.equal(classifyProjectionPath(contract, path, profile)?.category, "maintainer-only", path);
    }
    for (const path of hostedTemplatePreparationPaths) {
      assert.equal(classifyProjectionPath(contract, path, profile)?.category, "maintainer-only", path);
    }
    assert.equal(
      classifyProjectionPath(contract, ".agents/skills/vireo-template-maintainer/SKILL.md", profile)?.category,
      "maintainer-only",
    );
  }
  assert.equal(
    classifyProjectionPath(contract, "scripts/vireo-package-compatibility.mjs", "full-stack")?.category,
    "managed",
  );
  assert.equal(
    classifyProjectionPath(contract, "frontend/public/icons/icon-192x192.png", "full-stack")?.category,
    "application-owned",
  );
  assert.equal(
    classifyProjectionPath(contract, "public/icons/icon-192x192.png", "frontend")?.category,
    "application-owned",
  );
  assert.equal(classifyProjectionPath(contract, "new-maintainer-surface.txt", "full-stack"), undefined);
});

test("the validator rejects ambiguous and missing ownership decisions", () => {
  const ambiguous = clone(contract);
  ambiguous.rules.push({
    id: "ambiguous-security",
    category: "application-owned",
    profiles: ["full-stack"],
    paths: ["SECURITY.md"],
    prefixes: [],
  });
  assert.match(validateApplicationProjectionContract(ambiguous).join("\n"), /SECURITY\.md is declared by both/u);

  const missing = clone(contract);
  missing.rules = missing.rules.map(rule => ({
    ...rule,
    paths: rule.paths.filter(path => path !== ".github/workflows/flagship-demo.yml"),
  }));
  assert.match(validateApplicationProjectionContract(missing).join("\n"), /flagship-demo\.yml is unclassified/u);

  const missingPlatformSupportTest = clone(contract);
  missingPlatformSupportTest.rules = missingPlatformSupportTest.rules.map(rule => ({
    ...rule,
    paths: rule.paths.filter(path => path !== "scripts/platform-support-policy.test.mjs"),
  }));
  assert.match(
    validateApplicationProjectionContract(missingPlatformSupportTest).join("\n"),
    /platform-support-policy\.test\.mjs/u,
  );

  const missingDurableRecoveryWorkflow = clone(contract);
  missingDurableRecoveryWorkflow.rules = missingDurableRecoveryWorkflow.rules.map(rule => ({
    ...rule,
    paths: rule.paths.filter(path => path !== ".github/workflows/template-release-recover.yml"),
  }));
  assert.match(
    validateApplicationProjectionContract(missingDurableRecoveryWorkflow).join("\n"),
    /template-release-recover\.yml is unclassified for full-stack/u,
  );

  for (const path of durableTemplateReleaseRecoveryPaths.slice(1)) {
    const missingDurableRecoveryScript = clone(contract);
    missingDurableRecoveryScript.rules = missingDurableRecoveryScript.rules.map(rule => ({
      ...rule,
      paths: rule.paths.filter(candidate => candidate !== path),
    }));
    assert.match(
      validateApplicationProjectionContract(missingDurableRecoveryScript).join("\n"),
      new RegExp(`${path} must be maintainer-only for full-stack, got managed`, "u"),
    );
  }

  for (const path of templateProviderOnlyPaths) {
    const missingProviderSurface = clone(contract);
    missingProviderSurface.rules = missingProviderSurface.rules.map(rule => ({
      ...rule,
      paths: rule.paths.filter(candidate => candidate !== path),
    }));
    assert.match(
      validateApplicationProjectionContract(missingProviderSurface).join("\n"),
      new RegExp(`${path} is unclassified`, "u"),
    );
  }
});

test("creation permits explicit unresolved release routes but release validation blocks them", () => {
  const identity = {
    projectName: "inventory-app",
    displayName: "Inventory App",
    ownerName: "UNRESOLVED_VIREO_OWNER_NAME",
    repositoryUrl: "UNRESOLVED_VIREO_REPOSITORY_URL",
    supportUrl: "UNRESOLVED_VIREO_SUPPORT_URL",
    securityContact: "UNRESOLVED_VIREO_SECURITY_CONTACT",
  };
  assert.deepEqual(validateApplicationIdentity(contract, identity, "creation"), []);
  assert.deepEqual(validateApplicationIdentity(contract, identity, "release"), [
    "ownerName is unresolved",
    "repositoryUrl is unresolved",
    "supportUrl is unresolved",
    "securityContact is unresolved",
  ]);
});

test("release identity must be application-owned and route security separately", () => {
  const valid = {
    projectName: "inventory-app",
    displayName: "Inventory App",
    ownerName: "Acme Operations",
    repositoryUrl: "https://github.com/acme/inventory-app",
    supportUrl: "https://support.acme.example/inventory",
    securityContact: "mailto:security@acme.example",
  };
  assert.deepEqual(validateApplicationIdentity(contract, valid), []);
  assert.match(
    validateApplicationIdentity(contract, {
      ...valid,
      repositoryUrl: "https://github.com/vireocodedev/vireo-template",
      securityContact: valid.supportUrl,
    }).join("\n"),
    /must not inherit a Vireo[\s\S]*must be distinct/u,
  );
  for (const identity of [
    {
      ...valid,
      supportUrl: "https://support.acme.example/inventory",
      securityContact: "https://support.acme.example/inventory/",
    },
    {
      ...valid,
      supportUrl: "mailto:Security@acme.example",
      securityContact: "mailto:security@acme.example",
    },
  ]) {
    assert.match(
      validateApplicationIdentity(contract, identity).join("\n"),
      /supportUrl and securityContact must be distinct/u,
    );
  }
});

test("release identity URLs are structurally parsed and normalized before route comparison", () => {
  const valid = {
    projectName: "inventory-app",
    displayName: "Inventory App",
    ownerName: "Acme Operations",
    repositoryUrl: "https://github.com/acme/inventory-app",
    supportUrl: "https://support.acme.example/inventory",
    securityContact: "mailto:Security@acme.example",
  };
  assert.deepEqual(validateApplicationIdentity(contract, valid), []);

  for (const repositoryUrl of [
    "https:///missing-host",
    "https://.",
    "https://..",
    "https://user@example.test/inventory",
    "https://:password@example.test/inventory",
    "https://@example.test/inventory",
    "https://example.test/invalid\\path",
    "https://example.test/invalid\u0000path",
  ]) {
    assert.match(
      validateApplicationIdentity(contract, { ...valid, repositoryUrl }).join("\n"),
      /repositoryUrl must use https-url format/u,
      repositoryUrl,
    );
  }

  assert.match(
    validateApplicationIdentity(contract, {
      ...valid,
      supportUrl: "https://SUPPORT.acme.example:443/inventory/",
      securityContact: "https://support.acme.example/inventory",
    }).join("\n"),
    /supportUrl and securityContact must be distinct/u,
  );
});
