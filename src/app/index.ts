import { WhiteboardPlayer, type PlayerState } from "./WhiteboardPlayer";
import { TranscriptViewer } from "./TranscriptViewer";
import { TestingPanel } from "./TestingPanel";
import { SceneLoader } from "../engine/SceneLoader";
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
  player.resize(canvas.width, canvas.height);
});

// -----------------------------------------------------------------------------
// Player + TranscriptViewer
// -----------------------------------------------------------------------------

const player = new WhiteboardPlayer(canvas);
const viewer = new TranscriptViewer(txContainer);
player.setTranscriptViewer(viewer);

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

player.onStateChanged(setStatus);

// ---------------------------------------------------------------------------
// Load default sample scene on startup
// ---------------------------------------------------------------------------

let currentScene: SceneDefinition | null = null;

async function loadDefaultScene(): Promise<void> {
  try {
    const scene = await SceneLoader.loadFromUrl(import.meta.env.BASE_URL + "sample-scene.json");
    currentScene = scene;
    player.loadScene(scene);
    sceneInput.value = JSON.stringify(scene, null, 2);
    setStatus("idle");
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
  if (!currentScene) return;
  player.play();
});

pauseBtn.addEventListener("click", () => { player.pause(); });

stopBtn.addEventListener("click", () => {
  player.stop();
  if (currentScene) player.loadScene(currentScene);
  viewer.reset();
  setStatus("idle");
});

// ---------------------------------------------------------------------------
// Load JSON from textarea (editor panel)
// ---------------------------------------------------------------------------

loadJsonBtn.addEventListener("click", () => {
  try {
    const scene = SceneLoader.loadFromString(sceneInput.value);
    currentScene = scene;
    player.loadScene(scene);
    setStatus("idle");
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
        currentScene = scene;
        player.stop();
        player.loadScene(scene);
        viewer.reset();
        setStatus("idle");
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
