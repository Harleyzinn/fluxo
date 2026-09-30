# Revisao local 3.9.33

Data: 30/09/2026. Revisao preparada localmente e aprovada pelo usuario para publicacao como v3.9.33.

## Temas novos

| Tema | Composicao |
| --- | --- |
| Portal / Aperture | Indice numerado, bancada clara e sinalizacao azul-laranja. |
| Resident Evil / Save Room | Navegacao a direita, inventario em grade e mostradores de equipamento. |
| DOOM / UAC | Console industrial, controles retangulares e canais de audio embutidos. |
| Ace Attorney / Court Record | Navegacao superior em abas de documentos e enquadramento de evidencias. |
| Death Note / Case Files | Player lateral em telas largas e composicao de dossie. |
| Dandadan / Occult FM | Busca abaixo da lista, contraste rosa-lima e perfis de audio em coluna. |
| Art Deco / Grand Salon | Linhas arquitetonicas, tipografia serifada e capa em arco no modo festa. |
| Bauhaus / Form & Sound | Menu modular em duas colunas, cores primarias e divisorias geometricas. |

Os oito temas incluem estilos para equalizador, modo festa e mini-player. Os estilos antigos continuam separados em style.css; os novos ficam em themes-collection.css.

## Correcoes verificadas

- Extracao de video deixa de solicitar o JSON completo de legendas traduzidas, que podia crescer excessivamente e causar timeout.
- Limpar fila cancela o carregamento anterior e permite iniciar a primeira faixa adicionada depois.
- Troca de audio/video, retry e crossfade respeitam a faixa mais recente.
- Retorno de uma falha HLS usa o manifesto original, nao uma URL blob revogada.
- Recomendacoes do radio sao descartadas quando a faixa mudou ou o radio foi desativado.
- Convidado respeita pausas recebidas durante o carregamento e nao avanca sozinho ao terminar a faixa.
- Video se reposiciona ao entrar/sair do mini-player; o botao de fixar reflete o estado da janela.
- Previa de audio para ao trocar de pagina.
- Importacao filtra registros invalidos e diferencia nomes repetidos no mesmo arquivo.
- Restauracao valida o backup antes de gravar e preserva categorias ausentes em backups parciais.
- Configuracoes salvas com JSON invalido nao impedem a inicializacao.
- Equalizador nao cria uma segunda coluna implicita em janelas estreitas.
- Aviso de atualizacao pode ser fechado e informa falhas de download.

## Verificacao executada

- 15 testes automatizados de extracao, cache, proxy, busca e reconexao RPC.
- 20 cenarios de interface, incluindo biblioteca, fila, importacao de 251 faixas, cancelamentos, mini-player e estados simulados da sessao.
- Rolagem e equalizador dos 58 temas, em larguras de 800 e 1200 pixels.
- Novos temas nas janelas 800x600 e 1200x800: busca, controles, equalizador, festa e mini-player. Capturas de tela e verificacao de botoes visiveis e clicaveis.
- Buscas reais de YouTube e SoundCloud, disponibilidade HTTP do Firebase e pedidos parciais do proxy.
- Executavel empacotado: duas faixas reais do YouTube, seek para 150 segundos, video com audio, fullscreen do video, retorno a audio e SoundCloud HLS.
- Instalador: arquivos de interface comparados byte a byte, runtimes conferidos, manifesto de atualizacao e exclusao de mapas e arquivos privados.

Os testes usam perfis temporarios, sem alterar a biblioteca pessoal. Os testes simulados de sessao nao escrevem salas no Firebase de producao. Ausencia de falhas nesses cenarios nao equivale a garantia de ausencia de todos os bugs.

## Pendencias e limites

- RPC: a reconexao com Discord fechado tem teste automatizado; a atividade visivel exige validar com Discord Desktop aberto.
- Multiplayer: falta validacao entre dois computadores com latencia real, permissoes de convidados e reconexao prolongada. O teste HTTP do Firebase nao comprova seguranca das regras.
- Seguranca das salas: as regras locais permitem acesso por codigo de sala sem autenticacao. Uma migracao coordenada de autenticacao e permissoes de host/convidado continua necessaria. Nenhuma regra de producao foi alterada nesta revisao.
- Conversao, recortes e exportacoes que dependem de FFmpeg nao foram validados. FFmpeg nao acompanha este instalador.
- README e tela inicial anunciavam soundboard e importacao local sem implementacao correspondente nesta arvore de codigo. As promessas foram removidas, sem excluir um modulo funcional.
- Reinstalacao automatica sobre uma versao anterior nao foi executada no perfil pessoal; o manifesto e os arquivos do instalador foram verificados.
