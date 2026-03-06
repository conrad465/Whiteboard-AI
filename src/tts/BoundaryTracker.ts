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

  constructor(onStart: (actionId: string) => void, onComplete: (actionId: string) => void) {
    this.onStart    = onStart;
    this.onComplete = onComplete;
  }

  loadMappings(mappings: TriggerMapping[]): void {
    this.mappings = mappings;
    this.startedActions.clear();
    this.completedActions.clear();
  }

  handleBoundary(event: SpeechSynthesisEvent): void {
    if (event.name !== "word") return;

    const currentChar = event.charIndex;

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
  }
}
