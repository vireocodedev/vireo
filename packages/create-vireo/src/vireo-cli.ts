import { resolve } from "node:path";
import { checkGeneratedEntities, ejectEntity, generateEntity } from "./entity-generator.js";
import type { VireoGenerationTarget } from "./entity-renderer.js";
import {
  formatVireoStatusText,
  formatVireoUpgradeText,
  upgradeVireoProject,
  vireoProjectStatus,
} from "./project-upgrade.js";
import { removeExample } from "./remove-example.js";

const HELP = `Vireo application development CLI.

Usage:
  vireo generate entity <schema.json> [options]
  vireo check [options]
  vireo eject <entity-plural> [options]
  vireo status [options]
  vireo upgrade --to <version> [options]
  vireo remove-example [options]

Generate options:
  --project <directory>        Vireo application root (default: current directory)
  --output <directory>         Render a reviewable standalone output tree
  --target <target>            frontend or full-stack (defaults to project profile)
  --dry-run                    Validate and show the complete write plan
  --diff                       Alias for --dry-run with per-file statuses
  --force                      Allow a reviewed schema change to regenerate
  --accept-overwrite           With --force, explicitly overwrite collisions/customizations
  --json                       Print machine-readable output

Check verifies canonical schema, derived wire contract, migration, backend request/response/controller,
and frontend transport/API hashes. Eject retains application code while removing Vireo
management and generated route registration.

Upgrade options:
  --to <version>              Required target create-vireo release
  --dry-run                   Validate and show the migration plan (default)
  --apply                     Apply only the declared Vireo-managed migration
  --accept-application-owned  Required with --apply; acknowledges the manual Template boundary

Status reports the recorded release, next declared hop, managed-file drift, and
generated capability ownership. It never writes files.

Remove-example options:
  --dry-run                   Validate and show the complete removal plan (default)
  --status                    Report whether the generated example is present or removed
  --apply                     Apply only when every example-owned file is unchanged
`;

type CommonArguments = {
  project: string;
  json: boolean;
  dryRun: boolean;
};

function valueAfter(values: string[], index: number, option: string) {
  const value = values[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return value;
}

function commonArguments(values: string[]) {
  const common: CommonArguments = { project: process.cwd(), json: false, dryRun: false };
  const rest: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--project") common.project = resolve(valueAfter(values, index++, value));
    else if (value === "--json") common.json = true;
    else if (value === "--dry-run" || value === "--diff") common.dryRun = true;
    else rest.push(value);
  }
  return { common, rest };
}

function print(value: unknown, json: boolean) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (Array.isArray(value)) value.forEach(item => console.log(String(item)));
  else console.log(String(value));
}

async function generate(values: string[]) {
  if (values.shift() !== "entity") throw new Error("The supported Phase 3 generator is `vireo generate entity`.");
  const { common, rest } = commonArguments(values);
  let schemaPath: string | undefined;
  let outputDirectory: string | undefined;
  let force = false;
  let acceptOverwrite = false;
  let target: VireoGenerationTarget | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--output") outputDirectory = resolve(valueAfter(rest, index++, value));
    else if (value === "--target") {
      const requested = valueAfter(rest, index++, value);
      if (requested !== "frontend" && requested !== "full-stack")
        throw new Error("--target must be `frontend` or `full-stack`.");
      target = requested;
    } else if (value === "--force") force = true;
    else if (value === "--accept-overwrite") acceptOverwrite = true;
    else if (value.startsWith("-")) throw new Error(`Unknown generate option: ${value}`);
    else if (schemaPath) throw new Error(`Unexpected generate argument: ${value}`);
    else schemaPath = value;
  }
  if (!schemaPath) throw new Error("generate entity requires a schema JSON path.");
  const result = await generateEntity({
    projectDirectory: common.project,
    schemaPath,
    outputDirectory,
    dryRun: common.dryRun,
    force,
    acceptOverwrite,
    target,
  });
  if (common.json) return print(result, true);
  print(
    [
      `${result.dryRun ? "Validated" : "Generated"} ${result.entity} for ${result.target} (${result.schemaDigest.slice(0, 12)}).`,
      ...result.files.map(file => `${file.status.padEnd(10)} ${file.path}`),
      result.dryRun
        ? "No files were written."
        : `Run \`vireo check --project ${result.projectDirectory}\` to verify wire-contract integrity.`,
    ],
    false,
  );
}

