# Fluxo Mobile 2.1

App independente para **Android 7 ou superior**, reconstruido na pasta `fluxo-mobile`. Nao precisa do Fluxo de PC nem de um servidor seu para tocar. A interface usa HTML/CSS/JavaScript dentro do Capacitor; o audio, a sessao de midia, a extracao de streams e os arquivos sao tratados em Java no Android.

## Instalar e usar

Download: [Fluxo Mobile 2.1.0 para Android](https://github.com/Harleyzinn/fluxo/releases/tag/mobile-v2.1.0). Baixe o arquivo `Fluxo-Mobile-2.1.0.apk`, nao os pacotes de codigo-fonte.

1. Pegue `dist/Fluxo-Mobile-2.1.0.apk` e envie ao celular por USB, Drive ou outro meio de sua preferencia.
2. Abra o APK no celular. Quando o Android pedir, permita instalar apps dessa origem. Depois da instalacao, voce pode desativar essa permissao novamente.
3. Abra o Fluxo. Procure uma musica na aba **Buscar** ou use o botao de pasta para importar seus arquivos.
4. Ao iniciar a primeira reproducao ou download, o app pede notificacoes no Android 13 ou superior. Negar nao impede tocar. O seletor de arquivos concede acesso somente aos arquivos escolhidos, sem pedir acesso geral ao armazenamento.
5. No menu de uma musica, escolha **Baixar musica**. Ela aparece em **Biblioteca > Baixadas**, com progresso ou motivo de espera. Aguarde a conclusao antes de desligar a internet.
6. Crie uma playlist com **Somente musicas baixadas**, adicione os arquivos e reproduza. O modo offline fica em Ajustes.

**Nao precisa upar um site para usar o aplicativo.** O APK ja contem o app. O endereco de pre-visualizacao no computador e apenas uma ferramenta de desenvolvimento, nao e o app Android.

Este APK e uma compilacao de desenvolvimento assinada para instalacao pessoal. Para publicar na Play Store ou distribuir atualizacoes permanentes, gere uma chave de assinatura de producao no Android Studio em **Build > Generate Signed App Bundle / APK**. Guarde essa chave: uma atualizacao precisa da mesma assinatura. Nao envie senhas nem a chave ao GitHub. Uma assinatura diferente exige desinstalar o app anterior, apagando seus arquivos privados; exporte os dados antes e preserve os audios originais.

## Novidades da 2.1.0

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

## GitHub e Novas Compilacoes

O codigo mobile fica em `fluxo-mobile` no mesmo repositorio [Harleyzinn/fluxo](https://github.com/Harleyzinn/fluxo). As releases Android usam tags `mobile-v...`; a versao Windows marcada como Latest nao e substituida pelo mobile.

1. Envie as alteracoes mobile ao repositorio, preservando a pasta `fluxo-mobile`. Nao envie `node_modules`, `.qa`, `dist`, arquivos de assinatura nem `android/local.properties`.
2. Na aba [Actions](https://github.com/Harleyzinn/fluxo/actions/workflows/mobile-android.yml), abra **Fluxo Mobile - Android APK** e escolha **Run workflow**. Alteracoes mobile enviadas a `main` tambem iniciam a compilacao.
3. Ao concluir, abra a execucao e baixe o artefato **Fluxo-Mobile-Android**. Extraia o ZIP e envie o APK ao celular. Os artefatos de teste exigem login no GitHub; o APK da release publica nao exige.
4. Para compartilhar uma versao, publique uma release mobile com o APK, codigo correspondente e avisos de licenca. A compilacao automatica gera artefatos, mas nao publica releases sozinha.

O workflow esta em `../.github/workflows/mobile-android.yml` e compila apenas o Android. Compilacoes debug em computadores diferentes podem ter assinaturas diferentes; para atualizacoes permanentes, configure uma chave de producao mantida fora do repositorio. Nao desinstale uma versao com arquivos privados sem preservar seus audios originais e exportar os metadados.

## Licencas

A distribuicao mobile integra NewPipeExtractor (GPL-3.0-or-later) e e fornecida com o codigo correspondente sob essa licenca. Consulte `LICENSE` e `THIRD_PARTY.md`. Ao compartilhar um binario, disponibilize tambem o codigo-fonte correspondente e os avisos de licenca. Isso nao altera a licenca de arquivos fora de `fluxo-mobile`.
