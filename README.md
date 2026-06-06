# Fluxo Deck (Fluxo Music)

Um player de musica desktop feito em Electron, focado em customizacao pesada, imersao visual, sessoes compartilhadas e ferramentas de audio. O Fluxo nao tenta ser uma interface generica: ele transforma o player em uma experiencia visual mutante, com temas que mexem em cores, formas, animacoes, modo festa, equalizador, widget e overlay.

> Versao atual do projeto: **3.9.23**

## Como instalar

O jeito certo para usuario final e baixar o instalador pronto pela aba **Releases**. Nao precisa clonar repositorio, instalar Node ou abrir terminal.

1. Abra a pagina de releases:
   [github.com/Harleyzinn/fluxo/releases](https://github.com/Harleyzinn/fluxo/releases)

2. Clique na release mais recente, ou use direto:
   [Ultima release](https://github.com/Harleyzinn/fluxo/releases/latest)

3. Na area **Assets**, baixe o arquivo:
   `Fluxo-Music-Setup-x.x.x.exe`

   Exemplo:
   `Fluxo-Music-Setup-3.9.23.exe`

4. Execute o instalador baixado.

5. Se o Windows SmartScreen avisar que o app e desconhecido:
   clique em **Mais informacoes** e depois em **Executar assim mesmo**.

6. Depois de instalado, abra o **Fluxo Music** pelo menu iniciar ou atalho criado.

## Atualizacao

Quando uma nova release for publicada no GitHub, o Fluxo usa o arquivo `latest.yml` da release para verificar atualizacoes.

Para atualizar manualmente:

1. Abra [Releases](https://github.com/Harleyzinn/fluxo/releases).
2. Baixe o instalador mais novo em **Assets**.
3. Execute o `.exe`.
4. Se o Fluxo ja estiver instalado, o instalador atualiza a versao existente.

## Principais recursos

- **Busca por YouTube e SoundCloud**: pesquisa normal, links diretos, playlists, mixes, sets e links curtos.
- **Importacao do Spotify**: cole links de musica, album ou playlist; o Fluxo le os metadados e resolve as faixas para reproducao.
- **Discord Rich Presence**: mostra o que esta tocando no Discord, com progresso, capa e estado de reproducao.
- **Sessao compartilhada**: crie uma sala para ouvir junto com outras pessoas em tempo real.
- **Modo host profissional**: permissoes separadas para play/pause, seek, skip, fila direta, pedidos, reacoes e prioridade.
- **Fila com votos**: convidados podem votar para subir musicas; o host pode fixar uma faixa como prioridade.
- **Ranking e replay da sessao**: veja quem mais emplacou musicas, quais faixas receberam mais reacoes e salve o replay como playlist.
- **Equalizador robusto**: presets, DSP, velocidade, reverb, compressor, ganho, pan e perfis como Normal, Slowed + Reverb e Nightcore.
- **Modo Festa**: tela imersiva que muda conforme o tema ativo.
- **Mini-player**: modos compacto, horizontal e cinema, com controles essenciais.
- **Biblioteca local**: playlists, favoritos, historico, inbox musical, importacao/exportacao JSON e diagnostico de biblioteca.
- **Sleep Timer**: pausar em X minutos, parar depois da faixa atual, fechar o app e aplicar fade out.
- **LivePix**: aba visivel para apoiar o projeto via `livepix.gg/devpotato`.
- **Changelog dentro do app**: veja as mudancas recentes sem sair do Fluxo.

## Sessao compartilhada

A sessao compartilhada permite que um usuario seja o host e outros entrem como convidados.

O host pode:

- liberar ou bloquear play/pause;
- liberar ou bloquear a barra de progresso;
- liberar ou bloquear skip manual;
- permitir que convidados coloquem a proxima musica direto;
- silenciar pedidos moderados;
- ativar votacao para pular;
- permitir que o host pule sem esperar votos;
- ligar Infinite Radio da sala;
- sincronizar video para todo mundo;
- aplicar o equalizador do host nos convidados.

Os convidados podem:

- entrar por codigo de sala;
- enviar pedidos de musica;
- colocar a proxima musica direto, se o host permitir;
- votar para pular;
- votar para subir musicas na fila;
- reagir ao vivo;
- ver membros, fila, historico tocado e ranking;
- salvar fila ou replay da sessao como playlist.

## Temas e identidade visual

O Fluxo tem dezenas de temas que mudam mais do que a paleta. Cada tema pode alterar bordas, sombras, fundo, player, equalizador, modo festa, cards e clima geral da interface.

Alguns destaques:

- **Fluxo Bug**: satira interna sobre bugs do app, com visual de crash report controlado.
- **Soul Eater**: visual torto, sombrio e cartunesco.
- **Adolla**: identidade de chamas pretas e brancas.
- **Dark Brotherhood**: atmosfera ritualistica escura.
- **Fatal Error**: estetica de diagnostico e falha critica.
- **Minecraft**: interface inspirada em blocos e inventario.
- **Tensura**: UI mais fluida e arredondada.
- **Ophiuchus**: neon cosmico e aura estelar.
- **Morioh-Cho Radio**: pop-art, paineis fortes e cores absurdas.
- **Orokin Cell**: marfim, ouro e luxo de ficcao cientifica.

## Apoiar o projeto

O Fluxo tem uma aba **Apoiar Fluxo** dentro do app.

Link publico:
[livepix.gg/devpotato](https://livepix.gg/devpotato)

O app nao embute segredo privado de pagamento. Ele abre apenas a pagina publica do LivePix.

## Para desenvolvedores

Esta parte e opcional. Usuario normal deve instalar pela aba **Releases**, como explicado acima.

Requisitos:

- Node.js
- npm
- Windows, para gerar o instalador `.exe`

Instalar dependencias:

```bash
npm install
```

Rodar em modo desenvolvimento:

```bash
npm start
```

Gerar instalador:

```bash
npm run build
```

Os arquivos finais aparecem em:

```text
dist/
```

Arquivos importantes:

- `script.js`: maior parte da UI e logica do player.
- `main.js`: processo principal Electron, busca, streams, Discord RPC e IPC.
- `preload.js`: ponte segura entre renderer e Electron.
- `style.css`: temas, layout e skins visuais.
- `firebase.database.rules.json`: regras da sessao compartilhada no Firebase Realtime Database.
- `package.json`: versao, scripts e configuracao do electron-builder.

## Publicar uma nova release

1. Atualize a versao em `package.json` e `package-lock.json`.
2. Atualize o changelog dentro do app, se necessario.
3. Rode:

```bash
npm run build
```

4. Na pasta `dist/`, envie para a release:

```text
Fluxo-Music-Setup-x.x.x.exe
Fluxo-Music-Setup-x.x.x.exe.blockmap
latest.yml
```

5. Publique esses arquivos na aba **Releases** do GitHub.

O `latest.yml` e importante para o auto-updater.

## Observacoes

- Algumas fontes podem bloquear streams por DRM, regiao, login ou idade.
- SoundCloud pode depender de disponibilidade publica da faixa.
- Discord RPC exige o Discord Desktop aberto.
- Sessao compartilhada depende das regras corretas no Firebase Realtime Database.

