# Fluxo Music 3.9.33

Oito novas identidades visuais e uma revisao do player, da fila e da biblioteca.

- Novos temas: Portal, Resident Evil, DOOM, Ace Attorney, Death Note, Dandadan, Art Deco e Bauhaus, com modos festa e equalizadores proprios.
- Layouts com navegacao superior, menu a direita, inventario em grade e player lateral.
- Extracao de video mais enxuta, evitando metadados de legendas desnecessarios.
- Limpar a fila cancela carregamentos pendentes; a primeira faixa adicionada depois volta a tocar normalmente.
- Troca de audio/video, crossfade e recomendacoes do radio descartam operacoes antigas.
- Falha ao trocar o modo restaura a origem HLS e preserva a posicao quando possivel.
- Convidados respeitam pausas recebidas durante o carregamento e aguardam o anfitriao ao terminar a faixa.
- Ajustes de video e fixacao no mini-player, rolagem do equalizador e fechamento de avisos de atualizacao.
- Importacao mais resistente a registros invalidos e nomes repetidos; backups parciais preservam categorias ausentes.

Verificado com 15 testes de midia, 20 cenarios de interface, os 58 temas e reproducao real de YouTube, video com audio, fullscreen e SoundCloud no executavel empacotado.

## Instalacao

Em Assets, baixe **Fluxo-Music-Setup-3.9.33.exe** e execute. Nao e necessario baixar o codigo-fonte. Para atualizar, feche o Fluxo e execute o instalador sem apagar os dados do aplicativo.

O instalador e destinado a Windows 10/11 de 64 bits. Os arquivos latest.yml e .blockmap sao usados pela atualizacao automatica.
