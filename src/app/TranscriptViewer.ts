import type { TriggerMapping } from "../tts/TranscriptMapper";

// -----------------------------------------------------------------------------
// TranscriptViewer
//
// Renders the full transcript as annotated HTML inside a container element.
// Trigger-phrase runs become clickable <span> elements with three visual states:
//   pending  — not yet reached during playback
//   active   — currently being spoken
//   past     — already spoken
//
// Clicking any trigger-phrase span fires the onSeekRequest callback with the
// absolute character index (in the full transcript) where that phrase starts.
// -----------------------------------------------------------------------------

export type SeekHandler = (seekCharIndex: number) => void;

interface TriggerSpanMeta {
  el: HTMLElement;
  startChar: number;
  endChar: number;
}

export class TranscriptViewer {
  private container: HTMLElement;
  private seekHandler: SeekHandler | null = null;
  private triggerSpans: TriggerSpanMeta[] = [];
  private lastActiveStart = -1;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  onSeekRequest(handler: SeekHandler): void {
    this.seekHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // loadScene — rebuild DOM from transcript + mappings
  // ---------------------------------------------------------------------------

  loadScene(transcript: string, mappings: TriggerMapping[]): void {
    this.container.innerHTML = "";
    this.triggerSpans = [];
    this.lastActiveStart = -1;

    // Deduplicate: multiple actions can share the same (startChar, endChar).
    // We need one clickable span per unique phrase position.
    const seen = new Set<number>();
    const uniquePhrases: { start: number; end: number }[] = [];
    for (const m of mappings) {
      if (!seen.has(m.startCharIndex)) {
        seen.add(m.startCharIndex);
        uniquePhrases.push({ start: m.startCharIndex, end: m.endCharIndex + 1 });
      }
    }
    // Already sorted by startCharIndex (TranscriptMapper guarantees this)

    let cursor = 0;
    for (const phrase of uniquePhrases) {
      // Plain text before this phrase
      if (cursor < phrase.start) {
        this.container.appendChild(
          this.makePlain(transcript.slice(cursor, phrase.start))
        );
      }

      // Trigger phrase span
      const span = this.makeTrigger(
        transcript.slice(phrase.start, phrase.end),
        phrase.start,
        phrase.end - 1
      );
      this.triggerSpans.push({ el: span, startChar: phrase.start, endChar: phrase.end - 1 });
      this.container.appendChild(span);

      cursor = phrase.end;
    }

    // Remaining plain text
    if (cursor < transcript.length) {
      this.container.appendChild(this.makePlain(transcript.slice(cursor)));
    }
  }

  // ---------------------------------------------------------------------------
  // updateProgress — called on each TTS boundary event
  // charIndex is the ABSOLUTE position in the full transcript
  // ---------------------------------------------------------------------------

  updateProgress(charIndex: number): void {
    let newActiveStart = -1;

    for (const meta of this.triggerSpans) {
      meta.el.classList.remove("tx-trigger--pending", "tx-trigger--active", "tx-trigger--past");

      if (charIndex > meta.endChar) {
        meta.el.classList.add("tx-trigger--past");
      } else if (charIndex >= meta.startChar) {
        meta.el.classList.add("tx-trigger--active");
        newActiveStart = meta.startChar;
      } else {
        meta.el.classList.add("tx-trigger--pending");
      }
    }

    // Scroll active span into view when it changes
    if (newActiveStart !== this.lastActiveStart && newActiveStart !== -1) {
      this.lastActiveStart = newActiveStart;
      const activeMeta = this.triggerSpans.find(m => m.startChar === newActiveStart);
      activeMeta?.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ---------------------------------------------------------------------------
  // reset — clear all progress state (call on stop / load)
  // ---------------------------------------------------------------------------

  reset(): void {
    this.lastActiveStart = -1;
    for (const meta of this.triggerSpans) {
      meta.el.classList.remove("tx-trigger--active", "tx-trigger--past");
      meta.el.classList.add("tx-trigger--pending");
    }
  }

  // ---------------------------------------------------------------------------
  // Private DOM helpers
  // ---------------------------------------------------------------------------

  private makePlain(text: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "tx-plain";
    span.textContent = text;
    return span;
  }

  private makeTrigger(text: string, startChar: number, endChar: number): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "tx-trigger tx-trigger--pending";
    span.textContent = text;
    span.title = "Click to jump here";
    span.dataset["start"] = String(startChar);
    span.dataset["end"]   = String(endChar);
    span.addEventListener("click", () => {
      this.seekHandler?.(startChar);
    });
    return span;
  }
}
