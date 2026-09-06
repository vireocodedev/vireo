# Plan and change modes

Use the [shared entry and exit](workflow.md) in every mode. Read the relevant
specialists for their acceptance criteria, without adopting broader permissions.

## Plan

Read the request, current implementation, scoped instructions, and authoritative
contracts. Return in the response:

1. Desired observable behavior and acceptance criteria.
2. Owning modules, public surfaces, compatibility/ownership implications.
3. Small vertical slices, each with its test/reproduction and expected outcome.
4. Discovered focused commands and separately coordinated final gates.
5. Risks, missing information, and any separate Template/consumer/release handoff.

Stop when each requirement has a proposed slice and validation path. Planning is
read-only: no test execution, generated files, saved plan, dependency installs, or
implementation. If the user explicitly requests a plan file, only that artifact
becomes writable. “Plan and implement” allows continuation within the shared
implementation envelope; “plan first for approval” stops after the plan.

## Feature / change

1. Trace the requested public behavior to its owning module and affected consumers.
   Use source and existing tests, not just symbol names, to bound the change.
2. Choose one observable slice. Add/update a focused contract test and observe it
   fail for the intended reason before implementing the behavior.
3. Make the smallest compatible implementation; run that check and refactor once
   green. Repeat for the next slice, including relevant failure cases.
4. Update examples, declarations, snapshots, and release-impact intent only where
   required by the changed public contract and permitted scope. Inspect generated
   diffs; a snapshot refresh must not hide an unexplained breaking change.
5. Self-review the scoped changes and run permitted focused checks. Hand off any
   broad gates and separate repository work with their exact reason.

If tests cannot run or the change has no executable behavior (for example prose),
record that limit and use the applicable inspection/check instead. Do not invent
red-green evidence. Completion accounts for every acceptance criterion, useful
specialist requirements, compatibility, and remaining verification gaps.

## Fix

1. Establish the symptom, expected behavior, actual affected version/profile, and
   smallest reproducer. Distinguish local source behavior from published behavior.
2. Inspect logs and the relevant code path; form a specific hypothesis and use the
   smallest permitted experiment to confirm or reject it. Diagnose before patching.
3. Turn the confirmed failure into a focused regression test, then use the
   feature/change vertical slice above. A test failing for missing tools is not
   proof of the reported bug.
4. Verify the reproducer and nearby owned failure cases. Explain the causal fix,
   release impact, and pre-existing/environment failures separately.

A request to diagnose only remains read-only unless experiments are explicitly
requested. If reproduction requires secrets, production mutations, installation,
or another repository, stop at that boundary with the minimum needed next step.

## Docs

Identify the audience and source of truth. Read the live API, manifests, contracts,
or corresponding code before documenting claims or commands. For skills and agent
instructions, follow the available writing-for-agents guidance. Keep entry points
short and disclose branch-specific material through relative links that resolve.

Update only the requested docs; do not change implementation to make prose true.
Clearly distinguish shipped capabilities, local work, and planned release paths.
Inspect links/examples and run only permitted focused non-generating checks.
Portal/Storybook builds, snapshots, and generated release evidence are separate
outputs requiring their own scope and resource coordination.
