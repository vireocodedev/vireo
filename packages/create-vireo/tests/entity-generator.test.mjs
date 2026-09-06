import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkGeneratedEntities,
  createWireContract,
  ejectEntity,
  EntitySchemaError,
  generateEntity,
  parseEntitySchema,
  sha256,
  stableJson,
} from "../dist/index.js";

function schema(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "entity",
    entity: { name: "APIClient", plural: "api-clients", description: "Acronym fixture" },
    database: { table: "api_client", migrationVersion: 3 },
    api: { path: "/api/api-clients" },
    permissions: { read: "hasRole('USER')", manage: "hasRole('SUPERADMIN')" },
    capabilities: { history: true, offline: false, query: true },
    fields: [
      {
        name: "displayName",
        type: "string",
        required: true,
        constraints: { min: 2, max: 120 },
        query: { filterable: true, searchable: true, sortable: true },
      },
      {
        name: "creditLimit",
        type: "decimal",
        required: true,
        constraints: { min: 0 },
        query: { filterable: true },
      },
      {
        name: "status",
        type: "enum",
        required: true,
        enumValues: ["NEW", "ACTIVE"],
        query: { filterable: true },
      },
      { name: "reviewedAt", type: "timestamp", query: { filterable: true } },
    ],
    localization: {
      en: { singular: "API client", plural: "API clients" },
      hr: { singular: "API klijent", plural: "API klijenti" },
    },
    ...overrides,
  };
}

async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), "vireo-entity-generator-"));
  await mkdir(join(root, ".vireo"), { recursive: true });
  await writeFile(
    join(root, ".vireo/project.json"),
    JSON.stringify({
      schemaVersion: 1,
      projectName: "fixture",
      javaPackage: "dev.example.fixture",
      database: "h2",
      packageManager: "npm",
    }),
  );
  const schemaPath = join(root, "api-client.entity.json");
  await writeFile(schemaPath, JSON.stringify(schema()));
  return { root, schemaPath };
}

async function frontendProjectFixture() {
  const root = await mkdtemp(join(tmpdir(), "vireo-frontend-entity-generator-"));
  await mkdir(join(root, ".vireo"), { recursive: true });
  await writeFile(
    join(root, ".vireo/project.json"),
    JSON.stringify({ schemaVersion: 1, profile: "frontend", projectName: "frontend-fixture", packageManager: "npm" }),
  );
  const schemaPath = join(root, "api-client.entity.json");
  await writeFile(schemaPath, JSON.stringify(schema()));
  return { root, schemaPath };
}

async function legacyGeneratorFixture() {
  const { root, schemaPath } = await projectFixture();
  const currentSchema = schema();
  currentSchema.fields[0] = {
    ...currentSchema.fields[0],
    example: "API-123",
    constraints: { ...currentSchema.fields[0].constraints, pattern: "^API-[0-9]{3}$" },
  };
  await writeFile(schemaPath, JSON.stringify(currentSchema));
  await generateEntity({ projectDirectory: root, schemaPath });

  const legacySchema = structuredClone(currentSchema);
  delete legacySchema.fields[0].example;
  assert.throws(() => parseEntitySchema(legacySchema), /example is required/u);
  const schemaArtifact = join(root, ".vireo/schemas/api-clients.json");
  const manifestPath = join(root, ".vireo/generated/api-clients.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const legacyCanonicalSchema = stableJson(legacySchema);
  manifest.generatorVersion = "0.2.0";
  manifest.schemaDigest = sha256(legacyCanonicalSchema);
  manifest.files.find(file => file.path === ".vireo/schemas/api-clients.json").sha256 = sha256(legacyCanonicalSchema);
  await writeFile(schemaArtifact, legacyCanonicalSchema);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, schemaArtifact, manifest, manifestPath };
}

