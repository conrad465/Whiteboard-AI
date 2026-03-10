#!/usr/bin/env node
// =============================================================================
// generate-scenes.ts
//
// Generates Whiteboard AI scene JSON for each test case in public/tests/cases.json
// using the Anthropic API.
//
// Usage:
//   npx tsx scripts/generate-scenes.ts            # generate missing scenes only
//   npx tsx scripts/generate-scenes.ts --all      # regenerate ALL scenes
//   npx tsx scripts/generate-scenes.ts --validate # validate existing scenes only
//
// Requires: ANTHROPIC_API_KEY environment variable
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env from the project root (Codebase/.env)
const envFilePath = path.join(ROOT, ".env");
if (fs.existsSync(envFilePath)) {
  const lines = fs.readFileSync(envFilePath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FORCE_ALL  = args.includes("--all");
const ONLY_VALIDATE = args.includes("--validate");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CASES_PATH        = path.join(ROOT, "public/tests/cases.json");
const SCENES_DIR        = path.join(ROOT, "public/tests/scenes");
const SYSTEM_PROMPT_PATH = path.join(ROOT, "public/system-prompt.md");

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

interface TestCase {
  id: string;
  name: string;
  category: string;
  prompt: string;
}

const { cases }: { cases: TestCase[] } = JSON.parse(
  fs.readFileSync(CASES_PATH, "utf-8")
);

const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateScene(json: unknown, caseId: string): string[] {
  const errors: string[] = [];

  if (typeof json !== "object" || json === null) {
    return ["Scene is not a JSON object"];
  }

  const scene = json as Record<string, unknown>;

  if (scene["version"] !== "1.0") {
    errors.push(`version must be "1.0", got: ${scene["version"]}`);
  }
  if (typeof scene["transcript"] !== "string" || !scene["transcript"]) {
    errors.push("transcript must be a non-empty string");
  }
  if (!Array.isArray(scene["actions"])) {
    errors.push("actions must be an array");
    return errors;
  }

  const transcript = (scene["transcript"] as string) ?? "";
  const actions = scene["actions"] as Record<string, unknown>[];
  const elementIds = new Set<string>();
  const actionIds  = new Set<string>();

  for (const action of actions) {
    const aid = action["action_id"] as string;
    if (!aid) { errors.push("action missing action_id"); continue; }
    if (actionIds.has(aid)) errors.push(`duplicate action_id: ${aid}`);
    actionIds.add(aid);

    const phrase = action["trigger_phrase"] as string;
    if (phrase && !transcript.includes(phrase)) {
      errors.push(
        `trigger_phrase not found in transcript: "${phrase}"`
      );
    }

    if (action["action_type"] === "create") {
      const el = action["element"] as Record<string, unknown> | undefined;
      if (!el) { errors.push(`create action ${aid} missing element`); continue; }
      const elId = el["id"] as string;
      if (!elId) { errors.push(`element in ${aid} missing id`); continue; }
      if (elementIds.has(elId)) errors.push(`duplicate element id: ${elId}`);
      elementIds.add(elId);

      // Check relative_to references an existing element
      const pos = el["position"] as Record<string, unknown> | undefined;
      if (pos && pos["type"] === "relative") {
        const refId = pos["relative_to"] as string;
        if (refId && !elementIds.has(refId)) {
          errors.push(
            `element "${elId}" references relative_to "${refId}" which has not been created yet`
          );
        }
      }
    }
  }

  void caseId; // used only for labelling in caller
  return errors;
}

// ---------------------------------------------------------------------------
// Validate-only mode
// ---------------------------------------------------------------------------

if (ONLY_VALIDATE) {
  console.log("=== Validating existing scenes ===\n");
  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    const scenePath = path.join(SCENES_DIR, `${tc.id}.json`);
    if (!fs.existsSync(scenePath)) {
      console.log(`[MISS] ${tc.id} — ${tc.name} (no scene file)`);
      failed++;
      continue;
    }

    let scene: unknown;
    try {
      scene = JSON.parse(fs.readFileSync(scenePath, "utf-8"));
    } catch {
      console.log(`[FAIL] ${tc.id} — ${tc.name} (invalid JSON)`);
      failed++;
      continue;
    }

    const errors = validateScene(scene, tc.id);
    if (errors.length === 0) {
      console.log(`[PASS] ${tc.id} — ${tc.name}`);
      passed++;
    } else {
      console.log(`[FAIL] ${tc.id} — ${tc.name}`);
      for (const e of errors) console.log(`       ✗ ${e}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Generation mode
// ---------------------------------------------------------------------------

if (!process.env["ANTHROPIC_API_KEY"]) {
  console.error("ERROR: ANTHROPIC_API_KEY environment variable is not set.");
  process.exit(1);
}

const client = new Anthropic();

console.log("=== Whiteboard AI — Scene Generator ===\n");

let generated = 0;
let skipped   = 0;
let failed    = 0;

for (const tc of cases) {
  const scenePath = path.join(SCENES_DIR, `${tc.id}.json`);

  if (!FORCE_ALL && fs.existsSync(scenePath)) {
    console.log(`[SKIP] ${tc.id} — ${tc.name}`);
    skipped++;
    continue;
  }

  console.log(`[GEN]  ${tc.id} — ${tc.name} …`);

  let rawText = "";
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: tc.prompt }],
    });

    const block = response.content[0];
    rawText = block.type === "text" ? block.text : "";

    // Strip optional markdown fences if the model wrapped its output
    rawText = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const scene: unknown = JSON.parse(rawText);

    const errors = validateScene(scene, tc.id);
    if (errors.length > 0) {
      console.log(`       ⚠ Validation warnings:`);
      for (const e of errors) console.log(`         - ${e}`);
    }

    fs.writeFileSync(scenePath, JSON.stringify(scene, null, 2));
    console.log(`[DONE] ${tc.id} → ${scenePath}`);
    generated++;

  } catch (err) {
    console.error(`[FAIL] ${tc.id} — ${(err as Error).message}`);
    if (rawText) {
      console.error(`       Raw response (first 200 chars): ${rawText.slice(0, 200)}`);
    }
    failed++;
  }
}

console.log(
  `\nDone: ${generated} generated, ${skipped} skipped, ${failed} failed.`
);
if (failed > 0) process.exit(1);
