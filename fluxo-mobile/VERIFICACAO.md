# Verificacao da Versao 2.0.0

Validacao realizada em 1 de outubro de 2026 em emulador Android API 37 e navegador Microsoft Edge.

- APK compilado, instalado e aberto no Android.
- Busca YouTube e reproducao de audio online confirmadas.
- Inicio em aproximadamente 4 segundos no teste de extracao sem cache; uma tentativa anterior lenta motivou reduzir a extracao aos dados de audio.
- Inicio com cache em 2,6 segundos no ultimo teste completo. Esses tempos dependem da rede e do provedor.
- Tela realmente apagada: o player permaneceu tocando e avancou 8,7 segundos durante a verificacao.
- Sessao de midia Android ativa para controles do sistema.
- Download completo de 10.271.496 bytes validado, seguido de reproducao com Wi-Fi e dados moveis desativados.
- Fila, proxima faixa, velocidade, repeticao, aleatorio e temporizador testados no Android.
- Visualizador recebeu 32 amostras de nivel do audio e desenhou pixels no canvas. Nenhuma permissao de microfone e utilizada.
- Um endereco de audio invalido encerrou o carregamento com erro, sem espera infinita.
- Importacao, favoritos, playlist offline, persistencia e temas testados na interface.
- Quatro tamanhos de tela verificados, incluindo 320x640. Player e controles permaneceram acessiveis.
- Oito testes de dados e backup passaram.

A interface oferece 68 paletas. Os estilos adicionais foram adaptados do projeto desktop para a navegacao compacta do celular.

O comportamento no celular fisico do usuario ainda precisa ser conferido apos a instalacao. Restricoes do YouTube, da rede e da bateria do fabricante podem afetar streams ou o funcionamento em segundo plano. Os downloads completos e arquivos importados nao dependem do YouTube para tocar offline.
