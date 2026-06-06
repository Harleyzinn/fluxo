# Fluxo Music

Fluxo Music e um player desktop para Windows feito em Electron, com foco em musica, personalizacao visual, sessao compartilhada, Discord Rich Presence, temas mutantes e ferramentas de audio.

O objetivo do projeto e ser um player com identidade propria: a interface muda com os temas, o Modo Festa acompanha a estetica ativa, o equalizador tem perfis de uso real e a sessao compartilhada permite ouvir junto sem transformar tudo em painel confuso.

> Versao atual do projeto: **3.9.29**

## Baixar e instalar

O jeito correto para usuario final e baixar o instalador pronto pela aba **Releases** do GitHub. Nao precisa clonar o repositorio, instalar Node.js ou abrir terminal.

1. Abra a pagina de releases:
   [github.com/Harleyzinn/fluxo/releases](https://github.com/Harleyzinn/fluxo/releases)

2. Clique na release mais recente, ou use o link direto:
   [Ultima release](https://github.com/Harleyzinn/fluxo/releases/latest)

3. Em **Assets**, baixe o instalador:
   `Fluxo-Music-Setup-x.x.x.exe`

   Exemplo da versao atual:
   `Fluxo-Music-Setup-3.9.29.exe`

4. Execute o arquivo baixado.

5. Se o Windows SmartScreen avisar que o app e desconhecido, clique em **Mais informacoes** e depois em **Executar assim mesmo**.

6. Depois da instalacao, abra o **Fluxo Music** pelo menu iniciar ou pelo atalho criado.

## Atualizacao

O Fluxo usa o `latest.yml` publicado junto da release para verificar atualizacoes.

Para atualizar manualmente:

1. Abra [Releases](https://github.com/Harleyzinn/fluxo/releases).
2. Baixe o instalador mais novo em **Assets**.
3. Execute o `.exe`.
4. Se o Fluxo ja estiver instalado, o instalador atualiza a versao existente.

Arquivos que precisam estar na release para o autoupdater funcionar:

```text
Fluxo-Music-Setup-x.x.x.exe
Fluxo-Music-Setup-x.x.x.exe.blockmap
latest.yml
```

## Novidades da 3.9.29

- Player ganhou cache real de resolucao de stream no renderer: prefetch agora esquenta e reaproveita a URL/proxy no play.
- Busca, preview de playlist, tocar agora, tocar a seguir e proximas faixas aquecem streams em segundo plano.
- O `yt-dlp` faz warmup no boot e a Central Fluxo mostra versao/tempo desse aquecimento.
- Falhas do media element invalidam cache, renovam o stream uma vez e mostram o botao **POR QUE FALHOU?**.
- Biblioteca ganhou backup completo e restauracao por JSON unico com playlists, favoritos, historico, inbox, perfil visual e EQ.

## Principais recursos

- **Busca por YouTube e SoundCloud**: pesquisa normal, links diretos, playlists, mixes, sets e links curtos.
- **Importacao do Spotify**: cole links de musica, album ou playlist; o Fluxo le os metadados e resolve as faixas para reproducao.
- **Player com fallback de stream**: se um resultado estiver bloqueado, o Fluxo tenta audio, outra fonte tocavel ou mostra erro amigavel.
- **Discord Rich Presence**: mostra no Discord o que esta tocando, com capa, tempo decorrido, tempo total e botao para ouvir no YouTube.
- **Sessao compartilhada**: crie uma sala para ouvir junto com outras pessoas em tempo real.
- **Fila da sessao**: convidados podem pedir musica, entrar direto na proxima se o host liberar, votar para subir faixas e salvar a fila.
- **Votacao para pular**: a sala pode exigir 50% dos votos para avancar, com opcao do host ignorar o requisito.
- **Infinite Radio**: recomenda musicas automaticamente quando a fila esta acabando.
- **Equalizador robusto**: presets, DSP, velocidade, reverb, compressor, ganho, pan e perfis como Normal, Slowed + Reverb e Nightcore.
- **Modo Festa**: tela imersiva que muda conforme o tema ativo.
- **Mini-player**: modos compacto, horizontal e cinema, com controles essenciais.
- **Biblioteca local**: playlists, favoritos, historico, inbox musical, importacao/exportacao JSON e diagnostico de biblioteca.
- **Widget e overlay OBS**: janela de "tocando agora" com visual baseado no tema.
- **Sleep Timer**: pausar em X minutos, parar depois da faixa atual, fechar o app e aplicar fade out.
- **LivePix**: aba visivel para apoiar o projeto via `livepix.gg/devpotato`.
- **Changelog dentro do app**: veja as mudancas recentes sem sair do Fluxo.

## Sessao compartilhada

A sessao compartilhada permite que um usuario seja o host e outras pessoas entrem como convidados por codigo de sala.

O host pode:

- liberar ou bloquear play/pause;
- liberar ou bloquear seek na barra de progresso;
- liberar ou bloquear skip manual;
- permitir que convidados coloquem a proxima musica direto;
- silenciar pedidos moderados;
- ativar fila prioritaria por voto;
- fixar uma musica como prioridade;
- ativar votacao para pular;
- permitir que o host pule sem esperar votos;
- ligar Infinite Radio da sala;
- sincronizar video para todos;
- aplicar o equalizador do host nos convidados.

Os convidados podem:

- entrar por codigo de sala;
- enviar pedidos de musica;
- colocar a proxima musica direto, se o host permitir;
- votar para pular;
- votar para subir musicas na fila;
- reagir ao vivo;
- ver membros, fila, historico tocado e ranking;
- salvar fila, tocadas ou replay da sessao como playlist.

## Temas e identidade visual

O Fluxo tem dezenas de temas que mudam mais do que a paleta. Cada tema pode alterar bordas, sombras, fundo, player, equalizador, modo festa, cards, widget, overlay e clima geral da interface.

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

## Solucao de problemas

### A musica aparece como erro de stream

Alguns videos do YouTube podem ter DRM, restricao regional, login, idade ou remocao. A partir da 3.9.28, o Fluxo resolve a faixa no processo principal e entrega o audio/video ao renderer por proxy local com CORS. Isso evita o erro em que o Electron recusava URLs diretas do `googlevideo.com` e tambem preserva o equalizador.

Se ainda falhar:

- tente outro resultado da busca;
- confira se o link abre no navegador;
- teste somente audio se o modo video estiver ligado;
- atualize para a release mais recente.

### SoundCloud nao toca

O SoundCloud pode bloquear faixas privadas, removidas ou sem stream publico. Links curtos e playlists publicas sao suportados, mas a disponibilidade final depende da propria faixa.

### Discord RPC nao aparece

Verifique:

- Discord Desktop aberto;
- atividade de jogos ativada no Discord;
- Fluxo atualizado;
- app id configurado no projeto;
- tempo de alguns segundos para o Discord atualizar o status.

### Sessao compartilhada nao conecta

A sessao compartilhada depende do Firebase Realtime Database. Confira se as regras foram publicadas e se o projeto correto e `fluxo-music`.

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

- `script.js`: maior parte da UI, player, sessao compartilhada, temas e logica do renderer.
- `main.js`: processo principal Electron, busca, streams, Discord RPC, auto-updater e IPC.
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

O `latest.yml` e obrigatorio para o auto-updater encontrar a nova versao.

## Observacoes

- Algumas fontes podem bloquear streams por DRM, regiao, login ou idade.
- SoundCloud depende de disponibilidade publica da faixa.
- Discord RPC exige o Discord Desktop aberto.
- Sessao compartilhada depende das regras corretas no Firebase Realtime Database.
- O projeto e focado em Windows desktop.
