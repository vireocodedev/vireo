# Vireo Starter BOM

`vireo-bom` is the version-alignment contract for the Vireo Starter JVM libraries. It contains no runtime classes and does not add any module to an application by itself.

## Why it exists

Vireo's JVM modules are released on one version line and compiled against one Spring Boot dependency line. Pinning every artifact independently allows accidental mixed releases and transitive dependency drift. Importing the BOM once gives Gradle and Maven consumers one explicit version boundary while they still choose only the capabilities they need.

## Gradle

```groovy
dependencies {
    implementation platform("com.vireocode:vireo-bom:0.4.0")

    implementation "com.vireocode:vireo-core"
    implementation "com.vireocode:vireo-auth"
    implementation "com.vireocode:vireo-query"
    implementation "com.vireocode:vireo-history"
    implementation "com.vireocode:vireo-offline"
}
```

Declare only the modules the application uses. `platform(...)` is the normal default: its constraints participate in Gradle conflict resolution while still allowing an application to make a deliberate stronger choice. Reserve `enforcedPlatform(...)` for an application that intentionally wants the BOM to override every competing version; published libraries should not impose that policy on their consumers.

## Maven

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.vireocode</groupId>
      <artifactId>vireo-bom</artifactId>
      <version>0.4.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>com.vireocode</groupId>
    <artifactId>vireo-core</artifactId>
  </dependency>
</dependencies>
```

## Alignment contract

The BOM aligns these published artifacts to its own version:

| Artifact        | Capability                                                             |
| --------------- | ---------------------------------------------------------------------- |
| `vireo-core`    | Shared web, persistence, service, migration, and extension foundations |
| `vireo-auth`    | Replaceable session-authentication defaults                            |
| `vireo-query`   | Typed query metadata, predicates, relation options, and saved filters  |
| `vireo-history` | Neutral audit recording and authenticated history reads                |
| `vireo-offline` | Authenticated replay, hydration revisions, and change streaming        |

It also imports the Spring Boot dependency BOM used to compile the release. That supplies compatible third-party defaults; it does not apply the Spring Boot Gradle plugin, create an executable application, or install any Vireo capability.

All Vireo JVM artifacts intentionally share one version. Upgrade the BOM and the selected modules together rather than pinning individual Vireo versions. Applications may override a third-party dependency when required, but that override becomes application-owned compatibility work and should pass the complete application test suite.

## Verification and release semantics

`./gradlew :vireo-bom:check` verifies both the declared Gradle platform model and the generated Maven BOM. The gate fails if an aligned module is missing or extra, a coordinate or version drifts, the Spring Boot import changes unexpectedly, or Maven publication stops producing a real BOM.

The repository's protected release workflow stages one signed, `USER_MANAGED`
Maven Central deployment by default. An explicit opt-in input may promote only
that validated deployment after it verifies the UUID and exact six-artifact
package-URL set; stage-only releases remain available for Portal review. After
Central reports publication, a separate workflow resolves the public BOM and
every versionless module from Maven Central with a cold Gradle cache. See the
unified Vireo Starter Storybook under **JVM → BOM** for consumption and release
guidance.
