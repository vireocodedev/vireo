# Release-impact contract

Every pull request that changes a publishable package, JVM module, or deployable
application must state what happens to that artifact. The declaration is data
owned by the repository, reviewed in the pull-request diff, and checked against
the exact base and head commits by CI.

The authoritative artifact-to-path mapping and allowed decisions live in
[`contracts/release-impact-policy.json`](../contracts/release-impact-policy.json).
It must remain aligned with the publishable inventory in
[`contracts/ecosystem-release-contract.json`](../contracts/ecosystem-release-contract.json).

## npm packages

Use a Changeset for a package release:

```md
---
"@vireocodedev/sqlite": patch
---

Prevent duplicate replay after an interrupted offline synchronization.
```

Select every affected package. The gate only counts a Changeset changed by the
current pull request. On a Changesets version pull request, deletion of that file
counts only when the same diff changes the selected package version and its
`CHANGELOG.md`.

If an affected package deliberately does not need a release, add a uniquely
named `.release-impact/*.json` record:

```json
{
  "schemaVersion": 1,
  "artifact": "npm:@vireocodedev/ui",
  "decision": "no-release",
  "justification": "Test-only coverage; packed runtime bytes and public behavior are unchanged."
}
```

The justification must be specific enough for a maintainer to review; the gate
rejects placeholders shorter than the policy minimum.

## JVM modules and applications

JVM release intent uses the same directory and declares a semantic bump:

```json
{
  "schemaVersion": 1,
  "artifact": "jvm:vireo-offline",
  "decision": "release",
  "bump": "patch",
  "summary": "Dispatch offline commands locally without credential-bearing self-HTTP."
}
```

The documentation application uses `"bump": "deploy"`. A JVM module or
application that needs no release uses `"decision": "no-release"` and a
`"justification"`, as in the npm example.

JVM release records integrate with the version tooling. `corepack npm run
version-packages` applies pending JVM intent after Changesets updates npm
packages. For a JVM-only release branch, run:

```sh
corepack npm run version:jvm-impact
```

The command applies the highest requested JVM bump to the shared version,
prepends the module summaries to `jvm/CHANGELOG.md`, and removes the consumed JVM
release records. Review those generated changes and run the ordinary ecosystem
and release gates before merging. Application decisions and no-release
exemptions remain as the reviewable audit trail.

The pull-request gate accepts a deleted JVM release record only when the same
diff applies the exact coordinated bump in `jvm/gradle.properties` and adds the
matching exact `## <version>` heading to `jvm/CHANGELOG.md`. This lets generated
version pull requests consume their intent without recreating or renaming it;
deleting an already-consumed record without an affected JVM artifact remains
ordinary metadata cleanup. Unchanged records outside the pull-request diff remain
ignored.

## Changesets version pull requests

`corepack npm run version-packages` synchronizes the current documentation release
after Changesets updates public package versions. It also regenerates the current
friendly `site/content/snapshots/<version>.json` archive and writes a deterministic
`application:documentation-site` deploy record at
`.release-impact/documentation-site-current-release.json`. Its summary includes the
exact current documentation coordinate and a digest of the full release object, so a
non-`create-vireo` package change updates the reviewed deployment decision without
creating duplicate records.

Review both generated artifacts in the version pull request. The synchronizer only
updates the current friendly snapshot; retained historical archives and `site/dist`
remain unchanged.

## Checking a branch

Compare the proposed head to the pull request base:

```sh
git fetch origin main
corepack npm run release-impact:check -- --base origin/main --head HEAD
```

CI performs the same semantic comparison in the `pull_request` workflow with
read-only repository permission. It checks out full history with credentials
disabled, installs no dependencies, uses the event's exact base and head SHAs,
and parses metadata as JSON or a deliberately small Changesets frontmatter
subset. It never executes release metadata or uses `pull_request_target`.

Changing an unrelated decision file does not satisfy an affected artifact, an
unknown artifact is rejected, and duplicate or conflicting `.release-impact`
decisions for the same artifact are rejected. Multiple Changesets for one npm
package are combined using the highest bump, matching Changesets' versioning
behavior. Changes to shared JVM build logic affect every JVM artifact; changes
to the shared TypeScript configuration affect every npm artifact. These
conservative mappings make release omission visible during review rather than
after publication.
