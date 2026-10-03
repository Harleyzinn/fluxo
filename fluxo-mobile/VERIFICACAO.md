# Verificacao da Versao 2.4.0

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
