import Phaser from 'phaser';
import './style.css';

const GAME_WIDTH = 960;
const GAME_HEIGHT = 540;
const WORLD_SIZE = 3000;
const PLAYER_COLOR_NORMAL = 0x4fd7ff;
const PLAYER_COLOR_DASH = 0x7ce6ff;


class AudioManager {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.muted = false;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    return this.ctx;
  }

  unlock() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    this.unlocked = true;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  canPlay() {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (!this.unlocked || this.muted) return false;
    return true;
  }

  beep({ type = 'sine', freq = 440, duration = 0.08, gain = 0.04, rampTo = null, when = 0 } = {}) {
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + when;
    const end = start + duration;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, freq), start);

    if (rampTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, rampTo), end);
    }

    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.01);
  }

  playShoot() {
    this.beep({ type: 'square', freq: 940, duration: 0.035, gain: 0.02, rampTo: 760 });
  }

  playDash() {
    this.beep({ type: 'triangle', freq: 520, duration: 0.11, gain: 0.035, rampTo: 180 });
  }

  playXp() {
    this.beep({ type: 'sine', freq: 620, duration: 0.05, gain: 0.03, rampTo: 860 });
  }

  playDamage() {
    this.beep({ type: 'sawtooth', freq: 180, duration: 0.09, gain: 0.04, rampTo: 110 });
  }

  playLevelUp() {
    this.beep({ type: 'sine', freq: 500, duration: 0.08, gain: 0.03, when: 0.0 });
    this.beep({ type: 'sine', freq: 680, duration: 0.08, gain: 0.03, when: 0.09 });
    this.beep({ type: 'triangle', freq: 860, duration: 0.11, gain: 0.03, when: 0.18 });
  }

  playGameOver() {
    this.beep({ type: 'sawtooth', freq: 170, duration: 0.24, gain: 0.05, rampTo: 75 });
  }
}

class GameScene extends Phaser.Scene {
  constructor() {
    super('game');

    this.stats = {
      hp: 100,
      maxHp: 100,
      xp: 0,
      xpToNext: 10,
      level: 1,
      elapsedSeconds: 0,
      isPaused: false,
      gameOver: false,
    };

    this.upgradeMenu = {
      active: false,
      options: [],
    };

    this.audio = new AudioManager();
  }

  create() {
    this.createBackground();
    this.createGroups();
    this.createPlayer();
    this.createParticleSystems();
    this.createInput();
    this.createHud();
    this.createSystems();
    this.createUpgradeOverlay();
    this.bindPause();
  }

  createBackground() {
    this.cameras.main.setBackgroundColor('#101526');

    const grid = this.add.grid(0, 0, WORLD_SIZE, WORLD_SIZE, 64, 64, 0x13203a, 0, 0x1f2d4d, 0.3);
    grid.setOrigin(0.5);
  }

  createGroups() {
    this.enemies = this.physics.add.group();
    this.bullets = this.physics.add.group();
    this.gems = this.physics.add.group();
  }

  createPlayer() {
    this.player = this.add.circle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 18, PLAYER_COLOR_NORMAL);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setCircle(18);

    this.speed = 220;
    this.fireCooldown = 380;
    this.fireRange = 420;
    this.bulletSpeed = 460;
    this.bulletDamage = 1;
    this.playerInvulnerableUntil = 0;
    this.playerBlinkEvent = null;

    this.lastMoveDirection = new Phaser.Math.Vector2(1, 0);
    this.isDashing = false;
    this.dashSpeedMultiplier = 4.5;
    this.dashDuration = 120;
    this.dashCooldown = 1200;
    this.dashReadyAt = 0;
    this.dashEndAt = 0;
    this.dashDirection = new Phaser.Math.Vector2(1, 0);

