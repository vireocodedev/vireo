# Repository and mode routing

Paths below are lookups relative to the selected repository root, not links from
this file. Identify role before loading a skill:

| Evidence                                                                             | Role                     | Load                                                       |
| ------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------- |
| `contracts/ecosystem-release-contract.json` and `packages/create-vireo/package.json` | Framework                | `.agents/skills/vireo-framework/SKILL.md`                  |
| `.vireo/template.json` and `contracts/template-release-policy.json`                  | Template source          | `.agents/skills/vireo-template/SKILL.md`                   |
| `.vireo/project.json`, checked against actual manifests/layout                       | Generated consumer       | `.agents/skills/vireo-app/SKILL.md`                        |
| Vireo dependencies in actual manifests, no current metadata                          | Legacy/existing consumer | Same app skill when installed; preserve unknown provenance |

Contradictory markers fail closed. An unrelated project is not made a consumer by
installing a skill. Consumer skills may exist without any `.vireo` metadata; the
safe adoption path deliberately does not create it.

## Mode dispatch

- `plan`, `feature`/`change`, `fix`, `review`, `docs`, `verify`: use the owning
  repository's router. Map `change` to app `feature`; map `readiness` in an app to
  app `verify` with an explicit readiness request. Map Template readiness to its
  read-only planning/verification reference, not a framework maturity promotion.
- `generate`: app router for a product capability; framework `change` with the
  generator specialist for changes to the CLI itself. Distinguish these first.
- `upgrade`: app upgrader for a selected consumer. Package upgrades inside the
  framework or Template use their local change/release-intent workflow; do not
  call a project-upgrade command on a maintainer checkout.
- `release`: framework release operator, or Template release reference. An app
  release uses app `operate` and application runbooks, not framework publication.
- `operate`: app or Template operations for the named environment. Framework
  website/provider operations use framework release planning and the specific
  runbook. Resolve ambiguous operations before any external call.
- `create`: discover the framework checkout and load its
  `.agents/skills/vireo-project-create/SKILL.md`. The resulting app must use a
  reviewed exact published CLI unless a local fixture was explicitly requested.
- `adopt-skills`: framework `adopt-skills`, with the explicitly selected Template
  source and application target. Preview by default; application-owned additive
  installation is not a Vireo project upgrade.

## Missing guidance

If a local router is missing, do not download random skills or assume a new release
exists. For a consumer, offer the bounded `adopt-skills` preview using the configured
framework/Template source, then stop before writes. An implementation request alone
does not approve adoption. For a missing maintainer harness, report the expected
file and request a reviewed checkout containing it. Read-only inventory can continue
without it; implementation waits for authoritative guidance.

Never patch the example into every consumer. Trace framework behavior → Template
composition → CLI projection/upgrade → application policy, name each required root,
and obtain expanded scope when the original task did not include it.
