import { WhiteboardPlayer, type PlayerState } from "./WhiteboardPlayer";
import { StockFlowPlayer } from "../scene-types/stock-flow/StockFlowPlayer";
import type { StockFlowScene } from "../scene-types/stock-flow/types";
import { TranscriptViewer } from "./TranscriptViewer";
import { TestingPanel } from "./TestingPanel";
import type { SceneDefinition } from "../schema/types";

// -----------------------------------------------------------------------------
// DOM setup
// -----------------------------------------------------------------------------

const canvas        = document.getElementById("whiteboard")        as HTMLCanvasElement;
const playBtn       = document.getElementById("btn-play")          as HTMLButtonElement;
const pauseBtn      = document.getElementById("btn-pause")         as HTMLButtonElement;
const stopBtn       = document.getElementById("btn-stop")          as HTMLButtonElement;
const statusEl      = document.getElementById("status")            as HTMLElement;
const sceneInput    = document.getElementById("scene-json")        as HTMLTextAreaElement;
const loadJsonBtn   = document.getElementById("btn-load-json")     as HTMLButtonElement;
const txContainer   = document.getElementById("transcript-viewer") as HTMLElement;
const testModeBtn   = document.getElementById("btn-test-mode")     as HTMLButtonElement;
const editorPanel   = document.getElementById("editor-panel")      as HTMLElement;
const testPanelEl   = document.getElementById("test-panel")        as HTMLElement;
const hintEl        = document.getElementById("hint-text")         as HTMLElement;

// -----------------------------------------------------------------------------
// Canvas resize (maintain 16:9 within its container)
// -----------------------------------------------------------------------------

function resizeCanvas(): void {
  const container = canvas.parentElement!;
  const containerWidth  = container.clientWidth;
  const containerHeight = container.clientHeight;

  const targetRatio = 16 / 9;
  let w = containerWidth;
  let h = w / targetRatio;
  if (h > containerHeight) {
    h = containerHeight;
    w = h * targetRatio;
  }

  canvas.width  = Math.floor(w);
  canvas.height = Math.floor(h);
}

resizeCanvas();
window.addEventListener("resize", () => {
  resizeCanvas();
  activePlayer?.resize(canvas.width, canvas.height);
});

// -----------------------------------------------------------------------------
// Player abstraction — unifies WhiteboardPlayer and StockFlowPlayer
// -----------------------------------------------------------------------------

interface UnifiedPlayer {
  play(): void;
  pause(): void;
  stop(): void;
  resize(w: number, h: number): void;
  onStateChanged(handler: (state: PlayerState) => void): void;
  destroy(): void;
}

function wrapWhiteboardPlayer(canvas: HTMLCanvasElement, viewer: TranscriptViewer): UnifiedPlayer & { loadScene(s: SceneDefinition): void } {
  const p = new WhiteboardPlayer(canvas);
  p.setTranscriptViewer(viewer);
  return {
    play: () => p.play(),
    pause: () => p.pause(),
    stop: () => p.stop(),
    resize: (w, h) => p.resize(w, h),
    onStateChanged: (h) => p.onStateChanged(h),
    destroy: () => p.stop(),
    loadScene: (s) => p.loadScene(s),
  };
}

function wrapStockFlowPlayer(canvas: HTMLCanvasElement): UnifiedPlayer & { loadScene(s: StockFlowScene): void } {
  const p = new StockFlowPlayer(canvas);
  return {
    play: () => p.play(),
    pause: () => p.pause(),
    stop: () => p.stop(),
    resize: (w, h) => p.resize(w, h),
    onStateChanged: (h) => p.onStateChanged(h),
    destroy: () => p.destroy(),
    loadScene: (s) => p.loadScene(s),
  };
}

const viewer = new TranscriptViewer(txContainer);
let activePlayer: UnifiedPlayer | null = null;

function setStatus(state: PlayerState): void {
  const labels: Record<PlayerState, string> = {
    idle:     "Ready",
    playing:  "Playing…",
    paused:   "Paused",
    finished: "Finished",
  };
  statusEl.textContent = labels[state] ?? state;

  playBtn.disabled  = state === "playing";
  pauseBtn.disabled = state !== "playing";
  stopBtn.disabled  = state === "idle" || state === "finished";
}

