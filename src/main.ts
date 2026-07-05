import "./style.css";
import { Game } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const score = document.querySelector<HTMLElement>("#score");
const wave = document.querySelector<HTMLElement>("#wave");
const lives = document.querySelector<HTMLElement>("#lives");
const bestScoreStart = document.querySelector<HTMLElement>("#best-score-start");
const bestScoreEnd = document.querySelector<HTMLElement>("#best-score-end");
const finalScore = document.querySelector<HTMLElement>("#final-score");
const comboStatus = document.querySelector<HTMLElement>("#combo-status");
const powerUpStatus = document.querySelector<HTMLElement>("#powerup-status");
const waveBanner = document.querySelector<HTMLElement>("#wave-banner");
const startPanel = document.querySelector<HTMLElement>("#start-panel");
const gameOverPanel = document.querySelector<HTMLElement>("#game-over-panel");
const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const restartButton = document.querySelector<HTMLButtonElement>("#restart-button");
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-button");

if (
  canvas === null ||
  score === null ||
  wave === null ||
  lives === null ||
  bestScoreStart === null ||
  bestScoreEnd === null ||
  finalScore === null ||
  comboStatus === null ||
  powerUpStatus === null ||
  waveBanner === null ||
  startPanel === null ||
  gameOverPanel === null ||
  startButton === null ||
  restartButton === null ||
  pauseButton === null
) {
  throw new Error("Nova Frenzy could not find its required DOM nodes.");
}

const game = new Game(canvas, {
  score,
  wave,
  lives,
  bestScoreStart,
  bestScoreEnd,
  finalScore,
  comboStatus,
  powerUpStatus,
  waveBanner,
  startPanel,
  gameOverPanel,
  startButton,
  restartButton,
  pauseButton,
});

game.start();

window.addEventListener("beforeunload", () => {
  game.dispose();
});
