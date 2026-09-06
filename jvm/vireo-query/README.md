# Vireo Query Engine

`vireo-query` turns application-authored entity metadata into a validated filtering contract for Spring Data JPA and provides authenticated, per-user saved filters.

## Why it exists

Data-heavy applications otherwise duplicate filter metadata, request parsing, Criteria predicates, relation-option lookup, and saved-filter persistence for every aggregate. Query Engine centralizes those mechanics while applications retain ownership of entity keys, filterable fields, relation labels, authorization policy around domain data, and the frontend experience.

## Installation

```groovy
dependencies {
    implementation platform("com.vireocode:vireo-bom:0.4.0")
    implementation "com.vireocode:vireo-query"
}
```

The artifact depends on Core and on Auth's default user model because saved filters currently reference `StarterUser`. It auto-configures the registry, metadata generator, Core filter SPI implementation, relation-option service, authenticated controllers, and the module-owned saved-filter migration.

## Application contract

1. Define an application enum implementing `QueryEntityKey`.
2. Publish one or more `QueryEntityTypeResolver` beans.
3. Annotate only explicitly filterable entity fields with `@Filterable`.
4. Add `@FilterableMetadata` when an entity needs a title or default relation label fields.
5. Send a `QueryFilterRequest` whose entity key matches the service domain.
6. Supply a `QueryRelationOptionPolicy` before using the relation-option endpoint. Its Criteria predicate must scope target rows for the current subject and application domain.

Entity keys are normalized to upper case and must be unique. Entity types must be registered; Query Engine never invents a fallback key. Custom metadata providers and predicate resolvers are Spring beans, so dependency injection and replacement remain explicit.

## Safety and ownership

- Only paths and operators published in generated metadata are accepted by the auto-configured filter builder.
- Invalid typed values fail with HTTP 400 rather than silently disappearing.
- Filter requests are a flat v1 shape capped at 50 clauses, 4,096 characters per value, and 100 selected relation options per clause.
- Saved-filter search is limited to page 10,000 and 200 rows; the legacy `/all` view returns at most 200 records.
- Relation-option searches inspect declared relation label fields, cap search text at 128 characters, have a bounded result count, and always apply the application policy predicate.
- Saved-filter reads return the current user's filters plus public filters.
- Only the owner may update or delete a saved filter; request JSON cannot assign `userId` or `username`.
- All default endpoints require an authenticated caller.

Relation options fail closed: the auto-configured fallback policy denies every request. An application policy may throw access denied for a field or return a Criteria predicate that enforces owner, tenant, deletion, retention, and other domain visibility rules. Returning `criteriaBuilder.conjunction()` is an explicit decision that all registered target rows are visible to that caller.

Query execution and relation-option lookups publish safe completion events and,
when an application provides a Micrometer `ObservationRegistry`, bounded
observations. See [`docs/OBSERVABILITY.md`](../../docs/OBSERVABILITY.md) for names,
tags, and the data-exclusion contract.

`isPublic` means discoverable by other authenticated users, not editable by them. Domain record authorization remains an application responsibility and should be enforced before applying a filter to protected data.

## Configuration

```properties
vireo.starter.query-engine.endpoint-enabled=true
vireo.starter.query-engine.saved-filters-endpoint-enabled=true
vireo.starter.query-engine.endpoint-path=/api/queryengine
vireo.starter.query-engine.saved-filters-endpoint-path=/api/filters
vireo.starter.query-engine.relation-options-limit=20
```

Both endpoint paths must be absolute and distinct. The relation-option limit accepts values from 1 through 1000. Disabling controllers does not disable the registry, metadata generator, filter builder, services, or migrations.

## HTTP surface

- `GET {endpoint-path}/entities`
- `GET {endpoint-path}/entities/config`
- `GET {endpoint-path}/entities/{entityKey}`
- `GET {endpoint-path}/entities/{entityKey}/fields/{fieldPath}/options`
- saved-filter list, search, default, create, update, and delete operations under `{saved-filters-endpoint-path}`

The matching TypeScript package is `@vireocodedev/query`. The JVM module owns metadata generation, persistence predicates, relation lookups, and saved-filter authorization; the TypeScript package owns browser-side schemas, query construction, and local execution support.

See the unified Vireo Starter Storybook under **JVM → Query Engine** for the compiled registration example and operational guidance.
