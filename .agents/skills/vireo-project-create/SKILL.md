---
name: vireo-project-create
description: "Use for creating a new Vireo frontend or full-stack consumer with an exact supported published CLI; not existing-app upgrades, framework generator edits, or implicit local Template fixtures."
---

# Vireo project create

Complete the [shared entry](../vireo-framework/references/workflow.md#entry) first,
including when delegated by `$vireo-framework create`. Creation has a separate
target permission boundary; it does not authorize changing the framework checkout.

## Resolve and preview

1. Establish the exact intended new directory, `frontend` or `full-stack` profile,
   app identity, and requested capabilities. Read applicable target-parent
   instructions. Show the canonical target and profile to the user before creation;
   obtain confirmation where the original request did not already specify them.
   Refuse any existing target, even empty, and any symlink/redirection conflict.
   Never delete it, merge into it, or quietly choose a different directory.
2. Read [the CLI contract](../../../packages/create-vireo/README.md),
   [ecosystem compatibility](../../../contracts/ecosystem-release-contract.json),
   and [platform support](../../../contracts/platform-support-policy.json).
   Resolve **one exact supported published `create-vireo` version** for this task.
   Confirm public availability and record its immutable package identity/integrity
   and Template provenance. A local manifest version or floating `latest` lookup
   alone is not proof. If the user supplies a selector, resolve it once and retain
   that exact version through help, preview, create, and diagnosis. Stop if support,
   public availability, or provenance cannot be established.
3. Use the selected published executable's `--help` to confirm supported flags and
   profiles, including dry-run/JSON and disabling Git initialization if offered.
   If Git initialization cannot be disabled through a verified option or prompt,
   stop rather than allowing creation to initialize a repository implicitly.
   Inspect any additional subcommand help before use. Do not assume that local
   source docs or an old app's skills describe this released executable. If a
   required option is unavailable, stop and explain the limitation instead of
   inventing flags, changing versions mid-task, or using workspace binaries.
4. Present the exact-version invocation, target, profile, identity choices,
   supported preview output, and bootstrap/check scope. Use a non-writing preview
   only when confirmed by that executable's help. If preview is unsupported,
   state that and obtain explicit approval of the manual plan before creating.
   Require an approved target/profile before target writes; changed choices need
   a new preview. Recheck target absence immediately before creation.

## Bootstrap and verify

A creation request permits obtaining the selected published CLI in an isolated
execution cache. Once the target/profile is confirmed, it also permits ordinary
dependency bootstrap **only for that new app**, using its actual manifests,
lockfiles, declared package manager, and documented setup. Disclose cache/network
effects. A preview-only or no-install request does not permit either install.
Missing tools then become a blocker, not permission to install them system-wide.

1. Run only the previewed exact executable/flags. Keep Git initialization off;
   creating an app is not permission for Git initialization, commits, publication,
   deployment, global tool installation, or edits to framework/Template/home config.
2. Inspect the generated metadata, manifests, lockfiles, and scoped instructions.
   Confirm the requested profile and actual CLI/Template provenance. A frontend
   target must remain frontend-only; do not introduce or run JVM/Gradle/database
   setup. A full-stack target uses its declared backend/database configuration,
   not an assumed service or a cached dependency/version list.
3. Discover setup and focused profile checks from the generated app itself. Review
   script side effects before execution; bootstrap permission does not include
   unapproved external service provisioning, secrets, destructive database work,
   or heavy gates. Coordinate heavy verification sequentially. Do not launch an
   indefinite dev server unless requested.
4. Report target, profile, exact CLI, Template provenance, actual installed
   dependencies/checks, and unresolved identity or environment requirements.
   If generated application skills are present, hand off to those local skills;
   if absent, report their absence rather than copying current Template skills.

## Explicit local fixture exception

Only an explicit request for a local integration fixture can replace published
consumption. Obtain the exact authorized source and new fixture target, read the
[generator specialist](../vireo-generator-maintainer/SKILL.md) and source fixture
docs, and keep that lane clearly labeled
**local fixture, not published-consumer evidence**. If source is unavailable, ask
for the exact path. Never guess a sibling Template or use one to make an ordinary
published create succeed. Fixture permission does not authorize a dependency
upgrade, Template release, immutable pin edit, or changes to a real consumer.

Complete the [shared exit](../vireo-framework/references/workflow.md#exit). Do not
call creation validated without actual profile-appropriate evidence.
