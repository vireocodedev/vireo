# Working with Codex in Vireo repositories

The portable personal `$vireo` router is versioned under
[docs/codex/skills/vireo](codex/skills/vireo/SKILL.md). Install that directory as a
user skill without replacing an existing customized copy. Its optional personal
workspace map locates repositories; it grants no write permissions. See the
[invocation guide](codex/skills/vireo/references/usage.md). Repository-local routers
remain usable without this personal installation.

Skills-only adoption into an explicitly selected older consumer uses the
[preview/apply helper](../scripts/codex-consumer-skills.mjs). Preview is non-writing;
apply requires the reviewed digest and acknowledgement of application ownership.
It copies only missing app skill files, never application source, root guidance,
dependencies, or Vireo ownership/provenance metadata. Existing skill conflicts
require a separate migration decision, not overwriting. Exclude concurrent writers
during apply; the helper is not a replacement for filesystem sandboxing.

Run `corepack npm run codex:check` and `corepack npm run codex:test` for the local
structural/file-safety contract. Set `VIREO_CODEX_TEMPLATE_DIR` to an explicitly
selected Template checkout when running the create-vireo tests to exercise the
real skill bundle through both projection profiles; without it that optional
cross-repository test is reported skipped. The ordinary synthetic profile tests
always run. These tests do not certify model routing or human approval behavior.

Start Codex in the repository you intend to change. Its
[root instructions](../AGENTS.md) and local skills establish ownership; scoped
instructions apply before editing a specialized subtree. A shared-workspace
session must name each repository in scope. Framework, Template, and consumer
repositories retain separate diffs, checks, and release decisions.

## One invocation, the whole requested workflow

Use [$vireo-framework](../.agents/skills/vireo-framework/SKILL.md) for framework
work. It loads the relevant specialists, carries the task through its authorized
steps, and returns evidence and gaps. There is no need to invoke six specialists
in sequence. The optional personal `$vireo`universal router is installed
separately by the parent/personal setup; this repository does not define or install
another skill with that name, and`$vireo-framework` works without it.

Examples to paste into Codex:

```text
$vireo-framework plan a compatible public export; return the plan only
$vireo-framework feature add this behavior with focused regression coverage
$vireo-framework fix this failure; preserve my existing working-tree changes
$vireo-framework review the current diff against the requested behavior
$vireo-framework docs update the public API guide from the current source
$vireo-framework verify only the affected package's focused checks
$vireo-framework readiness assess existing public-consumer evidence and gaps
$vireo-framework release plan the affected artifacts; do not execute
$vireo-framework create a frontend app at <new-target>; preview first
$vireo-framework adopt-skills from <authorized-template-root> into <app-root>; preview only
```

| Mode                        | What happens by default                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `plan`                      | Read-only proposal in the response; no files or test/build runs                                 |
| `feature` / `change`, `fix` | Scoped ordinary edits and focused checks, using vertical test/implementation slices             |
| `review`                    | Read-only findings against requirements and repo standards; no fixes or checks unless requested |
| `docs`                      | Requested documentation edits backed by current source, not new runtime behavior                |
| `verify`                    | Discovered, scoped checks; no automatic repair, install, or snapshot rewrite                    |
| `readiness`                 | Existing-evidence assessment; missing operational/human proof stays unproven                    |
| `release`                   | Plan unless an explicit phase is requested; exact approval is required for execution            |
| `create`                    | Exact supported published CLI, target/profile preview, bounded new-app bootstrap                |
| `adopt-skills`              | Non-writing local skills-only preview; separate target/hash approval for apply                  |

“Plan and implement” permits continuation; “plan first for approval” stops at the
plan. A stricter request such as “no commands/tests/builds/installs” is preserved.
Neither trust nor a skill invocation grants Git initialization, commits, tags,
publication, deployment, or credential changes. Implementation does not need
repeated approval for each ordinary scoped edit or focused check.

The [shared workflow](../.agents/skills/vireo-framework/references/workflow.md)
requires framework identity markers, a preserved dirty-state baseline, explicit
ownership, and actual command logs/results. Commands come from current package
scripts and scoped docs. Heavy repository-wide, Storybook/browser, Gradle, and
consumer gates require coordinated sequential scheduling across repositories.
Subagents are optional and use read-only or disjoint scope with the same approvals;
an AI self-review is not independent approval.

## Specialists remain available

Direct specialist use follows the same entry/exit and permission envelope:

