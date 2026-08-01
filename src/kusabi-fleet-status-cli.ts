#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./stores/index.js";
import {
  canonicalKusabiFleetStatus,
  deriveKusabiFleetStatusFromStore,
  formatKusabiFleetStatus,
} from "./kusabi-fleet-status.js";

interface Args {
  manifestPath: string;
  generatedAt?: string;
  json: boolean;
}

export function parseKusabiFleetStatusArgs(argv: string[]): Args {
  let manifestPath: string | undefined;
  let generatedAt: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--manifest" && argv[index + 1] !== undefined) manifestPath = argv[++index];
    else if (arg === "--at" && argv[index + 1] !== undefined) generatedAt = argv[++index];
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") throw new Error("KUSABI_FLEET_STATUS_HELP");
    else throw new Error("KUSABI_FLEET_STATUS_ARGUMENT_INVALID");
  }
  if (!manifestPath) throw new Error("KUSABI_FLEET_STATUS_MANIFEST_REQUIRED");
  return { manifestPath, generatedAt, json };
}

export function kusabiFleetStatusHelp(): string {
  return [
    "Usage: wasurezu-kusabi-fleet-status --manifest <file> [--at <UTC ISO timestamp>] [--json]",
    "",
    "Derives a read-only status snapshot from the selected SQLite or PostgreSQL event store.",
  ].join("\n");
}

export async function runKusabiFleetStatusCli(argv = process.argv.slice(2)): Promise<void> {
  let args: Args;
  try {
    args = parseKusabiFleetStatusArgs(argv);
  } catch (error) {
    if (error instanceof Error && error.message === "KUSABI_FLEET_STATUS_HELP") {
      process.stdout.write(`${kusabiFleetStatusHelp()}\n`);
      return;
    }
    throw error;
  }
  const manifest: unknown = JSON.parse(readFileSync(args.manifestPath, "utf8"));
  const store = await createStore();
  try {
    const snapshot = await deriveKusabiFleetStatusFromStore(store, manifest, {
      generatedAt: args.generatedAt,
    });
    process.stdout.write(args.json ? `${canonicalKusabiFleetStatus(snapshot)}\n` : formatKusabiFleetStatus(snapshot));
  } finally {
    await store.close();
  }
}

export function isMainEntrypoint(moduleUrl: string, argv1 = process.argv[1]): boolean {
  return argv1 !== undefined && resolve(argv1) === resolve(fileURLToPath(moduleUrl));
}

if (isMainEntrypoint(import.meta.url)) {
  runKusabiFleetStatusCli().catch(() => {
    process.stderr.write("KUSABI_FLEET_STATUS_FAILED\n");
    process.exitCode = 1;
  });
}
