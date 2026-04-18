# 🎧 Fluxo Deck (Fluxo Music)

Um reprodutor de música desktop construído com Electron, com foco absoluto em customização, imersão visual e alta performance. O Fluxo Deck abandona as interfaces genéricas e transforma a experiência de ouvir música em um evento visual através de uma injeção profunda de CSS.

## ✨ Características Principais

* **Importação Mágica do Spotify:** Cole o link de qualquer música, álbum ou playlist do Spotify. O sistema realiza *web scraping* assíncrono para extrair as faixas nativamente e usa *lazy loading* para buscar o áudio em alta qualidade no YouTube apenas no momento do play, contornando bloqueios de API.
* **Modo Festa Mutante (Party Mode):** Uma interface full-screen imersiva que **muda de forma, animação e layout** dependendo do tema ativo. O clássico disco de vinil pode se transformar em um hexágono cibernético, desaparecer em um terminal de código, ou pulsar como um slime.
* **Sistema de Áudio DJ:** Transições perfeitas entre as faixas usando *Crossfade* construído sob medida, além de um sistema *Auto-Mix* que busca recomendações inteligentes quando a fila acaba.
* **Mini-Player Blindado:** Modo de janela compacta `Always on Top` com controles essenciais e design flexível para não interromper seu fluxo de trabalho.
* **Sessões Compartilhadas:** Sincronização em tempo real (Host/Client) para ouvir músicas simultaneamente em rede.

## 🎨 O Arsenal de Temas (Mutação UI)

O Fluxo possui **33 temas exclusivos**. Eles não trocam apenas a paleta de cores; eles injetam pseudo-elementos, alteram formas geométricas e aplicam ilusões de ótica com sombras e shaders 100% via CSS.

### Destaques do Modo Festa:
* **Morioh-Cho Radio:** Cores pop-art brutalistas com céu amarelo, painéis rosa choque e o Modo Festa ganhando sombras duras de quadrinhos.
* **Orokin Cell:** O player se transforma em uma joia Prime do Void, com curvas orgânicas, marfim polido e ouro reflexivo. 
* **Dark Brotherhood:** A interface vira um pergaminho rústico. No Modo Festa, texturas de sangue seco e papel queimado tomam conta da tela.
* **Synthwave Retrowave:** Um grid de perspectiva 3D distorce o fundo em tons de neon rosa e ciano, enquanto o disco vira uma capa quadrada de fliperama retro.
* **Patas da Lua:** O extremo do conforto visual, com tons mistos em tons de pelagem macia, cantos altamente arredondados e sombras difusas.
* **Constelação Ophiuchus:** Um neon cósmico desenha os contornos da interface no breu absoluto, criando uma aura estelar no disco de vinil.
* **Manga Edition:** Estética de mangá P&B com retículas no fundo e o disco de vinil angulado de forma dramática com onomatopeias.
* **Hacker Matrix:** Foca na brutalidade do código. O vinil desaparece para dar lugar a logs de execução de áudio verde-neon puro.
* **E 25 outras mutações completas:** Tensura (Slime), Pip-Boy (Fallout), Deus Ex, Frutiger Aero, Night City, Blood Dragon, Arcade 80s e muito mais.

## 🚀 Como Instalar e Rodar

1. Clone o repositório para sua máquina local.
2. Acesse a pasta do projeto e instale as dependências:
   ```bash
   npm install
