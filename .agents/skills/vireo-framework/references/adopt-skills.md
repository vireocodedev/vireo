# Skills-only adoption into an older app

This is a local, application-owned adoption route, not `vireo upgrade`, Template
release adoption, or proof of a capability in any published CLI. Use the
[shared entry and exit](workflow.md), with source and target authorized separately.

## Preview

1. Obtain the user's exact Template source root and application target root. Read
   their applicable instructions and confirm that the Template source is explicitly
   authorized. If either root is missing/unavailable, ask for its exact path; never
   substitute a sibling checkout, download, local framework package, or current
   Template source on the strength of old application skills.
2. Inspect actual app manifests and any ownership metadata. Missing skills are not
   evidence of an upgrade edge, nor does the presence of an older skill authorize
   commands from the current CLI. Keep application code and dependencies unchanged.
3. Read [the helper](../../../../scripts/codex-consumer-skills.mjs) and its help
   contract before use. The non-writing preview interface is:

   ```bash
   node scripts/codex-consumer-skills.mjs --source <template-root> --target <app-root>
   ```

   If absent, incompatible, or unable to provide the required safety proof, stop
   and report the missing helper. Do not implement a substitute or manually copy.

4. The non-writing preview must expose the canonical source/target, complete file
   list and hashes, collision/ownership decisions, and `planDigest`. Present these
   for explicit user approval; no application mutation has been authorized yet.

## Apply boundary

Only after the user explicitly authorizes that exact target and the preview's file
hashes/digest, use the same source/target and the helper's guarded apply interface:

```bash
node scripts/codex-consumer-skills.mjs --source <template-root> --target <app-root> --apply --accept-application-owned --expect-digest <planDigest>
```

The helper is required to copy **missing `.agents/skills/vireo-app*` content only**
from the authorized Template's `.vireo/application/.agents/skills/vireo-app*`
source, not its maintainer skills. It must refuse collisions, managed overwrites,
and symlinks, including source/target path redirection. It never copies
root/scoped `AGENTS.md`, application source, dependencies, or `.vireo` metadata;
it must not relabel copied skills as Vireo-managed. A dirty app retains all existing
work. Changed source/target state or digest invalidates approval: preview again.

The helper and tests enforce file safeguards, not human authorization or protection
against hostile concurrent filesystem changes. Exclude concurrent writers during
apply. Do not weaken checks,
force overwrites, add a second script, or bypass a refusal with manual copying.
If an existing skill or managed path blocks adoption, return that conflict for a
separate migration decision. After apply, inspect the exact result and report the
copied paths, digest, and untouched ownership boundary. Do not run setup/install,
upgrade the app, commit, or claim that a future CLI upgrade edge now exists.