/** Detect scene type from raw JSON and load appropriate player */
function loadSceneFromJson(json: unknown): void {
  const obj = json as Record<string, unknown>;

  if (activePlayer) {
    activePlayer.stop();
    activePlayer.destroy();
    activePlayer = null;
  }

  if (obj.scene_type === "stock_and_flow") {
    const sfPlayer = wrapStockFlowPlayer(canvas);
    sfPlayer.onStateChanged(setStatus);
    sfPlayer.loadScene(obj as unknown as StockFlowScene);
    activePlayer = sfPlayer;
  } else {
    const wbPlayer = wrapWhiteboardPlayer(canvas, viewer);
    wbPlayer.onStateChanged(setStatus);
    wbPlayer.loadScene(obj as unknown as SceneDefinition);
    activePlayer = wbPlayer;
  }

  setStatus("idle");
}

// ---------------------------------------------------------------------------
// Load default sample scene on startup
// ---------------------------------------------------------------------------

let currentSceneJson: unknown = null;

async function loadDefaultScene(): Promise<void> {
  try {
    const resp = await fetch(import.meta.env.BASE_URL + "sample-scene.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    currentSceneJson = json;
    sceneInput.value = JSON.stringify(json, null, 2);
    loadSceneFromJson(json);
  } catch (err) {
    statusEl.textContent = `Error loading scene: ${(err as Error).message}`;
    console.error(err);
  }
}

loadDefaultScene();

// ---------------------------------------------------------------------------
// Playback controls
// ---------------------------------------------------------------------------

playBtn.addEventListener("click", () => {
  if (!activePlayer || !currentSceneJson) return;
  activePlayer.play();
});

pauseBtn.addEventListener("click", () => { activePlayer?.pause(); });

stopBtn.addEventListener("click", () => {
  if (!activePlayer || !currentSceneJson) return;
  activePlayer.stop();
  loadSceneFromJson(currentSceneJson);
  viewer.reset();
  setStatus("idle");
});

// ---------------------------------------------------------------------------
// Load JSON from textarea (editor panel)
// ---------------------------------------------------------------------------

loadJsonBtn.addEventListener("click", () => {
  try {
    const json = JSON.parse(sceneInput.value);
    currentSceneJson = json;
    loadSceneFromJson(json);
  } catch (err) {
    statusEl.textContent = `Scene error: ${(err as Error).message}`;
    console.error(err);
  }
});

// ---------------------------------------------------------------------------
// Testing Mode
// ---------------------------------------------------------------------------

let testingModeActive = false;
let testingPanel: TestingPanel | null = null;

function setTestingMode(active: boolean): void {
  testingModeActive = active;
  testModeBtn.classList.toggle("active", active);

  if (active) {
    // Hide editor, show test panel
    editorPanel.style.display = "none";
    testPanelEl.classList.add("visible");
    hintEl.innerHTML = "🧪 <strong>Test Mode</strong> — select a case and press Play.";
    hintEl.classList.add("test-hint");

    // Initialise once
    if (!testingPanel) {
      testingPanel = new TestingPanel(testPanelEl, import.meta.env.BASE_URL);
      testingPanel.onLoad((scene, tc) => {
        currentSceneJson = scene;
        activePlayer?.stop();
        loadSceneFromJson(scene);
        viewer.reset();
        // Mirror JSON into editor so users can inspect it
        sceneInput.value = JSON.stringify(scene, null, 2);
        statusEl.textContent = `Loaded: ${tc.name}`;
      });
      void testingPanel.init();
    }
  } else {
    // Restore editor panel
    editorPanel.style.display = "";
    testPanelEl.classList.remove("visible");
    hintEl.innerHTML =
      'Edit the scene JSON on the right and click "Load Scene"<br>to preview your changes, then press Play.';
    hintEl.classList.remove("test-hint");
  }
}

testModeBtn.addEventListener("click", () => {
  setTestingMode(!testingModeActive);
});