    // Coleta magnética simples de XP (sem cálculo pesado).
    this.baseGemMagnetRadius = 140;
    this.baseGemMagnetSpeed = 280;
    this.gemMagnetRadius = this.baseGemMagnetRadius;
    this.gemMagnetSpeed = this.baseGemMagnetSpeed;
    this.gemMagnetRadiusSq = this.gemMagnetRadius * this.gemMagnetRadius;
    this.baseGemMaxSpeed = 420;
    this.gemMaxSpeed = this.baseGemMaxSpeed;

    this.superMagnetEndAt = 0;

    this.knockbackUntil = 0;
    this.knockbackDuration = 110;
    this.knockbackVelocity = new Phaser.Math.Vector2(0, 0);

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBounds(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE);

    this.physics.world.setBounds(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE);
  }


  createParticleSystems() {
    if (!this.textures.exists('fx-dot')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(2, 2, 2);
      g.generateTexture('fx-dot', 4, 4);
      g.destroy();
    }

    this.particleManager = this.add.particles(0, 0, 'fx-dot', {
      emitting: false,
    });

    this.enemyBurstEmitter = this.particleManager.createEmitter({
      speed: { min: 70, max: 170 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 260,
      blendMode: 'ADD',
      tint: [0xff9559, 0xff4f4f],
      emitting: false,
    });

    this.xpBurstEmitter = this.particleManager.createEmitter({
      speed: { min: 60, max: 130 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 220,
      blendMode: 'ADD',
      tint: [0x8fff98, 0xe9ff73],
      emitting: false,
    });

    this.dashTrailEmitter = this.particleManager.createEmitter({
      speed: { min: 15, max: 55 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.28, end: 0 },
      lifespan: 220,
      frequency: 36,
      blendMode: 'ADD',
      tint: [0x7ce6ff, 0xb4f1ff],
      emitting: false,
    });
  }

  createInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,S,A,D');
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.input.keyboard.on('keydown-M', () => {
      this.audio.toggleMute();
      this.updateHud();
    });

    const unlockAudio = () => {
      this.audio.unlock();
      this.updateHud();
    };
    this.input.keyboard.once('keydown', unlockAudio);
    this.input.once('pointerdown', unlockAudio);

    this.input.keyboard.on('keydown-ONE', () => this.pickUpgrade(0));
    this.input.keyboard.on('keydown-TWO', () => this.pickUpgrade(1));
    this.input.keyboard.on('keydown-THREE', () => this.pickUpgrade(2));
    this.input.keyboard.on('keydown-R', () => {
      if (!this.stats.gameOver) return;
      this.hardResetGame();
    });
  }

  createHud() {
    const textStyle = { fontSize: '18px', color: '#ffffff' };

    this.hud = {
      hp: this.add.text(16, 16, '', textStyle).setScrollFactor(0),
      xp: this.add.text(16, 40, '', textStyle).setScrollFactor(0),
      timer: this.add.text(16, 64, '', textStyle).setScrollFactor(0),
      status: this.add.text(GAME_WIDTH / 2, 16, '', { fontSize: '20px', color: '#f7e479' }).setOrigin(0.5, 0).setScrollFactor(0),
      dash: this.add.text(16, 84, '', textStyle).setScrollFactor(0),
      dashBarBg: this.add.rectangle(16, 104, 220, 8, 0x2a3048).setOrigin(0, 0).setScrollFactor(0),
      dashBarFill: this.add.rectangle(16, 104, 220, 8, 0x7ce6ff).setOrigin(0, 0).setScrollFactor(0),
      xpBarBg: this.add.rectangle(16, 118, 220, 12, 0x1e2a47).setOrigin(0, 0).setScrollFactor(0),
      xpBarFill: this.add.rectangle(16, 118, 220, 12, 0x5fe87a).setOrigin(0, 0).setScrollFactor(0),
      magnet: this.add.text(16, 134, '', { fontSize: '14px', color: '#9af9ff' }).setScrollFactor(0),
      sound: this.add.text(16, 150, '', { fontSize: '14px', color: '#ffd6a0' }).setScrollFactor(0),
    };

    this.updateHud();
  }

  createSystems() {
    this.physics.add.overlap(this.bullets, this.enemies, this.hitEnemy, null, this);
    this.physics.add.overlap(this.player, this.enemies, this.damagePlayer, null, this);
    this.physics.add.overlap(this.player, this.gems, this.collectGem, null, this);

    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.stats.isPaused && !this.stats.gameOver) {
          this.stats.elapsedSeconds += 1;
          this.updateHud();
        }
      },
    });

    this.time.addEvent({
      delay: 900,
      loop: true,
      callback: () => {
        if (!this.stats.isPaused && !this.stats.gameOver) {
          this.spawnWave();
        }
      },
    });

    this.time.addEvent({
      delay: this.fireCooldown,
      loop: true,
      callback: () => {
        if (!this.stats.isPaused && !this.stats.gameOver && !this.upgradeMenu.active) {
          this.autoShoot();
        }
      },
    });
  }

  createUpgradeOverlay() {
    this.upgradeBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 620, 260, 0x05060d, 0.92)
      .setScrollFactor(0)
      .setVisible(false);

    this.upgradeTitle = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 98, 'LEVEL UP! Escolha um upgrade:', {
      fontSize: '26px',
      color: '#ffe66d',
      align: 'center',
    })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    this.upgradeTexts = [0, 1, 2].map((index) => this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 - 30 + index * 56,
      '',
      { fontSize: '22px', color: '#c8d2ff' },
    ).setOrigin(0.5).setScrollFactor(0).setVisible(false));
  }

  bindPause() {
    this.input.keyboard.on('keydown-P', () => {
      if (this.stats.gameOver || this.upgradeMenu.active) return;
      this.stats.isPaused = !this.stats.isPaused;
      this.physics.world.isPaused = this.stats.isPaused;
      this.hud.status.setText(this.stats.isPaused ? 'PAUSADO (P para voltar)' : '');
    });
  }

  update() {
    if (this.stats.isPaused || this.stats.gameOver || this.upgradeMenu.active) {
      this.player.body.setVelocity(0, 0);
      return;
    }

    let moveX = 0;
    let moveY = 0;

    if (this.cursors.left.isDown || this.wasd.A.isDown) moveX = -1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) moveX = 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) moveY = -1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) moveY = 1;

    const hasDirectionInput = moveX !== 0 || moveY !== 0;
    const magnitude = Math.hypot(moveX, moveY) || 1;
    const moveDirX = moveX / magnitude;
    const moveDirY = moveY / magnitude;

    if (hasDirectionInput) {
      this.lastMoveDirection.set(moveDirX, moveDirY);
    }

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.tryStartDash(this.lastMoveDirection.clone());
    }

    // Failsafe: nunca deixar dash preso em true.
    if (this.isDashing && this.time.now >= this.dashEndAt) {
      this.finishDash();
    }

    if (this.isDashing) {
      this.player.body.setVelocity(
        this.dashDirection.x * this.speed * this.dashSpeedMultiplier,
        this.dashDirection.y * this.speed * this.dashSpeedMultiplier,
      );
    } else {
      this.player.body.setVelocity(moveDirX * this.speed, moveDirY * this.speed);

      if (this.time.now < this.knockbackUntil) {
        const kbFactor = (this.knockbackUntil - this.time.now) / this.knockbackDuration;
        this.player.body.velocity.x += this.knockbackVelocity.x * kbFactor;
        this.player.body.velocity.y += this.knockbackVelocity.y * kbFactor;
      }
    }

    if (this.dashTrailEmitter && this.dashTrailEmitter.on) {
      this.dashTrailEmitter.setPosition(this.player.x, this.player.y);
    }

    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;
      this.physics.moveToObject(enemy, this.player, enemy.speed);
    });

    this.updateSuperMagnetState();
    this.updateGemMagnet();
    this.updateDashHud();

    this.bullets.children.iterate((bullet) => {
      if (!bullet || !bullet.active) return;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, bullet.x, bullet.y) > this.fireRange * 1.6) {
        bullet.destroy();
      }
    });
  }


  tryStartDash(direction) {
    if (this.isDashing || this.time.now < this.dashReadyAt || this.stats.gameOver) return;

    let dashDir = direction;
    if (!dashDir || dashDir.lengthSq() <= 0) {
      dashDir = this.lastMoveDirection?.clone() || new Phaser.Math.Vector2(1, 0);
    }
    if (dashDir.lengthSq() <= 0) {
      dashDir = new Phaser.Math.Vector2(1, 0);
    }

    dashDir.normalize();
    this.dashDirection = dashDir;
    this.isDashing = true;
    this.dashEndAt = this.time.now + this.dashDuration;
    this.dashReadyAt = this.time.now + this.dashCooldown;

    // Dash concede i-frames durante sua duração.
    this.playerInvulnerableUntil = Math.max(this.playerInvulnerableUntil, this.dashEndAt);

    // Feedback mínimo e seguro do dash.
    this.setPlayerDashVisual(true);

    console.debug('dash start', {
      now: this.time.now,
      endAt: this.dashEndAt,
      readyAt: this.dashReadyAt,
      dirX: this.dashDirection.x,
      dirY: this.dashDirection.y,
    });

    this.time.delayedCall(this.dashDuration, () => {
      this.finishDash();
    });

    this.startDashTrail(260);
    this.audio.playDash();
    this.updateDashHud();
  }

  finishDash() {
    if (!this.isDashing) return;

    this.isDashing = false;
    this.setPlayerDashVisual(false);
    if (this.dashTrailEmitter) this.dashTrailEmitter.stop();
    console.debug('dash end');
  }



  startDashTrail(durationMs = 260) {
    if (!this.dashTrailEmitter) return;

    this.dashTrailEmitter.setPosition(this.player.x, this.player.y);
    this.dashTrailEmitter.start();

    if (this.dashTrailStopEvent) this.dashTrailStopEvent.remove(false);
    this.dashTrailStopEvent = this.time.delayedCall(durationMs, () => {
      if (this.dashTrailEmitter) this.dashTrailEmitter.stop();
      this.dashTrailStopEvent = null;
    });
  }

  emitEnemyBurst(x, y) {
    if (!this.enemyBurstEmitter) return;
    this.enemyBurstEmitter.explode(10, x, y);
  }

  emitXpBurst(x, y) {
    if (!this.xpBurstEmitter) return;
    this.xpBurstEmitter.explode(8, x, y);
  }

  showShootFlash() {
    const flash = this.add.circle(this.player.x, this.player.y, 8, 0xfff2a8, 0.65);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.8,
      duration: 60,
      onComplete: () => flash.destroy(),
    });
  }

  setPlayerDamageVisual(isDamaged) {
    if (this.player && typeof this.player.setFillStyle === 'function') {
      if (isDamaged) this.player.setFillStyle(0xff7a7a, 1);
      else this.setPlayerDashVisual(this.isDashing);
      return;
    }

    if (this.player && typeof this.player.setTint === 'function') {
      if (isDamaged) this.player.setTint(0xff8080);
      else if (this.isDashing) this.player.setTint(PLAYER_COLOR_DASH);
      else this.player.clearTint();
    }
  }

  applyKnockbackFromEnemy(enemy) {
    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const len = Math.hypot(dx, dy) || 1;
    this.knockbackVelocity.set((dx / len) * 280, (dy / len) * 280);
    this.knockbackUntil = this.time.now + this.knockbackDuration;
  }

  setPlayerDashVisual(isDashing) {
    // Preferência 1: Shape (Circle/Arc/Rectangle/etc.)
    if (this.player && typeof this.player.setFillStyle === 'function') {
      if (isDashing) {
        this.player.setFillStyle(PLAYER_COLOR_DASH, 1);
      } else {
        this.player.setFillStyle(PLAYER_COLOR_NORMAL, 1);
      }
      this.player.setScale(isDashing ? 1.2 : 1);
      return;
    }

    // Preferência 2: Sprite/Image (se um dia trocar por sprite)
    if (this.player && typeof this.player.setTint === 'function') {
      if (isDashing) this.player.setTint(PLAYER_COLOR_DASH);
      else this.player.clearTint();
      this.player.setScale(isDashing ? 1.2 : 1);
      return;
    }

    // Fallback: pelo menos não quebra
    if (this.player) {
      this.player.alpha = isDashing ? 0.85 : 1;
      if (typeof this.player.setScale === 'function') this.player.setScale(isDashing ? 1.2 : 1);
    }
  }

  updateDashHud() {
    if (!this.hud?.dash || !this.hud?.dashBarFill) return;

    if (this.stats.gameOver) {
      this.hud.dash.setText('DASH: -');
      this.hud.dashBarFill.setScale(0, 1);
      return;
    }

    const remaining = Math.max(0, this.dashReadyAt - this.time.now);
    const isReady = remaining <= 0 && !this.isDashing;

    if (isReady) {
      this.hud.dash.setText('DASH: PRONTO');
      this.hud.dashBarFill.setScale(1, 1);
      return;
    }

    this.hud.dash.setText(`DASH: ${Math.max(0, remaining / 1000).toFixed(1)}s`);
    const charge = Phaser.Math.Clamp(1 - (remaining / this.dashCooldown), 0, 1);
    this.hud.dashBarFill.setScale(charge, 1);
  }

  spawnWave() {
    const levelScale = 1 + Math.floor(this.stats.elapsedSeconds / 15);
    const count = Phaser.Math.Clamp(levelScale, 1, 6);

    for (let i = 0; i < count; i += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(300, 480);
      const x = this.player.x + Math.cos(angle) * distance;
      const y = this.player.y + Math.sin(angle) * distance;

      const enemy = this.add.circle(x, y, 14, 0xe75a5a);
      this.physics.add.existing(enemy);
      enemy.speed = Phaser.Math.Between(70, 95) + levelScale * 8;
      enemy.hp = 2 + Math.floor(levelScale / 2);
      this.enemies.add(enemy);
    }
  }

  autoShoot() {
    const target = this.findClosestEnemy();
    if (!target) return;

    const bullet = this.add.circle(this.player.x, this.player.y, 6, 0xf8f272);
    this.physics.add.existing(bullet);
    this.bullets.add(bullet);
    this.physics.moveToObject(bullet, target, this.bulletSpeed);
    this.showShootFlash();
    this.audio.playShoot();
  }

  findClosestEnemy() {
    let closest = null;
    let minDistance = Number.MAX_SAFE_INTEGER;

    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      if (dist < minDistance) {
        minDistance = dist;
        closest = enemy;
      }
    });

    return closest;
  }

  hitEnemy(bullet, enemy) {
    bullet.destroy();
    this.flashEnemyHit(enemy);
    enemy.hp -= this.bulletDamage;

    if (enemy.hp <= 0) {
      this.emitEnemyBurst(enemy.x, enemy.y);
      this.dropGem(enemy.x, enemy.y);
      enemy.destroy();
    }
  }

  damagePlayer(player, enemy) {
    if (this.time.now < this.playerInvulnerableUntil) return;
    if (enemy.lastHit && this.time.now - enemy.lastHit < 450) return;

    enemy.lastHit = this.time.now;
    this.playerInvulnerableUntil = this.time.now + 500;
    this.startPlayerBlink(380);
    this.applyKnockbackFromEnemy(enemy);

    this.stats.hp = Math.max(0, this.stats.hp - 8);
    this.audio.playDamage();
    this.updateHud();

    if (this.stats.hp <= 0) {
      this.triggerGameOver();
    }
  }

  startPlayerBlink(durationMs = 300) {
    if (this.playerBlinkEvent) {
      this.playerBlinkEvent.remove(false);
      this.playerBlinkEvent = null;
    }

    this.setPlayerDamageVisual(true);
    this.player.alpha = 0.35;
    const blinkDelay = 60;
    const repeatCount = Math.max(0, Math.floor(durationMs / blinkDelay) - 1);

    this.playerBlinkEvent = this.time.addEvent({
      delay: blinkDelay,
      repeat: repeatCount,
      callback: () => {
        this.player.alpha = this.player.alpha < 1 ? 1 : 0.35;
      },
      callbackScope: this,
      onComplete: () => {
        this.player.alpha = 1;
        this.setPlayerDamageVisual(false);
        this.playerBlinkEvent = null;
      },
    });
  }

  flashEnemyHit(enemy) {
    if (!enemy || !enemy.active) return;

    enemy.setAlpha(0.3);
    this.time.delayedCall(100, () => {
      if (!enemy.active) return;
      enemy.setAlpha(1);
    });
  }

  dropGem(x, y) {
    const gem = this.add.star(x, y, 5, 3, 8, 0x5fe87a);
    this.physics.add.existing(gem);
    gem.body.setAllowGravity(false);
    gem.body.setVelocity(0, 0);
    gem.magnetSpeed = 0;
    gem.xpValue = 1;
    this.gems.add(gem);
  }

  collectGem(player, gem) {
    const gx = gem.x;
    const gy = gem.y;
    gem.destroy();
    this.emitXpBurst(gx, gy);
    this.stats.xp += gem.xpValue;
    this.audio.playXp();

    while (this.stats.xp >= this.stats.xpToNext) {
      this.stats.xp -= this.stats.xpToNext;
      this.stats.level += 1;
      this.stats.xpToNext = Math.floor(this.stats.xpToNext * 1.35);
      this.activateSuperMagnet(1000);
      this.audio.playLevelUp();
      this.openUpgradeMenu();
      break;
    }

    this.updateHud();
  }


  activateSuperMagnet(durationMs = 1000) {
    this.superMagnetEndAt = this.time.now + durationMs;
    this.gemMagnetRadius = 500;
    this.gemMagnetSpeed = 560;
    this.gemMagnetRadiusSq = this.gemMagnetRadius * this.gemMagnetRadius;
    this.gemMaxSpeed = 620;
  }

  updateSuperMagnetState() {
    if (this.superMagnetEndAt > 0 && this.time.now >= this.superMagnetEndAt) {
      this.superMagnetEndAt = 0;

      this.gemMagnetRadius = this.baseGemMagnetRadius;
      this.gemMagnetSpeed = this.baseGemMagnetSpeed;
      this.gemMagnetRadiusSq = this.gemMagnetRadius * this.gemMagnetRadius;
      this.gemMaxSpeed = this.baseGemMaxSpeed;
    }
  }

  updateGemMagnet() {
    const maxDistanceSq = 3000 * 3000;

    this.gems.children.iterate((gem) => {
      if (!gem || !gem.active || !gem.body) return;

      const dx = this.player.x - gem.x;
      const dy = this.player.y - gem.y;
      const distSq = (dx * dx) + (dy * dy);

      // Failsafe anti-infinito: remove gem perdida muito longe do player.
      if (distSq > maxDistanceSq) {
        gem.destroy();
        return;
      }

      if (distSq <= this.gemMagnetRadiusSq && distSq > 0.0001) {
        // Recalcula direção todo frame (seek), sem reaproveitar alvo antigo.
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        const targetSpeed = Math.min(this.gemMaxSpeed, this.gemMagnetSpeed);
        gem.magnetSpeed = Phaser.Math.Linear(gem.magnetSpeed || 0, targetSpeed, 0.22);

        gem.body.setVelocity(nx * gem.magnetSpeed, ny * gem.magnetSpeed);
        return;
      }

      // Fora do raio: freio para não continuar "voando" sozinha.
      gem.magnetSpeed = Phaser.Math.Linear(gem.magnetSpeed || 0, 0, 0.15);
      gem.body.velocity.x *= 0.85;
      gem.body.velocity.y *= 0.85;

      if (Math.abs(gem.body.velocity.x) < 2) gem.body.velocity.x = 0;
      if (Math.abs(gem.body.velocity.y) < 2) gem.body.velocity.y = 0;
    });
  }

  openUpgradeMenu() {
    this.upgradeMenu.active = true;
    this.stats.isPaused = true;
    this.physics.world.isPaused = true;

    const pool = [
      {
        label: '+20% velocidade de movimento',
        apply: () => { this.speed = Math.floor(this.speed * 1.2); },
      },
      {
        label: '-15% cooldown de tiro automático',
        apply: () => {
          this.fireCooldown = Math.max(120, Math.floor(this.fireCooldown * 0.85));
          this.time.removeAllEvents();
          this.createSystems();
        },
      },
      {
        label: '+25% velocidade do projétil',
        apply: () => { this.bulletSpeed = Math.floor(this.bulletSpeed * 1.25); },
      },
      {
        label: '+1 dano de projétil',
        apply: () => { this.bulletDamage += 1; },
      },
      {
        label: '+20 HP máximo e cura completa',
        apply: () => {
          this.stats.maxHp += 20;
          this.stats.hp = this.stats.maxHp;
        },
      },
    ];

    this.upgradeMenu.options = Phaser.Utils.Array.Shuffle(pool).slice(0, 3);

    this.upgradeBg.setVisible(true);
    this.upgradeTitle.setVisible(true);
    this.upgradeTexts.forEach((item, index) => {
      item.setText(`${index + 1}) ${this.upgradeMenu.options[index].label}`);
      item.setVisible(true);
    });
    this.hud.status.setText('Escolha com teclas 1, 2 ou 3');
  }

  pickUpgrade(index) {
    if (!this.upgradeMenu.active || !this.upgradeMenu.options[index]) return;

    this.upgradeMenu.options[index].apply();
    this.upgradeMenu.active = false;
    this.stats.isPaused = false;
    this.physics.world.isPaused = false;

    this.upgradeBg.setVisible(false);
    this.upgradeTitle.setVisible(false);
    this.upgradeTexts.forEach((item) => item.setVisible(false));
    this.hud.status.setText('');
    this.updateHud();
  }

  triggerGameOver() {
    this.stats.gameOver = true;
    this.stats.isPaused = true;
    this.physics.world.isPaused = true;
    this.hud.status.setText('GAME OVER - pressione R para reiniciar');
    this.audio.playGameOver();
  }

  hardResetGame() {
    // Hard reset garante limpeza total do estado do jogo em memória.
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
      return;
    }

    // Fallback defensivo caso reload não exista no ambiente.
    globalThis.location?.assign?.(globalThis.location.href);
  }

  updateHud() {
    this.hud.hp.setText(`HP: ${this.stats.hp}/${this.stats.maxHp} | LVL ${this.stats.level}`);
    this.hud.xp.setText(`XP: ${this.stats.xp}/${this.stats.xpToNext}`);
    this.hud.timer.setText(`Tempo: ${this.stats.elapsedSeconds}s`);
    this.updateDashHud();

    const xpRatio = Phaser.Math.Clamp(this.stats.xp / this.stats.xpToNext, 0, 1);
    this.hud.xpBarFill.setScale(xpRatio, 1);

    const magnetActive = this.superMagnetEndAt > this.time.now;
    this.hud.magnet.setText(magnetActive ? 'MAGNET: ON' : '');

    this.hud.sound.setText(this.audio.muted ? 'SOM: OFF' : 'SOM: ON');
  }
}

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'app',
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  scene: [GameScene],
};

new Phaser.Game(config);
