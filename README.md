<div align="center">
  <img src="https://img.shields.io/badge/Status-Online-success?style=for-the-badge&logo=electron" alt="Status">
  <img src="https://img.shields.io/badge/Version-3.4.0-blue?style=for-the-badge&logo=npm" alt="Version">
  <img src="https://img.shields.io/badge/License-ISC-purple?style=for-the-badge" alt="License">
</div>

<br>

<div align="center">
  <h1>🎵 FLUXO MUSIC OS</h1>
  <p><strong>Um reprodutor de áudio de alta performance, construído do zero com foco em personalização extrema e sessões compartilhadas.</strong></p>
</div>

---

## 🚀 O que é o Fluxo Music?
O **Fluxo** não é apenas um player de música. É um sistema operacional de áudio embutido. Desenvolvido para quem gosta de ouvir música sem limites, ele permite buscar e extrair áudios diretamente da internet em tempo real, reproduzir arquivos locais, e o melhor: **ouvir música sincronizada com seus amigos** em salas privadas.

## ✨ Funcionalidades Principais

- 🌐 **Sessão Compartilhada (Multiplayer):** Crie uma sala, convide amigos (via código) e ouçam músicas perfeitamente sincronizadas através do banco de dados em tempo real (Firebase). Inclui chat ao vivo, sistema de permissões e pedidos de música.
- 🎨 **Sistemas de Temas (27 UIs Exclusivas):** Mude completamente a interface com um clique. De *Cyber Deck* e *Pip-Boy* até *Frutiger Aero*, *Tensura* e *Manga Edition* (estilo HQ em Cel-Shading).
- 🔍 **Motor de Busca Integrado:** Pesquise faixas, cole links ou carregue playlists inteiras diretamente do terminal. Extração feita via `yt-dlp` com fallback automático.
- 🎛️ **DSP (Digital Sound Processor):** Equalizador paramétrico de 5 bandas integrado com presets (Rock, Trap, Phonk, Vocal, etc).
- 📜 **Decodificador de Letras:** Mineração de metadados em tempo real via `lrclib` para exibir as letras da faixa atual.
- 📂 **Biblioteca e Playlists:** Arraste e solte arquivos locais (`.mp3`) ou salve suas filas de reprodução favoritas na memória local.
- 📻 **Rádios 24/7:** Sintonize instantaneamente nas frequências Lo-Fi Girl, Cyberpunk ou Phonk Drift.
- 📌 **Mini-Player Overdrive:** Modo compacto fixado no topo da tela para controle rápido enquanto você joga ou estuda.
- 🔄 **Auto-Updater:** Sistema de atualização invisível e automático direto via GitHub Releases.

## 🛠️ Tecnologias Utilizadas
- **Core:** [Electron](https://www.electronjs.org/) (Chromium + Node.js)
- **Backend/Sync:** [Firebase Realtime Database](https://firebase.google.com/)
- **Extração de Áudio:** `yt-search` & `yt-dlp-exec`
- **Estilização:** CSS3 Avançado (Animações aceleradas por GPU, Flexbox, UI Fluída)
- **Distribuição:** `electron-builder` & `electron-updater`

## ⚙️ Como rodar localmente (Desenvolvedor)

1. Clone este repositório:
   ```bash
   git clone [https://github.com/Harleyzinn/fluxo.git](https://github.com/Harleyzinn/fluxo.git)
