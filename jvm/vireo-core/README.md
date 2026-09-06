# Vireo Core

Foundational Spring Boot contracts for reusable CRUD services, auditing, search,
stable API errors, optional-module integration, and library-owned Flyway
migrations.

Core owns the mechanics shared by the other Vireo JVM artifacts. Applications
still own their domain entities and DTOs, controllers, authorization policy,
business validation, database selection, and consumer-owned migrations.

## Installation

Gradle:

```groovy
dependencies {
    implementation platform("com.vireocode:vireo-bom:0.4.0")
    implementation "com.vireocode:vireo-core"
}
```

Maven:

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

<dependency>
  <groupId>com.vireocode</groupId>
  <artifactId>vireo-core</artifactId>
</dependency>
```

Optional modules such as Auth, History, Query Engine, and Offline already bring
Core transitively. Declare Core directly when an application uses its base
service contracts without another JVM artifact.

## Primary workflow

A managed aggregate normally provides:

1. an entity extending `BaseEntity`;
2. either one DTO and MapStruct `BaseMapper`, or distinct create, PATCH, and
   response models with `BaseRequestMapper`;
3. a `SearchableRepository`;
4. a `BaseService` or `BaseRequestService` subclass with one immutable `EntityConfig`.

`BaseService` owns the CRUD transaction boundaries, soft-delete visibility,
keyword population, optional filter compilation, history recording, and offline
change publication. Customize the protected template hooks such as
`validateCreateRequest`, `applyRelations`, and `performDelete`; overriding the
public CRUD entry points is rejected because it can bypass those invariants.

Use `BaseRequestService<ID, DOMAIN, CREATE, PATCH, RESPONSE>` for new HTTP
contracts. Its `create(CREATE)` and `patch(ID, PATCH)` operations map only
writable request models, then return `RESPONSE`. Map a writable relation as
`<relation>Id` and resolve it in `applyCreateRelations` or
`applyPatchRelations`; expose a relation name or display value only from the
response model. This keeps the partial PATCH shape explicit and prevents
server-owned fields from becoming writable by accident.

History is opt-in per entity. If `EntityConfig.history` is present but no
`HistoryEventsRecorder` exists, the operation fails before persistence instead
of silently dropping an audit record. Query filters likewise fail explicitly
when no `FilterSpecificationBuilder` is installed.

## Auto-configuration

Adding the dependency provides replaceable defaults for:

- one UTC `Clock`;
- one stable `GlobalExceptionHandler`;
- Boot-owned Jackson 3 composition with `JsonNullable`, Java time, and Vireo's
  `is`-prefixed boolean wire convention;
- `JsonNullableMapper` and `JsonNodeMapper`;
- Spring Data JPA auditing and a security-context `AuditorAware<String>`;
- method security for Starter endpoints;
- a Flyway migration strategy when Flyway is present.

Ordinary consumer beans replace the `Clock`, Boot `JsonMapper`, error handler,
mappers, auditor, or Flyway strategy through `@ConditionalOnMissingBean`.
Applications can contribute Jackson modules and builder customizers without
Vireo replacing Boot's mapper or HTTP converter. Applications that already
enable JPA auditing retain their own auditing setup.

## Configuration

```properties
vireo.starter.core.expose-internal-error-details=false
vireo.starter.core.system-auditor=system
```

Internal exception details are hidden by default. Enable them only in a trusted
development environment. `system-auditor` is used when no authenticated,
non-anonymous principal is available and must not be blank.

## Web and security semantics

- `ApiError(status, code, message, errors, timestamp)` is the stable error
  body. `code` is an uppercase-snake-case, machine-readable contract; the
  existing four-argument constructor remains binary compatible and uses
  `REQUEST_FAILED`.
- Core emits `VALIDATION_FAILED`, `MALFORMED_REQUEST`, `INVALID_REQUEST`,
  `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE`, `CONFLICT`,
  `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_ERROR`, or `REQUEST_FAILED`.
- Validation, malformed input,
  authentication, authorization, status exceptions, and unexpected failures.
- Duplicate validation errors for one field are retained in deterministic
  order rather than overwritten.
- Unexpected failures are logged server-side and do not expose exception class
  names or messages by default.
- Missing routes, unsupported methods/media types, invalid arguments, and
  persistence/optimistic conflicts retain safe 404/405/415/400/409 responses
  instead of collapsing into a generic 500.
- Throw `ApplicationException` for an intentional domain failure that needs a
  stable error code and a deliberately safe client message. Do not pass
  persistence, identity, or upstream exception messages through it.
- `RestUtils.makePageable` rejects invalid public request values as HTTP 400 and
  caps requests at page 10,000 and 200 rows per page. There is no public
  all-rows sentinel, and search text is limited to 256 characters.
- `RestUtils.getCurrentPrincipal` excludes unauthenticated and anonymous
  security tokens.

Applications own their endpoint-specific authorization. Core only enables the
method-security infrastructure that the Starter modules' `@PreAuthorize`
contracts require.

## Persistence and migrations

Core does not own an application table. It coordinates migrations contributed
by optional modules through `StarterFlywayModule`:

- each module has a validated, SQL-safe name;
- migrations live under `classpath:db/vireo/{module}`;
- vendor additions live under `vendor/{database}`;
- each module owns `flyway_schema_history_vireo_{module}`;
- modules run deterministically by order and then name;
- duplicate module names abort startup.

The consumer's ordinary `flyway_schema_history` remains separate. Published
migrations are immutable; upgrades add a new version rather than editing an
applied script.

## Extension boundary

The `com.vireocode.vireo.spi` package prevents Core from depending upward on
optional artifacts:

- Query Engine supplies `FilterSpecificationBuilder`.
- History supplies `HistoryEventsRecorder`.
- Offline supplies `OfflineRevisionTracker` and `OfflineChangeBroadcaster`.

Applications may implement those SPIs deliberately, but should not depend on
module implementation classes. Core is not a generic application framework:
domain workflows that do not fit its CRUD lifecycle should use ordinary Spring
services instead of forcing them through `BaseService`.

## Verification and documentation

Core is verified by module unit tests, dependency-only consumer context tests,
H2 and PostgreSQL migration/adoption/upgrade tests, Javadoc doclint, and the
committed public-API snapshot. The unified Vireo Starter Storybook displays
Java examples compiled by `vireo-starter-documentation-examples`; Javadocs are
the detailed type reference.
