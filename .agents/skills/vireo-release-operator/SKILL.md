---
name: vireo-release-operator
description: "Use for Vireo release plan, prepare, reconcile, and explicitly authorized execute phases; not implicit publishing, tagging, deployment, or approval reuse for changed artifacts."
---

# Vireo Release Operator

Complete the [shared entry](../vireo-framework/references/workflow.md#entry),
including on direct invocation. Read [the invocation policy](agents/openai.yaml):
implicit invocation is disabled. The framework router may explicitly read this
document for planning; neither router selection nor `$vireo-release-operator`
itself is authorization to perform release mutations.

## Establish the authoritative transaction

Read these sources for the candidate being considered, not a cached release order:

- [Ecosystem identity/compatibility](../../../contracts/ecosystem-release-contract.json),
  [publication policy](../../../contracts/ecosystem-publication-policy.json),
  [lifecycle policy](../../../contracts/release-lifecycle-policy.json), and
  [release-impact policy](../../../contracts/release-impact-policy.json).
- [Release impact](../../../docs/RELEASE_IMPACT.md),
  [release lifecycle](../../../docs/RELEASE_LIFECYCLE.md),
  [npm publication](../../../docs/NPM_RELEASE.md), and
  [Maven Central publication/recovery](../../../docs/MAVEN_CENTRAL_RELEASE.md).
- For CLI/Template work, [Template adoption](../../../docs/TEMPLATE_RELEASE_ADOPTION.md),
  [adoption policy](../../../contracts/template-adoption-policy.json), and
  [declared project-upgrade policy](../../../contracts/project-upgrade-policy.json).
- The applicable checked-in protected workflows and their planner implementations,
  starting with [ecosystem publication](../../../.github/workflows/release-npm.yml)
  and, when relevant, [Template adoption](../../../.github/workflows/adopt-template-release.yml)
  or [exceptional Maven recovery](../../../.github/workflows/recover-maven-central-deployment.yml).

Identify affected npm packages, JVM modules/BOM, CLI, immutable Template provenance,
changesets/impact records, documentation release, and admitted upgrade edges. Build
the dependency/order plan from current contracts **and** enforced workflow behavior.
If prose, contracts, and automation disagree, cite the exact disagreement and
reconcile its ownership/authority with the maintainer before an executable plan.
Do not silently choose a convenient order, copy an old dispatch recipe, weaken a
gate, or edit policy as an incidental release fix. Unresolved conflict blocks execute.

## Phases

| Phase            | Allowed outcome                                                                                                                   | Stop boundary                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `plan` (default) | Read-only inventory, dependency/order proposal, missing evidence and approval checklist in the response                           | No edits, tests/builds, generated evidence, versioning, or remote mutation            |
| `prepare`        | Explicitly requested scoped local release-intent/changelog/docs edits and permitted focused checks                                | No automatic version commands, commit/merge/tag, publish, credentials, or broad gates |
| `reconcile`      | Read-only comparison of exact candidate, retained receipts, workflow runs, tags and registry/Central state using permitted access | No recovery mutation, workflow rerun, promotion, tag repair, or replacement upload    |
| `execute`        | Only a separately approved named operation for the exact transaction below, through the protected path                            | Missing/mismatched approval, evidence, or provider state fails closed                 |

Do not advance automatically from one phase to the next. “Prepare a release” is
not “execute”; “retry” starts reconciliation, not a repeated publish. If versioning,
packing, signing, evidence generation, or network verification is needed, disclose
the exact command, outputs, credential/resource effects, and obtain its appropriate
scope before running it. Broad verification remains coordinated and sequential.

## Exact authorization before execute

Present and obtain explicit user approval for the named operation and target:

1. Phase/action, repository, exact PR/head or release source SHA, target workflow,
   environment, channel, and all affected package/module/version coordinates.
2. Immutable Template identity where applicable, candidate/retained artifact
   digests and evidence subjects, and exact run/attempt/deployment identity for
   recovery. Where the protected workflow builds the initial candidate, bind the
   authorization to its exact reviewed source and planner-qualified coordinates;
   only that workflow may derive and retain the candidate digests. A later retry
   must match those retained bytes and receipts, never a local rebuild.
3. Observed registry/Central/tag state, required successful gates, permitted
   mutations, and the documented recovery/stop conditions. Unknown state is not
   absence and is not permission to publish.

The user approval is necessary but does not bypass repository controls. Preserve
the exact generated release-PR/adoption proof, protected branch/workflow/environment,
immutable candidate, trusted publisher, provenance, and anonymous-consumer gates
required by the current policies. A workflow merge may trigger publication; never
treat it as an ordinary Git edit or merge it on the strength of a prepare request.
Do not assume recurring environment reviewers or manual dispatch paths exist;
inspect the current workflows.

No automatic Git commit/push/tag, npm publish/dist-tag/deprecation, Maven
upload/promotion, GitHub Release, deployment, or provider/credential mutation.
Run only the specifically approved operation via the documented protected path;
never bypass it with a local equivalent. A source, target, coordinate, channel,
workflow, candidate digest, or recovery identity change invalidates approval.
Return to plan/reconcile and obtain new approval; “already approved” does not apply
to changed bytes. Credentials stay in the approved provider flow, never in chat.

## Reconciliation and exit

Preserve actual evidence from partial/failed runs. Distinguish absent, public,
in-progress, and ambiguous state for each coordinate; inspect receipts before any
retry. An accepted artifact is immutable: never rebuild/re-upload it, move a tag,
or republish a version. A defective public artifact needs a new reviewed release
decision. Use only the documented, exactly bound recovery path for missing
finalization or an interrupted deployment; trust/identity failures stop the task.

Complete the [shared exit](../vireo-framework/references/workflow.md#exit) with the
phase, authorization boundary, exact transaction, actual evidence/results, and
next approval or unresolved conflict. Keep planned, attempted, published, and
anonymously verified states distinct. No successful release claim from local
compilation, stale receipts, or a workflow merely being queued.
