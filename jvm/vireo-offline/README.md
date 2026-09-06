# Vireo Offline

`vireo-offline` provides authenticated mutation replay, idempotent command tracking, per-entity hydration revisions, and transaction-aware server-sent change batches for row-shaped applications.

## Why it exists

Offline-capable applications otherwise duplicate command persistence, retry classification, replay authorization, hydration invalidation, and SSE lifecycle behavior. Offline centralizes the server side of that protocol while applications retain ownership of domain mutations, record authorization, browser persistence, and product-specific conflict resolution.

## Installation

```groovy
dependencies {
    implementation platform("com.vireocode:vireo-bom:0.4.0")
    implementation "com.vireocode:vireo-offline"
}
```

The artifact depends on Core and Query Engine. Auth is an implementation dependency used only by the replaceable default actor adapter; the Offline schema does not require actors to exist in Auth's user table.

## Runtime contract

- `POST /api/offline/sync` replays bounded mutation batches and records idempotent outcomes.
- `POST /api/offline/sync/commands/search` exposes caller-scoped command diagnostics.
- `GET /api/offline/hydration/versions` returns normalized per-entity revisions.
- `GET /api/offline/heartbeat` and `/stream` expose current sync state and transaction-aware change batches.
- `OfflineSyncReplayHandler` is the required, ordered application extension point for domain replay. Offline never loops a command through the HTTP stack.
- `OfflineActorResolver` supplies application-neutral command ownership and privileged-read policy.
- `OfflineSseAudienceResolver` supplies the opaque subject/tenant audience shared by a stream and its events.

All default endpoints require authentication. A non-privileged actor sees only commands owned by its stable ID, with username fallback for legacy rows. A privileged actor may inspect the complete command stream. SSE payload streaming additionally requires a non-empty application audience; the fail-closed resolver denies stream creation and discards payload events.

## Replay safety

The default policy accepts only `POST`, `PUT`, `PATCH`, and `DELETE` beneath `/api/`. Auth and Offline paths are excluded. Paths must be relative, canonical, fragment-free, and free of encoded traversal. Only `Content-Type`, `Idempotency-Key`, and `X-Offline-Temp-Id` are accepted from queued command headers. Incoming Host, Cookie, CSRF, Authorization, and arbitrary queued headers are never copied into command dispatch. Authentication establishes the actor and security context at the sync endpoint; it is not forwarded as a credential-bearing loopback request.

Request bodies and headers are omitted from `OfflineSyncCommandDto.toString()`. Downstream exception bodies are not returned to clients. Duplicate IDs inside one batch and oversized batches fail before replay.

Batch, replay, queue, SSE, and lifecycle paths publish structured events that
contain only bounded operation/outcome enums, counts, and elapsed time. An
optional Micrometer bridge activates only when the application provides an
`ObservationRegistry`; see [`docs/OBSERVABILITY.md`](../../docs/OBSERVABILITY.md).

They are also omitted from persistence by the safe-default
`OfflineDataLifecyclePolicy`; idempotency uses the SHA-256 request fingerprint,
not a stored payload. New commands expire after 30 days and each owner partition
is capped at 10,000 rows. Configure `command-retention` and
`max-commands-per-partition`, or provide an application policy that returns an
opaque tenant/owner partition, approved redacted payload, expiry, and legal-hold
decision. Held rows survive purge and erasure, but cannot make growth unbounded:
admission fails when holds exhaust quota.

Command diagnostics reject pages above 10,000, page sizes above 200, and the former `rowsPerPage=-1` all-rows sentinel before repository access.

Custom handlers receive an immutable, header-sanitized command DTO and return an outcome. Offline—not the handler—owns persistence, retry state, and timestamps. A valid command with no accepting application handler is permanently rejected with status 422; there is no HTTP fallback.

## Configuration

```properties
vireo.starter.offline.sync-endpoint-enabled=true
vireo.starter.offline.heartbeat-endpoint-enabled=true
vireo.starter.offline.hydration-endpoint-enabled=true
vireo.starter.offline.sync-endpoint-path=/api/offline/sync
vireo.starter.offline.heartbeat-endpoint-path=/api/offline/heartbeat
vireo.starter.offline.hydration-endpoint-path=/api/offline/hydration
vireo.starter.offline.max-batch-size=100
vireo.starter.offline.max-replay-attempts=5
vireo.starter.offline.max-hydration-entities=100
vireo.starter.offline.command-retention=30d
vireo.starter.offline.max-commands-per-partition=10000
vireo.starter.offline.heartbeat-interval=1s
vireo.starter.offline.replay-api-prefix=/api/
vireo.starter.offline.replay-methods=POST,PUT,PATCH,DELETE
vireo.starter.offline.excluded-replay-path-prefixes=/api/auth,/api/offline/
vireo.starter.offline.replay-headers=Content-Type,Idempotency-Key,X-Offline-Temp-Id
vireo.starter.offline.privileged-role=SUPERADMIN
```

Endpoint paths must be absolute and distinct. Numeric limits and heartbeat cadence are validated at startup. Disabling controllers does not disable replay, revision, heartbeat, migration, or Core SPI services.

## Persistence and failure semantics

Every non-empty batch requires a resolved actor. Stored commands carry a normalized actor key and a SHA-256 fingerprint over the canonical method, URL, JSON body, and admitted replay headers. A stored `DONE` command is idempotent success only when both bindings match; another actor cannot observe that result, payload reuse is rejected with 409, and pre-binding legacy rows are never replayed. `command_id` remains globally unique as a collision backstop, with an additional actor/command database constraint. Transient failures are retried up to the configured server budget. Applications classify handler failures as retryable or rejected. Concurrent inserts return a generic retryable conflict. Handler results are persisted centrally.

Each command uses a short `REQUIRES_NEW` claim transaction, runs application dispatch with no Offline persistence transaction open, and uses a separate `REQUIRES_NEW` finalize transaction. A handler exception or rollback therefore cannot mark the batch transaction rollback-only or prevent later commands from being processed. The application handler may establish its own domain transaction. Because a process failure can occur after the domain mutation commits but before Offline records `DONE`, handlers must make business effects idempotent using the stable command ID; external side effects require the same protection.

Entity revision bumps use row locking and bounded insert-race recovery. Change events flush only after transaction commit and are discarded on rollback. Concurrent sync batches keep the heartbeat in-progress state true until the last batch finishes.

Each SSE connection is bound to the audience resolved when it opens. Each transaction batch is bound to the audience resolved when its first event is published and is delivered only to matching connections. Resolving a different audience later in the same transaction fails instead of mixing data. Applications choose whether the opaque value represents one subject, tenant, organization, or another isolation boundary; there is no global payload audience by default.

The module owns `sync_command` and `offline_entity_version` through `flyway_schema_history_vireo_offline`. V2 removes the legacy Auth foreign key so custom actor IDs remain valid audit data. V4 adds partition/expiry/hold metadata, redacts legacy bodies and headers, and marks those rows eligible for scoped purge. `OfflineDataLifecycleService` provides partition-plus-owner erasure and publishes payload-free count events. See [`docs/DATA_LIFECYCLE.md`](../../docs/DATA_LIFECYCLE.md).

The matching browser implementation lives in `@vireocodedev/sqlite`: it owns the persistent browser queue, replay scheduling, hydration state, and network policy. JSON is the boundary between the two runtimes.

See the unified Vireo Starter Storybook under **JVM → Offline** for the compiled handler example and operational guidance.
