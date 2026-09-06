# @vireocodedev/ui

## 0.3.2

### Patch Changes

- Updated dependencies [7d02039]
  - @vireocodedev/infrastructure@0.3.0

## 0.3.1

### Patch Changes

- c57f130: Fix accessible loading indicators, landmark semantics, and focus behavior across public UI components and executable Storybook examples.

## 0.3.0

### Major Changes

- 24abb92: Require every `VireoResponsiveOverlayFrame` to provide either `aria-label` or `aria-labelledby`, and expose the selected overlay side panel as a named dialog surface.
- 8aefcc9: Make `VireoInfiniteCanvas` require a localized accessible name and provide focus-visible Arrow-key pan, plus/minus zoom, and zero-key reset controls by default. Consumers can configure the pan distance, cancel built-in actions from composed key handlers, or opt out when supplying a complete alternative keyboard model.

### Minor Changes

- 4485a17: Add a stable live-status slot and required localized failure label to `VireoJsonViewer`, so clipboard success and failure are both announced to assistive technology. TanStack Query error-detail integrations now expose matching failure-label options.
- 15acb3e: Add the public `createVireoTheme` factory and canonical light/dark semantic foundations, align Storybook with the same themes, and standardize Vireo motion and reduced-motion behavior across navigation and overlay surfaces.
- a210969: Require a localized landmark label on `VireoApplicationNavigation` and a destination URL on each `VireoApplicationNavigationItem`. Navigation content now renders as a named `nav` landmark, while items render as links with current-page and disabled semantics.
- 0e7c206: Add localized incremental-loading labels to `VireoResponsiveTable`, give the mobile progress indicator an accessible name, and announce both loading and completion through one stable polite status region.
- dc78ca7: Preserve normal page wheel and touch scrolling around `VireoInfiniteCanvas` by default. Wheel zoom and touch panning are now explicit opt-ins through `wheelZoomEnabled` and `touchPanEnabled`.
- 8ec4300: Add an inherited read-only display mode to Vireo forms and every bound field, including customizable empty and value rendering, a themeable `VireoFormReadOnlyValue`, and automatic submit suppression.
- 0685dad: Remove the two free-solo field implementations from the direct `@vireocodedev/ui/forms` runtime surface. Their types and utility classes remain public; render them through the `useVireoForm` field facade, consistently with the other form-bound fields.

### Patch Changes

- a30ca30: Increase truncated-content and side-panel resize interaction targets to meet the 24px WCAG minimum without enlarging their visible anatomy.
- 9375d5f: Preserve consumer theme foundations and regenerate correct CSS variables when deriving a dark theme with `createDarkTheme`.
- 8af8e7a: Use system foreground, background, and border colors for contained buttons and filled chips in forced-colors mode so their content remains legible across high-contrast palettes.
- 133f5c7: Keep responsive-table pagination text at full contrast while its controls are disabled during initial skeleton loading.
- 89751c2: Compose `VireoInfiniteCanvas` root pointer handlers before built-in panning and honor `defaultPrevented`, matching the event-cancellation contract used by other slotted Vireo components.
- 728eb65: Compose Tabs and Confirmation Dialog slot event handlers before built-in behavior and honor `preventDefault()` cancellation consistently.
- 1356b87: Connect confirmation and responsive form overlay headings to their dialog, drawer, bottom-sheet, and docked-panel surfaces so assistive technology receives a stable accessible name.
- 08e9b05: Make labeled icon buttons, action-preview buttons, and label boxes follow consumer typography, spacing, and shape theme settings.
- 56f6bc6: Add an associated-control render contract to `VireoLabelBox` and programmatically name the responsive table's mobile sort controls.
- 2eba1e6: Initialize uncontrolled `VireoPage` layouts from one deterministic server and hydration mode before resolving the actual embedded container, and apply reserved inline space to every container measurement.
- e76c22c: Keep drag-and-drop utility-class, slot, prop-precedence, and ref orchestration in each public component's canonical implementation module.
- 706cac2: Standardize Vireo Framework product terminology and publish canonical documentation, issue, and source routes in registry metadata.
- Updated dependencies [706cac2]
  - @vireocodedev/history@0.2.2
  - @vireocodedev/infrastructure@0.2.2
  - @vireocodedev/localization@0.2.2
  - @vireocodedev/query@0.2.2

## 0.2.2

### Patch Changes

- aa48184: Preserve the temporal localization provider's Day.js UTC and bundled-locale setup
  when consumer bundlers tree-shake the package, and document canonical temporal
  value formats.

## 0.2.1

### Patch Changes

- f3ea1c2: Include the compiled distribution artifacts required by public npm consumers.
- Updated dependencies [f3ea1c2]
  - @vireocodedev/history@0.2.1
  - @vireocodedev/infrastructure@0.2.1
  - @vireocodedev/localization@0.2.1
  - @vireocodedev/query@0.2.1

## 0.2.0

### Initial public release

- Publish the complete Vireo React component, hook, provider, theme, responsive
  layout, form, table, overlay, loading, motion, and integration surface at the
  canonical coordinate.
- Include coordinated truncated-content resize handling and the corrected TanStack
  Query peer floor in the first public artifact.
- Establish the public `0.x` compatibility line on npm.