- [$vireo-npm-package-author](../.agents/skills/vireo-npm-package-author/SKILL.md): public exports, declarations, peers, portability, release impact.
- [$vireo-jvm-module-author](../.agents/skills/vireo-jvm-module-author/SKILL.md): JVM APIs, BOM, Spring behavior, consumer evidence.
- [$vireo-generator-maintainer](../.agents/skills/vireo-generator-maintainer/SKILL.md): generation, projection, ownership, supported upgrade edges.
- [$starter-ui-component-author](../.agents/skills/starter-ui-component-author/SKILL.md): complete public components, accessibility/loading, executable stories.
- [$vireo-framework-readiness-auditor](../.agents/skills/vireo-framework-readiness-auditor/SKILL.md): public readiness and missing human/provider evidence.
- [$vireo-release-operator](../.agents/skills/vireo-release-operator/SKILL.md): guarded release phases and recovery.

## Release is a phased decision

The release specialist separates `plan`, `prepare`, `reconcile`, and `execute`.
Planning and reconciliation are read-only; preparation permits only requested local
intent/docs work and scoped checks, not versioning or publication by implication.
Execution requires a named operation, exact source/coordinates, candidate evidence,
and protected workflow approval. Changed artifacts invalidate earlier approval.
Retries begin by reconciling retained bytes, receipts, and public state.

Its metadata disables implicit invocation. The router explicitly reads the release
instructions for planning; invoking either skill is not publishing authorization.
The operator must reconcile current [contracts](ECOSYSTEM_CONTRACT.md),
[lifecycle](RELEASE_LIFECYCLE.md), [npm](NPM_RELEASE.md),
[Maven](MAVEN_CENTRAL_RELEASE.md), and [Template adoption](TEMPLATE_RELEASE_ADOPTION.md)
with the actual protected workflows. Conflicting publication order or dispatch
instructions are blockers, not reasons to follow a cached recipe.

## New apps: published source first

[$vireo-project-create](../.agents/skills/vireo-project-create/SKILL.md) is the
focused create route. It resolves one supported published exact CLI, verifies its
help flags, previews the new target/profile, refuses existing directories, and
uses the generated app's actual dependency manifests and scripts for bootstrap and
checks. Frontend checks remain frontend-only. It does not silently substitute a
local Template or workspace CLI when a released capability is missing.

Creation permits only its disclosed isolated CLI bootstrap and, after target/profile
confirmation, dependency setup for that new app. No-install/preview-only constraints
override this exception. Local integration fixtures require an explicit fixture
request with exact source and target; they are not published-consumer proof.

## Older apps: optional skills-only adoption

Older apps may lack metadata or current skills. Inspect their actual manifests,
installed CLI, and ownership records; skill text is not evidence that the app has a
current CLI capability. Application root instructions and product code remain
application-owned, while managed files retain their declared ownership.

The [adopt-skills reference](../.agents/skills/vireo-framework/references/adopt-skills.md)
describes the planned parent-owned local helper interface:

```bash
node scripts/codex-consumer-skills.mjs --source <template-root> --target <app-root>
```

Run it from the confirmed framework root only after checking that the helper exists
and implements the documented contract. The Template source must be explicitly
authorized; if unavailable, ask for its exact path instead of guessing a sibling.
An absent/incompatible helper is a stop, not permission to copy files manually.

Preview must expose the exact target, file hashes, and `planDigest`. Only explicit
user approval of that target/hash plan permits applying the same preview:

```bash
node scripts/codex-consumer-skills.mjs --source <template-root> --target <app-root> --apply --accept-application-owned --expect-digest <planDigest>
```

The helper must copy missing `.agents/skills/vireo-app*` content only and refuse
collisions, managed overwrites, symlinks, and stale digests. It must never copy or
modify `AGENTS.md`, application source, dependencies, or `.vireo` metadata. Adopted
skills are application-owned; this does not manufacture a managed upgrade edge.
The parent owns the script and its deterministic tests, not these instructions.

### Source availability is not public availability

New application skills in local Template source are **not public merely because
they exist in a checkout**. Normal public delivery requires the reviewed immutable
Template release, normal CLI pin adoption/release, and a future declared supported
upgrade edge where existing-app delivery is intended. Do not edit the current
immutable pin, retrofit a released baseline, or invent an upgrade command/edge to
claim delivery. An explicitly authorized local skills-only adoption is a separate
application-owned choice, not a release or general migration.

## Workflow evaluation and limits

The [routing evaluation table](../.agents/skills/vireo-framework/references/routing-evals.md)
covers route selection, read-only defaults, dirty work, exact release approvals,
creation profiles, absent sources/helpers, collisions, and stale approval digests.
It is a manual rubric, not a record of passing automated evaluations. Deterministic
customization validation and adoption enforcement remain parent-owned. Report any
unrun checks or missing enforcement plainly; prose safeguards alone are not a
security boundary.

## Trust and external connections

Trust a repository only after you have reviewed its source and intended commands.
Trust allows its project configuration and instructions to influence your session; it
does not authorize publishing, deployment, credential changes, or destructive work.

Plugins and connected services are optional. Connect only services your organization
uses, review their requested permissions, and keep human approval for external
mutations. Repository skills should describe repeatable engineering work; live
provider data and organization permissions belong in explicitly connected tools.
