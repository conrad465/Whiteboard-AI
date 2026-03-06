import type { TriggerMapping } from "./TranscriptMapper";

// -----------------------------------------------------------------------------
// BoundaryTracker
//
// Listens to SpeechSynthesisUtterance.onboundary events.
// Each event carries a charIndex pointing to the word that TTS just started.
//
// We fire:
//   onStart(actionId)    when charIndex >= mapping.startCharIndex  (first time)
//   onComplete(actionId) when charIndex >  mapping.endCharIndex    (first time)
//
// Seeking support: when TTS is restarted from transcript.slice(N), the browser
// resets charIndex to 0. Call setCharOffset(N) before speaking so that all
// incoming charIndex values are shifted back to absolute transcript positions.
//
// Note: onboundary is reliable on Chrome desktop. On Firefox it may not fire
// for every word. The animation system degrades gracefully — animations still
// run, just potentially at a slightly wrong time.
// -----------------------------------------------------------------------------

export class BoundaryTracker {
  private mappings: TriggerMapping[] = [];
  private startedActions   = new Set<string>();
  private completedActions = new Set<string>();
  private onStart:    (actionId: string) => void;
  private onComplete: (actionId: string) => void;
  /** Added to every event.charIndex to convert back to absolute transcript positions. */
  private charOffset = 0;

  constructor(onStart: (actionId: string) => void, onComplete: (actionId: string) => void) {
    this.onStart    = onStart;
    this.onComplete = onComplete;
  }

  loadMappings(mappings: TriggerMapping[]): void {
    this.mappings = mappings;
    this.startedActions.clear();
    this.completedActions.clear();
  }

  /**
   * Set the character offset for seek playback.
   * When TTS speaks transcript.slice(N), all boundary event charIndex values
   * are relative to the sliced string. Adding N here converts them back to
   * absolute positions that match TriggerMapping.startCharIndex/endCharIndex.
   */
  setCharOffset(offset: number): void {
    this.charOffset = offset;
  }

  /**
   * Pre-mark an action as both started and completed.
   * Used after a seek so instantly-applied actions don't re-fire via TTS.
   */
  markApplied(actionId: string): void {
    this.startedActions.add(actionId);
    this.completedActions.add(actionId);
  }

  /** Read-only access to the mapping list (used by WhiteboardPlayer.seekTo). */
  getMappings(): readonly TriggerMapping[] {
    return this.mappings;
  }

  handleBoundary(event: SpeechSynthesisEvent): void {
    if (event.name !== "word") return;

    const currentChar = event.charIndex + this.charOffset;

    for (const mapping of this.mappings) {
      const id = mapping.actionId;

      // Fire START: current word is at or past the trigger phrase start
      if (!this.startedActions.has(id) && currentChar >= mapping.startCharIndex) {
        this.startedActions.add(id);
        this.onStart(id);
      }

      // Fire COMPLETE: current word has passed the trigger phrase end
      if (
        this.startedActions.has(id) &&
        !this.completedActions.has(id) &&
        currentChar > mapping.endCharIndex
      ) {
        this.completedActions.add(id);
        this.onComplete(id);
      }
    }
  }

  /**
   * Mark all started-but-not-completed actions as complete.
   * Call this on TTS 'end' or 'error' events so no animations are left hanging.
   */
  handleEnd(): void {
    for (const mapping of this.mappings) {
      const id = mapping.actionId;
      if (this.startedActions.has(id) && !this.completedActions.has(id)) {
        this.completedActions.add(id);
        this.onComplete(id);
      }
      // Also trigger any actions that never started (transcript ended early)
      if (!this.startedActions.has(id)) {
        this.startedActions.add(id);
        this.onStart(id);
        this.completedActions.add(id);
        this.onComplete(id);
      }
    }
  }

  reset(): void {
    this.startedActions.clear();
    this.completedActions.clear();
    this.charOffset = 0;
  }
}