test("ships a parser-compatible public V4 example and the exact frozen V3 legacy fixture", async () => {
  const [publicFixture, legacyBytes] = await Promise.all([
    readFile(new URL("../fixtures/purchase-order.entity.json", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/purchase-order.0.2.0.entity.json", import.meta.url)),
  ]);
  const current = parseEntitySchema(JSON.parse(publicFixture));
  const legacy = JSON.parse(legacyBytes.toString("utf8"));

  assert.equal(current.database.migrationVersion, 4);
  assert.equal(legacy.database.migrationVersion, 3);
  assert.equal(
    legacy.fields.some(field => Object.hasOwn(field, "example")),
    false,
  );
  assert.equal(
    createHash("sha256").update(legacyBytes).digest("hex"),
    "d822e61a9d895cc2440918c2262ec7b97f01bb64550cda9a4fcdf20fec006b4b",
  );
});

test("validates acronyms and explicit irregular plural names without inferring them", () => {
  const parsed = parseEntitySchema(schema());
  assert.equal(parsed.entity.name, "APIClient");
  assert.equal(parsed.entity.plural, "api-clients");
});

test("records the v2 full-stack Vireo ApiError wire contract", () => {
  const contract = createWireContract(parseEntitySchema(schema()));

  assert.equal(
    contract.semantics.errors,
    "Vireo ApiError { status, code, message, errors: field-message map or null, timestamp }; validation failures use code VALIDATION_FAILED",
  );
  assert.equal(
    createWireContract(parseEntitySchema(schema()), "frontend").semantics.errors,
    "The application adapter normalizes backend-specific failures into frontend errors",
  );
});

test("keeps generated 0.3.0 wire contracts valid after correcting the error description", async () => {
  const { root, schemaPath } = await projectFixture();
  await generateEntity({ projectDirectory: root, schemaPath });

  const manifestPath = join(root, ".vireo/generated/api-clients.json");
  const contractPath = join(root, ".vireo/contracts/api-clients.contract.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const contract = {
    schemaVersion: 1,
    entity: "APIClient",
    id: { name: "id", type: "long", wireType: "integer" },
    fields: schema().fields.map(field => ({
      name: field.name,
      type: field.type,
      wireType:
        field.type === "decimal"
          ? "number"
          : field.type === "integer" || field.type === "long"
            ? "integer"
            : field.type === "boolean"
              ? "boolean"
              : "string",
      nullable: field.required !== true,
      ...(field.enumValues ? { enumValues: field.enumValues } : {}),
      ...(field.constraints ? { constraints: field.constraints } : {}),
    })),
    endpoints: {
      search: { method: "POST", path: "/api/api-clients/search", response: "page" },
      create: { method: "POST", path: "/api/api-clients" },
      update: { method: "PUT", path: "/api/api-clients/{id}" },
      delete: { method: "DELETE", path: "/api/api-clients/{id}" },
    },
    semantics: {
      date: "ISO-8601 calendar date",
      decimal: "JSON number; BigDecimal is canonical on the server",
      errors: "Spring ProblemDetail with field violations when validation fails",
      nullability: "optional fields are explicit JSON null; unknown response fields are stripped by Zod",
      timestamp: "ISO-8601 UTC or offset timestamp",
    },
  };
  const previousContract = stableJson(contract);
  manifest.generatorVersion = "0.3.0";
  manifest.contractDigest = sha256(previousContract);
  manifest.files.find(file => file.path === ".vireo/contracts/api-clients.contract.json").sha256 =
    sha256(previousContract);
  await writeFile(contractPath, previousContract);
  await writeFile(manifestPath, stableJson(manifest));

  const [result] = await checkGeneratedEntities(root);
  assert.equal(result.ok, true, result.problems.join("\n"));

  contract.semantics.errors =
    "Vireo ApiError { status, message, errors: field-message map or null, timestamp }; validation failures key errors by field";
  const correctedContract = stableJson(contract);
  manifest.generatorVersion = "0.3.1";
  manifest.contractDigest = sha256(correctedContract);
  manifest.files.find(file => file.path === ".vireo/contracts/api-clients.contract.json").sha256 =
    sha256(correctedContract);
  await writeFile(contractPath, correctedContract);
  await writeFile(manifestPath, stableJson(manifest));
  const [corrected] = await checkGeneratedEntities(root);
  assert.equal(corrected.ok, true, corrected.problems.join("\n"));
});

test("rejects reserved, Unicode, compound-id, and offline shapes explicitly in schema v1", () => {
  for (const value of [
    schema({ entity: { name: "Član", plural: "clanovi" } }),
    schema({ fields: [{ name: "class", type: "string", required: true, query: { searchable: true } }] }),
    schema({ capabilities: { history: true, offline: true, query: true } }),
    { ...schema(), id: { fields: ["tenantId", "number"] } },
  ]) {
    assert.throws(() => parseEntitySchema(value), EntitySchemaError);
  }
});

test("rejects reserved, colliding, and oversized derived SQL identifiers", () => {
  assert.throws(
    () => parseEntitySchema(schema({ database: { table: "user", migrationVersion: 3 } })),
    /reserved H2\/PostgreSQL word user/u,
  );

  const reservedField = schema();
  reservedField.fields[0] = { ...reservedField.fields[0], name: "order" };
  assert.throws(() => parseEntitySchema(reservedField), /reserved H2\/PostgreSQL word order/u);

  const auditCollision = schema();
  auditCollision.fields[0] = { ...auditCollision.fields[0], name: "createdAt" };
  assert.throws(() => parseEntitySchema(auditCollision), /conflicts with the generated created_at audit column/u);

  const conversionCollision = schema();
  conversionCollision.fields = [
    { ...conversionCollision.fields[0], name: "apiClient" },
    { ...conversionCollision.fields[0], name: "apiCLIENT" },
  ];
  assert.throws(() => parseEntitySchema(conversionCollision), /remain unique after lower_snake_case/u);

  assert.throws(
    () =>
      parseEntitySchema(
        schema({
          database: { table: `orders_${"x".repeat(48)}`, migrationVersion: 3 },
        }),
      ),
    /name-derived index exceeds the portable 63-character/u,
  );
});

test("rejects relationship response and SQL-column collisions before target resolution", () => {
  const scalarCollision = schema({
    fields: [
      { name: "customerName", type: "string", required: true, query: { searchable: true } },
      { name: "customerId", type: "long" },
    ],
    relationships: [{ name: "customer", kind: "many-to-one", target: "Customer", displayField: "legalName" }],
  });
  assert.throws(() => parseEntitySchema(scalarCollision), /conflicts with a field/u);

  const relationCollision = schema({
    relationships: [
      { name: "apiClient", kind: "many-to-one", target: "Customer", displayField: "legalName" },
      { name: "apiCLIENT", kind: "many-to-one", target: "Customer", displayField: "legalName" },
    ],
  });
  assert.throws(() => parseEntitySchema(relationCollision), /lower_snake_case SQL conversion/u);
});

test("rejects nested field values that disagree with their declared type", () => {
  const invalid = schema();
  invalid.fields[0] = {
    ...invalid.fields[0],
    default: false,
    constraints: { ...invalid.fields[0].constraints, unexpected: 1 },
    query: { ...invalid.fields[0].query, searchable: "yes", unexpected: true },
    ui: { control: "bogus", list: "yes", label: false, unexpected: true },
  };
  invalid.fields[1] = {
    ...invalid.fields[1],
    constraints: { ...invalid.fields[1].constraints, pattern: "^[0-9]+$" },
  };

  assert.throws(
    () => parseEntitySchema(invalid),
    error => {
      assert.ok(error instanceof EntitySchemaError);
      assert.match(error.message, /fields\[0\]\.default must be a string/u);
      assert.match(error.message, /fields\[0\]\.constraints\.unexpected is not supported/u);
      assert.match(error.message, /fields\[0\]\.query\.searchable must be a boolean/u);
      assert.match(error.message, /fields\[0\]\.query\.unexpected is not supported/u);
      assert.match(error.message, /fields\[0\]\.ui\.control is incompatible/u);
      assert.match(error.message, /fields\[0\]\.ui\.list must be a boolean/u);
      assert.match(error.message, /fields\[0\]\.ui\.label must be a string/u);
      assert.match(error.message, /fields\[0\]\.ui\.unexpected is not supported/u);
      assert.match(error.message, /fields\[1\]\.constraints\.pattern is valid only/u);
      return true;
    },
  );
});

test("requires constraint-valid examples for patterned fields", () => {
  const missingExample = schema();
  missingExample.fields[0] = {
    ...missingExample.fields[0],
    constraints: { min: 3, max: 6, pattern: "^PO-[0-9]{3}$" },
  };
  assert.throws(() => parseEntitySchema(missingExample), /example is required/u);

  const invalidExample = structuredClone(missingExample);
  invalidExample.fields[0].example = "EXAMPLE";
  assert.throws(() => parseEntitySchema(invalidExample), /example does not match constraints\.pattern/u);

  const validExample = structuredClone(missingExample);
  validExample.fields[0].example = "PO-123";
  assert.equal(parseEntitySchema(validExample).fields[0].example, "PO-123");
});

test("checks admitted 0.2 manifests without reparsing their historical schema", async () => {
  const fixture = await legacyGeneratorFixture();
  assert.deepEqual(await checkGeneratedEntities(fixture.root), [{ entity: "APIClient", ok: true, problems: [] }]);

  const mutations = [
    async ({ schemaArtifact }) => {
      const value = JSON.parse(await readFile(schemaArtifact, "utf8"));
      value.entity.description = "Changed legacy schema";
      await writeFile(schemaArtifact, stableJson(value));
    },
    async ({ root }) => {
      const path = join(root, ".vireo/contracts/api-clients.contract.json");
      const value = JSON.parse(await readFile(path, "utf8"));
      value.entity = "ChangedContract";
      await writeFile(path, stableJson(value));
    },
    async ({ root, manifest }) => {
      const critical = manifest.files.find(file => file.path.includes("/models/"));
      const path = join(root, critical.path);
      await writeFile(path, `${await readFile(path, "utf8")}\n// changed\n`);
    },
  ];
  for (const mutate of mutations) {
    const mutationFixture = await legacyGeneratorFixture();
    await mutate(mutationFixture);
    assert.equal((await checkGeneratedEntities(mutationFixture.root))[0].ok, false);
  }
});

test("rejects unknown generator versions in persisted manifests", async () => {
  const { root, manifestPath } = await legacyGeneratorFixture();
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.generatorVersion = "0.2.1";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const [result] = await checkGeneratedEntities(root);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /unsupported generator version/u);
});

test("collects malformed patterns without evaluating them against examples", () => {
  const invalidPattern = schema();
  invalidPattern.fields[0] = {
    ...invalidPattern.fields[0],
    example: "PO-123",
    constraints: { pattern: "[" },
  };
  assert.throws(() => parseEntitySchema(invalidPattern), /pattern must be a valid regular expression/u);
});

test("rejects impossible required string fixture constraints", () => {
  const impossible = schema();
  impossible.fields[0] = {
    ...impossible.fields[0],
    required: true,
    constraints: { max: 0 },
  };
  assert.throws(() => parseEntitySchema(impossible), /max must be at least 1/u);
});

test("dry run is non-writing and output mode renders a deterministic review tree", async () => {
  const { root, schemaPath } = await projectFixture();
  const dry = await generateEntity({ projectDirectory: root, schemaPath, dryRun: true });
  assert.equal(dry.dryRun, true);
  await assert.rejects(stat(join(root, "src/main/java/dev/example/fixture/app/aPIClient/APIClient.java")), /ENOENT/u);

  const output = join(root, "review");
  const first = await generateEntity({ projectDirectory: root, schemaPath, outputDirectory: output });
  const source = await readFile(join(output, "src/main/java/dev/example/fixture/app/apiclient/APIClient.java"), "utf8");
  assert.match(source, /class APIClient extends BaseEntity/u);
  const second = await generateEntity({ projectDirectory: root, schemaPath, outputDirectory: output });
  assert.ok(second.files.every(file => file.status === "unchanged"));
  assert.equal(first.schemaDigest, second.schemaDigest);
});

test("generated pages import only controls used by the schema", async () => {
  const { root, schemaPath } = await projectFixture();
  await writeFile(
    schemaPath,
    JSON.stringify(
      schema({
        fields: [
          {
            name: "displayName",
            type: "string",
            required: true,
            query: { filterable: true, searchable: true, sortable: true },
          },
        ],
      }),
    ),
  );

  await generateEntity({ projectDirectory: root, schemaPath });
  const page = await readFile(join(root, "frontend/src/generated/api-clients/pages/AppPageApiClients.tsx"), "utf8");
  assert.match(page, /import \{ useAppPreferences \} from "@\/app\/ui\/preferences\/hooks\/useAppPreferences"/u);
  assert.match(page, /const \{ preferences \} = useAppPreferences\(\)/u);
  assert.doesNotMatch(page, /sigAppPreferences/u);
  assert.doesNotMatch(page, /\bCheckbox\b/u);
  assert.doesNotMatch(page, /\bFormControlLabel\b/u);
  assert.doesNotMatch(page, /\bMenuItem\b/u);
});

test("generated fixtures respect declared string length constraints", async () => {
  const { root, schemaPath } = await projectFixture();
  await writeFile(
    schemaPath,
    JSON.stringify(
      schema({
        fields: [
          {
            name: "countryCode",
            type: "string",
            required: true,
            constraints: { min: 2, max: 6 },
            query: { searchable: true },
          },
        ],
      }),
    ),
  );

  await generateEntity({ projectDirectory: root, schemaPath });
  const frontendTest = await readFile(
    join(root, "frontend/tests/contract/generated/aPIClient.wire-contract.test.ts"),
    "utf8",
  );
  assert.match(frontendTest, /countryCode: "XX"/u);
  assert.doesNotMatch(frontendTest, /EXAMPLE/u);
});

test("generated create schemas match Java optionality and nonblank string validation", async () => {
  const { root, schemaPath } = await projectFixture();
  await generateEntity({ projectDirectory: root, schemaPath });

  const model = await readFile(join(root, "frontend/src/generated/api-clients/models/APIClient.ts"), "utf8");
  const createSchema = model.match(/CreateRequestSchema = z\.object\(\{([\s\S]*?)\n\}\);/u)?.[1] ?? "";
  assert.match(
    createSchema,
    /displayName:\s+z[\s\S]*?\.string\(\)[\s\S]*?\.min\(2\)[\s\S]*?\.max\(120\)[\s\S]*?\.refine\(\(value\) => value\.trim\(\)\.length > 0\),/u,
  );
  assert.match(createSchema, /reviewedAt: z\.iso\.datetime\(\{ offset: true \}\)\.nullable\(\)\.optional\(\),/u);
});

test("generates target-first many-to-one create, patch, response, and query contracts", async () => {
  const { root } = await projectFixture();
  const customerPath = join(root, "customer.entity.json");
  const purchaseOrderPath = join(root, "purchase-order.entity.json");
  const [customerFixture, purchaseOrderFixture] = await Promise.all([
    readFile(new URL("../fixtures/customer.entity.json", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/purchase-order.relationship.entity.json", import.meta.url), "utf8"),
  ]);
  await writeFile(customerPath, customerFixture);
  await generateEntity({ projectDirectory: root, schemaPath: customerPath });
  await writeFile(purchaseOrderPath, purchaseOrderFixture);
  await generateEntity({ projectDirectory: root, schemaPath: purchaseOrderPath });

  const javaRoot = join(root, "src/main/java/dev/example/fixture/app/purchaseorder");
  const entity = await readFile(join(javaRoot, "PurchaseOrder.java"), "utf8");
  const create = await readFile(join(javaRoot, "PurchaseOrderCreateRequest.java"), "utf8");
  const patch = await readFile(join(javaRoot, "PurchaseOrderPatchRequest.java"), "utf8");
  const mapper = await readFile(join(javaRoot, "PurchaseOrderMapper.java"), "utf8");
  const service = await readFile(join(javaRoot, "PurchaseOrderService.java"), "utf8");
  const response = await readFile(join(javaRoot, "PurchaseOrderResponse.java"), "utf8");
  const controller = await readFile(join(javaRoot, "PurchaseOrderController.java"), "utf8");
  const repository = await readFile(join(javaRoot, "PurchaseOrderRepository.java"), "utf8");
  const model = await readFile(join(root, "frontend/src/generated/purchase-orders/models/PurchaseOrder.ts"), "utf8");
  const api = await readFile(join(root, "frontend/src/generated/purchase-orders/api/purchaseOrder.api.ts"), "utf8");
  const migration = await readFile(join(root, "src/main/resources/db/migration/V4__create_purchase_order.sql"), "utf8");
  const backendTest = await readFile(
    join(root, "src/test/java/dev/example/fixture/app/purchaseorder/PurchaseOrderApiIntegrationTest.java"),
    "utf8",
  );
  const contract = JSON.parse(await readFile(join(root, ".vireo/contracts/purchase-orders.contract.json"), "utf8"));

  assert.match(entity, /@ManyToOne\(fetch = FetchType\.LAZY\)/u);
  assert.match(entity, /relationSelectionLabelFields = \{ "legalName" \}/u);
  assert.match(create, /@NotNull Long customerId/u);
  assert.match(patch, /JsonNullable<@NotNull Long> customerId/u);
  assert.match(mapper, /@BeanMapping\(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy\.IGNORE\)/u);
  assert.match(service, /customerRepository\.findById\(id\)[\s\S]*\.filter\(target -> !target\.isDeleted\(\)\)/u);
  assert.doesNotMatch(service, /customerRepository\.findByIdAndDeletedFalse/u);
  assert.match(response, /Long customerId[\s\S]*String customerName/u);
  assert.match(controller, /@PatchMapping\("\/\{id\}"\)/u);
  assert.match(controller, /@Valid @RequestBody PurchaseOrderPatchRequest/u);
  assert.match(repository, /Optional<PurchaseOrder> findWithRelationsByIdAndDeletedFalse\(Long id\);/u);
  assert.equal(
    (repository.match(/\{/gu) ?? []).length,
    (repository.match(/\}/gu) ?? []).length,
    "generated Repository.java must have balanced braces",
  );
  assert.match(model, /export type PurchaseOrderCreateRequest/u);
  assert.match(model, /export type PurchaseOrderPatchRequest/u);
  assert.match(api, /httpPatch/u);
  assert.match(api, /PurchaseOrderPatchRequestSchema\.parse/u);
  assert.match(migration, /customer_id BIGINT NOT NULL REFERENCES customer\(id\)/u);
  assert.match(backendTest, /seedRelationTargets/u);
  assert.match(backendTest, /customerRepository\.saveAndFlush/u);
  assert.match(backendTest, /\.formatted\(customerId\)/u);
  assert.equal(contract.schemaVersion, 2);
  assert.deepEqual(contract.relationships[0].responseDisplay, {
    name: "customerName",
    source: "Customer.legalName",
    wireType: "string",
    nullable: false,
  });
});

test("generated create schemas allow omitted optional relationship IDs", async () => {
  const { root } = await projectFixture();
  const customerPath = join(root, "customer.entity.json");
  const purchaseOrderPath = join(root, "purchase-order.entity.json");
  await writeFile(customerPath, await readFile(new URL("../fixtures/customer.entity.json", import.meta.url), "utf8"));
  await generateEntity({ projectDirectory: root, schemaPath: customerPath });
  const purchaseOrder = JSON.parse(
    await readFile(new URL("../fixtures/purchase-order.relationship.entity.json", import.meta.url), "utf8"),
  );
  purchaseOrder.relationships[0].required = false;
  await writeFile(purchaseOrderPath, JSON.stringify(purchaseOrder));
  await generateEntity({ projectDirectory: root, schemaPath: purchaseOrderPath });

  const model = await readFile(join(root, "frontend/src/generated/purchase-orders/models/PurchaseOrder.ts"), "utf8");
  const createSchema = model.match(/CreateRequestSchema = z\.object\(\{([\s\S]*?)\n\}\);/u)?.[1] ?? "";
  assert.match(createSchema, /customerId: z\.number\(\)\.int\(\)\.positive\(\)\.nullable\(\)\.optional\(\),/u);
});

test("fails closed for unsupported relationship targets and ordering", async () => {
  const frontend = await frontendProjectFixture();
  const frontendSchema = schema({
    relationships: [{ name: "customer", kind: "many-to-one", target: "Customer", displayField: "legalName" }],
  });
  await writeFile(frontend.schemaPath, JSON.stringify(frontendSchema));
  await assert.rejects(
    generateEntity({ projectDirectory: frontend.root, schemaPath: frontend.schemaPath }),
    /managed full-stack target/u,
  );

  const self = await projectFixture();
  const selfSchema = schema({
    relationships: [{ name: "owner", kind: "many-to-one", target: "APIClient", displayField: "displayName" }],
  });
  await writeFile(self.schemaPath, JSON.stringify(selfSchema));
  await assert.rejects(generateEntity({ projectDirectory: self.root, schemaPath: self.schemaPath }), /own entity/u);

  const { root } = await projectFixture();
  const customerPath = join(root, "customer.entity.json");
  const sourcePath = join(root, "source.entity.json");
  await writeFile(customerPath, await readFile(new URL("../fixtures/customer.entity.json", import.meta.url), "utf8"));
  await generateEntity({ projectDirectory: root, schemaPath: customerPath });
  const invalidDisplay = JSON.parse(
    await readFile(new URL("../fixtures/purchase-order.relationship.entity.json", import.meta.url), "utf8"),
  );
  invalidDisplay.relationships[0].displayField = "missing";
  await writeFile(sourcePath, JSON.stringify(invalidDisplay));
  await assert.rejects(generateEntity({ projectDirectory: root, schemaPath: sourcePath }), /string or text field/u);
  invalidDisplay.relationships[0].displayField = "legalName";
  invalidDisplay.database.migrationVersion = 3;
  await writeFile(sourcePath, JSON.stringify(invalidDisplay));
  await assert.rejects(generateEntity({ projectDirectory: root, schemaPath: sourcePath }), /greater than target/u);

  invalidDisplay.database.migrationVersion = 4;
  await writeFile(sourcePath, JSON.stringify(invalidDisplay));
  const customerEntity = join(root, "src/main/java/dev/example/fixture/app/customer/Customer.java");
  await writeFile(customerEntity, `${await readFile(customerEntity, "utf8")}\n// customized\n`);
  await assert.rejects(generateEntity({ projectDirectory: root, schemaPath: sourcePath }), /stale or customized/u);

  const ambiguous = await projectFixture();
  await writeFile(
    customerPath.replace(root, ambiguous.root),
    await readFile(new URL("../fixtures/customer.entity.json", import.meta.url), "utf8"),
  );
  await generateEntity({ projectDirectory: ambiguous.root, schemaPath: customerPath.replace(root, ambiguous.root) });
  const customerManifest = await readFile(join(ambiguous.root, ".vireo/generated/customers.json"), "utf8");
  await writeFile(join(ambiguous.root, ".vireo/generated/customer-alias.json"), customerManifest);
  await writeFile(
    sourcePath.replace(root, ambiguous.root),
    JSON.stringify({ ...invalidDisplay, database: { ...invalidDisplay.database, migrationVersion: 4 } }),
  );
  await assert.rejects(
    generateEntity({ projectDirectory: ambiguous.root, schemaPath: sourcePath.replace(root, ambiguous.root) }),
    /exactly one previously generated/u,
  );
});

test("relationship generation rejects frozen 0.2 targets that use the legacy schema grammar", async () => {
  const legacy = await legacyGeneratorFixture();
  const sourcePath = join(legacy.root, "purchase-order.entity.json");
  await writeFile(
    sourcePath,
    JSON.stringify(
      schema({
        entity: { name: "PurchaseOrder", plural: "purchase-orders" },
        database: { table: "purchase_order", migrationVersion: 4 },
        api: { path: "/api/purchase-orders" },
        fields: [{ name: "number", type: "string", required: true, query: { searchable: true } }],
        relationships: [
          {
            name: "customer",
            kind: "many-to-one",
            target: "APIClient",
            required: false,
            displayField: "displayName",
          },
        ],
      }),
    ),
  );

  await assert.rejects(
    generateEntity({ projectDirectory: legacy.root, schemaPath: sourcePath }),
    /unsupported generator version "0\.2\.0"/u,
  );
});

test("generated full-stack and frontend stories use deterministic in-memory adapters", async () => {
  const fixtures = [
    { ...(await projectFixture()), storyRoot: "frontend/src/generated" },
    { ...(await frontendProjectFixture()), storyRoot: "src/generated" },
  ];

  for (const fixture of fixtures) {
    await generateEntity({ projectDirectory: fixture.root, schemaPath: fixture.schemaPath });
    const story = await readFile(
      join(fixture.root, fixture.storyRoot, "api-clients/storybook/AppPageApiClients.stories.tsx"),
      "utf8",
    );
    assert.match(story, /import \{ expect, waitFor, within \} from "storybook\/test"/u);
    assert.match(story, /configureAPIClientApi\(storyApi\)/u);
    assert.match(story, /const storyApi: APIClientApi/u);
    assert.match(story, /content: \[storySample\]/u);
    assert.match(story, /storySearchCalls \+= 1/u);
    assert.match(story, /play: async \(\{ canvasElement \}\)/u);
    assert.match(story, /expect\(storySearchCalls\)\.toBeGreaterThan\(0\)/u);
    assert.match(story, /canvas\.findAllByText\("XX"\)/u);
    assert.match(story, /expect\(displayed\.length\)\.toBeGreaterThan\(0\)/u);
    assert.doesNotMatch(story, /HttpApi|postAppPagedSearch|["']\/api\//u);
  }
});

test("generation is idempotent, detects wire drift, refuses customization, and ejects without deleting code", async () => {
  const { root, schemaPath } = await projectFixture();
  const first = await generateEntity({ projectDirectory: root, schemaPath });
  assert.ok(first.files.some(file => file.status === "create"));
  const second = await generateEntity({ projectDirectory: root, schemaPath });
  assert.ok(second.files.every(file => file.status === "unchanged"));

  const model = join(root, "frontend/src/generated/api-clients/models/APIClient.ts");
  await writeFile(model, `${await readFile(model, "utf8")}\n// deliberate contract drift\n`);
  const checks = await checkGeneratedEntities(root);
  assert.equal(checks[0].ok, false);
  assert.match(checks[0].problems.join("\n"), /contract drift/u);
  await assert.rejects(generateEntity({ projectDirectory: root, schemaPath }), /VIR-GEN-005/u);

  const ejected = await ejectEntity(root, "api-clients");
  assert.ok(ejected.retainedFiles.length > 10);
  assert.match(await readFile(model, "utf8"), /@vireo-ejected/u);
  assert.equal(
    await readFile(join(root, "frontend/src/generated/vireo.capabilities.ts"), "utf8"),
    "// @vireo-regenerated schema-v1 -- do not customize; run vireo eject first.\n\nexport const VIREO_GENERATED_CAPABILITIES = [] as const;\n",
  );
  await stat(model);
  assert.deepEqual(await checkGeneratedEntities(root), []);
});

test("ejection refuses a symlinked managed manifest without writing outside the project", async () => {
  const { root, schemaPath } = await projectFixture();
  const outsideRoot = await mkdtemp(join(tmpdir(), "vireo-entity-outside-"));
  const outsideManifest = join(outsideRoot, "api-clients.json");
  try {
    await generateEntity({ projectDirectory: root, schemaPath });
    await writeFile(outsideManifest, "outside bytes\n");
    const managedManifest = join(root, ".vireo/generated/api-clients.json");
    await rm(managedManifest);
    await symlink(outsideManifest, managedManifest);
    await assert.rejects(ejectEntity(root, "api-clients"), /symbolic link/u);
    assert.equal(await readFile(outsideManifest, "utf8"), "outside bytes\n");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("unmanaged collisions require both force and explicit overwrite acceptance", async () => {
  const { root, schemaPath } = await projectFixture();
  const collision = join(root, "frontend/src/generated/api-clients/models/APIClient.ts");
  await mkdir(join(root, "frontend/src/generated/api-clients/models"), { recursive: true });
  await writeFile(collision, "user-owned\n");
  await assert.rejects(generateEntity({ projectDirectory: root, schemaPath }), /VIR-GEN-003/u);
  await assert.rejects(
    generateEntity({ projectDirectory: root, schemaPath, acceptOverwrite: true }),
    /--accept-overwrite is valid only together with --force/u,
  );
  await generateEntity({ projectDirectory: root, schemaPath, force: true, acceptOverwrite: true });
  assert.match(await readFile(collision, "utf8"), /APIClientTransportSchema/u);
});

test("frontend projects generate, check, and eject only root-level TypeScript capabilities", async () => {
  const { root, schemaPath } = await frontendProjectFixture();
  const generated = await generateEntity({ projectDirectory: root, schemaPath });

  assert.equal(generated.target, "frontend");
  assert.ok(generated.files.some(file => file.path === "src/generated/api-clients/models/APIClient.ts"));
  assert.ok(generated.files.every(file => !file.path.endsWith(".java") && !file.path.includes("db/migration")));
  const api = await readFile(join(root, "src/generated/api-clients/api/aPIClient.api.ts"), "utf8");
  assert.match(api, /export interface APIClientApi/u);
  assert.match(api, /configureAPIClientApi/u);
  assert.deepEqual(await checkGeneratedEntities(root), [{ entity: "APIClient", ok: true, problems: [] }]);

  await ejectEntity(root, "api-clients");
  assert.match(await readFile(join(root, "src/generated/api-clients/models/APIClient.ts"), "utf8"), /@vireo-ejected/u);
  assert.equal(
    await readFile(join(root, "src/generated/vireo.capabilities.ts"), "utf8"),
    "// @vireo-regenerated schema-v1 -- do not customize; run vireo eject first.\n\nexport const VIREO_GENERATED_CAPABILITIES = [] as const;\n",
  );
  assert.deepEqual(await checkGeneratedEntities(root), []);
});

test("a full-stack project may explicitly generate a frontend-only capability", async () => {
  const { root, schemaPath } = await projectFixture();
  const generated = await generateEntity({ projectDirectory: root, schemaPath, target: "frontend" });
  assert.equal(generated.target, "frontend");
  assert.ok(generated.files.some(file => file.path.startsWith("frontend/src/generated/")));
  assert.ok(generated.files.every(file => !file.path.endsWith(".java") && !file.path.includes("db/migration")));
});
