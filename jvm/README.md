# Vireo JVM modules

Vireo's JVM modules are a family of aligned Spring Boot libraries for
applications that share Vireo's web, persistence, authentication, filtering,
history, and offline-sync contracts. It is a library build, not an executable
Spring Boot application: consumers select only the capabilities they need and
retain ownership of their domain model, business rules, deployment, and data
store.

## Modules

| Artifact        | Responsibility                                                          | Direct Vireo dependencies                  |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `vireo-bom`     | Aligns all Vireo modules and their Spring Boot dependency line          | None                                       |
| `vireo-core`    | CRUD foundations, web errors, shared SPIs, and migration infrastructure | None                                       |
| `vireo-auth`    | Replaceable user model, authentication services, and account endpoints  | Core                                       |
| `vireo-query`   | Metadata-driven filtering and per-user saved filters                    | Core, Auth                                 |
| `vireo-history` | Append-only entity history and actor resolution                         | Core; Auth at runtime for the V1 migration |
| `vireo-offline` | Command replay, entity versions, hydration, and SSE heartbeats          | Core, Query Engine; Auth internally        |

Import the BOM once, then declare only the libraries required by the
application:

```groovy
dependencies {
    implementation platform("com.vireocode:vireo-bom:0.4.0")
    implementation "com.vireocode:vireo-auth"
    implementation "com.vireocode:vireo-history"
}
```

The BOM contributes versions, not runtime capabilities. Every module remains an
ordinary library JAR and uses replaceable Spring Boot auto-configuration rather
than producing a fat or executable JAR.

## Repository verification

Run the complete JVM source and documentation gate from this directory:

```bash
./gradlew clean check aggregateJavadoc --no-build-cache
```

The aggregate API reference is written to `build/docs/javadoc`. Each published
library also produces its own sources and Javadoc JAR.

Before release, prove the Maven publications through a standalone consumer:

```bash
./scripts/verify-publication-consumer.sh
```

That script publishes all six artifacts to a temporary repository, imports the
BOM from a build outside the multi-project workspace, consumes every library
without a version, and asserts that the public contracts came from the
published JARs rather than Gradle project substitution.

## Documentation

The unified Vireo Starter Storybook contains the learning-oriented guides under
`JVM`. Detailed contracts live in each module README and in generated Javadocs.
Java examples displayed by Storybook are compiled from the exact same source
files by `vireo-starter-documentation-examples`.

Authoring and release rules live in:

- [`../docs/package-authoring/JVM_PACKAGES.md`](../docs/package-authoring/JVM_PACKAGES.md)
- [`../docs/package-authoring/JVM_LIVE_DOCUMENTATION.md`](../docs/package-authoring/JVM_LIVE_DOCUMENTATION.md)
- [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- [Vireo Spring Boot guide](https://vireocode.com/docs/spring/)
