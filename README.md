# Soulrvivors Prototype (Phaser 3 + Vite)

Protótipo simples inspirado em Vampire Survivors usando Phaser 3 com Vite.

## Features

- Movimento do player com **WASD** e **setas**.
- Inimigos perseguem o jogador.
- Spawner de inimigos escala por tempo.
- Arma automática com projétil auto-aim no inimigo mais próximo.
- Gems de XP ao derrotar inimigos.
- Sistema de level up com escolha entre 3 upgrades.
- HUD com HP, XP e tempo.
- Pause com tecla `P`.
- Game over e restart com tecla `R`.

## Como rodar

```bash
npm install
npm run dev
```

Abra o endereço exibido no terminal (normalmente `http://localhost:5173`).

## Build de produção

```bash
npm run build
npm run preview
```

## Deploy no GitHub Pages

O workflow em `.github/workflows/deploy.yml` publica automaticamente no GitHub Pages a cada push na branch `main`.

> O projeto usa `base: '/soulrvivors-prototype/'` no `vite.config.js`. Se o nome do repositório for outro, ajuste este valor.
