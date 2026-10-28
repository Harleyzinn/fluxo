# Fluxo Mobile 2.10: controles e publicacao

27 de outubro de 2026, horario de Sao Paulo. Atualizacao incremental na pasta mobile. O README principal recebe somente a nova versao Android; o aplicativo desktop nao foi alterado.

## Correcoes e recursos

O metodo nativo configure usava valores padrao para campos ausentes. Atualizar uma unica preferencia podia reativar o medidor, desligar o diagnostico ou redefinir avisos e economia. A atualizacao agora e serializada na thread principal, preserva campos ausentes e recusa modos desconhecidos mantendo o valor salvo. O medidor recupera economia/visualizador ao carregar a ponte, sem criar o servico de audio.

Atalhos do player podem ser 5/10/15/30 segundos. Numero, rotulo e comando usam a mesma preferencia. A exibicao de tempo restante tambem persiste. Ambas sao validadas, incluidas no backup e excluidas dos estilos de aparencia. O seletor de velocidade ganhou cinco opcoes rapidas; o timer ativo pode ser estendido em cinco minutos, ate quatro horas, sem reativar um prazo expirado.

As correcoes de foco, fila, downloads e interface da 2.8/2.9 estao incluidas. Esta e a primeira publicacao delas no GitHub depois da 2.7. A politica de foco e o motor de streaming nao foram reescritos nesta rodada.

Durante os testes em Android API 37 com 2 GB de RAM, o historico de saidas registrou o renderer WebView encerrado por LOW_MEMORY, seguido do encerramento do processo principal. O callback padrao nao tratava a perda. MainActivity agora retira e destroi a WebView perdida, apos aposentar a ponte, e recria somente a Activity. Se estiver em segundo plano, aguarda o retorno do usuario; duas recuperacoes por minuto sao permitidas antes de mostrar uma acao manual, evitando um ciclo infinito. Nenhum comando de audio faz parte dessa recuperacao. Isso segue a [orientacao oficial Android](https://developer.android.com/develop/ui/views/layout/webapps/handle-termination). Nao evita o encerramento do processo inteiro pelo sistema.

## Verificacao

Passaram nesta rodada: 54 testes de dados/preferencias, oito verificacoes Java de autorizacao e quatro testes JUnit. A suite do player verificou os novos atalhos, persistencia, presets e extensao do timer, junto de 16 combinacoes responsivas. Navegacao em 16 telas, 24 combinacoes de aparencia, ajustes/backup/cache e colecoes/fila tambem passaram.

No Android, a configuracao parcial preservou economia, medidor, diagnostico, avisos e pre-carregamento. Passaram tambem os comandos antigos recusados, a busca pausada, fila fria, leitura de PCM e arraste estavel. A suite de renderer provocou tres falhas: o processo e o audio sobreviveram em primeiro plano; no segundo plano, a recuperacao aguardou o retorno; a terceira falha mostrou o controle manual, que recuperou a interface sem iniciar audio ocioso nem pedir foco extra.

A falha inicial de memoria foi observada com 2 GB no emulador API 37. A validacao final usa o mesmo emulador com 4 GB, para separar a recuperacao controlada da falta de recursos da infraestrutura. Outra tentativa foi interrompida por atualizacao automatica do proprio WebView, registrada como PACKAGE UPDATED; nao e contada como aprovada. O teste de renderer desliga a rede temporariamente e a restaura ao terminar. Isso nao e uma medicao de reducao de RAM.

O registro final de coexistencia e tela apagada, vinculado ao hash exato do APK publicado, acompanha a release como [RESULTADOS-2.10.0.json](https://github.com/Harleyzinn/fluxo/releases/download/mobile-v2.10.0/RESULTADOS-2.10.0.json). A publicacao verifica esses resultados e recusa publicar se faltarem as validacoes obrigatorias. Registros de 2.8/2.9 permanecem datados e nao sao contados como testes novos.

APK SHA-256: `1b29936e2fb9486c5b26c73526169eee47f98d8174879bc4bbfff2a5493d9836`. Certificado preservado: `42dc5c2adbe56aefb20922bd7ba4392c0413f7948122530132474876ea874bbb`.

## Distribuicao

Tag mobile-v2.10.0, pre-release debug pessoal, separada de Windows Latest. APK, fonte correspondente, guia, relatorio, licencas e checksums acompanham a release. O script scripts/publish-github.mjs mantem credenciais somente em memoria, verifica os hashes enviados e confere o download publico de APK/fonte.

## Limites

POCO/HyperOS, Spotify real, Bluetooth/fones e uso prolongado fisicos nao foram validados. A reducao de PSS/bateria nao foi comprovada nesta rodada. O provedor pode limitar ou bloquear streams. Nao e uma versao homologada da Play Store.
