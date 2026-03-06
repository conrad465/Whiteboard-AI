import { WhiteboardPlayer, type PlayerState } from "./WhiteboardPlayer";
import { SceneLoader } from "../engine/SceneLoader";
import type { SceneDefinition } from "../schema/types";

// -----------------------------------------------------------------------------
// DOM setup
// -----------------------------------------------------------------------------

const canvas      = document.getElementById("whiteboard") as HTMLCanvasElement;
const playBtn     = document.getElementById("btn-play")   as HTMLButtonElement;
const pauseBtn    = document.getElementById("btn-pause")  as HTMLButtonElement;
const stopBtn     = document.getElementById("btn-stop")   as HTMLButtonElement;
const statusEl    = document.getElementById("status")     as HTMLElement;
const sceneInput  = document.getElementById("scene-json") as HTMLTextAreaElement;
const loadJsonBtn = document.getElementById("btn-load-json") as HTMLButtonElement;

// -----------------------------------------------------------------------------
// Resize canvas to fill its container, maintaining 16:9
// -----------------------------------------------------------------------------

function resizeCanvas(): void {
  const container = canvas.parentElement!;
  const containerWidth  = container.clientWidth;
  const containerHeight = container.clientHeight;

  // Fit 16:9 inside container
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
// Player
// -----------------------------------------------------------------------------

const player = new WhiteboardPlayer(canvas);

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
    const scene = await SceneLoader.loadFromUrl("/sample-scene.json");
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
// Control buttons
// ---------------------------------------------------------------------------

playBtn.addEventListener("click", () => {
  if (!currentScene) return;
  player.play();
});

pauseBtn.addEventListener("click", () => {
  player.pause();
});

stopBtn.addEventListener("click", () => {
  player.stop();
  if (currentScene) player.loadScene(currentScene);
  setStatus("idle");
});

// ---------------------------------------------------------------------------
// Load JSON from textarea
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
