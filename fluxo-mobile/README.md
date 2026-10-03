# Fluxo Mobile 2.6

App independente para **Android 7 ou superior**, reconstruido na pasta `fluxo-mobile`. Nao precisa do Fluxo de PC nem de um servidor seu para tocar. A interface usa HTML/CSS/JavaScript dentro do Capacitor; o audio, a sessao de midia, a extracao de streams e os arquivos sao tratados em Java no Android.

## Instalar e usar

Download: [Fluxo Mobile 2.6.0 para Android](https://github.com/Harleyzinn/fluxo/releases/tag/mobile-v2.6.0). Baixe o arquivo `Fluxo-Mobile-2.6.0.apk`, nao os pacotes de codigo-fonte.

1. Abra o link de download no celular ou envie `dist/Fluxo-Mobile-2.6.0.apk` por USB.
2. Abra o APK no celular. Quando o Android pedir, permita instalar apps dessa origem. Depois da instalacao, voce pode desativar essa permissao novamente.
3. Abra o Fluxo. Procure uma musica na aba **Buscar** ou use o botao de pasta para importar seus arquivos.
4. Ao iniciar a primeira reproducao ou download, o app pede notificacoes no Android 13 ou superior. Negar nao impede tocar. O seletor de arquivos concede acesso somente aos arquivos escolhidos, sem pedir acesso geral ao armazenamento.
5. Salve uma musica na biblioteca, favorite ou adicione a uma playlist. Com **Download automatico** ativo, o app agenda o download. Ela aparece em **Biblioteca > Baixadas**, com progresso ou motivo de espera. Aguarde a conclusao antes de desligar a internet. Historico, resultados de busca e radio nao sao baixados so por serem ouvidos.
6. Crie uma playlist com **Somente musicas baixadas**, adicione os arquivos e reproduza. O modo offline fica em Ajustes.

**Nao precisa upar um site para usar o aplicativo.** O APK ja contem o app. O endereco de pre-visualizacao no computador e apenas uma ferramenta de desenvolvimento, nao e o app Android.

Este APK e uma compilacao de desenvolvimento assinada para instalacao pessoal. Para publicar na Play Store ou distribuir atualizacoes permanentes, gere uma chave de assinatura de producao no Android Studio em **Build > Generate Signed App Bundle / APK**. Guarde essa chave: uma atualizacao precisa da mesma assinatura. Nao envie senhas nem a chave ao GitHub. Uma assinatura diferente exige desinstalar o app anterior, apagando seus arquivos privados; exporte os dados antes e preserve os audios originais.

## Novidades da 2.6.0

- Biblioteca por artistas, agrupada a partir dos nomes informados nas faixas. Busca sem diferenciar acentos, contagem offline, pagina com capa, filtro, selecao em lote e reproducao. Criar playlist do artista inclui as suas faixas.
- Arquivos baixados com outro identificador, mas a mesma URL, nao aparecem em duplicidade nas colecoes de artistas nem na busca local. Playlists tambem evitam adicionar novamente a mesma URL.
- Busca online com filtros de duracao, favoritas e baixadas. Resultados das ultimas oito consultas ficam em memoria por cinco minutos; repetir a consulta reaproveita os resultados. Atualizar resultados consulta novamente o provedor.
- Cancelar a busca libera a interface e ignora respostas atrasadas; nao interrompe uma extracao ja enviada ao provedor. Outra consulta pode ser iniciada imediatamente. O texto ainda nao enviado e mantido quando a tela atualiza.
- Menu de musica com Biblioteca, Reproducao e Organizar recolhiveis. A secao de organizacao abre diretamente quando o menu vem da fila ou playlist.
- Informacoes da musica: origem, artista, duracao, disponibilidade offline, tamanho do arquivo quando informado e playlists que a incluem. Copiar link funciona pela area de transferencia nativa, sem permissao geral de armazenamento.
- Player mostra origem do audio, posicao na fila e contagem regressiva do temporizador. Controles de dez segundos com area de toque maior, estados acessiveis de favorita/aleatorio/repeticao e layout revisto para texto ampliado.
- Acabamento visual da biblioteca, playlists, artistas, menus e navegacao. Layouts compacto/capa e os 68 temas continuam disponiveis.
- Protecao contra envios duplicados durante operacoes pendentes. Navegacao e fechamento de menus recuperam o foco para melhorar o uso com leitor de tela/teclado.
- Menus antigos nao removem/movem outro item quando a fila muda. A verificacao tambem acontece no servico Android, no momento de executar o comando.
- Corrigidos Tocar a seguir com fila vazia e limpar proximas em sessao vazia. Adicionar uma faixa continua sendo manual e nao inicia automaticamente o audio.
- Consultas de downloads, favoritas e musicas salvas usam indices em memoria para reduzir buscas repetidas ao renderizar listas. Totais de colecoes usam horas/minutos, e backups excessivamente grandes sao rejeitados antes da restauracao.

Atualize sem desinstalar para preservar seus arquivos privados. O APK continua sendo uma compilacao de desenvolvimento para uso pessoal; a verificacao em emulador nao substitui teste no POCO/HyperOS fisico.

## Novidades da 2.5.0

- Selecao em lote nas musicas salvas, baixadas, favoritas, historico e playlists. Selecione por filtro ou em toda a colecao, inclusive alem das primeiras 80 linhas.
- Acoes da selecao: tocar, favoritar, baixar, salvar na biblioteca, criar/adicionar a playlists e remover com confirmacao. Remover arquivos e uma acao separada, sem apagar playlists.
- Remocoes da biblioteca, playlists e historico podem ser desfeitas por dez segundos. A exclusao de arquivos de audio nao pode ser desfeita.
- Playlists fixadas no topo, com ordem respeitada tanto na lista normal quanto na ordenacao por nome. A fixacao acompanha o backup.
- Historico completo com filtro, ordenacao, selecao e reproducao. Continuam sendo guardadas ate 100 musicas realmente iniciadas.
- Reproducao da colecao filtrada. Em modo offline, somente as faixas disponiveis entram nessa selecao, com aviso quando outras ficam de fora.
- Ferramentas da fila para remover anteriores, limpar apenas as proximas e eliminar repetidas a seguir. Preservam a musica atual e sua posicao; limpar proximas encerra o radio.
- Atalhos para voltar/avancar dez segundos no player. Proxima segue a disponibilidade real do player Android, inclusive em ordem aleatoria.
- Navegacao mantem rolagem, filtro, ordenacao e quantidade de linhas carregadas ao voltar para uma colecao. Voltar sai primeiro da selecao ou do historico.
- Resumo visual da biblioteca reorganizado, capas de playlist sem espacos vazios com duas/tres imagens, acoes de selecao recolhidas fora desse modo e miniplayer com controle principal mais legivel.
- Corrigida a troca involuntaria do identificador da musica ao usar um download antigo. Arquivos com outro identificador mas mesma URL tocam sem deslocar o indice da playlist.
- Na previa, remover a faixa atual enquanto pausado nao inicia a seguinte; a fila atualiza ao adicionar faixas. Repetidas na fila nao aparecem todas como musica atual.
- Corrigida a migracao de arquivos maiores que 256 KB, que podia truncar o audio. Ao atualizar, copias antigas truncadas/ausentes sao recuperadas do banco antigo quando ele ainda existe. O arquivo anterior e preservado; arquivos removidos pelo usuario e transferencias do DownloadManager nao sao recriados/substituidos por essa reparacao.
- Atualizacoes de estado evitam reconstruir a biblioteca para cada linha do player. Busca local se atualiza quando um download termina, e as telas respondem ao perder/recuperar conexao.

Os 68 temas, estilos pessoais, downloads automaticos, radio opcional e central de notificacoes foram mantidos. Atualize por cima da instalacao anterior para preservar os arquivos privados. Testes Android realizados em emulador; nao ha promessa de funcionamento perfeito em toda rede/aparelho.

## Novidades da 2.4.0

- Ajustes divididos em Audio, Biblioteca, Visual e Sistema, com menos controles por tela.
- Busca Na biblioteca funciona com faixas salvas e importadas; sem internet, exibe apenas as disponiveis offline. Busca online continua separada.
- Biblioteca com area Continuar ouvindo, resumo compacto, busca de playlists sem diferenciar acentos, ordenacao por nome e indicador de arquivos locais nas capas.
- Fila dividida em Tocando agora, A seguir e anteriores recolhiveis, preservando os indices corretos ao tocar ou mover itens.
- Menu da musica com atalhos de favoritas/fila/download e grupos Biblioteca, Reproducao e Organizar.
- Volume interno de 0 a 100%, salvo pelo player Android, sem alterar o volume geral do telefone. Controle acessivel pelo player e Ajustes > Audio.
- Temporizador personalizado de 1 a 240 minutos, alem dos intervalos prontos e Ao fim desta musica.
- Desfazer por dez segundos apos remover uma faixa da playlist ou excluir a playlist. Excluir uma colecao retorna para Colecoes.
- Criar uma playlist pelo menu da musica inclui aquela musica, mesmo quando ainda nao existiam playlists.
- Botao Proxima atualizado ao adicionar faixas sem trocar a musica atual. Trocar de faixa enquanto pausado nao inicia o audio na previa do navegador.
- Player Android consulta o arquivo offline atual ao abrir o audio, inclusive para filas restauradas com um caminho antigo. Arquivos ausentes ou vazios deixam de aparecer como prontos.
- Inicializacao tolera dados locais parciais; duracoes e tamanhos invalidos nao quebram os totais. Campos de busca mantem o foco ao atualizar a interface.

A 2.4 mantem os 68 temas, estilos, downloads automaticos, preferencias do radio e central de notificacoes. A assinatura permanece igual para atualizar sem desinstalar. A validacao Android e feita em emulador; o POCO fisico ainda precisa ser conferido.

## Novidades da 2.3.0

- Central de downloads integrada a Biblioteca > Baixadas, com filtros Todas/Prontas/Pendentes/Falhas, espaco ocupado, cancelamento direto e novas tentativas individuais ou em lote.
- Downloads manuais agendados pelo Android, sem esperar a extracao na interface. Continuam ativos ao reabrir o app, mesmo com Download automatico desativado.
- Baixar uma playlist agenda somente as faixas daquela playlist. A preferencia global de downloads automaticos nao e ativada por essa acao.
- Cancelar pendentes confere o estado nativo novamente e preserva arquivos que ja estavam concluidos na verificacao.
- Iniciar Infinite Radio com a musica atual preserva a posicao e as faixas inseridas manualmente. Recomendacoes nao duplicam URLs ja presentes na sequencia.
- Opcao Nao recomendar no radio por musica, gerenciamento em Ajustes > Preferencias do radio e inclusao dessas preferencias no backup.
- Salvar a fila como playlist e duplicar playlists, preservando a ordem e a capa personalizada.
- Busca e selecao das musicas visiveis ao adicionar a uma playlist, com contador de selecionadas e selecao mantida ao mudar o filtro.
- Indicador de disponibilidade offline e duracao total de playlists. Reordenacao e remocao respeitam a posicao original mesmo com a lista filtrada.
- Listas extensas carregadas em grupos de 80, com busca em toda a biblioteca. Consulta nativa dos downloads em lote para reduzir acessos ao sistema.
- Progresso de buffer no miniplayer e botao Proxima desativado quando nao ha proxima faixa. Importar arquivos limpa filtros antigos que poderiam esconder a importacao.
- Backups importados nao podem introduzir caminhos privados de arquivos de outro aparelho.

Os temas, estilos, central de notificacoes, reproducao em segundo plano e demais recursos da 2.2 foram mantidos. O comportamento no POCO fisico precisa ser confirmado apos instalar; os testes Android desta entrega foram realizados em emulador.

## Novidades da 2.2.0

- Tocar uma musica inicia apenas aquela faixa. Uma playlist inteira so entra na fila pelo comando Reproduzir da playlist; adicionar a fila continua sendo uma acao manual.
- Infinite Radio opcional, iniciado pelo menu da musica ou pelo player. Recomendacoes do provedor, deduplicacao, preparacao das proximas faixas e reposicao no servico Android, mesmo com a tela apagada.
- Radio offline com arquivos ja baixados, sem consultas a internet. Encerrar o radio remove as recomendacoes futuras e preserva faixas colocadas manualmente.
- Aba Salvas e downloads automaticos de musicas salvas, favoritas e playlists. Trabalhos persistentes do WorkManager e transferencias pelo DownloadManager Android; retomada apos falhas com tentativas limitadas.
- Preferencia Wi-Fi, cancelamento que impede baixar o mesmo arquivo automaticamente outra vez, e central para retomar downloads pendentes ou com falha.
- Correcao do registro da sessao no MediaSessionService. O audio passa a promover o servico para primeiro plano e exibir a central de midia, com capa, titulo, artista, pausa, continuar, anterior/proxima e progresso conforme a versao do Android.
- Protecao de CPU e Wi-Fi durante a reproducao, recuperacao limitada de streams e renovacao de URLs mantendo a posicao.
- Temporizador para parar ao fim da faixa, alem dos intervalos em minutos.
- Tela com estado de notificacoes, bateria, versao Android e servico de audio, com acesso aos ajustes do aparelho.
- Biblioteca salva incluida no backup, sem caminhos privados de audio ou capas. Os 68 temas e a personalizacao da 2.1 foram preservados.

**Dados moveis:** downloads automaticos estao ativos por padrao. Ative Ajustes > Baixar so no Wi-Fi para evitar transferencias de audio por dados moveis. A preferencia se aplica ao agendamento; transferencias ja iniciadas pelo gerenciador Android nao sao reiniciadas ao mudar a opcao. Nenhum download e garantia de disponibilidade: conteudo bloqueado ou sem espaco suficiente nao pode ser baixado.

## POCO / Xiaomi com HyperOS

No POCO X5 5G, abra **Ajustes > Sistema > Tela apagada e notificacoes** no Fluxo. Permita notificacoes. Nos ajustes do aplicativo no telefone, procure a opcao de bateria e escolha **Sem restricoes**, se disponivel. Em **Configuracoes > Apps > Inicializacao automatica em segundo plano**, permita o Fluxo quando necessario. Os nomes e caminhos variam com a versao do HyperOS; o app abre os ajustes, mas nao muda essas permissoes sozinho.

O estado "sem otimizacao do Android" nao confirma todas as regras extras do HyperOS. A documentacao da Xiaomi descreve as [restricoes de bateria por aplicativo](https://www.mi.com/global/support/article/KA-61830/) e o [controle de inicializacao automatica](https://www.mi.com/global/support/faq/details/KA-497677/). A central usa a [sessao de midia oficial do Android](https://developer.android.com/media/media3/session/background-playback), e nao uma notificacao decorativa que depende da tela aberta.

## Personalizacao da 2.1.0

- Biblioteca com capas maiores nas playlists, alternancia entre grade/lista e fila numerada.
- Area de Aparencia dividida em Visual, Player e Estilos salvos.
- Cor principal, secundaria e fundo personalizaveis. O fundo ajusta automaticamente texto e superficies; botoes usam texto com contraste.
- Espacamento compacto/confortavel, texto padrao/maior, fonte sistema/mono/serifada, cantos retos/suaves/arredondados e capas quadradas/circulares.
- Player com capa em destaque ou layout compacto e visualizador em barras, onda de niveis ou desativado.
- Favoritos entre os 68 temas, filtro de favoritos e busca.
- Ate 12 estilos pessoais salvos, aplicacao rapida e restauracao da aparencia sem apagar biblioteca ou estilos.
- Playlists com mosaicos ou icones personalizados, sete simbolos e seis cores, com previa da capa.
- Estilos, temas favoritos e capas personalizadas acompanham o backup de metadados.
- A base de reproducao da 2.0 foi mantida; esta atualizacao nao depende do aplicativo de PC.

## O Que Foi Refeito

- Player Media3/ExoPlayer em `MediaSessionService`, com audio em segundo plano, controles de notificacao, audio focus e pausa ao desconectar fones.
- Busca YouTube e resolucao de audio no proprio Android usando NewPipeExtractor. Nao depende de instancias publicas Piped/Invidious.
- Cache temporario dos enderecos e preparacao antecipada da proxima faixa. Downloads disponiveis sao preferidos ao stream.
- Biblioteca nativa persistente, downloads pelo gerenciador Android, importacao pelo seletor de arquivos e migracao dos blobs da versao antiga.
- Navegacao Biblioteca / Buscar / Fila / Ajustes; miniplayer e player expandido; menus contextuais.
- 68 paletas de temas do Fluxo, incluindo as novas colecoes do desktop, adaptadas ao layout mobile. Sao paletas, nao todas as animacoes e layouts exclusivos do desktop.

## Dez Melhorias Implementadas

1. Filtro de biblioteca sem diferenciar acentos e ordenacao por titulo/artista.
2. Playlists com criacao, renomeacao, selecao multipla, reordenacao e remocao de faixas.
3. Playlists estritamente offline e preferencia automatica pelo arquivo baixado.
4. Favoritos e historico persistente de musicas realmente iniciadas.
5. Fila editavel com tocar a seguir, reordenar, remover e restaurar apos reabrir.
6. Temporizador executado pelo servico Android, inclusive com a tela desligada.
7. Velocidade de 0,5x a 2x, repeticao de uma/faixas e reproducao aleatoria.
8. Backup JSON de playlists, favoritos e preferencias, com validacao e restauracao sem apagar a biblioteca.
9. Temas pesquisaveis e cor de destaque personalizada.
10. Downloads em segundo plano, preferencia por Wi-Fi, progresso, cancelamento e nova tentativa.

Extras: equalizador nativo com Normal/Graves/Voz/Agudos (depende do suporte do dispositivo), visualizador do audio decodificado sem usar microfone, mosaicos de capas nas playlists, icone Android com a marca Fluxo, capas salvas para offline, ultimas buscas, retomada da fila sem autoplay e tratamento de erros sem carregamento infinito.

## Limites Importantes

- O YouTube pode bloquear determinados videos, regioes, redes ou formatos. A extracao depende de um servico externo e pode precisar de atualizacao; nao ha garantia de 100% de disponibilidade. A velocidade de download tambem pode ser limitada pelo provedor.
- A busca SoundCloud nao e oferecida nesta versao: falhou na validacao do identificador do provedor. Nao foi deixada como uma opcao que aparenta funcionar.
- Arquivos privados do app sao removidos ao desinstalar. O backup JSON guarda a organizacao, **nao os arquivos de audio**. Mantenha uma copia dos originais.
- O Android de alguns fabricantes pode restringir apps em segundo plano. Caso necessario, permita o funcionamento em segundo plano nas configuracoes de bateria do aparelho.
- A versao de navegador permite testar interface e arquivos locais, mas nao substitui o player Android. Nao ha uma implementacao nativa iOS nesta entrega.
- Nenhuma alteracao foi feita no aplicativo de PC. Uma copia do mobile anterior foi preservada em `../backups/fluxo-mobile-before-rebuild-2026-09-25`.
- Baixe somente conteudo que voce tem autorizacao para armazenar.

## Gerar o APK no Computador

Instale Node.js 22 ou superior e Android Studio com Android SDK 36 e Java 21. Nesta pasta:

```powershell
npm ci
npm test
npm run android:debug
```

O APK fica em `android/app/build/outputs/apk/debug/app-debug.apk`. O script sincroniza os arquivos e interrompe a compilacao quando ha erro, para nao entregar um APK antigo por engano.

Previa visual local:

```powershell
npm run dev
```

Abra `http://127.0.0.1:5174`. Os testes de interface usam Playwright e Microsoft Edge; para outro navegador configure `BROWSER_CHANNEL`. Os testes Android em `tests/native*.mjs` exigem emulador/dispositivo de teste com depuracao, APK debug instalado e a busca de teste anterior. Eles alteram apenas os dados desse app de teste e alternam a rede do dispositivo de teste.

`npm run test:professional` verifica artistas, informacoes das faixas, cache/filtros/cancelamento de busca, menus antigos e layouts. `npm run test:android:professional` confere a integracao nativa, os arquivos offline, o extrator real e os comandos da fila. Veja `VERIFICACAO.md` para as evidencias da versao publicada.

## GitHub e Novas Compilacoes

O codigo mobile fica em `fluxo-mobile` no mesmo repositorio [Harleyzinn/fluxo](https://github.com/Harleyzinn/fluxo). As releases Android usam tags `mobile-v...`; a versao Windows marcada como Latest nao e substituida pelo mobile.

1. Envie as alteracoes mobile ao repositorio, preservando a pasta `fluxo-mobile`. Nao envie `node_modules`, `.qa`, `dist`, arquivos de assinatura nem `android/local.properties`.
2. Na aba [Actions](https://github.com/Harleyzinn/fluxo/actions/workflows/mobile-android.yml), abra **Fluxo Mobile - Android APK** e escolha **Run workflow**. Alteracoes mobile enviadas a `main` tambem iniciam a compilacao.
3. Ao concluir, abra a execucao e baixe o artefato **Fluxo-Mobile-Android**. Extraia o ZIP e envie o APK ao celular. Os artefatos de teste exigem login no GitHub; o APK da release publica nao exige.
4. Para compartilhar uma versao, publique uma release mobile com o APK, codigo correspondente e avisos de licenca. A compilacao automatica gera artefatos, mas nao publica releases sozinha.

O workflow esta em `../.github/workflows/mobile-android.yml` e compila apenas o Android. Compilacoes debug em computadores diferentes podem ter assinaturas diferentes; para atualizacoes permanentes, configure uma chave de producao mantida fora do repositorio. Nao desinstale uma versao com arquivos privados sem preservar seus audios originais e exportar os metadados.

## Licencas

A distribuicao mobile integra NewPipeExtractor (GPL-3.0-or-later) e e fornecida com o codigo correspondente sob essa licenca. Consulte `LICENSE` e `THIRD_PARTY.md`. Ao compartilhar um binario, disponibilize tambem o codigo-fonte correspondente e os avisos de licenca. Isso nao altera a licenca de arquivos fora de `fluxo-mobile`.
