import * as XLSX from "xlsx";
import type { SceneDefinition } from "../schema/types";

// =============================================================================
// TestingPanel
//
// Manages the "Test Mode" sidebar panel. Loads test cases from
// public/tests/cases.json, lets the user switch between them, collects
// feedback, and exports feedback to Excel.
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestCase {
  id: string;
  name: string;
  category: string;
  prompt: string;
}

export interface FeedbackEntry {
  caseId:    string;
  caseName:  string;
  category:  string;
  feedback:  string;
  timestamp: string;
}

// localStorage key for persisted feedback
const STORAGE_KEY = "wbai_feedback";

// ---------------------------------------------------------------------------
// Callback type — called when the user selects a test case
// ---------------------------------------------------------------------------

export type SceneLoadHandler = (scene: SceneDefinition, tc: TestCase) => void;

// ---------------------------------------------------------------------------
// TestingPanel
// ---------------------------------------------------------------------------

export class TestingPanel {
  private container:      HTMLElement;
  private onSceneLoad:    SceneLoadHandler | null = null;

  private cases:          TestCase[] = [];
  private currentCase:    TestCase | null = null;
  private basePath:       string;

  // UI elements (set in render())
  private dropdown!:      HTMLSelectElement;
  private promptEl!:      HTMLElement;
  private statusEl!:      HTMLElement;
  private feedbackInput!: HTMLTextAreaElement;
  private submitBtn!:     HTMLButtonElement;
  private exportBtn!:     HTMLButtonElement;
  private countBadge!:    HTMLElement;

  constructor(container: HTMLElement, basePath: string) {
    this.container = container;
    // basePath is import.meta.env.BASE_URL — passed in from index.ts
    this.basePath  = basePath;
  }

  onLoad(handler: SceneLoadHandler): void {
    this.onSceneLoad = handler;
  }

