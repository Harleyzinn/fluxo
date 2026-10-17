# Revisao desktop 3.9.34

## Entrega

Esta revisao consolida os dez temas que estavam em desenvolvimento e acrescenta sete: Pokemon/Pokedex, NieR Automata/YoRHa, Splatoon/Turf Radio, Alien/Nostromo, Sonic/Green Hill FM, Disco Elysium/Revachol e Windows 98/Desktop Radio. Sao 75 temas desktop.

Cada novo tema tem composicao para o player, navegacao, equalizador, modo festa e mini-player. Widget e OBS recebem identificacao e paleta do tema. As colecoes usam arquivos CSS separados e mantem os mesmos elementos de reproducao.

## Correcoes e melhorias

- Transicoes de tema deixam de animar largura e altura de paineis, evitando o corte de conteudo ao alternar menus horizontais e laterais.
- O mini-player distribui seus controles dentro da janela de 580px e mantem os botoes de sair e fixar acessiveis.
- Previas usam uma geracao de carregamento: escolher outra faixa ou sair da busca invalida uma resposta atrasada.
- Falhas de previa sao tratadas e exibem um indicador, sem erro nao capturado.
- Ao selecionar outra faixa, a midia anterior e abortada antes de resolver o novo stream. Um erro da conexao antiga nao dispara uma segunda tentativa para a nova faixa.
- O Deck B cancela carregamentos ao mudar a selecao, parar ou sair do modo DJ. O volume principal, o crossfader e a velocidade da previa sao restaurados ao sair.
- Assumir o Deck B respeita as permissoes da sala e verifica se a faixa e a tela ainda correspondem ao comando antes de alterar a posicao.
- Permissoes individuais da sessao prevalecem sobre o antigo indicador geral de controles livres.
- Aceitar um pedido varias vezes adiciona a faixa uma unica vez; respostas de salas anteriores sao descartadas.
- A barra de progresso ignora cliques sem duracao valida e limita a posicao aos limites da faixa.
- Temas podem ser favoritados e filtrados por categoria ou novidades; favoritos acompanham o backup da biblioteca.
- Icones Phosphor acompanham o instalador. Nao dependem mais do script externo de icones.
- Contraste do botao de limpar fila e dos controles compactos ajustado para os novos temas.
- Foco e Ambiente tem geometria propria nos temas estruturais e podem ser encerrados pelo botao de retorno ou Escape.

## Verificacao

- 15 testes de midia, cache, busca, proxy e reconexao RPC.
- 29 cenarios de interface, incluindo selecao e cancelamento de previas, erros de streams anteriores, Deck B, permissoes, pedidos repetidos, biblioteca, importacao, saida do modo compacto e modos Foco/Ambiente.
- Equalizadores dos 75 temas em larguras de 800 e 1200 pixels.
- Busca, controles, equalizador, festa e mini-player dos 25 temas das novas colecoes em janelas 800x600 e 1200x800, com capturas e verificacao de botoes visiveis e clicaveis.
- Busca real de YouTube e SoundCloud, disponibilidade HTTP do Firebase e leitura parcial de audio pelo proxy.
- Executavel empacotado: duas faixas reais do YouTube, avanco para 150 segundos, video com audio, fullscreen do video, retorno a audio e SoundCloud HLS.
- O verificador do pacote compara os arquivos de interface com o codigo local e confere fontes, executaveis de midia, manifesto do updater e exclusao de mapas e arquivos privados.

Os testes usam perfis descartaveis e nao alteram a biblioteca pessoal nem salas de producao. A validacao local de estados de sessao nao substitui o teste entre dois computadores. A atividade visual no Discord e a instalacao automatica sobre o perfil pessoal nao fazem parte destes testes.

Esta entrega e um build local. A release publica 3.9.33 permanece disponivel no GitHub. Nenhuma alteracao foi feita no codigo mobile durante esta revisao desktop.
