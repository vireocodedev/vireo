# Compatibility, versioning, and migration policy

This policy defines the supported public contracts for Vireo Starter artifacts. It
applies to published npm packages and JVM modules; a repository checkout of `main`
is development state, not a released compatibility promise.

## Release families

The eight npm packages are independently versioned. Consumers may install only the
packages they need, subject to their declared dependencies and peer dependencies.
The six JVM artifacts share one coordinated version and should be aligned with the
`com.vireocode:vireo-bom` BOM.

The current released artifact mapping is machine-owned by
`contracts/documentation-release-policy.json` and validated against this table and
the package manifests:

| Artifact                       | Current version |
| ------------------------------ | --------------: |
| `create-vireo`                 |           0.8.7 |
| `@vireocodedev/history`        |           0.2.2 |
| `@vireocodedev/infrastructure` |           0.3.0 |
| `@vireocodedev/localization`   |           0.2.2 |
| `@vireocodedev/query`          |           0.2.2 |
| `@vireocodedev/shell`          |           0.2.2 |
| `@vireocodedev/sqlite`         |           0.2.3 |
| `@vireocodedev/ui`             |           0.3.2 |
| `com.vireocode:vireo-*`        |           0.4.0 |

`create-vireo` includes the frontend profile. The current supported project-upgrade
edge is 0.8.6→0.8.7; 0.8.4→0.8.6 remains retained historical evidence; 0.8.3→0.8.4 remains retained historical evidence; 0.8.2→0.8.3 remains retained historical evidence; 0.8.1→0.8.2 remains retained historical evidence; 0.8.0→0.8.1 remains retained historical evidence; 0.7.0→0.8.0 remains retained historical evidence; 0.6.0→0.7.0 and 0.2.0→0.3.0 remain retained historical evidence. Numeric
equality between npm packages or between npm and JVM versions is neither required
nor implied. A Template commit or tag, together with its committed lockfiles and
compatibility contract, records the exact frontend and backend combination proven
by that Template revision.

The immutable `starter-template@0.8.7` source baseline uses
`starterVersion=0.3.1`; `create-vireo@0.8.7` generates and upgrades
full-stack consumers with the coordinated `0.3.1` JVM release. Frontend consumers do
not contain Gradle configuration.

Only the latest published version of each npm package and latest published JVM
family receive fixes and security updates. Older immutable artifacts remain
installable where the registry retains them, but no backports are promised.

## SemVer contract

Vireo follows Semantic Versioning per npm package and for the coordinated JVM family,
including during `0.x`: breaking public changes require a major version increment.

| Change                                                                             | Required bump |
| ---------------------------------------------------------------------------------- | ------------- |
| Add a compatible export, component, prop, locale, configuration option, or JVM API | Minor         |
| Remove, rename, or incompatibly change a public contract                           | Major         |
| Widen a peer dependency range                                                      | Minor         |
| Raise a peer dependency floor                                                      | Major         |
| Behavior-preserving fix or internal refactor                                       | Patch         |

Package versions, changelogs, API snapshots, release smoke tests, and published
consumer verification are the release evidence. A version range expresses SemVer
eligibility, not proof for every possible dependency combination.

## What is compatible

Compatibility covers documented package entry points and exports, TypeScript types,
React component props and specified behavior, documented CSS variables and styling
hooks, localization keys, public JVM APIs, documented configuration names and
meanings, wire/schema formats, migration behavior, generated source explicitly
described as stable, and declared peer/runtime floors.

Files or imports outside declared package entry points, undocumented implementation
details, snapshots marked internal, examples, tests, Storybook internals, and
generated implementation classes not described as consumer contracts are not public
compatibility promises. APIs explicitly marked experimental may change in a minor
release; the experimental label and limitations must be visible at the use site.

Cross-stack changes must preserve or deliberately version their shared wire and
schema contract. A change that requires coordinated application data migration,
configuration replacement, regenerated code, or simultaneous frontend/backend
deployment is breaking unless the old and new forms can coexist through the stated
migration window.

## Deprecation and removal

Before an ordinary public contract is removed, it must be deprecated in a published
release with a migration note and remain available for at least one subsequent
published release. Removal then requires a major version. Urgent security, legal, or
registry-integrity changes may shorten that window; the release notes must explain
the exception and safest available migration.

Deprecation warnings must identify the replacement or explicitly state when there is
none. Deprecated contracts receive no new features and may receive only critical
fixes.

## Consumer upgrade procedure

1. Read every affected package changelog and the Template compatibility manifest.
2. Update declared ranges and lockfiles deliberately; do not discard the lockfile.
3. Apply documented configuration, schema, data, or code migrations.
4. Run the application's complete verification and production build.
5. For a cross-stack change, verify the intended frontend/backend deployment order
   and rollback path in an application-owned environment.

`vireo upgrade` is dry-run-first and supports only release pairs embedded in the
invoked CLI. It checks the source Template identity, managed dependencies and
lockfile declarations, Flyway version uniqueness, and generated/wire-contract drift.
It migrates only declared Vireo-managed surfaces. Template-derived applications
still own and selectively merge or port upstream source, configuration, deployment,
and data changes. Compatibility bugs should be reported through
[SUPPORT.md](../SUPPORT.md) with both versions and a minimal published-artifact
reproduction.
