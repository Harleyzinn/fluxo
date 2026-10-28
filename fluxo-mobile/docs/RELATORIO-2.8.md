# Fluxo Mobile 2.8: audio, arquitetura e validacao

Data: 11 de outubro de 2026, horario de Sao Paulo. Os registros tecnicos usam timestamps UTC.

## Estado da entrega

Correcao implementada, com uma causa de interferencia reproduzida antes e depois no Android API 37 em emulador. A aceitacao final em dispositivo real permanece pendente: o POCO X5 5G nao estava conectado. Nao foram executados testes reais com Spotify, YouTube Music, Apple Music ou Bluetooth fisico. Nao se afirma funcionamento perfeito em todos os aparelhos.

O projeto usa Capacitor 8.3.4, HTML/CSS/JavaScript e um unico player nativo Media3/ExoPlayer 1.9.4. Downloads usam WorkManager/DownloadManager; a resolucao de fontes usa NewPipeExtractor. Nenhum componente novo controla a musica de aplicativos externos.

## 1. Diagnostico com evidencias

Na 2.7.0, a recuperacao de stream executava `player.stop()` seguido de `prepare()` enquanto o ExoPlayer gerenciava automaticamente o foco. Na perda transitoria de foco, `playWhenReady` podia continuar verdadeiro embora a reproducao estivesse suprimida. Os testes antigos verificavam essa flag, mas nao a autorizacao para continuar depois da perda de foco.

Foi usado um segundo APK de teste, separado do Fluxo, com MediaPlayer e AudioManager. Ele registra contadores de perda de foco e posicao de reproducao, sem depender de um provedor musical ou de credenciais.

Reproducao do defeito:

1. Abrir a 2.7.0 publicada e solicitar explicitamente um stream de teste que falha.
2. Iniciar o player externo com foco transitorio.
3. Aguardar alem da janela de recuperacao do Fluxo, sem solicitar outra reproducao no Fluxo.
4. Observar o player externo e o estado do Fluxo.

Resultado anterior: o player externo recebeu uma perda permanente de foco, registrou `losses=1` e ficou `playing=false`. O Fluxo continuou com `playWhenReady=true`, em buffering, e ja havia executado uma tentativa de recuperacao.

Resultado corrigido, no mesmo cenario: o player externo permaneceu `playing=true`, com `losses=0`, durante 65 segundos. O Fluxo ficou `playWhenReady=false`, `recovering=false` e `focusState=none`. O registro mostrou perda transitoria de foco (`change=-2`), liberacao do foco proprio e cancelamento da intencao de tocar.

Isso comprova uma causa reproduzivel no emulador. Nao prova que seja a unica causa de todas as ocorrencias no HyperOS. A abertura isolada e a navegacao passiva na 2.7 nao provocaram perda de foco na janela inicial testada; a inicializacao antiga do servico foi identificada como desperdicio, nao como causa comprovada dessa pausa isolada.

Evidencias locais, nao distribuidas como dados pessoais: `.qa/audio-focus-baseline.json`, `.qa/audio-focus-fixed.json`, `.qa/idle-baseline.json` e `.qa/idle-fixed.json`.

Resumo sem metadados musicais incluido no codigo: [evidencia de foco](evidencias/audio-focus.json).

## 2. Correcao tecnica

- `AudioFocusController.java`: unica origem das chamadas de solicitar/liberar foco do Fluxo. GAIN e usado apenas para a musica propria solicitada pelo usuario ou por controle de midia. Interface, leitura de estado, cache, downloads e reconexoes nao solicitam foco.
- `PlaybackAuthorization.java`: autorizacao e geracao da intencao atual. Eventos antigos nao podem reativar uma autorizacao revogada.
- `PlaybackService.java`: gerenciamento automatico de foco do ExoPlayer desativado e substituido pelo controlador explicito. Recuperacao e respostas do radio verificam a autorizacao. Perdas permanentes/transitorias pausam somente o Fluxo e cancelam recuperacoes; nao reiniciam a musica externa nem retomam o Fluxo automaticamente.
- Alertas que permitem ducking usam a politica do Android; em plataformas antigas, somente o volume do player do Fluxo e reduzido/restaurado. Nao se altera o volume global do telefone ou de outro player.
- Um ForwardingPlayer aplica a mesma politica aos controles da MediaSession. A sessao de midia e a notificacao oficial foram preservadas.
- `PlaybackSnapshot.java` e `FluxoAudioPlugin.java`: abrir o app, ler estado, atualizar preferencias simples e restaurar a interface nao iniciam o player. A fila e os dados continuam persistidos. O servico nasce quando uma operacao realmente precisa dele.
- O caminho Android nao cria o Audio nem o temporizador da previa de navegador. O listener da ponte e registrado uma unica vez; callbacks da instancia destruida sao removidos.
- Alteracoes de fila/preferencias e a criacao do servico sao decididas na mesma thread principal, evitando gravar um snapshot ja desatualizado durante a inicializacao. Falhas ao iniciar o servico retornam erro para a interface, sem escapar como excecao nao tratada.
- Desativar um temporizador inexistente nao cria servico. Restaurar backup aplica imediatamente preferencias de diagnostico, notificacoes e desempenho ao Android.

