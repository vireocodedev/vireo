# Review, verify, and readiness modes

Use the [shared entry and exit](workflow.md); assessment does not authorize repair.

## Review

Establish the requested base/head, working diff, or file scope. If a reference is
unavailable, ask for it instead of fetching or choosing an unrelated baseline.
Read the originating requirements and applicable specialist criteria, then review
both standards and intended behavior, including compatibility and failure paths.

Report actionable findings with severity, location, evidence, user impact, and a
suggested correction. Separate proven defects from questions and untested risks.
If no findings are established, say so with the inspected scope and evidence limits.
Label an AI second pass accurately; it is not independent approval.

Default review is read-only: no fixes, test/build execution, generated reports,
snapshots, or evidence files. “Review and run the focused tests” permits only those
tests; “review and fix” also permits the explicitly scoped implementation loop.

## Verify

1. Map the requested claim to the smallest checks discovered from current package
   scripts and scoped docs. Inspect wrappers and output paths; some nominal checks
   build packages, write reports, contact registries, or launch broad gates.
2. State the selected scope and ordinary disposable outputs. Run only requested or
   mode-authorized checks with installed tools; coordinate heavy gates separately
   and sequentially. Stop for unapproved installations or tracked-file rewrites.
3. Report actual commands, logs/results, and the tested candidate. Separate local,
   packed-fixture, and anonymous published-consumer evidence. Do not claim a
   released artifact was tested when only workspace source was exercised.
4. Classify failures and stop with the necessary follow-up. Verification does not
   silently become repair, dependency update, contract refresh, or publication.

Completion lists each requested check as passed, failed, blocked, or not run, with
supporting observations. Existing or cached evidence is not a new successful run.

## Readiness

Read the [readiness specialist](../../vireo-framework-readiness-auditor/SKILL.md).
Start with a read-only evidence inventory: public APIs, packed/published consumption,
generation and profiles, supported upgrade edges, documentation, and policy gates.
Date the evidence and compare its subject to the candidate under review.

Return repository-fixable gaps separately from human/provider/legal/operational
gates. Missing evidence means unproven, not ready. Propose focused checks or repairs;
execute them only when requested under their own mode. A “full audit” requests an
assessment breadth, not automatic permission for all resource-heavy commands.
