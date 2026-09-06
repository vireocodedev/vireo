import { readFile } from "node:fs/promises";

export const VIREO_ENTITY_SCHEMA_VERSION = 1 as const;

export type EntityFieldType =
  "boolean" | "date" | "decimal" | "enum" | "integer" | "long" | "string" | "text" | "timestamp" | "uuid";

export type EntityFieldSchema = {
  name: string;
  type: EntityFieldType;
  required?: boolean;
  unique?: boolean;
  default?: boolean | number | string;
  example?: boolean | number | string;
  enumValues?: string[];
  constraints?: {
    max?: number;
    min?: number;
    pattern?: string;
  };
  query?: {
    filterable?: boolean;
    searchable?: boolean;
    sortable?: boolean;
  };
  ui?: {
    control?: "checkbox" | "date" | "number" | "select" | "text" | "textarea";
    list?: boolean;
    label?: string;
  };
};

export type EntityRelationshipSchema = {
  name: string;
  kind: "many-to-one";
  target: string;
  required?: boolean;
  displayField: string;
};

export type VireoEntitySchema = {
  schemaVersion: typeof VIREO_ENTITY_SCHEMA_VERSION;
  kind: "entity";
  entity: {
    name: string;
    plural: string;
    description?: string;
  };
  database: {
    table: string;
    migrationVersion: number;
  };
  api: {
    path: string;
  };
  permissions: {
    read: string;
    manage: string;
  };
  capabilities: {
    history: boolean;
    offline: boolean;
    query: boolean;
  };
  fields: EntityFieldSchema[];
  relationships?: EntityRelationshipSchema[];
  localization: {
    en: {
      singular: string;
      plural: string;
    };
    hr?: {
      singular: string;
      plural: string;
    };
  };
};

export class EntitySchemaError extends Error {
  readonly code = "VIR-GEN-001";

  constructor(readonly problems: string[]) {
    super(`Invalid Vireo entity schema:\n- ${problems.join("\n- ")}`);
    this.name = "EntitySchemaError";
  }
}

const FIELD_TYPES = new Set<EntityFieldType>([
  "boolean",
  "date",
  "decimal",
  "enum",
  "integer",
  "long",
  "string",
  "text",
  "timestamp",
  "uuid",
]);
const STRING_LENGTH_TYPES = new Set<EntityFieldType>(["string", "text"]);
const NUMERIC_TYPES = new Set<EntityFieldType>(["decimal", "integer", "long"]);
const UI_CONTROLS_BY_TYPE: Record<EntityFieldType, ReadonlySet<string>> = {
  boolean: new Set(["checkbox"]),
  date: new Set(["date", "text"]),
  decimal: new Set(["number", "text"]),
  enum: new Set(["select"]),
  integer: new Set(["number", "text"]),
  long: new Set(["number", "text"]),
  string: new Set(["text", "textarea"]),
  text: new Set(["text", "textarea"]),
  timestamp: new Set(["text"]),
  uuid: new Set(["text"]),
};
const RESERVED_TYPESCRIPT_NAMES = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
const RESERVED_JAVA_NAMES = new Set([
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "goto",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "void",
  "volatile",
  "while",
]);
const PORTABLE_SQL_IDENTIFIER_MAX_LENGTH = 63;
const PORTABLE_SQL_RESERVED_WORDS = new Set([
  "all",
  "and",
  "any",
  "array",
  "as",
  "authorization",
  "between",
  "both",
  "case",
  "cast",
  "check",
  "column",
  "constraint",
  "create",
  "cross",
  "current_date",
  "current_role",
  "current_schema",
  "current_time",
  "current_timestamp",
  "current_user",
  "default",
  "distinct",
  "else",
  "end",
  "except",
  "exists",
  "false",
  "fetch",
  "for",
  "foreign",
  "from",
  "full",
  "grant",
  "group",
  "having",
  "in",
  "inner",
  "intersect",
  "into",
  "is",
  "join",
  "key",
  "leading",
  "left",
  "like",
  "limit",
  "localtime",
  "localtimestamp",
  "natural",
  "not",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "primary",
  "references",
  "returning",
  "right",
  "row",
  "select",
  "session_user",
  "set",
  "some",
  "table",
  "then",
  "to",
  "true",
  "union",
  "unique",
  "user",
  "using",
  "value",
  "values",
  "when",
  "where",
  "window",
  "with",
]);
const GENERATED_AUDIT_COLUMNS = new Set([
  "created_at",
  "modified_at",
  "created_by",
  "modified_by",
  "keywords",
  "deleted",
]);
const RESERVED_RELATIONSHIP_NAMES = new Set(["id"]);

