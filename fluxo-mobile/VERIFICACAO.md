# Verificacao da Versao 2.10.0

27 de outubro de 2026. Pre-release pessoal Android; validacao fisica pendente.

- 54 testes de dados/preferencias, oito verificacoes Java e quatro testes JUnit passaram.
- Player: atalhos de 5/10/15/30 segundos, preferencia de tempo persistente, presets de velocidade e extensao do timer passaram. A matriz de 16 layouts, 16 telas de navegacao, 24 combinacoes de aparencia, ajustes/backup/cache e colecoes/fila passou.
- Android: configuracoes parciais nao reativaram medidor nem desligaram diagnostico; modos invalidos preservaram a preferencia anterior. Busca valida pausada, comandos antigos recusados, fila fria, PCM e arraste estavel passaram.
- Tres falhas controladas do renderer: processo/audio preservados, recuperacao em segundo plano adiada ate o retorno, limite de tentativas e botao manual funcionando sem pedir foco extra ou iniciar audio ocioso.
- A falha real de memoria foi observada em API 37 com 2 GB. A rodada final usa 4 GB. Atualizacao automatica do WebView interrompeu uma tentativa anterior; nao e contada como aprovada. Sem nova comparacao de PSS/bateria.
- O [registro final de foco e tela apagada](https://github.com/Harleyzinn/fluxo/releases/download/mobile-v2.10.0/RESULTADOS-2.10.0.json) e distribuido na release, vinculado ao SHA-256 do APK. Os resultados historicos abaixo nao substituem essa verificacao.
- APK SHA-256 `1b29936e2fb9486c5b26c73526169eee47f98d8174879bc4bbfff2a5493d9836`. Certificado anterior preservado; instale como atualizacao, sem desinstalar.

[Relatorio, limites e arquivos da 2.10](docs/PLAYER-2.10.md). POCO/HyperOS, Spotify real, Bluetooth/fones e horas de uso fisicos ainda pendentes.

## Evidencias da Versao 2.9.0

17 de outubro de 2026. Compilacao local de teste, Android API 37 em emulador e Microsoft Edge. O POCO/HyperOS fisico continua pendente.

- 51 testes de dados/estado e oito verificacoes Java de autorizacao passaram.
- Novo player: pausa durante buffering, arraste sem substituicao do elemento, foco preservado e progresso retomado apos confirmar, cancelamento, troca de faixa durante o arraste, tempo restante, timer pausado e visualizador retomado passaram.
- Atualizacoes apenas de progresso nao causaram mutacoes nos botoes principais. Velocidade com imprecisao de float foi exibida sem casas extras.
- 16 combinacoes do novo player em 320/390/820 px e paisagem 844x390, claro/escuro, texto maior e compacto/capa, sem controles fora da tela. Passaram tambem 16 telas de navegacao, 24 combinacoes de aparencia, ajustes/backup e colecoes/fila/atalhos.
- Android real do emulador: busca antiga nao iniciou servico nem pediu foco; comandos com faixa/URL antiga foram recusados, busca valida manteve a pausa e arraste sobreviveu aos ticks nativos. Economia desligou o medidor; modo equilibrado reativou niveis de PCM.
- Fila fria: posicao, embaralhar e adicionar a fila atualizaram a interface sem iniciar servico. Posicao foi preservada enquanto pausada.
- Android enviou velocidade `1.100000023841858`; a interface mostrou o rotulo compacto de 1,1 vezes.
- Alternar apenas o estado online/offline do radio atualizou o indicador imediatamente. O teste reproduziu o rotulo antigo antes da correcao.
- Na compilacao final, a falha de stream seguida de 65 segundos com outro player terminou com zero perdas de foco externo. Passaram tambem nove cenarios de coexistencia: sons internos, segundo plano, tela bloqueada, avisos, rede, alternancia de apps, preferencias/cache e download real. Economia do sistema nao foi contada como aprovada nesta rodada, pois sua ativacao no emulador foi inconsistente.
- Stream proprio avancou 183,9 segundos durante tres minutos com tela apagada, com servico em primeiro plano. Pausar, Continuar e Proxima pela notificacao passaram. Radio online retornou sete faixas sem repetidas; encerrar radio, radio offline e temporizador ao fim passaram. Inicio do stream em 15,0 segundos nesta rede/fonte, sem alegacao de ganho de velocidade. Uma tentativa anterior de toque na notificacao foi inconclusiva; detalhes no relatorio.
- APK `Fluxo-Mobile-2.9.0.apk`, SHA-256 `1ea2223fa5b3574092ff3ec91f46d8640d7fb01f663bdf055ef7d34e875efdb4`. Assinatura anterior preservada; instalado sobre a 2.8 sem apagar dados.

[Detalhes das correcoes e limites](docs/PLAYER-2.9.md). Sem nova medicao de PSS/bateria nesta rodada; nao se afirma reducao de RAM. Spotify real, Bluetooth e teste no POCO continuam pendentes.

## Evidencias da Versao 2.8.0

Validacao em 11 de outubro de 2026, Android API 37 em emulador e Microsoft Edge. O POCO X5 5G fisico nao estava conectado. APK local de teste, nao publicado como release validada.

- 47 testes de dados/preferencias/cache, oito verificacoes Java de autorizacao e quatro testes JUnit no Gradle passaram. O teste instrumentado de contexto foi corrigido, mas nao foi executado nem contado como teste de audio.
- Uma causa de interferencia foi reproduzida na 2.7: recuperacao de stream apos perda transitoria retomou foco sem nova acao do usuario e pausou o player externo de teste. Na 2.8, o mesmo cenario manteve o player externo tocando por 65 segundos, zero perdas, sem recuperacao ou nova solicitacao de foco pelo Fluxo.
- No APK final, coexistencia passou durante navegacao, segundo plano, tela bloqueada, efeitos opcionais, alternancia de apps, perda/retorno de rede e economia de bateria do Android confirmada ativa.
- Download real de fixture oficial pequeno concluiu com notificacao silenciosa no canal proprio, sem interromper o player externo. Um download maior do Google excedeu quatro minutos com progresso parcial; esse teste nao foi contado como aprovado.
- Interface: 16 telas, 24 combinacoes de personalizacao, biblioteca de 250 faixas, selecao de 183 e ferramentas de playlists. Nova central em cinco categorias, claro/escuro/automatico, backup aplicado imediatamente, limpeza segura e 18 capturas em 320/390/820 px passaram.
- Android: migracao/reparacao com SHA-256, arquivos privados e playlists apos reinicio, aliases, volume, restauracao sem autoplay e organizacao de fila sem perder posicao. Edicao preservou audio/pausa; download por playlist, deduplicacao concorrente, cancelamento, compartilhar e seletor de exportacao passaram.
- Stream proprio avancou 180,7 segundos em tres minutos com tela apagada no APK final; notificacao nativa pausou, continuou e passou de faixa. Radio online retornou sete faixas sem repetidas, radio offline e temporizador ao fim passaram. Inicio do stream: 4,2 segundos nesta ultima execucao (5,9 na anterior), dependente da fonte/rede.
- Medicao sequencial de tres aberturas por versao: mediana 3970 -> 3044 ms; eventos ociosos 8/9/8 -> 0/0/0; servico passivo deixou de existir. PSS mediano 154619 -> 159962 KB, cerca de 3,5% maior, portanto reducao de RAM nao foi comprovada.
- Segunda rodada alternando versoes: abertura 5153 -> 4259 ms, cerca de 17% menor; PSS 138514 -> 146246 KB, cerca de 5,6% maior. Memoria continua como pendencia de desempenho, sem alegacao de ausencia de regressao.
- APK `dist/Fluxo-Mobile-2.8.0.apk`, SHA-256 `1aefa4948c56ed15af9927afca53eb0e773ba15a376a696c85ef42327e0e440c`. Certificado igual ao anterior: `42dc5c2adbe56aefb20922bd7ba4392c0413f7948122530132474876ea874bbb`. Atualizacao sem apagar dados passou no emulador.
- Auditoria JavaScript de producao: zero vulnerabilidades reportadas, sem alegar auditoria completa das dependencias Android.

Aceitacao final pendente: Spotify/YouTube Music/Apple Music reais, POCO/HyperOS, Bluetooth/fones, redes fisicas, horas de uso e perfilagem de memoria/bateria. [Relatorio detalhado, arquivos alterados, limites e matriz dos 14 cenarios](docs/RELATORIO-2.8.md).

## Evidencias da Versao 2.7.0

Validacao em 3 de outubro de 2026, Android API 37 em emulador e Microsoft Edge. O POCO X5 5G fisico nao estava conectado.

- 42 testes de dados passaram. Novos casos cobrem edicao por ID/URL, campos invalidos, preferencias de download por playlist, ordenacao numerica, desfazer preservando alteracoes posteriores e formato de exportacao sem caminhos privados.
- Pela interface: descricao e download da playlist persistiram, ordenar e desfazer restauraram a sequencia, Reproduzir a partir daqui montou somente o restante da playlist, e editar nome/artista atualizou biblioteca, favoritas, historico e registro offline.
- Exportacao individual gerou JSON valido. Importacao criou uma colecao com novo ID, preservou a original e nao alterou a configuracao global de downloads. O seletor nativo de exportacao e o compartilhamento Android abriram corretamente; a suite visual verificou o conteudo do JSON, nao apenas a abertura do seletor.
- No Android, editar durante a reproducao preservou posicao, indice, IDs, URLs e estado tocando. Editar pausada manteve a pausa. SHA-256 do arquivo privado igual antes/depois: nenhuma regravacao do audio.
- Download automatico por playlist agendado com a opcao geral desligada, sem agendar a faixa nao selecionada. Requisicoes equivalentes concorrentes resultaram em um arquivo pronto para a mesma URL; remover/cancelar bloqueou os aliases conhecidos e uma tentativa explicita liberou o item solicitado.
- Cancelar usando o identificador pendente equivalente depois da conclusao retornou cancelled=false e manteve o arquivo pronto. Remover explicitamente pelo alias encontrou e removeu o registro nativo correto; a sincronizacao seguinte nao o recriou.
- Consulta nativa de espaco retornou bytes livres/total coerentes. Informacoes de espera agora distinguem nova tentativa do Android de ausencia de conexao. Durante a verificacao, o emulador apresentou falhas TLS e o gerenciador Android retomou o arquivo; isso nao foi tratado como garantia de velocidade de download.
- Nova suite visual em 320x640, 390x844 e 820x1180, incluindo formulario de descricao e playlists importadas, sem rolagem horizontal. Passaram tambem as 16 telas de navegacao, 24 combinacoes de personalizacao, biblioteca de 250 faixas, selecao de 183 faixas e migracao da previa.
- Regressao Android: volume persistente, fila restaurada sem autoplay, aliases offline, reparacao com SHA-256 preservando copia anterior, limpeza parcial da fila e arquivos/playlists mantidos apos reiniciar o processo.
- A busca real no YouTube retornou 17 faixas na verificacao desta versao. Consultar de novo pela interface reutilizou o cache; menus antigos da fila foram recusados sem alterar outra faixa.
- No APK final, um stream ainda nao baixado iniciou em 2,8 segundos nesta execucao e avancou 180,3 segundos durante tres minutos com a tela realmente apagada. Servico em primeiro plano confirmado; Pausar, Continuar e Proxima acionados na notificacao.
- Radio online retornou sete faixas sem IDs repetidos, encerrar removeu recomendacoes futuras, radio offline avancou sem internet e o temporizador Ao fim desta musica pausou. Tocar uma musica normalmente nao criou fila automatica.
- APK atualizado sobre a instalacao anterior, com certificado SHA-256 `42dc5c2adbe56aefb20922bd7ba4392c0413f7948122530132474876ea874bbb`, igual ao das versoes anteriores.
- APK publicado: `Fluxo-Mobile-2.7.0.apk`. SHA-256: `8cc6a34b099c01b0c1f1fb0a0d6bf83f5c0056712af157002b19dba0a09b5b22`.
- Auditoria JavaScript de producao: nenhuma vulnerabilidade reportada nesta execucao. Nao e uma auditoria completa dos componentes Android nem dos provedores.

Testes em emulador nao garantem comportamento identico no POCO/HyperOS, nem disponibilidade de qualquer fonte. Exportacao/importacao JSON nao transfere os arquivos de audio. Copias duplicadas antigas nao sao apagadas automaticamente para preservar os dados existentes.

## Evidencias da Versao 2.6.0

Validacao em 3 de outubro de 2026, Android API 37 em emulador e Microsoft Edge. O POCO X5 5G fisico nao estava conectado.

- 36 testes de dados passaram: agrupamento por artista, aliases de download, cache limitado/expiracao, filtros de busca, protecao contra operacoes sobrepostas, menus antigos e limites de backups, alem das verificacoes anteriores.
- Paginas de artistas com filtro sem diferenciar acentos, contagem offline e criacao/reproducao de playlist passaram. A busca local e a colecao de artistas nao duplicaram um arquivo com dois identificadores para a mesma URL.
- Busca com respostas controladas: consulta repetida reutilizou o cache, Atualizar consultou de novo, os filtros de duracao funcionaram e uma resposta atrasada da busca cancelada nao substituiu a consulta seguinte. Rascunho mantido ao atualizar a tela.
- Informacoes da faixa mostraram tamanho, origem e disponibilidade. Copiar link funcionou no navegador e pela ponte nativa Android.
- Menu aberto antes de alterar a fila recusou remover outra faixa. No Android, uma requisicao enviada com a fotografia antiga da fila tambem foi rejeitada; uma requisicao atual removeu a faixa sem iniciar o player pausado.
- Tocar a seguir com a fila vazia e limpar proximas em uma sessao vazia passaram no Android. Nenhuma dessas acoes iniciou automaticamente o audio.
- No Android, a colecao de um artista iniciou os arquivos privados com Wi-Fi/dados desligados, mantendo os identificadores da biblioteca. Criar a playlist e mostrar o timer regressivo funcionaram pela interface.
- Busca real no YouTube retornou 16 faixas na verificacao do APK final. Repetir a consulta pela interface nao chamou novamente o extrator nativo, conferindo a integracao do cache.
- Suite visual nova em 320x640, 390x844 e 820x1180. As 16 telas de navegacao, 24 combinacoes de personalizacao (incluindo texto maior), biblioteca de 250 faixas e selecao de 183 faixas tambem passaram.
- Regressao Android: volume sobreviveu ao reinicio, fila restaurada nao tocou sozinha, caminho de arquivo antigo usou a copia atual e arquivo ausente terminou com erro legivel, sem carregar para sempre.
- Migracao/reparacao verificadas novamente no Android com SHA-256, preservando a copia anterior. Playlists, fixacao, audios offline, atalhos de dez segundos e limpeza parcial da fila passaram, inclusive apos reiniciar o processo.
- Stream online nao baixado iniciou em 2,7 segundos nesta execucao e avancou 180,3 segundos durante tres minutos com a tela realmente apagada. Servico em primeiro plano confirmado. Pausa, continuar e proxima foram acionados na notificacao Android.
- Radio online trouxe sete faixas sem IDs repetidos; encerrar removeu as recomendacoes futuras. Radio offline avancou sem internet e o temporizador Ao fim desta musica pausou.
- APK compilado e atualizado sobre a instalacao anterior. Certificado SHA-256: `42dc5c2adbe56aefb20922bd7ba4392c0413f7948122530132474876ea874bbb`, igual ao das versoes anteriores.
- Auditoria das dependencias JavaScript de producao: nenhuma vulnerabilidade reportada nesta execucao. Isso nao e uma auditoria completa dos componentes Android nem dos servicos externos.

Resultados em emulador nao garantem comportamento identico no HyperOS. Tempos de inicio e disponibilidade dependem da rede e do provedor; a verificacao da interface de busca com respostas controladas nao foi usada como prova de streaming real.

## Evidencias da Versao 2.5.0

Validacao em 3 de outubro de 2026, Android API 37 em emulador e Microsoft Edge. O POCO X5 5G fisico nao estava conectado.

- 29 testes de dados passaram: identificadores de downloads, correspondencia por URL, remocao em lote, ordem no desfazer, playlists fixadas e preservacao de adicoes posteriores.
- Biblioteca de 183 faixas: selecao mantida ao mudar o filtro, selecao de toda a colecao alem da primeira pagina, criacao de playlist em lote, fixacao, favoritas e remocao com desfazer passaram.
- Historico completo, busca, limpeza com desfazer e reproducao da selecao filtrada passaram. Voltar recuperou a rolagem e as 160 linhas ja carregadas.
- Na previa, a fila atualizou ao adicionar faixas, apenas a posicao atual foi destacada entre repetidas e remover a faixa pausada nao iniciou a seguinte.
- Layouts de colecoes e selecao em 320x640, 390x844 e 820x844 sem rolagem horizontal. 16 telas de navegacao, 24 combinacoes de aparencia, biblioteca de 250 faixas e a suite da 2.4 tambem passaram.
- No Android sem Wi-Fi/dados moveis, arquivos com identificadores antigos tocaram por sua URL correspondente. O indice solicitado da playlist foi preservado.
- Os atalhos de dez segundos foram acionados pela interface. Limpar anteriores/proximas/repetidas preservou a faixa, a posicao de 35 segundos e o estado pausado. Remover a ultima faixa encerrou a sessao vazia sem erro antigo.
- Playlist, fixacao e arquivos locais foram preservados ao encerrar e reiniciar o processo Android. APK instalado por cima da versao anterior com o mesmo certificado.
- Migracao nativa de tres arquivos de 2.400.044 bytes por blocos: SHA-256 de cada copia Android igual ao original, verificando que os blocos nao se sobrescrevem.
- Reparacao de uma copia de teste truncada criou um novo arquivo com SHA-256 igual ao original e preservou o anterior. Uma fila com o caminho antigo tocou a copia reparada. A verificacao da ponte de migracao confirmou offsets/tamanhos e que arquivos removidos pelo usuario, copias validas e registros do DownloadManager nao sao substituidos. Uma segunda execucao nao repetiu a migracao.
- Stream online nao baixado iniciou em 3,2 segundos nesta execucao, avancou 180,4 segundos com a tela realmente apagada por tres minutos e manteve o servico em primeiro plano. Pausa, continuar e proxima foram acionados na notificacao.
- Radio online retornou sete faixas sem IDs repetidos, encerrar limpou recomendacoes futuras, radio offline avancou sem internet e o temporizador Ao fim desta musica pausou.

Os tempos de inicio dependem da faixa, rede e cache. A verificacao em emulador nao substitui teste no POCO fisico; as restricoes adicionais do HyperOS ainda podem exigir ajustes de bateria pelo usuario.

## Evidencias da Versao 2.4.0

Validacao em 3 de outubro de 2026, Android API 37 em emulador e Microsoft Edge. O POCO fisico nao estava conectado.

- 23 testes de dados passaram, incluindo modelos locais incompletos, busca de playlists e valores numericos nao finitos.
- Interface: busca local, busca de playlists, criacao de playlist com a faixa de origem, desfazer remocao e exclusao, indices da fila, temporizador personalizado e ajustes em quatro categorias passaram.
- Proxima ficou disponivel ao adicionar uma faixa sem trocar a musica atual. Na previa, trocar de faixa enquanto pausado permaneceu pausado.
- 16 telas de navegacao, 24 combinacoes de personalizacao do player e bibliotecas de 250 faixas passaram. Novo player e ajustes conferidos em 320x640, 390x844 e 820x1180.
- Android tocou o arquivo privado offline a partir da metadata original, sem localUri, com Wi-Fi e dados moveis desligados. O caminho antigo de uma fila nao impediu usar o arquivo atual.
- Volume escolhido na interface foi aplicado ao ExoPlayer e permaneceu apos encerrar e iniciar novamente o processo. A fila foi restaurada sem iniciar automaticamente.
- Arquivo de teste apagado fora do app deixou de aparecer como pronto. A tentativa de reproducao terminou com erro legivel, sem carregamento infinito.
- APK instalado por cima da versao anterior, com a mesma assinatura. Temas, modo claro, player compacto, capas circulares, estilos salvos e controles conferidos no Android.
- Stream ainda nao baixado iniciou em 3,2 segundos nesta execucao e avancou 180,4 segundos durante tres minutos com a tela apagada. O servico permaneceu em primeiro plano. O tempo de inicio varia por faixa, rede e cache.
- Pausar, continuar e proxima faixa foram acionados na notificacao. Radio online retornou sete faixas sem IDs repetidos; radio offline avancou com a internet desligada, e o temporizador ao fim da faixa pausou.
- Download automatico aguardou Wi-Fi, concluiu 965.128 bytes e tocou offline. Cancelamento impediu novo agendamento e a tentativa explicita liberou o item. A transferencia passou por 45 segundos com a tela apagada; nesta execucao, a conclusao so foi confirmada apos retomar o app, nao durante os primeiros 45 segundos.

As verificacoes nao substituem testes no aparelho fisico. Streams ainda dependem da rede e do provedor; restricoes adicionais do HyperOS podem exigir ajustes de bateria pelo usuario.

## Evidencias da Versao 2.3.0

Validacao da 2.3.0 em 2 de outubro de 2026, Android API 37 em emulador e Microsoft Edge. O celular POCO fisico nao estava conectado.

- 20 testes de dados e backup passaram, incluindo filtros de downloads, tamanhos de arquivos, preferencias do radio e bloqueio de caminhos privados em backups importados.
- Interface com biblioteca de 250 faixas: 80 linhas iniciais, carregamento de mais linhas e busca que encontra uma faixa fora da primeira pagina.
- Busca e selecao de musicas visiveis para playlists mantiveram a selecao ao trocar o filtro. Reordenar uma playlist filtrada moveu o item correto na lista original.
- Duplicacao de playlist, fila salva como playlist e indicador de disponibilidade offline conferidos.
- Interface do gerenciador de downloads conferida em 320x640, 390x844 e 820x1180, sem rolagem horizontal ou texto fora dos controles.
- 24 combinacoes de layouts/visualizadores e os recursos de personalizacao anteriores passaram no teste de aparencia.
- Radio Android preservou a posicao da faixa atual e as faixas manuais. As recomendacoes offline respeitaram a musica excluida do radio.
- Download manual foi agendado em 35 ms nesta execucao, sem esperar a extracao na interface. Esse tempo nao representa o inicio ou termino da transferencia.
- O agendamento manual permaneceu pendente apos sincronizar com Download automatico desativado e apos recarregar o aplicativo.
- Apenas a faixa solicitada foi agendada, sem baixar a faixa de outra colecao. Cancelamento pelo controle da interface confirmado.
- Download manual concluiu 965.128 bytes e tocou com Wi-Fi e dados moveis desligados.
- Cancelar apenas pendentes preservou um arquivo que ja estava concluido quando o estado nativo foi conferido.
- Download automatico esperou Wi-Fi, concluiu o arquivo de teste de 965.128 bytes durante 45 segundos com a tela apagada e tocou offline. Cancelar impediu novo agendamento automatico; repetir explicitamente liberou o download.
- Stream da 2.3 continuou tocando durante 180 segundos com a tela realmente apagada e avancou mais de 180 segundos. O servico permaneceu em primeiro plano, com notificacao de reproducao ativa.
- Pausar, continuar e proxima faixa foram acionados na notificacao Android. Radio online retornou sete faixas sem IDs repetidos; encerrar removeu as recomendacoes futuras. Radio offline avancou sem Wi-Fi ou dados moveis e o temporizador ao fim da faixa pausou a reproducao.
- APK atualizado sem desinstalar, com a mesma assinatura das versoes 2.0/2.1/2.2. Temas, player compacto e estilos salvos conferidos no Android.

## Evidencias anteriores da base 2.2.0

Validacao realizada em 1 e 2 de outubro de 2026 em emulador Android API 37 e navegador Microsoft Edge.

- APK compilado, instalado e aberto no Android.
- Busca YouTube e reproducao de audio online confirmadas.
- Inicio em 0,6 segundo com cache na execucao do teste desta versao. O tempo depende do cache, da rede e do provedor; nao e promessa para toda faixa.
- Tela realmente apagada durante 180 segundos: o stream avancou 180,6 segundos. Isso ultrapassa o buffer maximo de 50 segundos e verifica carregamento de audio com a tela apagada.
- Servico Android confirmado com isForeground=true, tipo mediaPlayback e notificacao 1001 no canal fluxo_playback.
- Botoes Pausar, Continuar e Proxima realmente tocados na central de midia do sistema e estados do player conferidos. Capa, titulo, artista e barra de progresso inspecionados na captura Android.
- Tocar uma faixa na lista cria uma fila de apenas uma musica.
- Infinite Radio online retornou sete faixas, sem IDs repetidos. Encerrar removeu as recomendacoes futuras.
- Radio offline iniciou e avancou com Wi-Fi e dados moveis desativados.
- Temporizador Ao fim desta musica pausou sem iniciar a proxima faixa.
- Download completo de 10.271.496 bytes da versao anterior preservado apos atualizar e reproduzido com Wi-Fi e dados moveis desativados.
- Download automatico da biblioteca aguardou Wi-Fi, concluiu um arquivo de teste de 965.128 bytes e reproduziu o arquivo privado com a internet desativada.
- Cancelamento impediu novo download automatico do mesmo item; nova tentativa explicita liberou o agendamento.
- A transferencia passou por tela apagada e retomada da interface. Nessa execucao, o arquivo de teste precisou de novas tentativas do gerenciador Android por falhas TLS do emulador e terminou apos retomar a interface; nao foi confirmado o termino durante os primeiros 45 segundos de tela apagada.
- Fila, proxima faixa, velocidade, repeticao, aleatorio e temporizador testados no Android.
- Visualizador recebeu 32 amostras de nivel do audio e desenhou pixels no canvas. Nenhuma permissao de microfone e utilizada.
- Um endereco de audio invalido encerrou o carregamento com erro, sem espera infinita.
- Importacao, favoritos, playlist offline, persistencia e temas testados na interface.
- Quatro tamanhos de tela verificados, incluindo 320x640. Player e controles permaneceram acessiveis.
- 17 testes de dados, validacao de aparencia, escopo de downloads da biblioteca e backup passaram.
- Cores, texto, fonte, espacamento, cantos, capas, temas favoritos, estilos salvos, restauracao e persistencia testados na interface.
- 24 combinacoes de layouts/visualizadores do player verificadas em quatro tamanhos de tela, com os controles acessiveis.
- Player compacto, capas circulares e estilos salvos verificados no APK Android.
- Assinatura da 2.2.0 comparada com a 2.1.0 e 2.0.0: mesmo certificado. Atualizacao instalada sem desinstalar e mantendo os arquivos.

A interface oferece 68 paletas. Os estilos adicionais foram adaptados do projeto desktop para a navegacao compacta do celular.

O comportamento no celular fisico do usuario ainda precisa ser conferido apos a instalacao. Restricoes do YouTube, da rede e da bateria do fabricante podem afetar streams ou o funcionamento em segundo plano. Os downloads completos e arquivos importados nao dependem do YouTube para tocar offline.
