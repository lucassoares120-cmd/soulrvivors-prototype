import Phaser from 'phaser';
import './style.css';

const GAME_WIDTH = 960;
const GAME_HEIGHT = 540;
const WORLD_SIZE = 3000;

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
  }

  create() {
    this.createBackground();
    this.createGroups();
    this.createPlayer();
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
    this.player = this.add.circle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 18, 0x4fd7ff);
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
    this.gemMagnetRadius = 140;
    this.gemMagnetRadiusSq = this.gemMagnetRadius * this.gemMagnetRadius;
    this.gemMagnetSpeed = 280;

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBounds(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE);

    this.physics.world.setBounds(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE);
  }

  createInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,S,A,D');
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

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
      xpBarBg: this.add.rectangle(16, 112, 220, 12, 0x1e2a47).setOrigin(0, 0).setScrollFactor(0),
      xpBarFill: this.add.rectangle(16, 112, 220, 12, 0x5fe87a).setOrigin(0, 0).setScrollFactor(0),
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
    }

    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;
      this.physics.moveToObject(enemy, this.player, enemy.speed);
    });

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
    this.player.setTint(0xb3e8ff);
    this.player.setScale(1.2);

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

    this.updateDashHud();
  }

  finishDash() {
    if (!this.isDashing) return;

    this.isDashing = false;
    this.player.clearTint();
    this.player.setScale(1);
    console.debug('dash end');
  }

  updateDashHud() {
    if (this.stats.gameOver) {
      this.hud.dash.setText('DASH: -');
      return;
    }

    const remaining = Math.max(0, this.dashReadyAt - this.time.now);
    if (remaining <= 0 && !this.isDashing) {
      this.hud.dash.setText('DASH: PRONTO');
      return;
    }

    this.hud.dash.setText(`DASH: ${(remaining / 1000).toFixed(1)}s`);
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
      this.dropGem(enemy.x, enemy.y);
      enemy.destroy();
    }
  }

  damagePlayer(player, enemy) {
    if (this.time.now < this.playerInvulnerableUntil) return;
    if (enemy.lastHit && this.time.now - enemy.lastHit < 450) return;

    enemy.lastHit = this.time.now;
    this.playerInvulnerableUntil = this.time.now + 500;
    this.startPlayerBlink(300);

    this.stats.hp = Math.max(0, this.stats.hp - 8);
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
    gem.xpValue = 1;
    this.gems.add(gem);
  }

  collectGem(player, gem) {
    gem.destroy();
    this.stats.xp += gem.xpValue;

    while (this.stats.xp >= this.stats.xpToNext) {
      this.stats.xp -= this.stats.xpToNext;
      this.stats.level += 1;
      this.stats.xpToNext = Math.floor(this.stats.xpToNext * 1.35);
      this.openUpgradeMenu();
      break;
    }

    this.updateHud();
  }

  updateGemMagnet() {
    this.gems.children.iterate((gem) => {
      if (!gem || !gem.active) return;

      const dx = this.player.x - gem.x;
      const dy = this.player.y - gem.y;
      const distSq = (dx * dx) + (dy * dy);

      if (distSq > this.gemMagnetRadiusSq || distSq <= 0.0001) return;

      const invDist = 1 / Math.sqrt(distSq);
      const targetVx = dx * invDist * this.gemMagnetSpeed;
      const targetVy = dy * invDist * this.gemMagnetSpeed;

      gem.body.velocity.x += (targetVx - gem.body.velocity.x) * 0.2;
      gem.body.velocity.y += (targetVy - gem.body.velocity.y) * 0.2;
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
