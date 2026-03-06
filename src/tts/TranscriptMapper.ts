import type { WhiteboardAction } from "../schema/types";

// -----------------------------------------------------------------------------
// TriggerMapping — maps a single action's trigger phrase to char positions
// -----------------------------------------------------------------------------

export interface TriggerMapping {
  actionId: string;
  triggerPhrase: string;
  /** charIndex of the first character of the trigger phrase in the transcript */
  startCharIndex: number;
  /** charIndex of the last character of the trigger phrase (inclusive) */
  endCharIndex: number;
}

// -----------------------------------------------------------------------------
// TranscriptMapper
// -----------------------------------------------------------------------------

export class TranscriptMapper {
  /**
   * Pre-computes character ranges for all action trigger phrases.
   * Call this once before TTS starts.
   *
   * Rules:
   * - Matching is case-sensitive (trigger phrases must be exact substrings)
   * - If a trigger phrase appears multiple times, the FIRST occurrence is used
   * - If a trigger phrase is not found, a warning is logged and the action is skipped
   */
  buildMappings(transcript: string, actions: WhiteboardAction[]): TriggerMapping[] {
    const mappings: TriggerMapping[] = [];

    for (const action of actions) {
      const phrase = action.trigger_phrase;
      const startChar = transcript.indexOf(phrase);

      if (startChar === -1) {
        console.warn(
          `TranscriptMapper: trigger phrase not found in transcript — action "${action.action_id}".\n` +
          `  Phrase:     "${phrase}"\n` +
          `  Transcript: "${transcript.slice(0, 80)}..."`
        );
        continue;
      }

      mappings.push({
        actionId: action.action_id,
        triggerPhrase: phrase,
        startCharIndex: startChar,
        endCharIndex: startChar + phrase.length - 1,
      });
    }

    // Sort by startCharIndex so BoundaryTracker can iterate in order
    mappings.sort((a, b) => a.startCharIndex - b.startCharIndex);

    return mappings;
  }
}
