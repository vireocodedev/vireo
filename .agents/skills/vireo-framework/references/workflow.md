# Shared framework workflow

Every specialist uses this entry and exit, including direct invocations. Reuse an
already established baseline within one invocation; refresh it when scope, source,
or candidate bytes change. A specialist never widens the selected mode's authority.

## Entry

1. **Locate.** Confirm the intended framework checkout using all of
   [root instructions](../../../../AGENTS.md),
   [the package manifest](../../../../package.json),
   [packages/create-vireo](../../../../packages/create-vireo/README.md), and the
   [ecosystem contract](../../../../contracts/ecosystem-release-contract.json).
   Directory names alone are not identity. Match the product/repository markers,
   CLI inventory, and declared compatibility set. Read applicable workspace and
   scoped instructions before touching their subtree. Stop on missing or
   contradictory markers; ask for the exact framework path.
2. **Bound.** State the requested outcome, mode, allowed roots/files, acceptance
   criteria, and exclusions. Framework APIs belong here; projected application
   architecture belongs to the Template; product code, data, deployment, and
   application-owned files belong to the consumer. Cross-repository work needs
   separately authorized roots and independent diffs, checks, and handoffs. Never
   copy a framework fix into a consumer as a shortcut. `create` and `adopt-skills`
   have their own explicit target boundaries.
3. **Baseline.** Inspect the existing working tree, staged/unstaged and untracked
   work, branch/HEAD, and relevant source before editing. Use read-only Git
   inspection only when permitted. Preserve existing work, index state, and
   unrelated files; do not stash, reset, clean, switch branches, or auto-format
   broadly. If edits overlap someone else's work, establish which hunks belong to
   this task and clarify conflicts. If inspection is forbidden or unavailable,
   mark that baseline unknown rather than inventing a clean state.
4. **Separate source from release.** Read current manifests and contracts for the
   local candidate. Distinguish these from installed dependencies, the exact
   published CLI/Template pin, and an old consumer's actual metadata. Local source
   and old app skills do not prove released capabilities. Use published artifacts
   in ordinary consumption; local packages/Template integration require an
   explicitly authorized fixture. No guessed sibling or personal source path.
5. **Discover.** Read [package scripts](../../../../package.json), the touched
   package/module manifest, and its scoped instructions/documentation to choose
   commands and tools. Inspect script bodies before executing: `check`, `plan`,
   `dry-run`, and `verify` names do not guarantee non-writing behavior. Confirm
   toolchain requirements from current files; do not cache dependency versions in
   skills or repair a missing toolchain with an unrequested install.

Entry is complete when mode, ownership, source baseline, candidate versus released
identity, and authorized actions are explicit. Carry forward unknowns as blockers.

## Permission envelope

| Request                            | Authorized by default                                             | Requires additional authorization                                                 |
| ---------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Plan, review, readiness assessment | Read existing source and evidence; answer in chat                 | Files, tests/builds, generated evidence, snapshots, installations                 |
| Feature/change or fix              | Ordinary edits within the named scope and focused relevant checks | Other repositories, broad resource-heavy gates, installations, release operations |
| Docs                               | Requested prose edits and focused non-generating checks           | Runtime changes, portal/Storybook generation, widened checks                      |
| Verify                             | Requested checks and disclosed ordinary disposable check outputs  | Fixes, snapshot/contract rewrites, installation, broad gates not coordinated      |
| Release                            | The explicitly requested phase's limits                           | Every named release mutation under the release operator policy                    |
| Create or adopt-skills             | Only the specialized route's staged permissions                   | Any other target or wider migration                                               |

A narrower user constraint wins, including “no commands/tests/tools.” In that
case inspect only what is permitted and report unverified checks. A normal
implementation request is sufficient for scoped edits and focused checks; do not
ask for approval on every slice. No task or skill invocation implies dependency
installation, Git initialization, commit, push, tag, publication, deployment,
credential access/change, or a versioning operation. Creation's bounded bootstrap
exception is defined only by the create skill. A changeset/release-impact record
describes intent; it does not authorize executing a release.

## Execution and resources

- Use **vertical TDD slices** for changed behavior: one failing observable contract,
  the minimum implementation, then refactor while green. Avoid a batch of unrun
  tests followed by an unrelated implementation sweep. If execution is blocked,
  label tests unrun and never call the slice red or green without logs.
- Start with the smallest relevant check. Coordinate repository-wide, Storybook,
  browser, Gradle-wide, full-consumer, and ecosystem gates with the owner/parent
  before running them. Respect workstation-wide scheduling and the
  [verification budget policy](../../../../contracts/verification-budget-policy.json).
  Run heavy verification sequentially across repositories and agents; do not
  infer permission to start it from a specialist's completion checklist.
- Subagents are optional: read-only research or explicitly disjoint file ownership
  only, with the same mode, approvals, and resource limits. The coordinator owns
  integration and evidence. A second pass by the same AI, including subagents,
  is an AI self-review, not independent human or independent external review.

## Exit

Return a concise result that accounts for every requested acceptance criterion:

- Mode, root/scope, baseline limitations, and files changed (or “read-only”).
- Behavior or findings, compatibility/ownership impact, and any release intent.
- Actual evidence: exact command, working directory, source revision or dirty
  candidate, result/exit status, and real log location or observed output. Label
  prior evidence with its source/date and distinguish it from this run. Never
  fabricate logs, passing tests, fixture proof, or release status.
- Remaining checks and why they were not run; separate tool/environment failures
  from demonstrated code regressions. A source build is not consumer proof.
- Self-review of the scoped diff, remaining risks, and the next explicit approval
  or owner handoff. No unrequested report/evidence files or automatic commit.

Completion means the requested outcome is supported by the evidence, or a precise
stop report identifies what prevents it. Deferred gates remain deferred, not passed.
