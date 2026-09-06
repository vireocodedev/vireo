---
name: starter-ui-component-author
description: "Use for first-class public Vireo React components in @vireocodedev/ui; not application-specific compositions, internal helpers, or ordinary UI edits."
---

# Starter UI Component Author

Complete the [shared entry](../vireo-framework/references/workflow.md#entry),
including on direct invocation. The selected mode controls this checklist:
plan/review is read-only; implementation permits scoped generation/edits and
focused checks, not an automatic full verification sweep.

Build a finished, publishable Vireo component—not merely a compiling scaffold. Work from the Starter repository root and preserve the user's requested behavior, compatibility, and scope.

## Canonical sources

The repository documentation is authoritative. Read the guide for every file or contract the task touches; read all of them for a new or full component migration:

- New scaffolds and CLI constraints: [generator.md](../../../packages/ui/docs/component-authoring/generator.md)
- Owner boundaries and source layout: [source-structure.md](../../../packages/ui/docs/architecture/source-structure.md)
- Approved component categories: [component-folder-categories.md](../../../packages/ui/docs/architecture/component-folder-categories.md)
- Form anatomy and layout: [form-layout.md](../../../packages/ui/docs/component-authoring/form-layout.md)
- Cross-component loading standard: [LOADING_STATE_STANDARD.md](../../../docs/LOADING_STATE_STANDARD.md)
- Declared loading categories and geometry: [loading-state-contracts.json](../../../packages/ui/loading-state-contracts.json)
- Runtime implementation and prop precedence: [component-files.md](../../../packages/ui/docs/component-authoring/component-files.md)
- Public types, slots, owner state, and MUI augmentation: [types-files.md](../../../packages/ui/docs/component-authoring/types-files.md)
- Canonical name and ordered slot tuple: [identity-files.md](../../../packages/ui/docs/component-authoring/identity-files.md)
- Utility-class contract: [classes-files.md](../../../packages/ui/docs/component-authoring/classes-files.md)
- Styled slots and root semantics: [styled-files.md](../../../packages/ui/docs/component-authoring/styled-files.md)
- Capability-driven unit coverage: [test-files.md](../../../packages/ui/docs/component-authoring/test-files.md)
- Storybook documentation and interactions: [stories-files.md](../../../packages/ui/docs/component-authoring/stories-files.md)
- Minimum sufficient story selection and audits: [story-coverage-rulebook.md](../../../packages/ui/docs/component-authoring/story-coverage-rulebook.md)
- Component and package public barrels: [index-files.md](../../../packages/ui/docs/component-authoring/index-files.md)

Use the cited reference components from those guides when a concrete pattern is needed. Do not copy an older `Rgo*` implementation when it conflicts with the current Vireo contracts.

## New components

Use the repository generator for a new first-class component. Do not hand-create the eight-file structure while the `react-component` template is available.

1. Choose an unprefixed PascalCase input such as `StatusBadge`; the generator adds `Vireo`.
2. Choose an existing public owner and an approved component category. Choose the loading category and geometry from the loading-state contract; `static` must use `none`.
3. Discover the generator entry/flags from current scripts and the generator guide,
   then inspect destinations before writing. This is an example, not a command to
   run in read-only mode:

```bash
npm run generate -- react-component StatusBadge \
  --owner core \
  --category data-display \
  --loading-category static \
  --loading-geometry none \
  --dry-run
```

4. If the plan is correct and no destination exists, rerun without `--dry-run`. The generator rejects `--output` and never overwrites a component.

The generator deliberately refuses to overwrite an existing component. For an existing or partially migrated component, edit it in place and use the file guides as the completion checklist.

## Complete the scaffold

Generation establishes structure only. Before treating the component as complete:

- Replace every `TODO(component-author)` description and placeholder behavior.
- Decide whether a public Vireo abstraction is justified. Do not force internal helpers or application compositions into this contract.
- Choose the correct native or MUI root semantics, matching inherited props and forwarded-ref type.
- Define the real public anatomy. Keep `root` first and remaining slots in rendered DOM order across identity, types, classes, styled slots, implementation, tests, and stories.
- Normalize public defaults into one owner-state object shared by utility classes, slot-prop callbacks, styled slots, and variants.
- Preserve the documented root/non-root prop precedence, ref composition, and slot-event cancellation rules.
- Encode accessibility dependencies in types when possible and protect required runtime semantics from late prop spreads.
- Keep default CSS in `*.styled.ts`; expose only styling regions that are genuine public slots or state classes.
- Replace baseline tests with capability-driven coverage for behavior, events, accessibility, refs, slots, classes, theme integration, and regressions actually owned by the component.
- Audit the twelve story-coverage questions and replace baseline stories with the minimum sufficient set of useful default, state, edge-case, interaction, context, and composition examples supported by the component. Treat slot and theme stories as conditional: include them only for meaningful component-specific extension contracts. Start the main component description with a one-sentence summary, then add `### Why it exists` covering the recurring problem, why Vireo owns the abstraction, and its use-or-avoid boundary. Disable Storybook Controls so the canvas cannot diverge from its displayed module. Give every story a complete executable TSX module under `internal/storybook`, import it normally and with `?raw`, and show that raw module through `docs.source.code`. Generated examples temporarily use a repository alias while the component is unfinished; after exporting the component boundary, replace it with consumer-resolvable `@vireocodedev/ui` imports and clear the TODO. Do not duplicate the example as a handwritten source string. A story build is not a substitute for behavior tests.
- Compose input-like `field.*` components inside `VireoLabelBox` in every executable story, keep the visible label on `VireoLabelBox`, and suppress the underlying MUI input label while retaining an accessible control name. Apply only the explicit whitelist documented in `stories-files.md`; currently `field.SwitchField` and `field.CheckboxField` are exempt because their control-label anatomy is integral to their presentation.
- Keep every story compatible with the shared dark Vireo Storybook theme. Use semantic palette tokens for neutral fixture surfaces and text, and make local `ThemeProvider` customization extend the outer theme instead of replacing it with a default light theme.
- Export only the component, classes, and types from the local barrel unless another API is intentionally public. Add the component directory to `packages/ui/src/index.ts` only when ready to publish.
- Add an appropriate changeset for a published API change. Preserve compatibility aliases when the migration requires them.

## Validation

Use vertical slices: a focused observable component test, minimal behavior, then
refactor while green. Discover the exact commands from the current root/UI package
scripts and scoped guides. Relevant evidence includes component tests, package
types/tests/build, Storybook interaction/accessibility/build, strict consumer
types, public surface, lint/format, and diff hygiene. These are completion criteria,
not permission to run every gate immediately: coordinate broad package,
Storybook/browser, and repository checks sequentially under the shared policy.

Only refresh a public-surface snapshot during authorized implementation when the
export change is intentional; inspect its diff and rerun the corresponding check.
Generator/template changes need generator tests; an ordinary generated component
does not automatically require a generator-wide run. Plan/review records missing
evidence without running checks or refreshing snapshots.

Do not report the component complete while generated placeholders remain, required public-surface changes are unexplained, or relevant checks are failing. Distinguish pre-existing failures and routine Storybook dependency/chunk warnings from regressions introduced by the component.

Complete the [shared exit](../vireo-framework/references/workflow.md#exit), including
the public anatomy, accessibility/loading/story coverage, release impact, actual
focused results, and coordinated gates still outstanding.
