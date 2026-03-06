import type { SceneDefinition } from "../schema/types";

// -----------------------------------------------------------------------------
// SceneLoader — loads and validates scene JSON
//
// Validation is intentionally lightweight (no Ajv dependency at runtime) —
// we check the critical structural constraints and surface clear errors.
// A full Ajv schema could be plugged in here for strict validation.
// -----------------------------------------------------------------------------

export class SceneLoader {
  /**
   * Fetch a scene JSON file from a URL and validate it.
   */
  static async loadFromUrl(url: string): Promise<SceneDefinition> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`SceneLoader: failed to fetch "${url}" — HTTP ${response.status}`);
    }
    const json = await response.json();
    return SceneLoader.validate(json);
  }

  /**
   * Parse and validate a raw JSON string.
   */
  static loadFromString(jsonString: string): SceneDefinition {
    let json: unknown;
    try {
      json = JSON.parse(jsonString);
    } catch (e) {
      throw new Error(`SceneLoader: invalid JSON — ${(e as Error).message}`);
    }
    return SceneLoader.validate(json);
  }

  /**
   * Validate a plain object as a SceneDefinition.
   * Throws a descriptive error if validation fails.
   */
  static validate(obj: unknown): SceneDefinition {
    if (typeof obj !== "object" || obj === null) {
      throw new Error("SceneLoader: scene must be a JSON object");
    }

    const scene = obj as Record<string, unknown>;

    if (scene["version"] !== "1.0") {
      throw new Error(`SceneLoader: unsupported version "${scene["version"]}" — expected "1.0"`);
    }
    if (typeof scene["transcript"] !== "string" || scene["transcript"].length === 0) {
      throw new Error('SceneLoader: "transcript" must be a non-empty string');
    }
    if (!Array.isArray(scene["actions"])) {
      throw new Error('SceneLoader: "actions" must be an array');
    }

    // Check trigger phrases are substrings of the transcript
    const transcript = scene["transcript"] as string;
    const actions = scene["actions"] as Array<Record<string, unknown>>;
    const actionIds = new Set<string>();

    for (const action of actions) {
      const id = action["action_id"] as string;
      if (!id) throw new Error("SceneLoader: each action must have an action_id");
      if (actionIds.has(id)) {
        throw new Error(`SceneLoader: duplicate action_id "${id}"`);
      }
      actionIds.add(id);

      const phrase = action["trigger_phrase"] as string;
      if (!phrase) throw new Error(`SceneLoader: action "${id}" missing trigger_phrase`);
      if (!transcript.includes(phrase)) {
        console.warn(
          `SceneLoader: trigger_phrase for action "${id}" not found in transcript.\n` +
          `  Phrase: "${phrase}"`
        );
      }
    }

    return scene as unknown as SceneDefinition;
  }
}
