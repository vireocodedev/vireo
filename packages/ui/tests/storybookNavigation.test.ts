import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");
const packagesRoot = join(packageRoot, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const srcRoot = join(packageRoot, "src");
const docsRoot = join(packageRoot, "docs", "storybook");
const historyDocsRoot = join(packagesRoot, "history", "docs", "storybook");
const historyExamplesRoot = join(packagesRoot, "history", "docs", "examples");
const infrastructureDocsRoot = join(packagesRoot, "infrastructure", "docs", "storybook");
const infrastructureExamplesRoot = join(packagesRoot, "infrastructure", "docs", "examples");
const localizationDocsRoot = join(packagesRoot, "localization", "docs", "storybook");
const localizationExamplesRoot = join(packagesRoot, "localization", "docs", "examples");
const queryEngineDocsRoot = join(packagesRoot, "queryengine", "docs", "storybook");
const queryEngineExamplesRoot = join(packagesRoot, "queryengine", "docs", "examples");
const shellDocsRoot = join(packagesRoot, "shell", "docs", "storybook");
const shellExamplesRoot = join(packagesRoot, "shell", "docs", "examples");
const sqliteDocsRoot = join(packagesRoot, "sqlite", "docs", "storybook");
const sqliteExamplesRoot = join(packagesRoot, "sqlite", "docs", "examples");
const jvmDocsRoot = join(repositoryRoot, "jvm", "docs", "storybook");
const jvmAuthDocsRoot = join(repositoryRoot, "jvm", "vireo-auth", "docs", "storybook");
const jvmBomDocsRoot = join(repositoryRoot, "jvm", "vireo-bom", "docs", "storybook");
const jvmCoreDocsRoot = join(repositoryRoot, "jvm", "vireo-core", "docs", "storybook");
const jvmHistoryDocsRoot = join(repositoryRoot, "jvm", "vireo-history", "docs", "storybook");
const jvmOfflineDocsRoot = join(repositoryRoot, "jvm", "vireo-offline", "docs", "storybook");
const jvmQueryEngineDocsRoot = join(repositoryRoot, "jvm", "vireo-query", "docs", "storybook");
const jvmDocumentationExamplesRoot = join(
  repositoryRoot,
  "jvm",
  "vireo-starter-documentation-examples",
  "src",
  "main",
  "java",
);
const storybookConfigFile = join(packageRoot, ".storybook-vireo", "main.ts");
const storybookManagerFile = join(packageRoot, ".storybook-vireo", "manager.ts");

const EXPECTED_DOCUMENTATION_ROUTES = [
  "Documentation/Overview",
  "TypeScript/Overview",
  "TypeScript/UI/Overview",
  "TypeScript/UI/Documentation/Installation",
  "TypeScript/UI/Documentation/Guides/Common Patterns",
  "TypeScript/UI/Documentation/Guides/Motion and Interaction",
  "TypeScript/UI/Documentation/Guides/Theming",
  "TypeScript/UI/Documentation/Guides/Providers",
  "TypeScript/UI/Documentation/Guides/Augmentable Interfaces",
  "TypeScript/UI/Documentation/Guides/Notifications",
  "TypeScript/UI/Documentation/Guides/Table Patterns",
  "TypeScript/UI/Documentation/Guides/TanStack Query",
  "TypeScript/UI/Documentation/Guides/Drag and Drop",
] as const;

const EXPECTED_HISTORY_ROUTES = [
  "TypeScript/History/Overview",
  "TypeScript/History/Primary Workflow",
  "TypeScript/History/Nested Definitions",
  "TypeScript/History/Collections",
  "TypeScript/History/Formatting and Comparison",
  "TypeScript/History/Node Model",
  "TypeScript/History/Record Validation",
  "TypeScript/History/Failure Semantics",
] as const;

const EXPECTED_LOCALIZATION_ROUTES = [
  "TypeScript/Localization/Overview",
  "TypeScript/Localization/Primary Workflow",
  "TypeScript/Localization/Late Registration",
  "TypeScript/Localization/Custom Namespaces",
  "TypeScript/Localization/Number Formatting",
  "TypeScript/Localization/Failure Semantics",
] as const;

const EXPECTED_INFRASTRUCTURE_ROUTES = [
  "TypeScript/Infrastructure/Overview",
  "TypeScript/Infrastructure/Primary Workflow",
  "TypeScript/Infrastructure/HTTP and Pagination",
  "TypeScript/Infrastructure/Connectivity",
  "TypeScript/Infrastructure/Persistent State",
  "TypeScript/Infrastructure/Session Expiry",
  "TypeScript/Infrastructure/Failure Semantics",
] as const;

const EXPECTED_SQLITE_ROUTES = [
  "TypeScript/SQLite/Overview",
  "TypeScript/SQLite/Primary Workflow",
  "TypeScript/SQLite/Managed Runtime",
  "TypeScript/SQLite/Offline Replay",
  "TypeScript/SQLite/Hydration State",
  "TypeScript/SQLite/Offline Utilities",
  "TypeScript/SQLite/Failure Semantics",
] as const;

const EXPECTED_QUERY_ENGINE_ROUTES = [
  "TypeScript/Query Engine/Overview",
  "TypeScript/Query Engine/Primary Workflow",
  "TypeScript/Query Engine/Filter Compilation",
  "TypeScript/Query Engine/SQLite Execution",
  "TypeScript/Query Engine/Config Persistence",
  "TypeScript/Query Engine/Failure Semantics",
] as const;

const EXPECTED_SHELL_ROUTES = [
  "TypeScript/Shell/Overview",
  "TypeScript/Shell/Primary Workflow",
  "TypeScript/Shell/Sitemap and Paths",
  "TypeScript/Shell/Navigation and Config",
  "TypeScript/Shell/Auth Redirects",
  "TypeScript/Shell/Overlay History",
  "TypeScript/Shell/Failure Semantics",
] as const;

const EXPECTED_JVM_AUTH_ROUTES = [
  "JVM/Auth/Overview",
  "JVM/Auth/Primary Workflow",
  "JVM/Auth/Configuration and Security",
  "JVM/Auth/External Identity and API Keys",
] as const;

const EXPECTED_JVM_ROUTES = ["JVM/Overview"] as const;

const EXPECTED_JVM_BOM_ROUTES = ["JVM/BOM/Overview", "JVM/BOM/Consumption and Release Semantics"] as const;

const EXPECTED_JVM_CORE_ROUTES = [
  "JVM/Core/Overview",
  "JVM/Core/Primary Workflow",
  "JVM/Core/Web, Migrations, and Extensions",
] as const;

const EXPECTED_JVM_HISTORY_ROUTES = ["JVM/History/Overview", "JVM/History/Security and Actors"] as const;

const EXPECTED_JVM_OFFLINE_ROUTES = [
  "JVM/Offline/Overview",
  "JVM/Offline/Primary Workflow",
  "JVM/Offline/Configuration, Security, and Persistence",
] as const;

const EXPECTED_JVM_QUERY_ENGINE_ROUTES = [
  "JVM/Query Engine/Overview",
  "JVM/Query Engine/Primary Workflow",
  "JVM/Query Engine/Configuration, Security, and Persistence",
] as const;

const APPROVED_STORY_ROUTES = [
  /^TypeScript\/UI\/Core\/(?:Behavior|Controls|Data Display|Feedback|Hooks|Layout|Navigation|Providers|Surfaces)\/(?:Vireo|useVireo)/u,
  /^TypeScript\/UI\/Capabilities\/(?:Application Navigation|Application Preferences|Countries|History|Infinite Canvas|Overlays|Page Layout|Tables)\/(?:Vireo|useVireo)/u,
  /^TypeScript\/UI\/Capabilities\/Forms\/(?:(?:Fields|Multi-Step|Overlays)\/)?(?:Vireo|useVireo)/u,
  /^TypeScript\/UI\/Integrations\/(?:Drag and Drop · Hello Pangea DND|Event Source|Localization|Notifications · Sonner|TanStack Query)\/(?:Vireo|useVireo)/u,
] as const;

function findFiles(root: string, predicate: (file: string) => boolean): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = join(root, entry.name);
    return entry.isDirectory() ? findFiles(file, predicate) : predicate(file) ? [file] : [];
  });
}

