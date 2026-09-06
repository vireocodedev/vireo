---
name: vireo-generator-maintainer
description: "Use for create-vireo generation, projection, and project upgrades; not ordinary consumer application feature work or simply creating a new app."
---

# Vireo Generator Maintainer

Complete the [shared entry](../vireo-framework/references/workflow.md#entry),
including on direct invocation. Plan/review inspects these contracts without
running fixtures. A request to create an app uses
[$vireo-project-create](../vireo-project-create/SKILL.md), not a generator change.

Use this skill for `create-vireo`, entity schemas/rendering, projection rules, Template fixtures, or declared project upgrade edges. Do not use it for ordinary application feature work.

## Before changing behavior

- Read [application projection](../../../docs/APPLICATION_PROJECTION.md), [generated-code ownership](../../../docs/architecture/generated-code-ownership.md), and [entity schemas](../../../docs/generators/entity-schema.md).
- Identify whether each touched file is managed, application-owned, optional, substitution-required, or excluded for each profile.
- Preserve atomic writes, dry-run behavior, output containment, manifest checks, and collision refusal. An upgrade must never silently replace application-owned or ejected work.

## Required evidence

- Keep `contracts/application-projection-contract.json` and `packages/create-vireo/schema/application-projection-contract.json` byte-identical.
- Add focused fixture coverage for a new projection path, generator shape, or upgrade edge. Exercise full-stack and frontend behavior when the path can differ.
- Use a temporary fixture or `--dry-run`; do not mutate a real consumer app while validating the generator.

In implementation, add one failing fixture contract and its implementation at a
time. Discover projection and targeted generator checks in current package scripts;
inspect their build/output effects before running them. Local Template fixtures
require an explicitly authorized exact source path, never an inferred sibling.
Escalate full projection/clean-consumer gates only with sequential coordination.

Complete the [shared exit](../vireo-framework/references/workflow.md#exit), accounting
for ownership classes, both profiles, atomicity/collisions, contract mirror parity,
and actual fixture results. Local skill source changes are not a released CLI
capability or permission to rewrite an immutable pin or invent an upgrade edge.
