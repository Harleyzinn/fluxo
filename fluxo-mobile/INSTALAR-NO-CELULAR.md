# Instalar o Fluxo no Android

Download: [Fluxo Mobile 2.7.0 no GitHub](https://github.com/Harleyzinn/fluxo/releases/tag/mobile-v2.7.0). Escolha o arquivo **Fluxo-Mobile-2.7.0.apk** em Assets.

1. Abra o link acima no celular e baixe o APK, ou envie **dist/Fluxo-Mobile-2.7.0.apk** por cabo USB.
2. No celular, abra o arquivo APK em Downloads ou no gerenciador de arquivos.
3. Se aparecer o aviso de instalacao bloqueada, toque em Configuracoes e permita instalar apps dessa origem. Volte e toque em Instalar.
4. Abra **Fluxo Mobile**. A busca fica na aba Buscar; seus arquivos e playlists ficam em Biblioteca.
5. Na primeira reproducao, permita notificacoes para facilitar os controles. Para importar musicas, toque no icone de pasta e escolha os arquivos.
6. Salve na biblioteca, favorite ou adicione a uma playlist para baixar automaticamente. Aguarde o progresso terminar. Depois crie uma playlist com Somente musicas baixadas. Ative Ajustes > Baixar so no Wi-Fi para evitar downloads usando dados moveis.

## POCO X5 5G / HyperOS

Na 2.7, edite nome e artista em Menu da musica > Biblioteca > Editar nome e artista. Isso nao regrava o audio e nao reinicia a faixa atual.

No menu da playlist, Editar playlist permite adicionar descricao e ativar Download automatico desta playlist. Ativada, ela baixa mesmo com o automatico geral desligado; desativada, segue o ajuste geral. Baixar so no Wi-Fi continua valendo. Organizar musicas salva a ordem por nome, artista, duracao ou invertida, com opcao Desfazer.

Exportar playlist gera um JSON apenas daquela colecao. Importe em Ajustes > Biblioteca > Importar playlist. Sao nomes, links e preferencias da playlist, nao arquivos de audio; musicas locais precisam estar importadas no mesmo aparelho para tocar offline.

No menu da faixa de uma playlist, Reproducao > Reproduzir a partir daqui toca da posicao escolhida ate o final. O toque normal continua tocando apenas aquela musica. Compartilhar musica, nas informacoes da faixa, compartilha o link pelo Android.

A central de downloads mostra espaco livre, permite ordenar pelo maior arquivo e informa quando o Android aguarda uma nova tentativa, em vez de tratar toda espera como falta de conexao.

Na 2.6, Colecoes > Artistas organiza as faixas da biblioteca e do dispositivo. Abra um artista para tocar sua selecao, filtrar musicas ou criar uma playlist. A busca online agora tem filtros de duracao, favoritas e baixadas; Atualizar resultados renova uma busca recente.

O menu da musica tem secoes recolhiveis. Abra Reproducao para encontrar Tocar a seguir e Infinite Radio. O icone de informacoes mostra origem, tamanho e disponibilidade; Copiar link usa a area de transferencia do telefone. No player, o timer mostra quanto tempo falta.

Os ajustes agora tem as abas Audio, Biblioteca, Visual e Sistema. Notificacoes e bateria ficam em Sistema > Tela apagada e notificacoes. Volume e temporizador ficam em Audio. Use Buscar > Na biblioteca para pesquisar seus arquivos offline; em Colecoes, o campo Buscar playlists encontra suas colecoes.

Na lista de musicas, o icone de selecao abre as acoes em lote. O filtro nao apaga a selecao; Todas seleciona a colecao filtrada inteira, nao apenas as linhas visiveis. No menu da playlist, Fixar playlist a coloca no topo. O historico completo abre pelo resumo Historico em Colecoes.

Em Fila, Organizar fila permite remover anteriores, repetidas a seguir ou somente as proximas, sem interromper a faixa atual. Os atalhos de dez segundos ficam junto ao tempo da musica no player.

Ao atualizar de uma versao anterior a 2.5, aguarde eventual aviso Recuperando download. A migracao antiga de audios maiores que 256 KB foi corrigida. Arquivos truncados podem ser recuperados se a copia antiga ainda estiver no app. Nao desinstale para fazer essa atualizacao: isso apaga tanto os arquivos privados quanto o banco antigo usado na recuperacao.

Abra **Ajustes > Sistema > Tela apagada e notificacoes** dentro do Fluxo. Permita notificacoes e abra **Ajustes do HyperOS**. Nos ajustes do telefone para o Fluxo, escolha bateria **Sem restricoes**, quando essa opcao existir. Se ainda houver interrupcoes, permita o Fluxo em **Configuracoes > Apps > Inicializacao automatica em segundo plano**. Os nomes podem mudar entre versoes do HyperOS. Essas preferencias sao escolhidas por voce; o aplicativo nao as altera escondido.

Durante a reproducao, a central de midia do Android mostra capa, titulo, pausa/continuar e anterior/proxima quando disponiveis. O controle funciona sem manter a tela do Fluxo aberta.

O Infinite Radio fica no menu da musica e no botao Radio do player. Ele so adiciona recomendacoes quando voce o inicia. Radio offline usa apenas arquivos baixados. Encerrar o radio interrompe as recomendacoes futuras.

Em **Biblioteca > Baixadas**, filtre Prontas, Pendentes ou Falhas para acompanhar os arquivos. O X cancela apenas o download pendente; arquivos prontos sao removidos pelo menu da musica, com confirmacao. No menu da playlist, **Baixar musicas** agenda somente essa playlist.

Use **Nao recomendar no radio** no menu da musica para ajustar as recomendacoes. Desfaca em Ajustes > Preferencias do radio. Iniciar o radio com a faixa atual nao reinicia a musica. Na aba Fila, o icone de salvar cria uma playlist com aquela selecao.

O app funciona no Android 7 ou superior. Nao precisa ligar o computador para usar.

Para atualizar a instalacao antiga, abra este APK e toque em Atualizar. Se o Android disser que a assinatura e diferente, preserve os audios originais e exporte as playlists antes de desinstalar a versao antiga. Os arquivos privados do app sao apagados ao desinstalar.

O backup JSON guarda playlists e favoritos, mas nao copia os arquivos de audio.

A nova personalizacao fica em Ajustes > Personalizar aparencia. Os temas favoritos, estilos salvos e capas de playlists acompanham o backup. Restaurar apenas a aparencia nao remove musicas nem playlists.

O codigo esta na pasta fluxo-mobile do repositorio Harleyzinn/fluxo. Leia README.md para gerar novas versoes pelo GitHub. Esta entrega e para uso pessoal; publicacao na loja exige uma assinatura de producao.
