# Vireo Starter

This repository publishes the Vireo TypeScript packages, JVM modules, and `create-vireo`. Treat published APIs, generated-project contracts, package coordinates, and documentation releases as public contracts.

## Routing

- Start a framework task with [$vireo-framework](.agents/skills/vireo-framework/SKILL.md): one invocation routes plan, change/fix, review, docs, verify, readiness, release, create, or skills-only adoption through shared safeguards and the existing specialists. Human examples and permission boundaries: [Codex workflow](docs/CODEX.md).
- Read scoped instructions for the touched surface: [UI](packages/ui/AGENTS.md), [creation/generation/projection/upgrades](packages/create-vireo/AGENTS.md), [JVM](jvm/AGENTS.md), or [policy/release scripts](scripts/AGENTS.md).
- Plan/review is read-only by default. Implementation permits scoped ordinary edits and focused checks; installations, broader ownership, and release mutations are separate decisions. Preserve dirty work and coordinate heavy verification sequentially.

## Durable invariants

- Preserve the public package/API surface unless the requested change includes its migration, compatibility strategy, and release intent.
- Keep the checked-in application projection contract and `packages/create-vireo/schema` mirror byte-identical. Classify every new Template path before it can be projected.
- Keep normal development against published artifacts. Local Template integration is explicit and must not silently alter default resolution.
- Use focused checks while editing; reserve repository-wide, Storybook, browser, and Gradle gates for coordinated final verification.
- Do not publish, deploy, alter external release settings, or resolve application-owned upgrade work without explicit user authorization.

Authoritative architecture and release routing live in [architecture](docs/ARCHITECTURE.md), [ecosystem contract](docs/ECOSYSTEM_CONTRACT.md), and [release lifecycle](docs/RELEASE_LIFECYCLE.md). Resolve source conflicts before release execution; a skill invocation is not release approval.