export function entityFieldSqlName(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLocaleLowerCase("en-US");
}

function validateSqlIdentifier(value: string, path: string, problems: string[]) {
  if (value.length > PORTABLE_SQL_IDENTIFIER_MAX_LENGTH)
    problems.push(`${path} exceeds the portable ${PORTABLE_SQL_IDENTIFIER_MAX_LENGTH}-character SQL identifier limit`);
  if (PORTABLE_SQL_RESERVED_WORDS.has(value)) problems.push(`${path} uses the reserved H2/PostgreSQL word ${value}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredObject(parent: Record<string, unknown>, key: string, problems: string[]) {
  const value = parent[key];
  if (!isObject(value)) {
    problems.push(`${key} must be an object`);
    return {};
  }
  return value;
}

function requiredString(parent: Record<string, unknown>, key: string, path: string, problems: string[]) {
  const value = parent[key];
  if (typeof value !== "string" || !value.trim()) {
    problems.push(`${path}.${key} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function requiredBoolean(parent: Record<string, unknown>, key: string, path: string, problems: string[]) {
  const value = parent[key];
  if (typeof value !== "boolean") {
    problems.push(`${path}.${key} must be a boolean`);
    return false;
  }
  return value;
}

function rejectUnknown(parent: Record<string, unknown>, allowed: readonly string[], path: string, problems: string[]) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(parent)) {
    if (!accepted.has(key)) problems.push(`${path ? `${path}.` : ""}${key} is not supported by schema v1`);
  }
}

function validJavaIdentifier(value: string) {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(value) && !RESERVED_JAVA_NAMES.has(value);
}

function validFieldIdentifier(value: string) {
  return /^[a-z][A-Za-z0-9]*$/u.test(value) && !RESERVED_TYPESCRIPT_NAMES.has(value) && !RESERVED_JAVA_NAMES.has(value);
}

