# Public API entry points

This is the navigation map for supported package boundaries. Package export maps,
API snapshots, and `contracts/public-api-policy.json` are normative; undocumented
source files and JVM implementation packages are not public entry points.

## Frontend entry points

| Package or subpath                            | Use it for                                                      | Runtime           |
| --------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| `create-vireo`                                | Creating a pinned full-stack or standalone frontend application | Node.js 24        |
| `@vireocodedev/history`                       | Validated, framework-free history records and diffs             | Browser or worker |
| `@vireocodedev/infrastructure`                | HTTP transport, connectivity, persistence, and session expiry   | Browser           |
| `@vireocodedev/infrastructure/network-status` | Framework-free network status                                   | Browser or worker |
| `@vireocodedev/infrastructure/pagination`     | Framework-free pageable contracts                               | Browser or worker |
| `@vireocodedev/localization`                  | Locale definitions, formatting, and shared resources            | Browser or worker |
| `@vireocodedev/query`                         | Query filters, metadata, persistence, and SQLite execution      | Browser or worker |
| `@vireocodedev/shell`                         | Router-neutral sitemap and application-shell contracts          | Browser or worker |
| `@vireocodedev/sqlite`                        | Managed SQLite worker/client runtime                            | Browser or worker |
| `@vireocodedev/sqlite/offline`                | Offline queue, replay, hydration, and lifecycle contracts       | Browser or worker |
| `@vireocodedev/ui`                            | React components, providers, tables, overlays, and shared hooks | Browser           |
| `@vireocodedev/ui/forms`                      | Vireo form bindings and form components                         | Browser           |
| `@vireocodedev/ui/localization`               | Temporal-field localization provider                            | Browser           |
| Other declared `@vireocodedev/ui/*` subpaths  | Optional integrations selected deliberately                     | Browser           |

Use only subpaths declared by the installed package's `exports` map. The complete UI
stability and migration classification is in
[Starter UI public surface](../packages/ui/docs/PUBLIC_SURFACE.md).

Each package owns detailed runnable documentation in its README and in the public
[Vireo documentation portal](https://vireocode.com/docs/). The
[generated TypeScript reference](https://vireocode.com/reference/typescript/)
is searchable across every export in these declared entry points.

## JVM entry points

Import the BOM once, then omit versions from individual Vireo modules:

```kotlin
dependencies {
    implementation(platform("com.vireocode:vireo-bom:0.4.0"))
    implementation("com.vireocode:vireo-core")
    implementation("com.vireocode:vireo-auth")
}
```

| Maven coordinate              | Use it for                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `com.vireocode:vireo-bom`     | Aligning all Vireo JVM module versions                                       |
| `com.vireocode:vireo-core`    | Base entities, mapping, migrations, security expressions, and HTTP contracts |
| `com.vireocode:vireo-auth`    | Default session authentication and configuration                             |
| `com.vireocode:vireo-query`   | Query language, validation, and persistence                                  |
| `com.vireocode:vireo-offline` | Server-side offline synchronization contracts                                |
| `com.vireocode:vireo-history` | History recording, authorization, and query support                          |

Public Java packages and declaration budgets are enforced by API snapshots. Start
with each module's README under [`jvm/`](../jvm), and use the BOM unless an isolated
module test deliberately proves a different version arrangement.

The public [aggregate JVM API reference](https://vireocode.com/reference/java/)
is generated from the same Java sources that Gradle compiles and validates.

## Compatibility boundary

- Adding an export is a minor change.
- Removing, renaming, or incompatibly changing one is a major change.
- Undeclared TypeScript implementation paths and non-public Java declarations may
  change without compatibility notice.
- The Template declares exact compatible npm ranges and one JVM release line.

See [compatibility and migration policy](COMPATIBILITY.md) for the complete contract.
