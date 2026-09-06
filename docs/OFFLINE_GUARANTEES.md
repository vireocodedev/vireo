# Offline guarantees and limits

Status: public `0.x` contract for Vireo's offline primitives. The current Starter
Template contains one application-owned reference capability: offline Item CRUD and
replay. Generated capabilities remain online-only. This current working-Template
state does not rewrite the pinned `0.8.7` Template history, which was shell-only.

## What “offline-capable” means

Vireo separates three claims that must not be collapsed:

1. **Offline shell:** after one successful production load, the Template's static
   application shell can start without the API. It displays an offline state;
   server-backed reads and writes remain unavailable.
2. **Offline primitives:** `@vireocodedev/sqlite` and
   `com.vireocode:vireo-offline` provide local SQLite/OPFS, hydration, queue,
   replay, lifecycle, revision, and server-handler contracts.
3. **Offline domain capability:** an application chooses eligible entities and
   commands, owns migrations, temporary identifiers, conflict policy, sensitive
   data, recovery UX, authorization, and end-to-end tests. Vireo does not make this
   claim automatically.

Generated schema v1 deliberately requires `capabilities.offline: false`. Turning a
field or package on does not create an offline-safe domain workflow.

## Paired opt-in command example

The compile-checked [TypeScript order-quantity example](../packages/sqlite/docs/examples/orderQuantityOfflineReplay.example.ts)
captures and replays exactly one `PATCH /api/orders/{uuid}/quantity` command with
the body `{ "quantity": number }`. Its paired, compile-checked [JVM replay handler](../jvm/vireo-starter-documentation-examples/src/main/java/com/vireocode/docs/offline/OfflineReplayConfigurationExample.java)
admits that same route and normalizes that body into `ChangeQuantity` before it
calls the application's order command.

Treat this as a starting contract, not a generated feature: deliberately admit the
specific command, connect capture to durable SQLite storage, keep server-side
idempotency and authorization, and implement conflict/recovery UI before exposing
it. The current Template applies this pattern to its application-owned Item feature;
it remains a reference capability, not generated output. Schema v1 still refuses
`capabilities.offline: true`, so generated CRUD is online-only.

## Primitive guarantees

