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

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBounds(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE);

    this.physics.world.setBounds(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE);
  }

  createInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,S,A,D');

    this.input.keyboard.on('keydown-ONE', () => this.pickUpgrade(0));
    this.input.keyboard.on('keydown-TWO', () => this.pickUpgrade(1));
    this.input.keyboard.on('keydown-THREE', () => this.pickUpgrade(2));
    this.input.keyboard.on('keydown-R', () => {
      if (this.stats.gameOver) this.scene.restart();
    });
  }

  createHud() {
    const textStyle = { fontSize: '18px', color: '#ffffff' };

    this.hud = {
      hp: this.add.text(16, 16, '', textStyle).setScrollFactor(0),
      xp: this.add.text(16, 40, '', textStyle).setScrollFactor(0),
      timer: this.add.text(16, 64, '', textStyle).setScrollFactor(0),
      status: this.add.text(GAME_WIDTH / 2, 16, '', { fontSize: '20px', color: '#f7e479' }).setOrigin(0.5, 0).setScrollFactor(0),
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

    const magnitude = Math.hypot(moveX, moveY) || 1;
    this.player.body.setVelocity((moveX / magnitude) * this.speed, (moveY / magnitude) * this.speed);

    this.enemies.children.iterate((enemy) => {
      if (!enemy || !enemy.active) return;
      this.physics.moveToObject(enemy, this.player, enemy.speed);
    });

    this.bullets.children.iterate((bullet) => {
      if (!bullet || !bullet.active) return;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, bullet.x, bullet.y) > this.fireRange * 1.6) {
        bullet.destroy();
      }
    });
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
    enemy.hp -= this.bulletDamage;

    if (enemy.hp <= 0) {
      this.dropGem(enemy.x, enemy.y);
      enemy.destroy();
    }
  }

  damagePlayer(player, enemy) {
    if (enemy.lastHit && this.time.now - enemy.lastHit < 450) return;
    enemy.lastHit = this.time.now;

    this.stats.hp = Math.max(0, this.stats.hp - 8);
    this.updateHud();

    if (this.stats.hp <= 0) {
      this.triggerGameOver();
    }
  }

  dropGem(x, y) {
    const gem = this.add.star(x, y, 5, 3, 8, 0x5fe87a);
    this.physics.add.existing(gem);
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

  updateHud() {
    this.hud.hp.setText(`HP: ${this.stats.hp}/${this.stats.maxHp} | LVL ${this.stats.level}`);
    this.hud.xp.setText(`XP: ${this.stats.xp}/${this.stats.xpToNext}`);
    this.hud.timer.setText(`Tempo: ${this.stats.elapsedSeconds}s`);
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