async function check(values: string[]) {
  const { common, rest } = commonArguments(values);
  if (rest.length > 0) throw new Error(`Unknown check option: ${rest[0]}`);
  const results = await checkGeneratedEntities(common.project);
  if (common.json) print(results, true);
  else
    print(
      results.length === 0
        ? ["No managed generated capabilities found."]
        : results.flatMap(result => [
            `${result.ok ? "PASS" : "FAIL"} ${result.entity}`,
            ...result.problems.map(problem => `  - ${problem}`),
          ]),
      false,
    );
  if (results.some(result => !result.ok)) process.exitCode = 1;
}

async function eject(values: string[]) {
  const { common, rest } = commonArguments(values);
  if (rest.length !== 1 || rest[0].startsWith("-")) throw new Error("eject requires one entity plural name.");
  const result = await ejectEntity(common.project, rest[0], common.dryRun);
  if (common.json) print(result, true);
  else
    print(
      [
        `${result.dryRun ? "Would eject" : "Ejected"} ${result.entity}.`,
        `Retained ${result.retainedFiles.length} application-owned files; route registration and contract management ${result.dryRun ? "would be removed" : "were removed"}.`,
      ],
      false,
    );
}

async function upgrade(values: string[]) {
  const { common, rest } = commonArguments(values);
  let targetRelease: string | undefined;
  let apply = false;
  let acceptApplicationOwned = false;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--to") targetRelease = valueAfter(rest, index++, value);
    else if (value === "--apply") apply = true;
    else if (value === "--accept-application-owned") acceptApplicationOwned = true;
    else throw new Error(`Unknown upgrade option: ${value}`);
  }
  if (!targetRelease) throw new Error("upgrade requires --to <version>.");
  if (apply && common.dryRun) throw new Error("Choose either --dry-run or --apply.");
  const result = await upgradeVireoProject({
    projectDirectory: common.project,
    targetRelease,
    dryRun: !apply,
    acceptApplicationOwned,
  });
  if (common.json) return print(result, true);
  print(formatVireoUpgradeText(result), false);
}

async function status(values: string[]) {
  const { common, rest } = commonArguments(values);
  if (rest.length > 0) throw new Error(`Unknown status option: ${rest[0]}`);
  const result = await vireoProjectStatus(common.project);
  if (common.json) return print(result, true);
  print(formatVireoStatusText(result), false);
}

async function removeGeneratedExample(values: string[]) {
  const { common, rest } = commonArguments(values);
  let apply = false;
  let status = false;
  for (const value of rest) {
    if (value === "--apply") apply = true;
    else if (value === "--status") status = true;
    else throw new Error(`Unknown remove-example option: ${value}`);
  }
  if (apply && (common.dryRun || status)) throw new Error("Choose either --apply, --dry-run, or --status.");
  const result = await removeExample(common.project, apply);
  if (common.json) return print(result, true);
  if (status) return print(`Example status: ${result.state}.`, false);
  print(
    [
      `${apply ? "Removed" : "Validated removal of"} the generated example (${result.files.length} file operations).`,
      ...result.files.map(file => `${file.status.padEnd(7)} ${file.path}`),
      apply
        ? "Run the project verification gate before committing."
        : "No files were written. Re-run with --apply to perform this reviewed plan.",
    ],
    false,
  );
}

async function main() {
  const values = process.argv.slice(2);
  if (values.length === 0 || values[0] === "--help" || values[0] === "-h") {
    console.log(HELP);
    return;
  }
  const command = values.shift();
  if (command === "generate") await generate(values);
  else if (command === "check") await check(values);
  else if (command === "eject") await eject(values);
  else if (command === "status") await status(values);
  else if (command === "upgrade") await upgrade(values);
  else if (command === "remove-example") await removeGeneratedExample(values);
  else throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch(error => {
  console.error(`vireo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
