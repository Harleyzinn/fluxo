# Fluxo Mobile 2.9: revisao do player

Data: 17 de outubro de 2026, horario de Sao Paulo.

## Escopo

Atualizacao incremental na pasta mobile, preservando os arquivos do desktop, a biblioteca, o armazenamento privado e as correcoes de foco da 2.8. Nao houve troca de framework ou de provedor. Nenhuma nova publicacao no GitHub foi feita nesta rodada.

## Problemas encontrados e correcoes

1. O player era reconstruido quando estados como pausa, buffering, repeticao ou favorita mudavam. Isso substituia a barra e podia perder o foco/arraste. A estrutura agora acompanha a identidade da faixa; estados mudam controles existentes. Progresso/levels nao repintam o transporte.
2. O teste antigo de `document.activeElement !== seek` mantinha a barra parada depois de uma busca enquanto ela permanecesse focada. A nova previa de arraste tem inicio, confirmacao, cancelamento e prazo de sincronizacao; depois disso o progresso acompanha o audio normalmente.
3. Uma mudanca de faixa entre o arraste e a chegada do comando podia aplicar o tempo na musica seguinte. O comando inclui indice, ID e URL esperados; a validacao e atomica na thread principal Android. O navegador aplica a mesma regra. Com servico encerrado, a solicitacao antiga nao o inicia.
4. O visualizador parava ao pausar, mas nao havia reinicio garantido ao continuar. Sua atividade agora acompanha o estado real, a visibilidade do player e o modo de desempenho. Parar limpa os pixels anteriores.
5. Economia/visualizador desligado ocultavam o desenho, mas o medidor nativo ainda calculava amostras com o app visivel. A configuracao agora impede tambem esse trabalho. Isso nao e uma medicao de consumo de bateria nem comprovacao de menor PSS.
6. O temporizador podia ficar visualmente congelado com o audio pausado porque nao havia mais ticks nativos. Uma atualizacao de tela limitada ao player aberto acompanha o prazo; fecha/oculta a tela, ela para. O temporizador de reproducao continua no servico Android.
7. O estado de carregamento mostrava um botao girando com rotulo Reproduzir embora a acao fosse pausar. Agora o botao mantem icone/rotulo Pausar e somente o indicador de estado gira.
8. Velocidades vindas de floats nativos podiam gerar rotulos extensos. A apresentacao usa ate duas casas decimais, sem mudar a velocidade efetiva do audio.
9. Com a fila restaurada e o servico encerrado, comandos salvos no snapshot nao notificavam a interface. Posicao, embaralhar e adicionar a fila agora publicam o estado atualizado sem iniciar o servico. Uma busca valida pode ser salva enquanto pausado; somente uma identidade antiga e recusada.
10. A atualizacao seletiva de controles nao observava a mudanca isolada do modo offline do radio. Um teste reproduziu o rotulo online antigo depois da troca; a assinatura de renderizacao agora inclui esse estado.

## Interface

Layout sem paines decorativos: origem e posicao na fila, capa, titulo/artista, linha de progresso/buffer, controles principais e ferramentas. Retrato e paisagem tem organizacao propria. Claro/escuro, texto ampliado, capas circulares, modo compacto e os 68 temas continuam disponiveis. Duracao total/restante pode ser alternada. Os controles principais preservam areas de toque de pelo menos 44 px.

## Verificacao

Passaram: 51 testes de dados/estado, oito verificacoes Java de autorizacao, nova suite de player com estados controlados e 16 combinacoes responsivas, 16 telas de navegacao, 24 combinacoes de aparencia, ajustes/backup/cache e regressao de colecoes/atalhos/fila. Estados controlados comprovam a interface, nao o streaming real.

No APK final instalado sobre a 2.8 em Android API 37:

- Busca antiga com servico encerrado recusada sem iniciar servico nem aumentar pedidos de foco.
- Com fila valida restaurada, posicao foi salva e exibida enquanto pausada, sem iniciar servico nem pedir foco. Embaralhar e adicionar a fila fria tambem atualizaram a tela.
- Busca valida em arquivo privado preservou a pausa; busca atrasada para a faixa anterior e URL alterada foram recusadas sem mover a seguinte.
- Economia desligou o medidor nativo e os niveis passaram a zero. Voltar ao modo equilibrado com barras reativou a leitura real de PCM.
- Arraste no WebView permaneceu no mesmo elemento por 1,7 segundos de atualizacoes; a posicao escolhida foi aplicada.
- A velocidade 1,1 chegou como `1.100000023841858`, reproduzindo a imprecisao nativa. O player mostrou `1,1x` (com o simbolo de multiplicacao na interface), sem a sequencia decimal extensa.