function storyTitle(file: string): string {
  const matches = [...readFileSync(file, "utf8").matchAll(/\btitle:\s*"([^"]+\/[^"]+)"/gu)];
  expect(matches, `${relative(packageRoot, file)} must declare exactly one slash-separated meta.title`).toHaveLength(1);
  return matches[0]?.[1] ?? "";
}

function documentationTitle(file: string): string {
  const match = readFileSync(file, "utf8").match(/<Meta\s+title="([^"]+)"\s*\/>/u);
  expect(match, `${relative(packageRoot, file)} must declare one standalone MDX Meta title`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("Vireo Starter Storybook navigation contract", () => {
  it("discovers the complete UI catalog and every audited package's pages", () => {
    const configSource = readFileSync(storybookConfigFile, "utf8");

    expect(configSource).toContain('"../src/**/{Vireo,useVireo}*.stories.@(js|jsx|mjs|ts|tsx)"');
    expect(configSource).toContain('"../docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../history/docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../infrastructure/docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../localization/docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../queryengine/docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../shell/docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../sqlite/docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../../jvm/docs/storybook/**/*.mdx"');
    expect(configSource).toContain('"../../../jvm/*/docs/storybook/**/*.mdx"');
  });

  it("assigns explicit icons to every top-level section", () => {
    const managerSource = readFileSync(storybookManagerFile, "utf8");

    expect(managerSource).toContain("Documentation: BookIcon");
    expect(managerSource).toContain("TypeScript: ComponentDrivenIcon");
    expect(managerSource).toContain("UI: ComponentIcon");
    expect(managerSource).toContain("JVM: BoxIcon");
    expect(managerSource).toContain("BOM: BranchIcon");
    expect(managerSource).toContain("Core: BoxIcon");
    expect(managerSource).toContain("Auth: LockIcon");
    expect(managerSource).toContain("History: TimeIcon");
    expect(managerSource).toContain("Offline: SyncIcon");
    expect(managerSource).toContain("Infrastructure: WrenchIcon");
    expect(managerSource).toContain("Localization: GlobeIcon");
    expect(managerSource).toContain('"Query Engine": SearchIcon');
    expect(managerSource).toContain("SQLite: DatabaseIcon");
    expect(managerSource).toContain("Shell: SidebarIcon");
  });

  it("keeps every CSF entry under an approved public root and group", () => {
    const storyFiles = findFiles(srcRoot, file => /\.stories\.[cm]?[jt]sx?$/u.test(file));
    const violations = storyFiles
      .map(file => ({ file, title: storyTitle(file) }))
      .filter(({ title }) => !APPROVED_STORY_ROUTES.some(pattern => pattern.test(title)))
      .map(({ file, title }) => `${relative(packageRoot, file)}: ${title}`);

    expect(violations).toEqual([]);
  });

  it("indexes monorepo documentation, the TypeScript overview, and UI-owned guides under their runtime roots", () => {
    const actualRoutes = findFiles(docsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(actualRoutes).toEqual([...EXPECTED_DOCUMENTATION_ROUTES].sort());
  });

  it("indexes every package-owned History page under the History root", () => {
    const actualRoutes = findFiles(historyDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(actualRoutes).toEqual([...EXPECTED_HISTORY_ROUTES].sort());
  });

  it("indexes every package-owned Localization page under the Localization root", () => {
    const actualRoutes = findFiles(localizationDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(actualRoutes).toEqual([...EXPECTED_LOCALIZATION_ROUTES].sort());
  });

  it("indexes every package-owned Infrastructure page under the Infrastructure root", () => {
    const actualRoutes = findFiles(infrastructureDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(actualRoutes).toEqual([...EXPECTED_INFRASTRUCTURE_ROUTES].sort());
  });

  it("indexes every package-owned SQLite page under the SQLite root", () => {
    const actualRoutes = findFiles(sqliteDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(actualRoutes).toEqual([...EXPECTED_SQLITE_ROUTES].sort());
  });

  it("indexes every package-owned Query Engine page under the Query Engine root", () => {
    const actualRoutes = findFiles(queryEngineDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(actualRoutes).toEqual([...EXPECTED_QUERY_ENGINE_ROUTES].sort());
  });

  it("indexes every package-owned Shell page under the Shell root", () => {
    const actualRoutes = findFiles(shellDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(actualRoutes).toEqual([...EXPECTED_SHELL_ROUTES].sort());
  });

  it("indexes audited JVM guides under the JVM root", () => {
    const jvmRoutes = findFiles(jvmDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();
    const bomRoutes = findFiles(jvmBomDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();
    const coreRoutes = findFiles(jvmCoreDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();
    const authRoutes = findFiles(jvmAuthDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();
    const historyRoutes = findFiles(jvmHistoryDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();
    const offlineRoutes = findFiles(jvmOfflineDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();
    const queryEngineRoutes = findFiles(jvmQueryEngineDocsRoot, file => extname(file) === ".mdx")
      .map(documentationTitle)
      .sort();

    expect(jvmRoutes).toEqual([...EXPECTED_JVM_ROUTES].sort());
    expect(bomRoutes).toEqual([...EXPECTED_JVM_BOM_ROUTES].sort());
    expect(coreRoutes).toEqual([...EXPECTED_JVM_CORE_ROUTES].sort());
    expect(authRoutes).toEqual([...EXPECTED_JVM_AUTH_ROUTES].sort());
    expect(historyRoutes).toEqual([...EXPECTED_JVM_HISTORY_ROUTES].sort());
    expect(offlineRoutes).toEqual([...EXPECTED_JVM_OFFLINE_ROUTES].sort());
    expect(queryEngineRoutes).toEqual([...EXPECTED_JVM_QUERY_ENGINE_ROUTES].sort());
  });

  it("displays every compiled JVM documentation example from its exact source file", () => {
    const exampleFiles = findFiles(jvmDocumentationExamplesRoot, file => extname(file) === ".java");
    const documentationSources = [
      jvmBomDocsRoot,
      jvmCoreDocsRoot,
      jvmAuthDocsRoot,
      jvmQueryEngineDocsRoot,
      jvmHistoryDocsRoot,
      jvmOfflineDocsRoot,
    ].flatMap(root =>
      findFiles(root, file => extname(file) === ".mdx").map(file => ({ file, source: readFileSync(file, "utf8") })),
    );

    for (const exampleFile of exampleFiles) {
      const filename = exampleFile.slice(exampleFile.lastIndexOf("/") + 1);
      const owningPages = documentationSources.filter(({ source }) => source.includes(`${filename}?raw`));

      expect(owningPages, `${relative(repositoryRoot, exampleFile)} must be displayed by one JVM page`).toHaveLength(1);
      expect(owningPages[0]?.source).not.toMatch(/<Source[^>]+code=["'][\s\S]+["']/u);
    }
  });

  it("executes and displays every History example from the same source module", () => {
    const exampleFiles = findFiles(historyExamplesRoot, file => file.endsWith(".example.ts"));
    const documentationSources = findFiles(historyDocsRoot, file => extname(file) === ".mdx").map(file => ({
      file,
      source: readFileSync(file, "utf8"),
    }));

    for (const exampleFile of exampleFiles) {
      const basename = exampleFile.slice(exampleFile.lastIndexOf("/") + 1, -".example.ts".length);
      const owningPages = documentationSources.filter(({ source }) =>
        source.includes(`../examples/${basename}.example`),
      );

      expect(owningPages, `${relative(packagesRoot, exampleFile)} must be owned by one MDX page`).toHaveLength(1);
      expect(owningPages[0]?.source).toContain(`../examples/${basename}.example.ts?raw`);

      const exampleSource = readFileSync(exampleFile, "utf8");
      expect(exampleSource).toContain('from "@vireocodedev/history"');
      expect(exampleSource).not.toMatch(/\b(?:React|jsx|tsx)\b/u);
    }
  });

  it("executes and displays every Localization example from the same source module", () => {
    const exampleFiles = findFiles(localizationExamplesRoot, file => file.endsWith(".example.ts"));
    const documentationSources = findFiles(localizationDocsRoot, file => extname(file) === ".mdx").map(file => ({
      file,
      source: readFileSync(file, "utf8"),
    }));

    for (const exampleFile of exampleFiles) {
      const basename = exampleFile.slice(exampleFile.lastIndexOf("/") + 1, -".example.ts".length);
      const owningPages = documentationSources.filter(({ source }) =>
        source.includes(`../examples/${basename}.example`),
      );

      expect(owningPages, `${relative(packagesRoot, exampleFile)} must be owned by one MDX page`).toHaveLength(1);
      expect(owningPages[0]?.source).toContain(`../examples/${basename}.example.ts?raw`);

      const exampleSource = readFileSync(exampleFile, "utf8");
      expect(exampleSource).toContain('from "@vireocodedev/localization"');
      expect(exampleSource).not.toMatch(/\b(?:React|jsx|tsx)\b/u);
    }
  });

  it("executes and displays every Infrastructure example from the same source module", () => {
    const exampleFiles = findFiles(infrastructureExamplesRoot, file => file.endsWith(".example.ts"));
    const documentationSources = findFiles(infrastructureDocsRoot, file => extname(file) === ".mdx").map(file => ({
      file,
      source: readFileSync(file, "utf8"),
    }));

    for (const exampleFile of exampleFiles) {
      const basename = exampleFile.slice(exampleFile.lastIndexOf("/") + 1, -".example.ts".length);
      const owningPages = documentationSources.filter(({ source }) =>
        source.includes(`../examples/${basename}.example`),
      );

      expect(owningPages, `${relative(packagesRoot, exampleFile)} must be owned by one MDX page`).toHaveLength(1);
      expect(owningPages[0]?.source).toContain(`../examples/${basename}.example.ts?raw`);

      const exampleSource = readFileSync(exampleFile, "utf8");
      expect(exampleSource).toContain('from "@vireocodedev/infrastructure"');
      expect(exampleSource).not.toMatch(/\b(?:React|jsx|tsx)\b/u);
    }
  });

  it("executes and displays every SQLite example from the same source module", () => {
    const exampleFiles = findFiles(sqliteExamplesRoot, file => file.endsWith(".example.ts"));
    const documentationSources = findFiles(sqliteDocsRoot, file => extname(file) === ".mdx").map(file => ({
      file,
      source: readFileSync(file, "utf8"),
    }));

    for (const exampleFile of exampleFiles) {
      const basename = exampleFile.slice(exampleFile.lastIndexOf("/") + 1, -".example.ts".length);
      const owningPages = documentationSources.filter(({ source }) =>
        source.includes(`../examples/${basename}.example`),
      );

      expect(owningPages, `${relative(packagesRoot, exampleFile)} must be owned by one MDX page`).toHaveLength(1);
      expect(owningPages[0]?.source).toContain(`../examples/${basename}.example.ts?raw`);

      const exampleSource = readFileSync(exampleFile, "utf8");
      expect(exampleSource).toContain('from "@vireocodedev/sqlite');
      expect(exampleSource).not.toMatch(/\b(?:React|jsx|tsx)\b/u);
    }
  });

  it("executes and displays every Query Engine example from the same source module", () => {
    const exampleFiles = findFiles(queryEngineExamplesRoot, file => file.endsWith(".example.ts"));
    const documentationSources = findFiles(queryEngineDocsRoot, file => extname(file) === ".mdx").map(file => ({
      file,
      source: readFileSync(file, "utf8"),
    }));

    for (const exampleFile of exampleFiles) {
      const basename = exampleFile.slice(exampleFile.lastIndexOf("/") + 1, -".example.ts".length);
      const owningPages = documentationSources.filter(({ source }) =>
        source.includes(`../examples/${basename}.example`),
      );

      expect(owningPages, `${relative(packagesRoot, exampleFile)} must be owned by one MDX page`).toHaveLength(1);
      expect(owningPages[0]?.source).toContain(`../examples/${basename}.example.ts?raw`);

      const exampleSource = readFileSync(exampleFile, "utf8");
      expect(exampleSource).toContain('from "@vireocodedev/query"');
      expect(exampleSource).not.toMatch(/\b(?:React|jsx|tsx)\b/u);
    }
  });

  it("executes and displays every Shell example from the same source module", () => {
    const exampleFiles = findFiles(shellExamplesRoot, file => file.endsWith(".example.ts"));
    const documentationSources = findFiles(shellDocsRoot, file => extname(file) === ".mdx").map(file => ({
      file,
      source: readFileSync(file, "utf8"),
    }));

    for (const exampleFile of exampleFiles) {
      const basename = exampleFile.slice(exampleFile.lastIndexOf("/") + 1, -".example.ts".length);
      const owningPages = documentationSources.filter(({ source }) =>
        source.includes(`../examples/${basename}.example`),
      );

      expect(owningPages, `${relative(packagesRoot, exampleFile)} must be owned by one MDX page`).toHaveLength(1);
      expect(owningPages[0]?.source).toContain(`../examples/${basename}.example.ts?raw`);

      const exampleSource = readFileSync(exampleFile, "utf8");
      expect(exampleSource).toContain('from "@vireocodedev/shell"');
      expect(exampleSource).not.toMatch(/\b(?:React|jsx|tsx)\b/u);
    }
  });
});
