---
name: vireo-framework-readiness-auditor
description: "Use for public Vireo readiness audits; not narrow feature work without an audit request."
---

# Vireo Framework Readiness Auditor

Complete the [shared entry](../vireo-framework/references/workflow.md#entry),
including on direct invocation. An audit is read-only by default: inspect existing
evidence and return findings, without tests, builds, generated reports, or repairs.

Use this skill for a public-beta, release, or framework-readiness audit. Do not apply it to a narrow feature request unless that feature asks for a readiness review.

- Read [ecosystem contract](../../../docs/ECOSYSTEM_CONTRACT.md), [public API](../../../docs/PUBLIC_API.md), [release lifecycle](../../../docs/RELEASE_LIFECYCLE.md), and the current [public-beta criteria](../../../docs/roadmap/phase-5/public-beta-criteria.md).
- Separate repository-fixable findings from human decisions, credentials, legal approval, provider configuration, and operating evidence. Do not claim a human gate is complete without evidence.
- Check the framework through a real consumer perspective: installable artifacts, generated app behavior, upgrade path, and documentation—not source compilation alone.
- Record evidence with its source and date. Prefer existing deterministic policies over adding duplicate audit scripts.

Only run focused checks when verification is requested, after inspecting current
scripts and their effects. Broad public/consumer gates require explicit sequential
coordination, even during a full audit. Repository-fixable findings are proposed
work, not automatic permission to edit policies or manufacture missing evidence.

Complete the [shared exit](../vireo-framework/references/workflow.md#exit), separating
observed evidence, missing proof, human gates, and the precise readiness claim that
the available evidence supports.
