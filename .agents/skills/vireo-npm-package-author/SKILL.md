---
name: vireo-npm-package-author
description: "Use for public Vireo npm package changes; not private tooling or consumer application code."
---

# Vireo npm Package Author

Complete the [shared entry](../vireo-framework/references/workflow.md#entry),
including on direct invocation. Keep the selected mode: in plan/review these are
read-only criteria, not instructions to edit or run checks.

Use this skill when a change affects a publishable package in `packages/`. Do not use it for private repository tooling or consumer application code.

- Read [public API governance](../../../docs/package-authoring/PUBLIC_API_GOVERNANCE.md), [package portability](../../../docs/package-authoring/PACKAGE_PORTABILITY.md), and the touched package README.
- Treat exports, declarations, peer dependencies, runtime imports, API snapshots, and examples as one public contract. Preserve compatibility unless the requested release explicitly changes it.
- Keep package documentation usable from an installed package; do not rely on repository-relative imports or private paths.
- Add a changeset for a published API change and record release impact when TypeScript/JVM/template coordinates move together.

For implementation, use vertical test/implementation slices and discover the
smallest package checks from current scripts. Public-boundary changes also need
public-surface and strict-consumer evidence; coordinate broader runs under the
shared resource policy. An intent record is not approval to version or publish.

Complete the [shared exit](../vireo-framework/references/workflow.md#exit), including
exports/declarations/peer impact, actual check evidence, and any consumer-proof gap.