function validateFieldLiteral(field: EntityFieldSchema, key: "default" | "example", path: string, problems: string[]) {
  const value = field[key];
  if (value === undefined) return;
  const valuePath = `${path}.${key}`;

  if (field.type === "boolean" && typeof value !== "boolean")
    problems.push(`${valuePath} must be a boolean for a boolean field`);
  else if (NUMERIC_TYPES.has(field.type) && (typeof value !== "number" || !Number.isFinite(value)))
    problems.push(`${valuePath} must be a finite number for a ${field.type} field`);
  else if (!NUMERIC_TYPES.has(field.type) && field.type !== "boolean" && typeof value !== "string")
    problems.push(`${valuePath} must be a string for a ${field.type} field`);

  if ((field.type === "integer" || field.type === "long") && !Number.isSafeInteger(value))
    problems.push(`${valuePath} must be a safe integer for a ${field.type} field`);
  if (field.type === "enum" && typeof value === "string" && !field.enumValues?.includes(value))
    problems.push(`${valuePath} must be one of the declared enumValues`);
  if (field.type === "date" && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    problems.push(`${valuePath} must use YYYY-MM-DD for a date field`);
  if (
    field.type === "uuid" &&
    typeof value === "string" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  )
    problems.push(`${valuePath} must be a canonical UUID for a uuid field`);

  if (typeof value === "string") {
    if (field.constraints?.min !== undefined && value.length < field.constraints.min)
      problems.push(`${valuePath} is shorter than constraints.min`);
    if (field.constraints?.max !== undefined && value.length > field.constraints.max)
      problems.push(`${valuePath} is longer than constraints.max`);
    if (field.constraints?.pattern) {
      try {
        if (!new RegExp(field.constraints.pattern, "u").test(value))
          problems.push(`${valuePath} does not match constraints.pattern`);
      } catch {
        // The constraint validator reports the malformed expression once.
      }
    }
  }
  if (typeof value === "number") {
    if (field.constraints?.min !== undefined && value < field.constraints.min)
      problems.push(`${valuePath} is below constraints.min`);
    if (field.constraints?.max !== undefined && value > field.constraints.max)
      problems.push(`${valuePath} exceeds constraints.max`);
  }
}

function validateField(value: unknown, index: number, problems: string[]): EntityFieldSchema | null {
  const path = `fields[${index}]`;
  if (!isObject(value)) {
    problems.push(`${path} must be an object`);
    return null;
  }
  rejectUnknown(
    value,
    ["name", "type", "required", "unique", "default", "example", "enumValues", "constraints", "query", "ui"],
    path,
    problems,
  );
  const name = requiredString(value, "name", path, problems);
  const type = requiredString(value, "type", path, problems) as EntityFieldType;
  if (name && !validFieldIdentifier(name))
    problems.push(`${path}.name must be a portable lower-camel Java/TypeScript identifier`);
  if (!FIELD_TYPES.has(type)) problems.push(`${path}.type is unsupported: ${type}`);
  if (name === "id") problems.push(`${path}.name is reserved because Vireo supplies the Long id`);
  if (type === "enum") {
    if (!Array.isArray(value.enumValues) || value.enumValues.length < 2)
      problems.push(`${path}.enumValues must contain at least two values for an enum field`);
    else {
      const values = value.enumValues.filter(item => typeof item === "string") as string[];
      if (values.length !== value.enumValues.length || values.some(item => !/^[A-Z][A-Z0-9_]*$/u.test(item)))
        problems.push(`${path}.enumValues must use portable UPPER_SNAKE_CASE identifiers`);
      if (new Set(values).size !== values.length) problems.push(`${path}.enumValues must be unique`);
    }
  } else if (value.enumValues !== undefined) problems.push(`${path}.enumValues is valid only when type is enum`);
  if (value.required !== undefined && typeof value.required !== "boolean")
    problems.push(`${path}.required must be a boolean`);
  if (value.unique !== undefined && typeof value.unique !== "boolean")
    problems.push(`${path}.unique must be a boolean`);
  if (value.constraints !== undefined && !isObject(value.constraints))
    problems.push(`${path}.constraints must be an object`);
  const constraints = isObject(value.constraints) ? value.constraints : undefined;
  if (constraints) {
    rejectUnknown(constraints, ["min", "max", "pattern"], `${path}.constraints`, problems);
    for (const key of ["min", "max"] as const) {
      const constraint = constraints[key];
      if (constraint !== undefined && (typeof constraint !== "number" || !Number.isFinite(constraint)))
        problems.push(`${path}.constraints.${key} must be a finite number`);
      else if (constraint !== undefined && STRING_LENGTH_TYPES.has(type) && !Number.isSafeInteger(constraint))
        problems.push(`${path}.constraints.${key} must be an integer length for a ${type} field`);
      else if (constraint !== undefined && STRING_LENGTH_TYPES.has(type) && constraint < 0)
        problems.push(`${path}.constraints.${key} cannot be negative for a ${type} field`);
      else if (constraint !== undefined && (type === "integer" || type === "long") && !Number.isSafeInteger(constraint))
        problems.push(`${path}.constraints.${key} must be a safe integer for a ${type} field`);
      else if (constraint !== undefined && !STRING_LENGTH_TYPES.has(type) && !NUMERIC_TYPES.has(type))
        problems.push(`${path}.constraints.${key} is valid only for string, text, or numeric fields`);
    }
    if (typeof constraints.min === "number" && typeof constraints.max === "number" && constraints.min > constraints.max)
      problems.push(`${path}.constraints.min cannot exceed max`);
    if (value.required === true && STRING_LENGTH_TYPES.has(type) && constraints.max === 0)
      problems.push(`${path}.constraints.max must be at least 1 for a required ${type} field`);
    if (constraints.pattern !== undefined) {
      if (typeof constraints.pattern !== "string") problems.push(`${path}.constraints.pattern must be a string`);
      else if (!STRING_LENGTH_TYPES.has(type))
        problems.push(`${path}.constraints.pattern is valid only for string or text fields`);
      else {
        try {
          new RegExp(constraints.pattern, "u");
        } catch {
          problems.push(`${path}.constraints.pattern must be a valid regular expression`);
        }
      }
    }
  }
  if (value.query !== undefined && !isObject(value.query)) problems.push(`${path}.query must be an object`);
  const query = isObject(value.query) ? value.query : undefined;
  if (query) {
    rejectUnknown(query, ["filterable", "searchable", "sortable"], `${path}.query`, problems);
    for (const key of ["filterable", "searchable", "sortable"] as const) {
      if (query[key] !== undefined && typeof query[key] !== "boolean")
        problems.push(`${path}.query.${key} must be a boolean`);
    }
  }
  if (value.ui !== undefined && !isObject(value.ui)) problems.push(`${path}.ui must be an object`);
  const ui = isObject(value.ui) ? value.ui : undefined;
  if (ui) {
    rejectUnknown(ui, ["control", "list", "label"], `${path}.ui`, problems);
    if (ui.control !== undefined) {
      if (typeof ui.control !== "string" || !FIELD_TYPES.has(type) || !UI_CONTROLS_BY_TYPE[type].has(ui.control))
        problems.push(`${path}.ui.control is incompatible with field type ${type}`);
    }
    if (ui.list !== undefined && typeof ui.list !== "boolean") problems.push(`${path}.ui.list must be a boolean`);
    if (ui.label !== undefined && typeof ui.label !== "string") problems.push(`${path}.ui.label must be a string`);
  }
  const field = value as EntityFieldSchema;
  if (field.constraints?.pattern && field.example === undefined && field.default === undefined)
    problems.push(`${path}.example is required when constraints.pattern is declared`);
  validateFieldLiteral(field, "default", path, problems);
  validateFieldLiteral(field, "example", path, problems);
  return field;
}

function validateRelationship(value: unknown, index: number, problems: string[]): EntityRelationshipSchema | null {
  const path = `relationships[${index}]`;
  if (!isObject(value)) {
    problems.push(`${path} must be an object`);
    return null;
  }
  rejectUnknown(value, ["name", "kind", "target", "required", "displayField"], path, problems);
  const name = requiredString(value, "name", path, problems);
  const kind = requiredString(value, "kind", path, problems);
  const target = requiredString(value, "target", path, problems);
  const displayField = requiredString(value, "displayField", path, problems);
  if (name && !validFieldIdentifier(name))
    problems.push(`${path}.name must be a portable lower-camel Java/TypeScript identifier`);
  if (RESERVED_RELATIONSHIP_NAMES.has(name)) problems.push(`${path}.name is reserved`);
  if (kind !== "many-to-one") problems.push(`${path}.kind must be "many-to-one"`);
  if (target && (!/^[A-Z][A-Za-z0-9]*$/u.test(target) || !validJavaIdentifier(target)))
    problems.push(`${path}.target must be a portable UpperCamelCase Java/TypeScript identifier`);
  if (displayField && !validFieldIdentifier(displayField))
    problems.push(`${path}.displayField must be a portable lower-camel Java/TypeScript identifier`);
  if (value.required !== undefined && typeof value.required !== "boolean")
    problems.push(`${path}.required must be a boolean`);
  return value as EntityRelationshipSchema;
}

export function parseEntitySchema(value: unknown): VireoEntitySchema {
  const problems: string[] = [];
  if (!isObject(value)) throw new EntitySchemaError(["document must be a JSON object"]);
  rejectUnknown(
    value,
    [
      "$schema",
      "schemaVersion",
      "kind",
      "entity",
      "database",
      "api",
      "permissions",
      "capabilities",
      "fields",
      "relationships",
      "localization",
    ],
    "",
    problems,
  );
  if (value.schemaVersion !== VIREO_ENTITY_SCHEMA_VERSION)
    problems.push(`schemaVersion must be ${VIREO_ENTITY_SCHEMA_VERSION}`);
  if (value.kind !== "entity") problems.push('kind must be "entity"');

  const entity = requiredObject(value, "entity", problems);
  rejectUnknown(entity, ["name", "plural", "description"], "entity", problems);
  const name = requiredString(entity, "name", "entity", problems);
  const plural = requiredString(entity, "plural", "entity", problems);
  if (name && (!/^[A-Z][A-Za-z0-9]*$/u.test(name) || !validJavaIdentifier(name)))
    problems.push("entity.name must be a portable UpperCamelCase Java/TypeScript identifier");
  if (plural && !/^[a-z][a-z0-9-]*$/u.test(plural)) problems.push("entity.plural must be lowercase kebab-case");

  const database = requiredObject(value, "database", problems);
  rejectUnknown(database, ["table", "migrationVersion"], "database", problems);
  const table = requiredString(database, "table", "database", problems);
  if (table && !/^[a-z][a-z0-9_]*$/u.test(table)) problems.push("database.table must be lower_snake_case");
  if (table) validateSqlIdentifier(table, "database.table", problems);
  if (!Number.isSafeInteger(database.migrationVersion) || Number(database.migrationVersion) < 1)
    problems.push("database.migrationVersion must be a positive integer");

  const api = requiredObject(value, "api", problems);
  rejectUnknown(api, ["path"], "api", problems);
  const apiPath = requiredString(api, "path", "api", problems);
  if (apiPath && !/^\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/u.test(apiPath))
    problems.push("api.path must be an absolute lowercase kebab-case path");

  const permissions = requiredObject(value, "permissions", problems);
  rejectUnknown(permissions, ["read", "manage"], "permissions", problems);
  requiredString(permissions, "read", "permissions", problems);
  requiredString(permissions, "manage", "permissions", problems);
  const capabilities = requiredObject(value, "capabilities", problems);
  rejectUnknown(capabilities, ["history", "offline", "query"], "capabilities", problems);
  requiredBoolean(capabilities, "history", "capabilities", problems);
  requiredBoolean(capabilities, "offline", "capabilities", problems);
  requiredBoolean(capabilities, "query", "capabilities", problems);
  if (capabilities.offline === true)
    problems.push("capabilities.offline is reserved for Phase 4; Phase 3 schemas must declare false");

  if (!Array.isArray(value.fields) || value.fields.length === 0)
    problems.push("fields must contain at least one field");
  const fields = Array.isArray(value.fields)
    ? value.fields.map((field, index) => validateField(field, index, problems)).filter(Boolean)
    : [];
  const fieldNames = fields.map(field => field!.name);
  if (new Set(fieldNames).size !== fieldNames.length) problems.push("field names must be unique");
  const sqlFieldNames = fields.map(field => entityFieldSqlName(field!.name));
  for (const [index, sqlFieldName] of sqlFieldNames.entries()) {
    validateSqlIdentifier(sqlFieldName, `fields[${index}].name-derived SQL identifier`, problems);
    if (GENERATED_AUDIT_COLUMNS.has(sqlFieldName))
      problems.push(`fields[${index}].name conflicts with the generated ${sqlFieldName} audit column`);
    if (table && fields[index]?.type === "enum")
      validateSqlIdentifier(`ck_${table}_${sqlFieldName}`, `fields[${index}].name-derived check constraint`, problems);
    if (
      table &&
      (fields[index]?.query?.filterable || fields[index]?.query?.searchable || fields[index]?.query?.sortable)
    )
      validateSqlIdentifier(`ix_${table}_${sqlFieldName}`, `fields[${index}].name-derived index`, problems);
  }
  if (new Set(sqlFieldNames).size !== sqlFieldNames.length)
    problems.push("field names must remain unique after lower_snake_case SQL conversion");
  if (!fields.some(field => field?.query?.searchable)) problems.push("at least one field must be query.searchable");

  const relationships =
    value.relationships === undefined
      ? []
      : !Array.isArray(value.relationships)
        ? (problems.push("relationships must be an array"), [])
        : value.relationships.map((relationship, index) => validateRelationship(relationship, index, problems)).filter(Boolean);
  const relationshipNames = relationships.map(relationship => relationship!.name);
  const relationshipSqlNames = relationships.map(relationship => `${entityFieldSqlName(relationship!.name)}_id`);
  if (new Set(relationshipNames).size !== relationshipNames.length) problems.push("relationship names must be unique");
  if (new Set(relationshipSqlNames).size !== relationshipSqlNames.length)
    problems.push("relationship names must remain unique after lower_snake_case SQL conversion");
  for (const [index, relationship] of relationships.entries()) {
    if (fieldNames.includes(relationship!.name))
      problems.push(`relationships[${index}].name conflicts with a field name`);
    const idName = `${relationship!.name}Id`;
    if (fieldNames.includes(idName) || relationshipNames.includes(idName))
      problems.push(`relationships[${index}].name-derived ${idName} conflicts with a field or relationship name`);
    const responseDisplayName = `${relationship!.name}Name`;
    if (fieldNames.includes(responseDisplayName) || relationshipNames.includes(responseDisplayName))
      problems.push(
        `relationships[${index}].name-derived ${responseDisplayName} conflicts with a field or relationship name`,
      );
    const column = `${entityFieldSqlName(relationship!.name)}_id`;
    if (sqlFieldNames.includes(column))
      problems.push(`relationships[${index}].name-derived ${column} conflicts with a scalar column`);
    validateSqlIdentifier(column, `relationships[${index}].name-derived SQL identifier`, problems);
    if (table) validateSqlIdentifier(`ix_${table}_${column}`, `relationships[${index}].name-derived index`, problems);
  }

  const localization = requiredObject(value, "localization", problems);
  rejectUnknown(localization, ["en", "hr"], "localization", problems);
  const english = requiredObject(localization, "en", problems);
  rejectUnknown(english, ["singular", "plural"], "localization.en", problems);
  requiredString(english, "singular", "localization.en", problems);
  requiredString(english, "plural", "localization.en", problems);
  if (localization.hr !== undefined) {
    const croatian = requiredObject(localization, "hr", problems);
    rejectUnknown(croatian, ["singular", "plural"], "localization.hr", problems);
    requiredString(croatian, "singular", "localization.hr", problems);
    requiredString(croatian, "plural", "localization.hr", problems);
  }

  if (problems.length > 0) throw new EntitySchemaError(problems);
  return value as VireoEntitySchema;
}

export async function readEntitySchema(path: string): Promise<VireoEntitySchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new EntitySchemaError([
      `could not read valid JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  return parseEntitySchema(parsed);
}