Registros locais: `.qa/player-ui-report.json` e `.qa/native-player-report.json`. As capturas foram conferidas em claro/escuro, retrato/paisagem e layout compacto/capa.

O APK final tambem passou pela regressao principal de foco: depois de iniciar um stream invalido e transferir o foco ao player de teste externo, esse player continuou reproduzindo por mais de 65 segundos, com zero perdas de foco. O registro estruturado identifica a versao 2.9.0 e a liberacao de foco pelo Fluxo, sem incluir a URL da faixa. Essa prova usa um segundo aplicativo de teste, nao o Spotify nem o POCO fisico.

Na mesma rodada passaram nove cenarios adicionais de coexistencia: sons internos, segundo plano, tela bloqueada, notificacoes, perda de rede, retorno de rede, alternancia rapida entre aplicativos, preferencias/cache com audio ocioso e conclusao de download real. Em cada cenario, o contador de pedidos de foco do Fluxo permaneceu igual e o player externo continuou avancando sem perdas de foco. Registro local: `.qa/audio-focus-fixed.json`; resumo sem links de faixas em `docs/evidencias/player-2.9.json`.

Na compilacao final, o stream proprio avancou 183,9 segundos durante a espera de tres minutos com tela apagada e servico em primeiro plano. Pausar, Continuar e Proxima foram acionados na central de midia do Android. Radio online retornou sete faixas sem IDs repetidos, encerrar removeu recomendacoes futuras, radio offline e temporizador ao fim passaram. O inicio desse stream levou 15,0 segundos; uma rodada anterior levou 14,5 segundos. Esses resultados dependem de fonte/rede e nao demonstram ganho de velocidade de inicializacao nem disponibilidade universal.

A primeira rodada de segundo plano passou na reproducao, mas nao confirmou o toque em Pausar depois de desbloquear. O teste passou a aguardar o retorno da Activity, reabrir a central de forma consistente e capturar cada controle antes do toque. Sem mudar o codigo de notificacoes entregue, a rodada seguinte confirmou pausa, retomada e troca de faixa. A tentativa inicial permanece inconclusiva; nao e contada como aprovada. Registro final: `.qa/native-background-report.json`.

O teste de coexistencia recebeu correcoes de infraestrutura: espera uma captura nova do outro player depois de iniciar e o fixture usa gravacao atomica para nao retornar JSON pela metade. O som de conectar carregador do emulador e temporariamente silenciado e restaurado depois, pois o historico Android mostrou um pedido de foco transitorio da propria SystemUI durante a simulacao, sem pedido correspondente do Fluxo. Isso nao altera configuracoes de som no aplicativo entregue nem simula validacao de um aparelho fisico.

A tentativa de ativar a economia do sistema nao foi consistente: o emulador retornou `low_power=0` mesmo depois do pedido, inclusive simulando bateria em 20%. Esse cenario nao e contado como aprovado na 2.9. A verificacao opcional exige `FOCUS_TEST_BATTERY=1`; a rodada principal registra o cenario como nao executado. O modo economico do proprio app e o medidor desligado foram verificados separadamente no Android.

APK: `dist/Fluxo-Mobile-2.9.0.apk`. SHA-256: `1ea2223fa5b3574092ff3ec91f46d8640d7fb01f663bdf055ef7d34e875efdb4`. Certificado SHA-256 igual ao anterior: `42dc5c2adbe56aefb20922bd7ba4392c0413f7948122530132474876ea874bbb`. Atualize sem desinstalar para manter os arquivos privados.

## Arquivos

Interface: `www/app.js`, `www/player-state.js`, `www/player.css`, `www/platform.js`, `www/visualizer.js`, `www/index.html`.

Android: `FluxoAudioPlugin.java`, `PlaybackSnapshot.java`, `AudioMeter.java`, `PlaybackService.java`. O controlador de foco e a autorizacao de reproducao da 2.8 nao foram alterados.

Testes: `tests/player-ui.mjs`, `tests/native-player.mjs`, `tests/model.test.mjs`, isolamento dos registros em `tests/native-focus.mjs`, gravacao atomica em `tests/fixtures/audio-probe/ProbeService.java`, sincronizacao/capturas em `tests/native-background.mjs` e sincronizacao da assercao de temporizador nas suites professional. Metadados de versao, README, guia e verificacao atualizados.

## Limites

O POCO/HyperOS fisico, Bluetooth/fones e Spotify real nao estavam disponiveis. Nao se promete compatibilidade perfeita ou disponibilidade de qualquer stream. O PSS maior observado na 2.8 nao foi reavaliado nesta rodada; o criterio de memoria permanece pendente. O APK e debug para uso pessoal, nao uma versao homologada de loja.
