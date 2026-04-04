/**
 * FEAT-029: Auto-install memory-tags.md into ~/.claude/rules/
 * Runs on every boot. Only writes if the file doesn't exist yet.
 */
import { copyFile, mkdir, access } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TARGET_DIR = join(homedir(), ".claude", "rules");
const TARGET_FILE = join(TARGET_DIR, "memory-tags.md");

// Template is in templates/ relative to project root (one level up from dist/)
function getTemplatePath(): string {
  // In dist/ensure-tags.js → project root is ../
  // In src/ensure-tags.ts → project root is ../
  const projectRoot = join(__dirname, "..");
  return join(projectRoot, "templates", "memory-tags.md");
}

export async function ensureMemoryTags(): Promise<void> {
  try {
    // Check if already installed
    await access(TARGET_FILE);
    // File exists — do nothing
  } catch {
    // File doesn't exist — install it
    try {
      await mkdir(TARGET_DIR, { recursive: true });
      await copyFile(getTemplatePath(), TARGET_FILE);
      console.error("[agent-memory] Installed memory-tags.md → ~/.claude/rules/");
    } catch (err) {
      // Non-fatal: don't break boot if template is missing or permissions fail
      console.error("[agent-memory] Could not install memory-tags.md:", (err as Error).message);
    }
  }
}