  // ---------------------------------------------------------------------------
  // Initialise: fetch cases and render
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    try {
      const res = await fetch(`${this.basePath}tests/cases.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { cases: TestCase[] };
      this.cases = data.cases;
    } catch (err) {
      this.container.innerHTML =
        `<p class="test-error">Failed to load test cases: ${(err as Error).message}</p>`;
      return;
    }

    this.render();
    this.updateCountBadge();
  }

  // ---------------------------------------------------------------------------
  // Render sidebar content
  // ---------------------------------------------------------------------------

  private render(): void {
    this.container.innerHTML = "";

    // ── Dropdown ──
    const dropLabel = document.createElement("label");
    dropLabel.className = "test-label";
    dropLabel.textContent = "Test Case";
    this.container.appendChild(dropLabel);

    this.dropdown = document.createElement("select");
    this.dropdown.className = "test-dropdown";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— select a test case —";
    placeholder.disabled = true;
    placeholder.selected = true;
    this.dropdown.appendChild(placeholder);

    for (const tc of this.cases) {
      const opt = document.createElement("option");
      opt.value = tc.id;
      opt.textContent = `${tc.id.replace("tc_0", "")}. ${tc.name}`;
      this.dropdown.appendChild(opt);
    }

    this.dropdown.addEventListener("change", () => {
      const id = this.dropdown.value;
      if (id) void this.loadCase(id);
    });
    this.container.appendChild(this.dropdown);

    // ── Prompt preview ──
    const promptLabel = document.createElement("label");
    promptLabel.className = "test-label";
    promptLabel.textContent = "Prompt";
    this.container.appendChild(promptLabel);

    this.promptEl = document.createElement("div");
    this.promptEl.className = "test-prompt-preview";
    this.promptEl.textContent = "Select a test case to preview its prompt.";
    this.container.appendChild(this.promptEl);

    // ── Scene load status ──
    this.statusEl = document.createElement("div");
    this.statusEl.className = "test-status";
    this.container.appendChild(this.statusEl);

    // ── Feedback ──
    const fbLabel = document.createElement("label");
    fbLabel.className = "test-label";
    fbLabel.textContent = "Feedback";
    this.container.appendChild(fbLabel);

    this.feedbackInput = document.createElement("textarea");
    this.feedbackInput.className = "test-feedback";
    this.feedbackInput.placeholder =
      "Enter your feedback on this test case…\n\n" +
      "e.g. positioning off, wrong color, transcript too fast, missing element…";
    this.feedbackInput.rows = 5;
    this.container.appendChild(this.feedbackInput);

    // ── Submit feedback ──
    this.submitBtn = document.createElement("button");
    this.submitBtn.className = "btn test-submit-btn";
    this.submitBtn.textContent = "Submit Feedback";
    this.submitBtn.disabled = true;
    this.submitBtn.addEventListener("click", () => this.submitFeedback());
    this.container.appendChild(this.submitBtn);

    // ── Export row ──
    const exportRow = document.createElement("div");
    exportRow.className = "test-export-row";

    this.countBadge = document.createElement("span");
    this.countBadge.className = "test-count-badge";
    exportRow.appendChild(this.countBadge);

    this.exportBtn = document.createElement("button");
    this.exportBtn.className = "btn test-export-btn";
    this.exportBtn.textContent = "Export to Excel";
    this.exportBtn.addEventListener("click", () => this.exportExcel());
    exportRow.appendChild(this.exportBtn);

    this.container.appendChild(exportRow);
  }

  // ---------------------------------------------------------------------------
  // Load a specific test case scene
  // ---------------------------------------------------------------------------

  private async loadCase(id: string): Promise<void> {
    const tc = this.cases.find(c => c.id === id);
    if (!tc) return;

    this.currentCase = tc;
    this.promptEl.textContent = tc.prompt;
    this.statusEl.textContent = "Loading scene…";
    this.statusEl.className   = "test-status test-status--loading";
    this.submitBtn.disabled   = true;

    // Restore any previously entered feedback for this case
    const existing = this.getFeedbackForCase(id);
    this.feedbackInput.value = existing?.feedback ?? "";

    try {
      const url = `${this.basePath}tests/scenes/${id}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Scene not found (HTTP ${res.status}). Run: npm run test:generate`);

      const scene = await res.json() as SceneDefinition;
      this.onSceneLoad?.(scene, tc);

      this.statusEl.textContent = `✓ Loaded — ${tc.category}`;
      this.statusEl.className   = "test-status test-status--ok";
      this.submitBtn.disabled   = false;

    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
      this.statusEl.className   = "test-status test-status--error";
    }
  }

  // ---------------------------------------------------------------------------
  // Feedback: submit & persist
  // ---------------------------------------------------------------------------

  private submitFeedback(): void {
    if (!this.currentCase) return;

    const text = this.feedbackInput.value.trim();
    if (!text) {
      this.flashStatus("⚠ Please enter feedback before submitting.");
      return;
    }

    const entry: FeedbackEntry = {
      caseId:    this.currentCase.id,
      caseName:  this.currentCase.name,
      category:  this.currentCase.category,
      feedback:  text,
      timestamp: new Date().toISOString(),
    };

    this.saveFeedback(entry);
    this.updateCountBadge();
    this.feedbackInput.value = "";

    this.flashStatus("✓ Feedback saved.");
  }

  private flashStatus(msg: string): void {
    const prev = this.statusEl.textContent ?? "";
    this.statusEl.textContent = msg;
    setTimeout(() => {
      this.statusEl.textContent = prev;
    }, 2500);
  }

  // ---------------------------------------------------------------------------
  // Feedback: localStorage persistence
  // ---------------------------------------------------------------------------

  private loadAllFeedback(): FeedbackEntry[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as FeedbackEntry[];
    } catch {
      return [];
    }
  }

  private saveFeedback(entry: FeedbackEntry): void {
    const all = this.loadAllFeedback();
    all.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  private getFeedbackForCase(id: string): FeedbackEntry | undefined {
    // Return the most recent entry for this case, if any
    const all = this.loadAllFeedback();
    return [...all].reverse().find(e => e.caseId === id);
  }

  private updateCountBadge(): void {
    const count = this.loadAllFeedback().length;
    this.countBadge.textContent =
      count === 0 ? "No feedback yet" : `${count} feedback entry${count === 1 ? "" : "s"}`;
  }

  // ---------------------------------------------------------------------------
  // Excel export
  // ---------------------------------------------------------------------------

  private exportExcel(): void {
    const feedback = this.loadAllFeedback();

    const wb = XLSX.utils.book_new();

    // Sheet 1: Feedback
    if (feedback.length > 0) {
      const fbRows = feedback.map(e => ({
        "Case ID":    e.caseId,
        "Case Name":  e.caseName,
        "Category":   e.category,
        "Feedback":   e.feedback,
        "Submitted":  e.timestamp,
      }));
      const wsFeedback = XLSX.utils.json_to_sheet(fbRows);
      // Set column widths
      wsFeedback["!cols"] = [
        { wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 60 }, { wch: 24 },
      ];
      XLSX.utils.book_append_sheet(wb, wsFeedback, "Feedback");
    } else {
      const wsEmpty = XLSX.utils.aoa_to_sheet([["No feedback entries yet."]]);
      XLSX.utils.book_append_sheet(wb, wsEmpty, "Feedback");
    }

    // Sheet 2: Test Cases (reference)
    const caseRows = this.cases.map(tc => ({
      "ID":       tc.id,
      "Name":     tc.name,
      "Category": tc.category,
      "Prompt":   tc.prompt,
    }));
    const wsCases = XLSX.utils.json_to_sheet(caseRows);
    wsCases["!cols"] = [
      { wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 80 },
    ];
    XLSX.utils.book_append_sheet(wb, wsCases, "Test Cases");

    // Download
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `whiteboard-ai-feedback-${date}.xlsx`);
  }
}