Tocar explicitamente uma musica do Fluxo pode pausar outra musica de acordo com a politica normal de foco do Android. A correcao impede novas solicitacoes automaticas depois da perda de foco; nao tenta burlar a arbitragem da plataforma para tocar varios players exclusivos simultaneamente.

Referencia de politica: [gerenciamento de foco do Android](https://developer.android.com/media/optimize/audio-focus) e [reproducao em segundo plano com Media3](https://developer.android.com/media/media3/session/background-playback).

## 3. Diagnostico e privacidade

Ativacao em Ajustes > Sistema > Registrar diagnostico, ou no painel Diagnostico de audio. Exportacao pelo seletor nativo de arquivos, com o nome `fluxo-audio-diagnostico.json`.

`AudioDiagnostics.java` mantem ate 250 eventos locais: componente, evento, timestamps e campos numericos/booleanos permitidos. Captura solicitacao/liberacao de foco, alteracoes de intencao, erros por codigo, ciclo de vida e recuperacao. Nao inclui nomes de musicas, artistas, links, caminhos de arquivos, contas, historico ou nomes de aplicativos externos. Nao envia telemetria a um servidor.

O modo e desativado por padrao. Limpar registros nao apaga a biblioteca. Logs verbosos da ponte Capacitor foram desativados para evitar registrar cargas com metadados musicais mesmo no APK debug. O painel mostra apenas o foco do proprio Fluxo, nao o estado privado de outro aplicativo.

## 4. Desempenho

- Player/servico sob demanda; nenhuma publicacao periodica do player enquanto o Fluxo esta ocioso.
- Atualizacoes de progresso sem reenviar a fila completa. Persistencia periodica nao reserializa a fila; alteracoes de fila continuam sendo salvas.
- Consultas de downloads simultaneas compartilham uma operacao. Polling adaptativo: 2,5 s com pendencias / 12 s ocioso em modo equilibrado; 8 s / 30 s em economia. Nao ha polling da interface oculta.
- Visualizador interrompido quando pausado, oculto ou em economia. Animacoes reduzidas e pre-carregamento desativado no modo economico.
- Cache de streams limitado a 64 entradas, com validade e limpeza sem remover audios. Cache de busca continua limitado e tambem pode ser limpo.
- Trabalhos ainda nao iniciados podem aguardar o app aberto quando downloads em segundo plano sao desativados. Transferencias ja iniciadas no DownloadManager nao sao apagadas nem reiniciadas.

Medicoes iniciais comparaveis, com o mesmo emulador e dados:

| Medida | 2.7 | Prototipo 2.8 |
| --- | --- | --- |
| Eventos de estado nao solicitados em 6,5 s ociosos | 9 | 0 |
| Servico de audio depois de abertura passiva | Presente | Ausente |
| Tempo de abertura nesta captura | 3347 ms | 2153 ms |
| PSS do processo nesta captura | 151304 KB | 155099 KB |

Os tempos e PSS sao capturas isoladas, nao um benchmark estatistico. A captura de PSS foi maior no prototipo: nao ha alegacao de reducao de RAM comprovada. Consumo real de bateria, variacao de memoria prolongada e desempenho no POCO precisam de perfilagem fisica. A eliminacao dos eventos ociosos e do servico passivo foi observada diretamente.

Repeticao no APK final, tres reinicios de processo por versao, sem apagar dados:

| Medida | 2.7 | 2.8 final |
| --- | --- | --- |
| Mediana de abertura | 3970 ms | 3044 ms |
| Mediana PSS | 154619 KB | 159962 KB |
| Eventos ociosos em cada janela de 6,5 s | 8 / 9 / 8 | 0 / 0 / 0 |
| Servico presente em cada abertura passiva | Sim / Sim / Sim | Nao / Nao / Nao |

Nesta pequena amostra, a mediana de abertura caiu cerca de 23%, mas a mediana PSS aumentou cerca de 3,5%. As faixas de PSS se sobrepoem e o teste sequencial em emulador nao permite atribuir toda a variacao ao codigo. Mesmo assim, esse resultado nao satisfaz uma alegacao de menor RAM ou de ausencia de regressao: esse criterio continua em aberto. Evidencia: `.qa/idle-comparison.json`. E preciso comparar amostras alternadas e perfilar heap/PSS durante uso prolongado no dispositivo fisico, inclusive componentes WebView compartilhados.

Uma segunda rodada alternou 2.7/2.8 em cada par de reinicios. Mediana de abertura: 5153 -> 4259 ms, cerca de 17% menor. PSS: 138514 -> 146246 KB, cerca de 5,6% maior. Servico ocioso permaneceu ausente e os eventos nao solicitados permaneceram zero na 2.8. A variacao de memoria maior persistiu nesta rodada; deve ser perfilada antes de alegar ausencia de regressao ou aprovar esse criterio. [Amostras completas alternadas](evidencias/idle-interleaved.json).

## 5. Interface e preferencias

- Ajustes em Audio, Biblioteca, Visual, Desempenho e Sistema.
- Sons de controles, respostas de erro e feedback tatil opcionais; interface silenciosa por padrao. Efeitos usam a sonificacao do Android, sem solicitar foco de musica.
- Avisos de downloads configuraveis, com conclusoes silenciosas em canal proprio. A notificacao essencial de reproducao continua sob a MediaSession.
- Claro, escuro ou automatico, alem da aparencia original de cada um dos 68 temas. Cores adaptadas para contraste; cores/preferencias originais continuam salvas.
- Controles e separadores consistentes, areas de toque adequadas, foco visivel, campos que se adaptam e menos blur.
- Modo equilibrado/economico, pre-carregamento, downloads em segundo plano e limpeza segura de cache.
- Playlists, favoritos, historico, arquivos baixados, perfis e cores nao foram removidos. As funcionalidades anteriores continuam na pasta mobile.

## 6. Testes e limites

- 47 testes de dados/preferencias/cache passaram; 8 verificacoes Java da autorizacao de reproducao e 4 testes JUnit integrados ao Gradle passaram.
- O teste unitario decorativo do template foi substituido por casos de autorizacao, revogacao e callbacks antigos. O teste instrumentado de contexto recebeu o identificador correto do Fluxo; esse teste de contexto isolado nao foi executado nesta rodada nem contado como validacao de audio.
- Teste antes/depois de interferencia de foco passou na versao corrigida.
- Coexistencia no APK final: navegacao, efeitos da interface, segundo plano, tela bloqueada por 20 s, notificacao silenciosa, perda/retorno de rede, economia do Android confirmada ativa e alternancia rapida entre apps, sem perda de foco no player externo.
- Download real de fixture de 418 bytes concluiu enquanto o outro player tocava. A notificacao `fluxo_download` apareceu, com canal `fluxo_downloads` sem som, evento `silent_notice` e zero perdas de foco no player externo. Isso e uma verificacao do caminho real Receiver/DownloadManager, nao somente um aviso simulado.
- Interface: 16 telas de navegacao, 24 combinacoes de personalizacao, 18 capturas novas claro/escuro em 320/390/820 px, biblioteca de 250 faixas, selecao de 183 faixas e ferramentas de playlists passaram.
- Regressao nativa: arquivo privado offline preferido, volume preservado, fila restaurada sem autoplay, arquivo ausente tratado sem carregamento infinito e caminho antigo consultando o arquivo atual passaram.
- Migracao por blocos e reparacao passaram com SHA-256 identico ao original, preservando a copia anterior. Playlists/arquivos resistiram ao reinicio; aliases mantiveram identidade e limpeza parcial preservou a posicao pausada.
- Edicao Android preservou a posicao, pausa e SHA-256 do audio. Download por playlist com automatico geral desligado, aliases concorrentes usando um arquivo, cancelamento, compartilhamento e seletor de exportacao passaram.
- Stream real iniciou em 5,9 segundos na primeira execucao. Repetido no APK final, iniciou em 4,2 segundos e avancou 180,7 segundos durante tres minutos com a tela apagada, com servico em primeiro plano. Pausar, continuar e proxima pela notificacao passaram; radio online trouxe sete faixas sem repetidas, radio offline e temporizador ao fim passaram. Esses tempos nao sao uma garantia de velocidade de qualquer fonte.
- Auditoria JavaScript de producao nao reportou vulnerabilidades. Nao e uma auditoria completa do Android ou dos provedores.
- Um teste de aviso usando o MP3 maior do Google atingiu 845404 bytes, mas nao concluiu no prazo de quatro minutos. Foi mantido como limitacao de integracao, nao contado como aprovado. O teste de conclusao passou a usar um fixture oficial de 418 bytes do Media3 em revisao fixa, para isolar o aviso da duracao da transferencia. Isso nao comprova velocidade de downloads grandes.

### Matriz solicitada

| Cenario | Emulador/teste | Dispositivo real |
| --- | --- | --- |
| Spotify com Fluxo aberto | Player separado, mesma arbitragem Android; nao e Spotify | Pendente |
| Outro audio com Fluxo em segundo plano | Passou com o player separado | Pendente |
| Tela bloqueada | Passou, 20 s com player externo e 180 s de stream proprio | Pendente |
| Troca rapida entre apps | Passou | Pendente |
| Recebimento de notificacao | Passou com aviso de teste e conclusao real silenciosa de download | Alertas de outros apps pendentes |
| Reconexao | Passou com audio local externo | Streaming real pendente |
| Wi-Fi/dados | Comandos de perda/retorno executados | Redes fisicas pendentes |
| Economia de bateria | Android confirmado ativo/desativado e modo do app testado | HyperOS pendente |
| Inicio/fim de servicos | Inicio sob demanda e estado ocioso testados | Pendente |
| Uso prolongado | Janelas controladas; nao horas de uso real | Pendente |
| Abertura repetida de telas | Passou | Pendente |
| Bluetooth/fones | Nao comprova hardware fisico | Pendente |
| Retorno apos inatividade | Passou no fluxo do emulador | Pendente |
| Midia propria do Fluxo | Stream online/offline, radio, timer e controles de notificacao passaram | Pendente |

## 7. Dependencias e recomendacoes

Consulta ao registro npm em 11/10: Capacitor instalado 8.3.4, disponivel 8.5.3; Lucide 0.468.0, disponivel 1.55.0; Playwright 1.63.0, disponivel 1.64.0. Nao foi feito um upgrade indiscriminado durante a investigacao para nao misturar mudancas de framework com a correcao causal. Media3, extrator e downloads continuam nas versoes verificadas do projeto.

Proximos passos: validar o APK no POCO com apps musicais reais e exportar o diagnostico se houver nova pausa; medir memoria/bateria com uso prolongado; testar Bluetooth/fones e as versoes Android suportadas; atualizar frameworks em uma mudanca separada, com a mesma bateria de testes. Publicacao de loja exige assinatura de producao e nova revisao de permissoes/politicas.

Pendencias conhecidas: PSS ocioso maior nas amostras, integracao de download grande com timeout nesta rede de teste e falta de validacao fisica. Nao foram comprovados consumo menor de RAM/bateria, inexistencia de toda forma de travamento ou coexistencia perfeita em todas as versoes do Android/HyperOS.

## 8. Arquivos principais

Nativos: `AudioFocusController.java`, `PlaybackAuthorization.java`, `AudioDiagnostics.java`, `PlaybackSnapshot.java`, `PlaybackService.java`, `FluxoAudioPlugin.java`, `StreamResolver.java`, `LibraryDownloadWorker.java`, `LibraryStore.java`, `DownloadReceiver.java`, `DownloadNotices.java` e manifesto Android.

Interface: `www/app.js`, `www/platform.js`, `www/runtime.js`, `www/appearance.js`, `www/studio.css`, `www/visualizer.js`, `www/discovery.js`, `www/index.html` e `capacitor.config.json`.

Testes/ferramentas: `tests/native-focus.mjs`, `tests/native-idle-metrics.mjs`, `tests/native-idle-comparison.mjs`, `tests/studio-ui.mjs`, `PlaybackAuthorizationUnitTest.java`, teste instrumentado de contexto, testes de dados, fixture Android separado e scripts de compilacao/validacao. O projeto de PC e suas alteracoes locais anteriores foram preservados; o trabalho ocorre na copia de trabalho configurada, mantendo o original intacto.

## 9. Instalacao e artefato

APK local: `dist/Fluxo-Mobile-2.8.0.apk`. SHA-256: `1aefa4948c56ed15af9927afca53eb0e773ba15a376a696c85ef42327e0e440c`.

Certificado SHA-256: `42dc5c2adbe56aefb20922bd7ba4392c0413f7948122530132474876ea874bbb`, igual a 2.7 e anteriores. Instalacao por cima no emulador passou; nao desinstale para atualizar. Nao foi publicada uma release nova nesta entrega. O binario e debug, para validacao pessoal. O guia `INSTALAR-NO-CELULAR.md` explica a transferencia e o roteiro no POCO.
