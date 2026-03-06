// -----------------------------------------------------------------------------
// TTSEngine — thin wrapper around the Web Speech API
//
// Browser compatibility note:
// - Chrome desktop: full support for onboundary (word boundaries)
// - Edge: full support
// - Firefox: onboundary may not fire; animations still work (via flush on end)
// - Safari: partial support; test before deploying
// -----------------------------------------------------------------------------

export type TTSEventHandler = (event: SpeechSynthesisEvent) => void;

export class TTSEngine {
  private utterance: SpeechSynthesisUtterance | null = null;
  private _isPaused = false;
  private _isSpeaking = false;

  get isPaused():  boolean { return this._isPaused;  }
  get isSpeaking(): boolean { return this._isSpeaking; }

  /**
   * Speak the given text. Any previous speech is cancelled first.
   * @param text       - the full transcript string
   * @param onBoundary - called at each word boundary (charIndex of word start)
   * @param onEnd      - called when speech finishes naturally or is cancelled
   */
  speak(
    text: string,
    onBoundary: TTSEventHandler,
    onEnd: () => void,
    rate = 0.9
  ): void {
    this.cancel();

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate  = rate;
    this.utterance.pitch = 1.0;

    this.utterance.onboundary = onBoundary;

    this.utterance.onend = () => {
      this._isSpeaking = false;
      this._isPaused   = false;
      onEnd();
    };

    this.utterance.onerror = (e) => {
      console.error("TTSEngine error:", e.error);
      this._isSpeaking = false;
      this._isPaused   = false;
      onEnd();
    };

    this._isSpeaking = true;
    this._isPaused   = false;
    window.speechSynthesis.speak(this.utterance);
  }

  pause(): void {
    if (this._isSpeaking && !this._isPaused) {
      window.speechSynthesis.pause();
      this._isPaused = true;
    }
  }

  resume(): void {
    if (this._isSpeaking && this._isPaused) {
      window.speechSynthesis.resume();
      this._isPaused = false;
    }
  }

  cancel(): void {
    window.speechSynthesis.cancel();
    this._isSpeaking = false;
    this._isPaused   = false;
    this.utterance   = null;
  }

  /**
   * Returns the list of available voices.
   * Voices load asynchronously; attach a callback for voiceschanged if needed.
   */
  getVoices(): SpeechSynthesisVoice[] {
    return window.speechSynthesis.getVoices();
  }
}
