import * as THREE from "three";
import { AudioBus } from "./audio";
import { InputController } from "./input";

type GameMode = "ready" | "playing" | "paused" | "gameover";
type EnemyKind = "spark" | "prism" | "comet" | "courier" | "meteor";
type EnemyBehavior = "drift" | "zigzag" | "dive" | "swoop" | "bonus" | "meteor";
type PowerUpKind = "spread" | "shield" | "rapid";
type WaveFormation = "grid" | "v" | "lanes" | "swoop" | "mixed";
type WaveEvent = "none" | "meteor" | "bonus" | "densePrism" | "cometRush";

type UiElements = {
  score: HTMLElement;
  wave: HTMLElement;
  lives: HTMLElement;
  bestScoreStart: HTMLElement;
  bestScoreEnd: HTMLElement;
  finalScore: HTMLElement;
  comboStatus: HTMLElement;
  powerUpStatus: HTMLElement;
  waveBanner: HTMLElement;
  startPanel: HTMLElement;
  gameOverPanel: HTMLElement;
  startButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
};

type Player = {
  mesh: THREE.Group;
  shieldMesh: THREE.Mesh;
  radius: number;
  targetX: number;
  fireTimer: number;
  invulnerableTimer: number;
  spreadTimer: number;
  rapidTimer: number;
  shieldCharges: number;
  pickupPulseTimer: number;
};

type Bullet = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  radius: number;
  fromPlayer: boolean;
  damage: number;
};

type Enemy = {
  mesh: THREE.Group;
  kind: EnemyKind;
  behavior: EnemyBehavior;
  radius: number;
  hp: number;
  maxHp: number;
  score: number;
  baseX: number;
  baseY: number;
  phase: number;
  pattern: number;
  fireTimer: number;
  localTime: number;
  entranceDelay: number;
  diveTimer: number;
  diveCooldown: number;
  direction: number;
  drop: PowerUpKind | null;
  bonus: boolean;
};

type Particle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: THREE.Vector3;
};

type PowerUp = {
  mesh: THREE.Group;
  kind: PowerUpKind;
  velocity: THREE.Vector3;
  radius: number;
  life: number;
};

type FormationSlot = {
  baseX: number;
  baseY: number;
  spawnX: number;
  spawnY: number;
  behavior: EnemyBehavior;
  entranceDelay: number;
};

const HIGH_SCORE_KEY = "nova-frenzy-high-score";
const FIELD_HEIGHT = 18;
const FIELD_WIDTH = 10;
const PLAYER_Y = -7.1;
const PLAYER_FIRE_INTERVAL = 0.18;
const RAPID_FIRE_INTERVAL = 0.105;
const MAX_DELTA = 0.033;
const PLAYER_BOUNDS_PADDING = 0.7;
const COMBO_TIMER = 3.2;

