---
name: vireo-framework
description: "Use for Vireo framework plan, feature/change, fix, review, docs, verify, readiness, release, create, and adopt-skills workflows; not ordinary Template or consumer implementation or implicit publication."
---

# Vireo framework workflow

One invocation carries the task from classification through the requested outcome.
Read the selected specialists as part of this invocation; the user need not invoke
each one. This repository defines `$vireo-framework`, not a second `$vireo`.

## Route and complete

1. Complete the [shared entry](references/workflow.md#entry) before choosing an
   action. Establish the framework root, requested mode, ownership, baseline, and
   permission envelope. If the root or an external source is unavailable, ask for
   its exact path; never infer a sibling checkout.
2. Select a row below. An explicit mode wins; otherwise infer implementation from
   a requested change, fix from a reported defect, or read-only review from a
   request for findings. Clarify only when the ambiguity changes scope or safety.
3. Load the mode reference and relevant specialists. Their content is a checklist
   inside the same workflow, not permission to change mode or expand scope.
4. Carry out all authorized steps, then complete the
   [shared exit](references/workflow.md#exit). Stop at a missing approval, evidence,
   or ownership boundary, reporting the exact next decision instead of guessing.

| Mode                 | Read and do                                                                                                                                                         | Default boundary                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `plan`               | [Planning](references/change-modes.md#plan), plus specialists for the proposed surfaces                                                                             | Read-only plan in the response; no files or checks                      |
| `feature` / `change` | [Implementation](references/change-modes.md#feature--change) and applicable specialists                                                                             | Scoped ordinary edits and focused checks                                |
| `fix`                | [Diagnosis and regression](references/change-modes.md#fix) and applicable specialists                                                                               | Reproduce, then one tested repair at a time                             |
| `review`             | [Review](references/assessment-modes.md#review), plus specialists as review criteria                                                                                | Read-only findings; no fixes, test runs, or report files                |
| `docs`               | [Documentation](references/change-modes.md#docs)                                                                                                                    | Requested docs only; factual claims need source evidence                |
| `verify`             | [Verification](references/assessment-modes.md#verify)                                                                                                               | Selected checks, not repairs or installations                           |
| `readiness`          | [Readiness](references/assessment-modes.md#readiness) and [$vireo-framework-readiness-auditor](../vireo-framework-readiness-auditor/SKILL.md)                       | Read-only assessment unless checks are requested                        |
| `release`            | Explicitly read the [release policy metadata](../vireo-release-operator/agents/openai.yaml) and [release operator instructions](../vireo-release-operator/SKILL.md) | `plan` unless the requested phase is explicit; never implicit execution |
| `create`             | Delegate this invocation to [$vireo-project-create](../vireo-project-create/SKILL.md)                                                                               | Published exact CLI; preview the authorized new target/profile          |
| `adopt-skills`       | [Skills-only adoption](references/adopt-skills.md)                                                                                                                  | Non-writing preview; explicit target/digest approval for apply          |

Release metadata disables implicit invocation. The router **reads** those
instructions for release planning; it does not implicitly invoke the release skill
or treat either direct invocation as execution authorization.

## Specialist selection

Load only the specialists required by the actual surface; combine them when a
vertical slice crosses framework boundaries.

| Surface                                                      | Specialist                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Public npm exports, peers, runtime contracts, declarations   | [$vireo-npm-package-author](../vireo-npm-package-author/SKILL.md)                                      |
| JVM modules, BOM, Spring auto-configuration                  | [$vireo-jvm-module-author](../vireo-jvm-module-author/SKILL.md)                                        |
| CLI behavior, generation, projection, declared upgrade edges | [$vireo-generator-maintainer](../vireo-generator-maintainer/SKILL.md)                                  |
| New or incomplete public UI component                        | [$starter-ui-component-author](../starter-ui-component-author/SKILL.md)                                |
| Public-readiness assessment                                  | [$vireo-framework-readiness-auditor](../vireo-framework-readiness-auditor/SKILL.md)                    |
| Release phases and recovery                                  | Read [$vireo-release-operator](../vireo-release-operator/SKILL.md) with its explicit-invocation policy |

For routing changes or workflow reviews, use the
[routing evaluation scenarios](references/routing-evals.md) as a manual rubric,
not a claim that an automated evaluation has run.
