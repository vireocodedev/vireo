# Entity generator

Build `create-vireo`, then run its application CLI from a Vireo project root:

```bash
corepack npm run build --workspace=create-vireo
node /path/to/vireo/packages/create-vireo/dist/vireo-cli.js \
  generate entity .vireo/examples/purchase-order.entity.json \
  --project . \
  --dry-run
```

Generated applications expose the shorter form:

```bash
corepack npm run vireo -- generate entity .vireo/examples/purchase-order.entity.json --dry-run
corepack npm run vireo -- generate entity .vireo/examples/purchase-order.entity.json
corepack npm run vireo -- check
```

The schema is validated twice conceptually: the shipped JSON Schema documents editor/tooling shape, and the CLI applies portable Java/TypeScript naming, uniqueness, reserved-word, regex, capability, and minimum searchable-field rules. `--json` provides machine-readable plans and checks.

## Generated vertical slice

Generation has two targets. A `full-stack` project defaults to `full-stack`; a
`frontend` project defaults to `frontend` and refuses the backend target. A
full-stack project may explicitly use `--target frontend`.

### Full-stack target

- Flyway table migration and indexes.
- JPA entity, Jakarta validation, enums, DTO, MapStruct mapper, repository, Vireo service, secured REST controller, query registration, and history identity.
- Separate Zod transport/domain schemas, mapper functions, validated API adapter, TanStack Query CRUD page, responsive empty/loading/error/list/form states, route/navigation registration, English/Croatian resources, Storybook story, and contract test.
- Spring API integration test, capability documentation, canonical schema copy, wire contract, and hash manifest.

`database.migrationVersion` is an explicit, unused Flyway version selected by
the application owner. Generation never silently renumbers it: choose a value
that does not conflict with an existing `V<version>__...sql` migration before
generating the entity.

### Frontend target

- Zod transport/domain schemas, mappers, an explicit API interface and configurable
  HTTP adapter.
- TanStack Query CRUD page, responsive states, route/navigation and capability
  registration, English/Croatian resources, Storybook story, and contract test.
- Capability documentation, canonical schema copy, target-aware wire contract, and
  hash manifest.
- No Java, Gradle, Flyway, or database artifact.

Schema format version 1 remains common to both targets. Its Java package, database,
permissions, and backend capability fields are retained so one reviewed schema can
cross a team boundary; the frontend renderer ignores backend-only values.

The v1 identifier is a generated `Long`. Explicit singular/plural names avoid English pluralization guesses. Acronyms are accepted when portable. Compound identifiers and offline replay remain out of scope; offline guarantees belong to Phase 4.

## Many-to-one relationships

Schema v1 admits a target-first `many-to-one` relationship:

```json
{
  "name": "customer",
  "kind": "many-to-one",
  "target": "Customer",
  "required": true,
  "displayField": "legalName"
}
```

`Customer` must already be exactly one managed, full-stack capability in the same project and use generator contract 0.3.0, 0.3.1, or 0.4.0. Its canonical schema and manifest must agree, its migration version must be lower than the source migration, and `legalName` must be a `string` or `text` field. Ejected, legacy 0.2.0, stale, frontend-only, self-referencing, and ambiguous targets fail before files are written.

The generator creates a lazy foreign key (`customer_id`) without cascade delete. Write DTOs use only `customerId`; responses expose `customerId` and the stable display property `customerName`, populated from the target's declared `displayField`. If both capabilities enable query, Vireo emits relation-selection metadata for that display field.

Full-stack schemas use an unquoted, portable H2/PostgreSQL identifier policy. Table names and field-derived column names cannot be reserved words, cannot conflict with generated audit columns, and must remain unique after lower-camel to lower-snake conversion. Tables, columns, generated enum checks, and generated query indexes must each fit PostgreSQL's 63-character identifier limit. The CLI reports the exact derived identifier before writing files; shorten the table or field name instead of relying on database truncation or quoting.

See [generated-code ownership](../architecture/generated-code-ownership.md) before regeneration and [wire contracts](../architecture/wire-contracts.md) before changing transport fields.