const tmpVector = new THREE.Vector3();

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly input: InputController;
  private readonly audio = new AudioBus();
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  private mode: GameMode = "ready";
  private player: Player;
  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];
  private powerUps: PowerUp[] = [];
  private particles: Particle[] = [];
  private score = 0;
  private highScore = 0;
  private lives = 3;
  private wave = 1;
  private currentFormation: WaveFormation = "grid";
  private currentEvent: WaveEvent = "none";
  private waveDelay = 0;
  private waveBannerTimer = 0;
  private waveBannerText = "";
  private elapsed = 0;
  private comboTimer = 0;
  private killStreak = 0;
  private scoreMultiplier = 1;
  private worldWidth = FIELD_WIDTH;
  private worldHeight = FIELD_HEIGHT;
  private animationId = 0;
  private starGeometry: THREE.BufferGeometry;
  private starPositions: Float32Array;
  private nebula: THREE.Group;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: UiElements,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x03050a, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.input = new InputController(canvas);
    this.player = this.createPlayer();
    this.scene.add(this.player.mesh);

    const background = this.createBackground();
    this.starGeometry = background.starGeometry;
    this.starPositions = background.starPositions;
    this.nebula = background.nebula;

    this.scene.add(new THREE.AmbientLight(0x85d9ff, 0.8));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
    keyLight.position.set(0, 3, 5);
    this.scene.add(keyLight);

    const rimLight = new THREE.PointLight(0xff41c8, 18, 26, 2);
    rimLight.position.set(0, -3, 5);
    this.scene.add(rimLight);

    this.highScore = this.readHighScore();
    this.bindUi();
    this.reset(false);
    this.resize();

    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  start(): void {
    this.clock.start();
    this.animationId = window.requestAnimationFrame(this.tick);
  }

  dispose(): void {
    window.cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.input.dispose();
    this.renderer.dispose();
  }

  private bindUi(): void {
    this.ui.startButton.addEventListener("click", () => {
      this.audio.unlock();
      this.reset(true);
    });

    this.ui.restartButton.addEventListener("click", () => {
      this.audio.unlock();
      this.reset(true);
    });

    this.ui.pauseButton.addEventListener("click", () => {
      this.audio.unlock();
      if (this.mode === "playing") {
        this.mode = "paused";
      } else if (this.mode === "paused") {
        this.mode = "playing";
        this.clock.getDelta();
      }
      this.syncUi();
    });
  }

  private reset(playImmediately: boolean): void {
    this.clearDynamicObjects();
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.currentFormation = "grid";
    this.currentEvent = "none";
    this.waveDelay = 0.8;
    this.waveBannerTimer = 1.45;
    this.waveBannerText = "Wave 1";
    this.elapsed = 0;
    this.comboTimer = 0;
    this.killStreak = 0;
    this.scoreMultiplier = 1;
    this.mode = playImmediately ? "playing" : "ready";
    this.player.mesh.position.set(0, PLAYER_Y, 0.5);
    this.player.targetX = 0;
    this.player.fireTimer = PLAYER_FIRE_INTERVAL;
    this.player.invulnerableTimer = 0;
    this.player.spreadTimer = 0;
    this.player.rapidTimer = 0;
    this.player.shieldCharges = 0;
    this.player.pickupPulseTimer = 0;
    this.player.shieldMesh.visible = false;
    this.spawnWave();
    this.syncUi();

    if (playImmediately) {
      this.audio.play("wave");
    }
  }

  private clearDynamicObjects(): void {
    for (const bullet of this.bullets) {
      this.scene.remove(bullet.mesh);
    }
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.mesh);
    }
    for (const powerUp of this.powerUps) {
      this.scene.remove(powerUp.mesh);
    }
    for (const particle of this.particles) {
      this.scene.remove(particle.mesh);
    }

    this.bullets = [];
    this.enemies = [];
    this.powerUps = [];
    this.particles = [];
  }

  private readonly tick = (): void => {
    const delta = Math.min(MAX_DELTA, this.clock.getDelta());

    if (this.mode === "playing") {
      this.update(delta);
    } else {
      this.updateAmbient(delta);
      this.updateParticles(delta);
    }

    this.renderer.render(this.scene, this.camera);
    this.animationId = window.requestAnimationFrame(this.tick);
  };

  private update(delta: number): void {
    this.elapsed += delta;
    this.updateAmbient(delta);
    this.updateTimers(delta);
    this.updatePlayer(delta);
    this.updateBullets(delta);
    this.updateEnemies(delta);
    this.updatePowerUps(delta);
    this.updateParticles(delta);
    this.handleCollisions();
    this.updateWave(delta);
    this.syncUi();
  }

  private updateAmbient(delta: number): void {
    this.updateStars(delta);
    this.nebula.rotation.z += delta * 0.025;
    this.player.mesh.rotation.z = Math.sin(performance.now() * 0.002) * 0.035;
  }

  private updateTimers(delta: number): void {
    this.player.spreadTimer = Math.max(0, this.player.spreadTimer - delta);
    this.player.rapidTimer = Math.max(0, this.player.rapidTimer - delta);
    this.player.pickupPulseTimer = Math.max(0, this.player.pickupPulseTimer - delta);
    this.waveBannerTimer = Math.max(0, this.waveBannerTimer - delta);

    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - delta);
    } else {
      this.killStreak = 0;
      this.scoreMultiplier = 1;
    }

    this.player.shieldMesh.visible = this.player.shieldCharges > 0;
    if (this.player.shieldCharges > 0) {
      const pulse = 1 + Math.sin(this.elapsed * 8) * 0.05;
      this.player.shieldMesh.scale.setScalar(pulse);
      this.player.shieldMesh.rotation.z -= delta * 1.6;
      setMaterialOpacity(this.player.shieldMesh.material, 0.34 + Math.sin(this.elapsed * 7) * 0.08);
    }
  }

  private updatePlayer(delta: number): void {
    const input = this.input.state;
    const minX = -this.worldWidth / 2 + PLAYER_BOUNDS_PADDING;
    const maxX = this.worldWidth / 2 - PLAYER_BOUNDS_PADDING;

    if (input.active) {
      const ndc = new THREE.Vector2(input.normalizedX * 2 - 1, -(input.normalizedY * 2 - 1));
      this.raycaster.setFromCamera(ndc, this.camera);
      this.raycaster.ray.intersectPlane(this.pointerPlane, tmpVector);
      this.player.targetX = clamp(tmpVector.x, minX, maxX);
    }

    if (input.keyboardX !== 0) {
      this.player.targetX = clamp(this.player.targetX + input.keyboardX * delta * 8.2, minX, maxX);
    }

    const x = damp(this.player.mesh.position.x, this.player.targetX, 18, delta);
    this.player.mesh.position.x = clamp(x, minX, maxX);
    this.player.mesh.position.y = PLAYER_Y + Math.sin(this.elapsed * 5) * 0.035;
    this.player.mesh.rotation.y = (this.player.targetX - this.player.mesh.position.x) * -0.16;

    this.player.fireTimer -= delta;
    if (this.player.fireTimer <= 0) {
      this.player.fireTimer = this.player.rapidTimer > 0 ? RAPID_FIRE_INTERVAL : PLAYER_FIRE_INTERVAL;
      this.spawnPlayerBullet();
    }

    if (this.player.pickupPulseTimer > 0) {
      const pulse = 1 + this.player.pickupPulseTimer * 0.12;
      this.player.mesh.scale.setScalar(pulse);
    } else {
      this.player.mesh.scale.setScalar(1);
    }

    if (this.player.invulnerableTimer > 0) {
      this.player.invulnerableTimer -= delta;
      const visible = Math.floor(this.player.invulnerableTimer * 18) % 2 === 0;
      this.player.mesh.visible = visible;
    } else {
      this.player.mesh.visible = true;
    }
  }

  private updateBullets(delta: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.mesh.position.addScaledVector(bullet.velocity, delta);
      bullet.mesh.rotation.z += delta * (bullet.fromPlayer ? 8 : -5);

      const outOfBounds =
        bullet.mesh.position.y > this.worldHeight / 2 + 1 ||
        bullet.mesh.position.y < -this.worldHeight / 2 - 1 ||
        Math.abs(bullet.mesh.position.x) > this.worldWidth / 2 + 2;

      if (outOfBounds) {
        this.removeBullet(i);
      }
    }
  }

  private updatePowerUps(delta: number): void {
    for (let i = this.powerUps.length - 1; i >= 0; i -= 1) {
      const powerUp = this.powerUps[i];
      powerUp.life -= delta;
      powerUp.mesh.position.addScaledVector(powerUp.velocity, delta);
      powerUp.mesh.rotation.z += delta * 2.2;
      powerUp.mesh.rotation.y += delta * 1.1;
      const pulse = 1 + Math.sin(this.elapsed * 8 + i) * 0.08;
      powerUp.mesh.scale.setScalar(pulse);

      const distance = powerUp.mesh.position.distanceTo(this.player.mesh.position);
      if (distance <= powerUp.radius + this.player.radius) {
        this.applyPowerUp(powerUp.kind);
        this.scene.remove(powerUp.mesh);
        this.powerUps.splice(i, 1);
        continue;
      }

      if (powerUp.life <= 0 || powerUp.mesh.position.y < -this.worldHeight / 2 - 1) {
        this.scene.remove(powerUp.mesh);
        this.powerUps.splice(i, 1);
      }
    }
  }

  private updateEnemies(delta: number): void {
    const difficulty = 1 + Math.min(1.8, this.wave * 0.09);

    for (const enemy of this.enemies) {
      enemy.localTime += delta;
      enemy.mesh.visible = enemy.localTime >= enemy.entranceDelay;
      if (!enemy.mesh.visible) {
        continue;
      }

      this.updateEnemyMovement(enemy, delta, difficulty);
      enemy.mesh.rotation.x += delta * (0.5 + enemy.pattern * 0.03);
      enemy.mesh.rotation.y += delta * (0.8 + enemy.pattern * 0.04);

      enemy.fireTimer -= delta;
      if (enemy.fireTimer <= 0 && enemy.mesh.position.y < this.worldHeight / 2 - 1.4 && this.canEnemyFire(enemy)) {
        enemy.fireTimer = this.nextEnemyFireInterval(enemy, difficulty);
        this.spawnEnemyBullet(enemy);
      }

      if (enemy.mesh.position.y < -this.worldHeight / 2 - 1.2 || Math.abs(enemy.mesh.position.x) > this.worldWidth / 2 + 3) {
        enemy.drop = null;
        enemy.hp = 0;
      } else if (enemy.mesh.position.y < PLAYER_Y + 0.2 && enemy.behavior !== "bonus") {
        enemy.drop = null;
        this.damagePlayer(enemy.mesh.position);
        enemy.hp = 0;
      }
    }

    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      if (this.enemies[i].hp <= 0) {
        this.destroyEnemy(i);
      }
    }
  }

  private updateEnemyMovement(enemy: Enemy, delta: number, difficulty: number): void {
    const time = enemy.localTime - enemy.entranceDelay;
    const descent = Math.min(3.2, time * 0.04 * difficulty);

    switch (enemy.behavior) {
      case "zigzag": {
        const zig = Math.sin(time * (2.15 + difficulty * 0.18) + enemy.phase);
        const bob = Math.sin(time * 1.5 + enemy.phase) * 0.16;
        enemy.mesh.position.x = enemy.baseX + zig * 0.9;
        enemy.mesh.position.y = enemy.baseY + bob - descent;
        break;
      }
      case "dive": {
        enemy.diveCooldown -= delta;
        if (enemy.diveCooldown <= 0 && enemy.diveTimer <= 0) {
          enemy.diveTimer = 1.15;
          enemy.diveCooldown = randomRange(3.2, 5.4);
          enemy.direction = this.player.mesh.position.x >= enemy.mesh.position.x ? 1 : -1;
          this.spawnSpark(enemy.mesh.position, 0xffdf72, 5);
        }

        if (enemy.diveTimer > 0) {
          enemy.diveTimer -= delta;
          enemy.mesh.position.y -= delta * (3.9 + difficulty * 0.75);
          enemy.mesh.position.x += enemy.direction * delta * 1.2;
          enemy.mesh.scale.setScalar(1.14 + Math.sin(time * 18) * 0.04);
        } else {
          const sway = Math.sin(time * 1.05 + enemy.phase) * 0.42;
          enemy.mesh.position.x = enemy.baseX + sway;
          enemy.mesh.position.y = enemy.baseY + Math.sin(time * 1.4 + enemy.phase) * 0.16 - descent;
          enemy.mesh.scale.setScalar(enemy.diveCooldown < 0.55 ? 1.18 : 1);
        }
        break;
      }
      case "swoop": {
        const path = Math.min(1, time / 2.2);
        const eased = 1 - Math.pow(1 - path, 3);
        const laneX = enemy.baseX + Math.sin(time * 2.4 + enemy.phase) * 0.75;
        enemy.mesh.position.x = damp(enemy.mesh.position.x, laneX, 3.2, delta);
        enemy.mesh.position.y = enemy.baseY - eased * 3.8 + Math.sin(time * 3.2 + enemy.phase) * 0.22;
        break;
      }
      case "bonus": {
        enemy.mesh.position.x = enemy.baseX + enemy.direction * time * (2.2 + difficulty * 0.2);
        enemy.mesh.position.y = enemy.baseY + Math.sin(time * 5 + enemy.phase) * 0.18;
        enemy.mesh.rotation.z += delta * 2.4;
        break;
      }
      case "meteor": {
        enemy.mesh.position.x = enemy.baseX + enemy.direction * time * 0.55;
        enemy.mesh.position.y = enemy.baseY - time * (3.8 + difficulty * 0.45);
        enemy.mesh.rotation.z += delta * 3.4;
        break;
      }
      case "drift":
      default: {
        const bob = Math.sin(time * (1.3 + enemy.pattern * 0.16) + enemy.phase);
        const sway = Math.sin(time * (0.9 + enemy.pattern * 0.11) + enemy.phase * 0.7);
        const drift = Math.sin(time * 0.27 + enemy.phase) * 0.55;
        enemy.mesh.position.x = enemy.baseX + sway * (0.42 + enemy.pattern * 0.02) + drift;
        enemy.mesh.position.y = enemy.baseY + bob * 0.18 - descent;
        break;
      }
    }
  }

  private canEnemyFire(enemy: Enemy): boolean {
    if (this.wave === 1) {
      return false;
    }

    return enemy.behavior !== "bonus" && enemy.behavior !== "meteor" && enemy.diveTimer <= 0;
  }

  private nextEnemyFireInterval(enemy: Enemy, difficulty: number): number {
    switch (enemy.kind) {
      case "prism":
        return randomRange(2.45, 4.1) / difficulty;
      case "comet":
        return randomRange(2.15, 3.7) / difficulty;
      default:
        return randomRange(1.85, 3.7) / difficulty;
    }
  }

  private updateParticles(delta: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.life -= delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.velocity.multiplyScalar(1 - delta * 1.6);
      particle.mesh.rotation.x += particle.spin.x * delta;
      particle.mesh.rotation.y += particle.spin.y * delta;
      particle.mesh.rotation.z += particle.spin.z * delta;

      const scale = Math.max(0.001, particle.life / particle.maxLife);
      particle.mesh.scale.setScalar(scale);
      setMaterialOpacity(particle.mesh.material, Math.min(1, scale * 1.25));

      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  private handleCollisions(): void {
    for (let bulletIndex = this.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = this.bullets[bulletIndex];

      if (bullet.fromPlayer) {
        for (let enemyIndex = this.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
          const enemy = this.enemies[enemyIndex];
          if (!enemy.mesh.visible) {
            continue;
          }

          const distance = bullet.mesh.position.distanceTo(enemy.mesh.position);

          if (distance <= bullet.radius + enemy.radius) {
            enemy.hp -= bullet.damage;
            this.score += 5;
            this.spawnSpark(bullet.mesh.position, 0x73f7ff, 4);
            this.removeBullet(bulletIndex);
            this.audio.play("enemyHit");

            if (enemy.hp <= 0) {
              this.registerEnemyKill(enemy);
              this.destroyEnemy(enemyIndex);
            }
            break;
          }
        }
      } else {
        const distance = bullet.mesh.position.distanceTo(this.player.mesh.position);
        if (distance <= bullet.radius + this.player.radius) {
          this.removeBullet(bulletIndex);
          this.damagePlayer(bullet.mesh.position);
        }
      }
    }

    for (let enemyIndex = this.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
      const enemy = this.enemies[enemyIndex];
      if (enemy.behavior === "bonus" || !enemy.mesh.visible) {
        continue;
      }

      const distance = enemy.mesh.position.distanceTo(this.player.mesh.position);
      if (distance <= enemy.radius + this.player.radius) {
        enemy.drop = null;
        enemy.hp = 0;
        this.damagePlayer(enemy.mesh.position);
        this.destroyEnemy(enemyIndex);
      }
    }
  }

  private updateWave(delta: number): void {
    if (this.enemies.length > 0) {
      return;
    }

    this.waveDelay -= delta;
    if (this.waveDelay <= 0) {
      this.wave += 1;
      this.elapsed = 0;
      this.spawnWave();
      this.audio.play("wave");
      this.waveDelay = 0.75;
    }
  }

  private spawnWave(): void {
    this.currentEvent = this.pickWaveEvent();
    this.currentFormation = this.pickWaveFormation(this.currentEvent);

    const enemyCount = this.enemyCountForCurrentWave();
    this.showWaveBanner(this.waveTitle());

    for (let i = 0; i < enemyCount; i += 1) {
      const kind = this.pickEnemyKind(i, this.currentEvent);
      const slot = this.getFormationSlot(i, enemyCount, this.currentFormation);
      const behavior = this.behaviorForEnemy(kind, slot.behavior);
      const enemy = this.createEnemy(kind, i, behavior);
      enemy.baseX = slot.baseX;
      enemy.baseY = slot.baseY;
      enemy.entranceDelay = slot.entranceDelay;
      enemy.mesh.position.set(slot.spawnX, slot.spawnY, 0.45);
      this.enemies.push(enemy);
      this.scene.add(enemy.mesh);
    }

    if (this.currentEvent === "bonus") {
      this.spawnBonusCourier();
    }

    if (this.currentEvent === "meteor") {
      this.spawnMeteorSweep();
    }
  }

  private pickWaveEvent(): WaveEvent {
    if (this.wave <= 2) {
      return "none";
    }

    if (this.wave % 12 === 0) {
      return "meteor";
    }

    if (this.wave % 7 === 0) {
      return "cometRush";
    }

    if (this.wave % 5 === 0) {
      return "densePrism";
    }

    if (this.wave % 4 === 0) {
      return "bonus";
    }

    return "none";
  }

  private pickWaveFormation(event: WaveEvent): WaveFormation {
    if (event === "cometRush") {
      return "swoop";
    }

    if (event === "densePrism") {
      return "lanes";
    }

    if (event === "meteor") {
      return "mixed";
    }

    const formations: WaveFormation[] = ["grid", "v", "lanes", "swoop", "mixed"];
    return formations[this.wave % formations.length];
  }

  private enemyCountForCurrentWave(): number {
    if (this.currentEvent === "cometRush") {
      return Math.min(7 + Math.floor(this.wave / 2), 13);
    }

    if (this.currentEvent === "densePrism") {
      return Math.min(12 + Math.floor(this.wave / 3), 18);
    }

    if (this.currentEvent === "meteor") {
      return Math.min(7 + Math.floor(this.wave / 4), 12);
    }

    return Math.min(8 + this.wave, 18);
  }

  private waveTitle(): string {
    switch (this.currentEvent) {
      case "bonus":
        return `Wave ${this.wave}: Bonus Courier`;
      case "densePrism":
        return `Wave ${this.wave}: Prism Bloom`;
      case "cometRush":
        return `Wave ${this.wave}: Comet Rush`;
      case "meteor":
        return `Wave ${this.wave}: Meteor Sweep`;
      default:
        return `Wave ${this.wave}`;
    }
  }

  private getFormationSlot(index: number, count: number, formation: WaveFormation): FormationSlot {
    const top = this.worldHeight / 2 - 2.1;

    switch (formation) {
      case "v": {
        const row = Math.floor((index + 1) / 2);
        const side = index === 0 ? 0 : index % 2 === 0 ? 1 : -1;
        const baseX = clamp(side * (0.45 + row * 0.72), -this.worldWidth / 2 + 1.1, this.worldWidth / 2 - 1.1);
        const baseY = top - row * 0.72;
        return { baseX, baseY, spawnX: baseX, spawnY: baseY + 0.7, behavior: "drift", entranceDelay: index * 0.035 };
      }
      case "lanes": {
        const columns = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(count))));
        const row = Math.floor(index / columns);
        const column = index % columns;
        const spacingX = Math.min(1.8, (this.worldWidth - 2.2) / Math.max(1, columns - 1));
        const baseX = -((columns - 1) * spacingX) / 2 + column * spacingX;
        const baseY = top - row * 1.2 - (column % 2) * 0.25;
        return {
          baseX,
          baseY,
          spawnX: baseX,
          spawnY: baseY + row * 0.18,
          behavior: column % 2 === 0 ? "zigzag" : "drift",
          entranceDelay: row * 0.08,
        };
      }
      case "swoop": {
        const lanes = Math.min(6, Math.max(3, Math.ceil(count / 2)));
        const row = Math.floor(index / lanes);
        const column = index % lanes;
        const side = index % 2 === 0 ? -1 : 1;
        const spacingX = Math.min(1.5, (this.worldWidth - 2.1) / Math.max(1, lanes - 1));
        const baseX = -((lanes - 1) * spacingX) / 2 + column * spacingX;
        const baseY = top - row * 1.05;
        return {
          baseX,
          baseY,
          spawnX: side * (this.worldWidth / 2 + 1.25),
          spawnY: baseY + 0.75,
          behavior: "swoop",
          entranceDelay: index * 0.075,
        };
      }
      case "mixed": {
        const ring = Math.floor(index / 6);
        const angle = (index / Math.max(1, count)) * Math.PI * 2 + this.wave * 0.23;
        const radius = 1.1 + ring * 0.95;
        const baseX = clamp(Math.cos(angle) * radius, -this.worldWidth / 2 + 1.1, this.worldWidth / 2 - 1.1);
        const baseY = top - ring * 0.9 + Math.sin(angle) * 0.35;
        return {
          baseX,
          baseY,
          spawnX: baseX,
          spawnY: baseY + 0.9,
          behavior: index % 3 === 0 ? "zigzag" : "drift",
          entranceDelay: index * 0.045,
        };
      }
      case "grid":
      default: {
        const columns = Math.min(6, Math.max(4, Math.ceil(Math.sqrt(count + 2))));
        const row = Math.floor(index / columns);
        const column = index % columns;
        const spacingX = Math.min(1.55, (this.worldWidth - 2.1) / Math.max(1, columns - 1));
        const startX = -((columns - 1) * spacingX) / 2;
        const baseX = startX + column * spacingX + (row % 2 === 0 ? 0 : spacingX * 0.28);
        const baseY = top - row * 1.05;
        return { baseX, baseY, spawnX: baseX, spawnY: baseY, behavior: "drift", entranceDelay: row * 0.055 };
      }
    }
  }

  private pickEnemyKind(index: number, event: WaveEvent): EnemyKind {
    if (event === "densePrism") {
      return "prism";
    }

    if (event === "cometRush") {
      return "comet";
    }

    const selector = (index + this.wave) % 6;

    if (selector === 0 && this.wave > 2) {
      return "comet";
    }

    if (selector <= 2 && this.wave > 1) {
      return "prism";
    }

    return "spark";
  }

  private behaviorForEnemy(kind: EnemyKind, formationBehavior: EnemyBehavior): EnemyBehavior {
    switch (kind) {
      case "prism":
        return "zigzag";
      case "comet":
        return formationBehavior === "swoop" ? "swoop" : "dive";
      case "courier":
        return "bonus";
      case "meteor":
        return "meteor";
      default:
        return formationBehavior;
    }
  }

  private spawnBonusCourier(): void {
    const enemy = this.createEnemy("courier", this.enemies.length, "bonus");
    const fromLeft = this.wave % 2 === 0;
    enemy.baseX = fromLeft ? -this.worldWidth / 2 - 1.1 : this.worldWidth / 2 + 1.1;
    enemy.baseY = this.worldHeight / 2 - 4.4;
    enemy.direction = fromLeft ? 1 : -1;
    enemy.drop = this.randomPowerUpKind();
    enemy.mesh.position.set(enemy.baseX, enemy.baseY, 0.55);
    this.enemies.push(enemy);
    this.scene.add(enemy.mesh);
  }

  private spawnMeteorSweep(): void {
    const count = Math.min(4 + Math.floor(this.wave / 4), 8);
    for (let i = 0; i < count; i += 1) {
      const enemy = this.createEnemy("meteor", this.enemies.length + i, "meteor");
      enemy.baseX = randomRange(-this.worldWidth / 2 + 0.9, this.worldWidth / 2 - 0.9);
      enemy.baseY = this.worldHeight / 2 + 0.8 + i * 0.55;
      enemy.direction = i % 2 === 0 ? 1 : -1;
      enemy.entranceDelay = i * 0.2;
      enemy.drop = Math.random() < 0.16 ? this.randomPowerUpKind() : null;
      enemy.mesh.position.set(enemy.baseX, enemy.baseY, 0.5);
      this.enemies.push(enemy);
      this.scene.add(enemy.mesh);
    }
  }

  private randomPowerUpKind(): PowerUpKind {
    const kinds: PowerUpKind[] = ["spread", "shield", "rapid"];
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  private showWaveBanner(text: string): void {
    this.waveBannerText = text;
    this.waveBannerTimer = 1.55;
  }

  private createPlayer(): Player {
    const group = new THREE.Group();

    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0x8ff7ff,
      emissive: 0x21c8ff,
      emissiveIntensity: 1.5,
      metalness: 0.25,
      roughness: 0.28,
    });
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xfcff7d,
      emissive: 0xffef47,
      emissiveIntensity: 2,
      metalness: 0.15,
      roughness: 0.18,
    });
    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0xff43cc,
      emissive: 0xff1cab,
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 0.3,
    });

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.05, 4), hullMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.y = 0.2;
    group.add(nose);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), coreMaterial);
    core.scale.set(0.9, 1.15, 0.55);
    core.position.y = -0.18;
    group.add(core);

    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.12), wingMaterial);
    leftWing.position.set(-0.42, -0.42, -0.02);
    leftWing.rotation.z = -0.32;
    group.add(leftWing);

    const rightWing = leftWing.clone();
    rightWing.position.x = 0.42;
    rightWing.rotation.z = 0.32;
    group.add(rightWing);

    const trail = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.75, 16),
      new THREE.MeshBasicMaterial({
        color: 0x47eaff,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
      }),
    );
    trail.rotation.x = -Math.PI / 2;
    trail.position.y = -0.8;
    group.add(trail);

    const shieldMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.74, 0.035, 8, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf9ff7e,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
      }),
    );
    shieldMesh.rotation.x = Math.PI / 2;
    shieldMesh.visible = false;
    group.add(shieldMesh);

    group.position.set(0, PLAYER_Y, 0.5);

    return {
      mesh: group,
      shieldMesh,
      radius: 0.45,
      targetX: 0,
      fireTimer: PLAYER_FIRE_INTERVAL,
      invulnerableTimer: 0,
      spreadTimer: 0,
      rapidTimer: 0,
      shieldCharges: 0,
      pickupPulseTimer: 0,
    };
  }

  private createEnemy(kind: EnemyKind, index: number, behavior: EnemyBehavior): Enemy {
    const group = new THREE.Group();
    const palette = {
      spark: {
        color: 0xff4fcf,
        emissive: 0xff168f,
        geometry: new THREE.TetrahedronGeometry(0.46, 0),
        hp: 1,
        score: 80,
        radius: 0.48,
      },
      prism: {
        color: 0x7cff91,
        emissive: 0x25ff63,
        geometry: new THREE.OctahedronGeometry(0.52, 0),
        hp: 2,
        score: 140,
        radius: 0.54,
      },
      comet: {
        color: 0xffc653,
        emissive: 0xff7a1f,
        geometry: new THREE.IcosahedronGeometry(0.5, 0),
        hp: 3,
        score: 210,
        radius: 0.58,
      },
      courier: {
        color: 0x76f8ff,
        emissive: 0x24ddff,
        geometry: new THREE.DodecahedronGeometry(0.56, 0),
        hp: 2,
        score: 450,
        radius: 0.62,
      },
      meteor: {
        color: 0xff7a2f,
        emissive: 0xff3f1f,
        geometry: new THREE.IcosahedronGeometry(0.45, 0),
        hp: 2,
        score: 130,
        radius: 0.5,
      },
    }[kind];

    const material = new THREE.MeshStandardMaterial({
      color: palette.color,
      emissive: palette.emissive,
      emissiveIntensity: 1.6,
      metalness: 0.2,
      roughness: 0.32,
    });

    const core = new THREE.Mesh(palette.geometry, material);
    group.add(core);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.028, 6, 32),
      new THREE.MeshBasicMaterial({
        color: palette.color,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    if (kind === "comet" || kind === "meteor") {
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.8, 16),
        new THREE.MeshBasicMaterial({
          color: kind === "meteor" ? 0xff8f55 : 0xffdf72,
          transparent: true,
          opacity: 0.48,
          blending: THREE.AdditiveBlending,
        }),
      );
      tail.rotation.x = -Math.PI / 2;
      tail.position.y = 0.58;
      group.add(tail);
    }

    if (kind === "courier") {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.035, 8, 36),
        new THREE.MeshBasicMaterial({
          color: 0xf9ff7e,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
        }),
      );
      halo.rotation.x = Math.PI / 2;
      group.add(halo);
    }

    const hp = palette.hp + (kind === "courier" || kind === "meteor" ? 0 : Math.floor(this.wave / 7));

    return {
      mesh: group,
      kind,
      behavior,
      radius: palette.radius,
      hp,
      maxHp: hp,
      score: palette.score,
      baseX: 0,
      baseY: 0,
      phase: randomRange(0, Math.PI * 2),
      pattern: index + this.wave,
      fireTimer: randomRange(1.45, 3.35),
      localTime: 0,
      entranceDelay: 0,
      diveTimer: 0,
      diveCooldown: randomRange(2.1, 4.2),
      direction: Math.random() > 0.5 ? 1 : -1,
      drop: kind === "courier" ? this.randomPowerUpKind() : Math.random() < 0.09 ? this.randomPowerUpKind() : null,
      bonus: kind === "courier",
    };
  }

  private spawnPlayerBullet(): void {
    const material = new THREE.MeshBasicMaterial({
      color: this.player.spreadTimer > 0 ? 0xffc7f0 : 0x9ffcff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
    });
    const geometry = new THREE.CapsuleGeometry(0.055, 0.45, 4, 8);
    const offsets = this.player.spreadTimer > 0 ? [-0.34, 0, 0.34] : [-0.18, 0.18];

    for (const offset of offsets) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(this.player.mesh.position.x + offset, PLAYER_Y + 0.62, 0.55);
      mesh.rotation.x = Math.PI / 2;
      this.scene.add(mesh);
      this.bullets.push({
        mesh,
        velocity: new THREE.Vector3(offset * (this.player.spreadTimer > 0 ? 1.55 : 0.55), 12.6, 0),
        radius: 0.12,
        fromPlayer: true,
        damage: 1,
      });
    }

    this.audio.play("fire");
  }

  private spawnEnemyBullet(enemy: Enemy): void {
    const color =
      enemy.kind === "spark" ? 0xff4fcf : enemy.kind === "prism" ? 0x7cff91 : enemy.kind === "comet" ? 0xffc653 : 0x76f8ff;
    const origin = enemy.mesh.position.clone();
    const baseDirection = this.player.mesh.position.clone().sub(origin).normalize();
    const angles = enemy.kind === "prism" ? [-0.2, 0.2] : [0];

    for (const angle of angles) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(enemy.kind === "comet" ? 0.18 : 0.14, 12, 12),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.position.copy(origin);
      this.scene.add(mesh);

      const direction = rotateVector2(baseDirection, angle);
      const speed = (enemy.kind === "prism" ? 2.55 : 2.9) + Math.min(1.9, this.wave * 0.1);
      this.bullets.push({
        mesh,
        velocity: direction.multiplyScalar(speed),
        radius: enemy.kind === "comet" ? 0.23 : 0.2,
        fromPlayer: false,
        damage: 1,
      });
    }
  }

  private spawnPowerUp(kind: PowerUpKind, position: THREE.Vector3): void {
    const color = this.powerUpColor(kind);
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending,
      }),
    );
    group.add(core);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 8, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    group.position.copy(position);
    this.scene.add(group);
    this.powerUps.push({
      mesh: group,
      kind,
      velocity: new THREE.Vector3(0, -1.6, 0),
      radius: 0.44,
      life: 7.5,
    });
  }

  private applyPowerUp(kind: PowerUpKind): void {
    switch (kind) {
      case "spread":
        this.player.spreadTimer = 9;
        this.showWaveBanner("Spread Shot");
        break;
      case "rapid":
        this.player.rapidTimer = 8;
        this.showWaveBanner("Rapid Fire");
        break;
      case "shield":
        this.player.shieldCharges = Math.min(2, this.player.shieldCharges + 1);
        this.showWaveBanner("Shield Ready");
        break;
    }

    this.player.pickupPulseTimer = 0.85;
    this.spawnSpark(this.player.mesh.position, this.powerUpColor(kind), 16);
    this.audio.play("powerUp");
  }

  private powerUpColor(kind: PowerUpKind): number {
    switch (kind) {
      case "spread":
        return 0xff4fcf;
      case "rapid":
        return 0x76f8ff;
      case "shield":
        return 0xf9ff7e;
    }
  }

  private destroyEnemy(index: number): void {
    const [enemy] = this.enemies.splice(index, 1);
    if (!enemy) {
      return;
    }

    this.spawnExplosion(enemy.mesh.position, enemy.kind);
    if (enemy.drop !== null) {
      this.spawnPowerUp(enemy.drop, enemy.mesh.position);
    }
    this.scene.remove(enemy.mesh);
  }

  private registerEnemyKill(enemy: Enemy): void {
    this.killStreak += 1;
    this.comboTimer = COMBO_TIMER;
    this.scoreMultiplier = Math.min(5, 1 + Math.floor(this.killStreak / 5));
    this.score += enemy.score * this.scoreMultiplier;

    if (enemy.bonus) {
      this.score += 250 * this.scoreMultiplier;
      this.showWaveBanner("Bonus Snagged");
      this.spawnSpark(enemy.mesh.position, 0xf9ff7e, 24);
    }
  }

  private damagePlayer(origin: THREE.Vector3): void {
    if (this.player.invulnerableTimer > 0 || this.mode !== "playing") {
      return;
    }

    if (this.player.shieldCharges > 0) {
      this.player.shieldCharges -= 1;
      this.player.invulnerableTimer = 0.65;
      this.player.pickupPulseTimer = 0.65;
      this.spawnSpark(this.player.mesh.position, 0xf9ff7e, 18);
      this.showWaveBanner("Shield Break");
      this.audio.play("playerHit");
      return;
    }

    this.lives -= 1;
    this.player.invulnerableTimer = 1.85;
    this.killStreak = 0;
    this.comboTimer = 0;
    this.scoreMultiplier = 1;
    this.spawnExplosion(origin, "spark");
    this.spawnSpark(this.player.mesh.position, 0xfff176, 14);
    this.audio.play("playerHit");

    if (this.lives <= 0) {
      this.endGame();
    }
  }

  private endGame(): void {
    this.mode = "gameover";
    this.highScore = Math.max(this.highScore, this.score);
    window.localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
    this.audio.play("gameOver");
    this.syncUi();
  }

  private removeBullet(index: number): void {
    const [bullet] = this.bullets.splice(index, 1);
    if (bullet) {
      this.scene.remove(bullet.mesh);
    }
  }

  private spawnExplosion(position: THREE.Vector3, kind: EnemyKind): void {
    const color = kind === "spark" ? 0xff4fcf : kind === "prism" ? 0x7cff91 : 0xffc653;
    this.spawnSpark(position, color, 18);
    this.spawnSpark(position, 0x92f8ff, 7);
  }

  private spawnSpark(position: THREE.Vector3, color: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.TetrahedronGeometry(randomRange(0.045, 0.13), 0),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.position.copy(position);
      const velocity = new THREE.Vector3(
        randomRange(-2.6, 2.6),
        randomRange(-1.8, 2.8),
        randomRange(-0.25, 0.25),
      );
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        life: randomRange(0.32, 0.72),
        maxLife: 0.72,
        spin: new THREE.Vector3(randomRange(-8, 8), randomRange(-8, 8), randomRange(-8, 8)),
      });
    }
  }

  private createBackground(): {
    starGeometry: THREE.BufferGeometry;
    starPositions: Float32Array;
    nebula: THREE.Group;
  } {
    const nebula = new THREE.Group();
    const ringMaterialA = new THREE.MeshBasicMaterial({
      color: 0x1ceaff,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMaterialB = new THREE.MeshBasicMaterial({
      color: 0xff39b6,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (let i = 0; i < 5; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(3.8 + i * 1.25, 3.86 + i * 1.25, 96),
        i % 2 === 0 ? ringMaterialA : ringMaterialB,
      );
      ring.position.z = -3.4;
      ring.scale.x = 1.65;
      ring.scale.y = 0.52;
      ring.rotation.z = i * 0.41;
      nebula.add(ring);
    }
    this.scene.add(nebula);

    const starCount = 320;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      starPositions[i * 3] = randomRange(-FIELD_WIDTH, FIELD_WIDTH);
      starPositions[i * 3 + 1] = randomRange(-FIELD_HEIGHT, FIELD_HEIGHT);
      starPositions[i * 3 + 2] = randomRange(-4, -1.2);
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xb5fbff,
        size: 0.045,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(stars);

    return { starGeometry, starPositions, nebula };
  }

  private updateStars(delta: number): void {
    for (let i = 0; i < this.starPositions.length; i += 3) {
      const depth = Math.abs(this.starPositions[i + 2]);
      this.starPositions[i + 1] -= delta * (0.9 + (4 - depth) * 0.45);

      if (this.starPositions[i + 1] < -this.worldHeight / 2 - 1) {
        this.starPositions[i] = randomRange(-this.worldWidth / 2 - 2, this.worldWidth / 2 + 2);
        this.starPositions[i + 1] = this.worldHeight / 2 + randomRange(0.5, 2.2);
      }
    }

    this.starGeometry.attributes.position.needsUpdate = true;
  }

  private readonly resize = (): void => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const aspect = width / height;
    const targetAspect = FIELD_WIDTH / FIELD_HEIGHT;

    if (aspect >= targetAspect) {
      this.worldHeight = FIELD_HEIGHT;
      this.worldWidth = FIELD_HEIGHT * aspect;
    } else {
      this.worldWidth = FIELD_WIDTH;
      this.worldHeight = FIELD_WIDTH / aspect;
    }

    this.camera.left = -this.worldWidth / 2;
    this.camera.right = this.worldWidth / 2;
    this.camera.top = this.worldHeight / 2;
    this.camera.bottom = -this.worldHeight / 2;
    this.camera.near = -20;
    this.camera.far = 20;
    this.camera.position.set(0, 0, 8);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden && this.mode === "playing") {
      this.mode = "paused";
      this.syncUi();
    }
  };

  private syncUi(): void {
    this.ui.score.textContent = String(this.score);
    this.ui.wave.textContent = String(this.wave);
    this.ui.lives.textContent = String(Math.max(0, this.lives));
    this.ui.finalScore.textContent = String(this.score);
    this.ui.bestScoreStart.textContent = String(this.highScore);
    this.ui.bestScoreEnd.textContent = String(this.highScore);
    this.ui.comboStatus.textContent = this.scoreMultiplier > 1 ? `x${this.scoreMultiplier} combo` : "x1";
    this.ui.comboStatus.classList.toggle("status-pill--quiet", this.scoreMultiplier <= 1);
    this.ui.powerUpStatus.textContent = this.powerUpStatusText();
    this.ui.powerUpStatus.classList.toggle("status-pill--quiet", this.powerUpStatusText() === "Ready");
    this.ui.waveBanner.textContent = this.waveBannerText;
    this.ui.waveBanner.classList.toggle("is-visible", this.waveBannerTimer > 0);

    this.ui.startPanel.classList.toggle("panel--active", this.mode === "ready");
    this.ui.gameOverPanel.classList.toggle("panel--active", this.mode === "gameover");
    this.ui.pauseButton.classList.toggle("is-visible", this.mode === "playing" || this.mode === "paused");
    this.ui.pauseButton.classList.toggle("is-paused", this.mode === "paused");
    this.ui.pauseButton.ariaLabel = this.mode === "paused" ? "Resume" : "Pause";
  }

  private readHighScore(): number {
    const value = Number(window.localStorage.getItem(HIGH_SCORE_KEY));
    return Number.isFinite(value) ? value : 0;
  }

  private powerUpStatusText(): string {
    const active: string[] = [];

    if (this.player.spreadTimer > 0) {
      active.push(`Spread ${Math.ceil(this.player.spreadTimer)}`);
    }

    if (this.player.rapidTimer > 0) {
      active.push(`Rapid ${Math.ceil(this.player.rapidTimer)}`);
    }

    if (this.player.shieldCharges > 0) {
      active.push(`Shield ${this.player.shieldCharges}`);
    }

    return active.length > 0 ? active.join(" | ") : "Ready";
  }
}

function damp(current: number, target: number, lambda: number, delta: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * delta));
}

function rotateVector2(vector: THREE.Vector3, radians: number): THREE.Vector3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return new THREE.Vector3(vector.x * cos - vector.y * sin, vector.x * sin + vector.y * cos, vector.z).normalize();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function setMaterialOpacity(material: THREE.Material | THREE.Material[], opacity: number): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      setMaterialOpacity(entry, opacity);
    }
    return;
  }

  material.transparent = true;
  material.opacity = opacity;
}
