import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ArtifactValidationResult } from "./restart-pack.js";

const RECOVERY_PACK_SCHEMA_FILE = "recovery-pack-v1.schema.json";
const HOST_INVOCATION_SCHEMA_FILE = "host-invocation-context-v1.schema.json";

interface CompiledSchemas {
  schemaDir: string;
  recoveryPack: ValidateFunction;
  hostInvocationContext: ValidateFunction;
}

let compiledSchemas: CompiledSchemas | null = null;

export function validateRecoveryPackJsonSchema(value: unknown, schemaDir = defaultSchemaDir()): ArtifactValidationResult {
  return validateWithSchema(compiled(schemaDir).recoveryPack, value);
}

export function validateHostInvocationContextJsonSchema(
  value: unknown,
  schemaDir = defaultSchemaDir()
): ArtifactValidationResult {
  return validateWithSchema(compiled(schemaDir).hostInvocationContext, value);
}

export function defaultSchemaDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "design", "schemas");
}

function compiled(schemaDir: string): CompiledSchemas {
  const resolvedSchemaDir = resolve(schemaDir);
  if (compiledSchemas?.schemaDir === resolvedSchemaDir) return compiledSchemas;

  const recoveryPackSchema = readSchema(resolvedSchemaDir, RECOVERY_PACK_SCHEMA_FILE);
  const hostInvocationSchema = readSchema(resolvedSchemaDir, HOST_INVOCATION_SCHEMA_FILE);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(recoveryPackSchema);
  ajv.addSchema(hostInvocationSchema);

  const recoveryPack = ajv.getSchema(schemaId(recoveryPackSchema, RECOVERY_PACK_SCHEMA_FILE));
  const hostInvocationContext = ajv.getSchema(schemaId(hostInvocationSchema, HOST_INVOCATION_SCHEMA_FILE));
  if (!recoveryPack) throw new Error(`failed to compile ${RECOVERY_PACK_SCHEMA_FILE}`);
  if (!hostInvocationContext) throw new Error(`failed to compile ${HOST_INVOCATION_SCHEMA_FILE}`);

  compiledSchemas = { schemaDir: resolvedSchemaDir, recoveryPack, hostInvocationContext };
  return compiledSchemas;
}

function readSchema(schemaDir: string, filename: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(schemaDir, filename), "utf8")) as Record<string, unknown>;
}

function schemaId(schema: Record<string, unknown>, filename: string): string {
  if (typeof schema.$id !== "string" || schema.$id.length === 0) {
    throw new Error(`${filename} must define a string $id`);
  }
  return schema.$id;
}

function validateWithSchema(validate: ValidateFunction, value: unknown): ArtifactValidationResult {
  const valid = validate(value);
  if (valid) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? "failed schema validation"}`;
    }),
  };
}