| Concern          | Guarantee                                                                                                                                                                                                                                                                                             | Boundary or limit                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acknowledgement  | `createOfflineQueueCapture` resolves only after the supplied enqueue operation succeeds. A failed durable write is not announced as queued.                                                                                                                                                           | Durability across reload requires an OPFS/SQLite adapter. The in-memory fallback is process-lifetime only.                                                                                                                                                                                                                        |
| Identity         | The lifecycle compares an application-supplied opaque owner key and serializes owner transitions before another runtime is used. Purge quiesces hydration, reflection and queue work before deleting the selected database.                                                                           | The application must derive a collision-resistant user-and-tenant key, invoke lifecycle on login/logout/switch, and decide whether release or purge is required. Storage is not browser-encrypted by Vireo.                                                                                                                       |
| Capture          | Only method, URL, body, command ID, capture time and an allowlist of replay headers are persisted. Authorization, Cookie, CSRF and arbitrary headers are excluded. Incoming request credentials and Host are never forwarded to command dispatch.                                                     | The authenticated sync endpoint establishes the actor and security context. Applications must not put secrets into URLs or bodies merely because headers are filtered.                                                                                                                                                            |
| Command identity | A duplicate local command ID fails; it never replaces the stored payload. The server binds each admitted ID to its resolved actor and a canonical request fingerprint. Only the same actor and payload can receive `ALREADY_APPLIED`; mismatches and legacy unbound rows are rejected without replay. | Delivery is retrying/at-least-once. The client must allocate the ID before its first attempt. Application handlers must make domain effects idempotent with that ID because a crash can occur after the domain transaction commits but before Offline finalizes the row. External side effects need their own idempotency design. |
| Ordering         | A pending local batch is selected by ascending capture timestamp, then command ID. The server processes request-list order.                                                                                                                                                                           | Equal-millisecond commands use command ID, not call order. No global order exists across tabs/devices. Dependencies and create/update/delete chains remain application-owned.                                                                                                                                                     |
| Result integrity | Unknown/duplicate result IDs and inconsistent aggregate counts are rejected before the client mutates queue state. Missing per-command results are retryable.                                                                                                                                         | A transport failure leaves commands queued. Applications choose scheduling/backoff around batch attempts.                                                                                                                                                                                                                         |
| Retry            | Retryable results remain pending and increment a bounded counter; `REJECTED` and exhausted results become permanently failed. Each command is claimed and finalized in independent short transactions, with application dispatch outside the Offline persistence transaction.                         | Applications classify domain outcomes and may open their own transaction. Automatic exponential backoff, jitter, poison-command UI, cancel/export, and operator policy are not supplied as a complete product workflow.                                                                                                           |
| Hydration        | Contributors compare revisions, execute exclusively per entity, apply timeouts, record failures and schedule bounded retries. Paged snapshots replace local state only after all pages map successfully.                                                                                              | There is no transactional snapshot across multiple HTTP pages unless the application API supplies one. Large-data streaming and incremental deltas are application work.                                                                                                                                                          |
| Schema           | Ordered migrations run transactionally; a database newer than the supplied migration list is rejected.                                                                                                                                                                                                | Applications own migration arrays. Automatic downgrade is unsupported. Roll forward or explicitly purge/re-hydrate after confirming queued-command safety.                                                                                                                                                                        |
| Corruption       | Worker failure rejects pending requests and allows a fresh worker; corrupt queued JSON is rejected with the command ID; explicit reset/purge operations exist.                                                                                                                                        | Vireo does not silently discard corrupt or incompatible user data. The application must provide support-safe inspection, export when lawful, confirmation, and recovery UX.                                                                                                                                                       |
| Conflicts        | Version, validation, permission, uniqueness and business-rule failures can be returned and preserved as failed commands. Application replay handlers are extensible.                                                                                                                                  | Vireo has no universal merge/LWW policy or generated conflict UI. When data loss is possible, preserve both versions and require an application-owned resolution.                                                                                                                                                                 |
| Multi-context    | Operations inside one managed runtime are coordinated, and owner transitions are serialized.                                                                                                                                                                                                          | Multiple tabs, workers, browsers, devices and tenants have no global lock or convergence guarantee. Use server idempotency/version rules and reconciliation.                                                                                                                                                                      |
| Observability    | Queue counts, pending/permanently-failed status, last error, retry count, hydration state, heartbeat state and server command history are available to an application.                                                                                                                                | Diagnostics must redact bodies/headers and scope history to the current actor. Vireo does not ship a vendor telemetry backend.                                                                                                                                                                                                    |

## Connectivity and version transitions

- Offline before first successful provisioning shows a useful failure state; it
  cannot manufacture server data or credentials.
- Session expiry during offline work leaves local commands intact. Replay must stop,
  reauthenticate, re-check authorization, and continue only under the same verified
  owner key.
- Logout or user/tenant switch must quiesce all writers before release/purge. Never
  show the previous owner's cached rows while deciding what to do.
- An installed old client may replay only command shapes still admitted by the
  server. Breaking command changes require a compatibility window or an explicit
  local-command migration; otherwise retain the command as incompatible for manual
  recovery.
- Real-time events, optimistic changes, queued commands and hydrated snapshots have
  no automatic cross-device merge. Applications must define revision checks and
  periodic reconciliation.

## Required application admission checklist

Before claiming a capability works offline, document and test:

1. eligible reads and commands, including why queuing each mutation is safe;
2. owner/tenant key, logout/switch cleanup, local sensitivity and quota policy;
3. stable command IDs, temporary identifiers and command dependencies;
4. retry/backoff, permanent failure, cancellation, discard and support workflow;
5. every conflict class and whether resolution is automatic, manual, or refused;
6. server transaction/idempotency behavior including external side effects;
7. schema/app-version compatibility, downgrade refusal and purge/re-hydration path;
8. two tabs, two devices, clock skew, out-of-order delivery and long suspension;
9. storage unavailable/full/corrupt/cleared and worker crash recovery; and
10. accessible queue/conflict/progress UI plus redacted diagnostics.

The minimum adversarial matrix includes offline before/after login, interruption
during hydration and submission, offline refresh/restart with queued work, update
with queued work, logout/session expiry/user switch, concurrent tabs/devices, an old
client against a migrated server, and unavailable/full/corrupt/externally-cleared
storage. Untested rows are published limits, not inferred guarantees.
