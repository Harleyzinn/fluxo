# Verificacao local da 3.9.35

Data: 17/10/2026. Build Windows preparada para a release publica v3.9.35.

## Alteracoes
- Sete temas novos, total de 82. Composicoes de navegacao, player, festa e equalizador, preservando os controles existentes.
- Spotify: musica individual, album, playlist publica, URL localizada e URI. Metadados com artista, duracao e capa; selecao e salvamento na biblioteca.
- Aviso de possivel lista publica parcial, erros com causa, prazo limite e validacao de redirecionamentos.
- Troca para faixa importada encerra o stream anterior antes da busca; resultado atrasado nao assume o player.

## Evidencias
- `npm test`: 19 testes aprovados, incluindo proxy HTTP real e quatro testes de Spotify.
- Auditoria final no executavel empacotado: 30 cenarios aprovados, sem falhas ou excecoes de interface detectadas.
- Consulta real pelo importador: uma faixa individual, album Global Warming com 18 faixas e Today's Top Hits com 50 faixas.
- Importacao, selecao, salvamento e reproducao real de uma faixa Spotify via YouTube, tanto no codigo fonte quanto no executavel empacotado. Progresso acima de dois segundos e duracao de 213,56 segundos.
- Sete temas em 1200x800 e 800x600: controles acessiveis, equalizador sem excesso horizontal, festa, mini-player e paleta widget/OBS, sem falhas detectadas. Capturas inspecionadas visualmente.
- Verificacao de equalizador e rolagem nos 82 temas.
- Teste de Foco/Ambiente passou apos aguardar o redimensionamento real da janela; a medicao imediata tinha produzido uma falha intermitente na primeira composicao.
- Pacote final para publicacao: reproducao real no YouTube, avanco para 150 segundos, segunda faixa, video com audio, fullscreen do video, retorno a audio e SoundCloud HLS aprovados. Buscas YouTube/SoundCloud, disponibilidade HTTP do Firebase e tres blocos do proxy tambem verificados.
- Instalador final: 138167466 bytes. Arquivos principais e CSS comparados com o fonte; runtimes, manifesto de atualizacao, hash e blockmap verificados. Mapas, dados privados e ferramentas de desenvolvimento fora do pacote.

## Limites
- Spotify fornece metadados publicos, nao audio direto. Nao ha login ou acesso a playlists privadas. O servico pode limitar ou mudar a lista publica.
- Links curtos validados com testes de redirecionamento simulados; nao foi fornecido um link curto real para validar.
- Testes de sessao usam estados simulados; nao substituem uma sessao real entre computadores. Atividade visual no Discord e conversao de arquivos dependente de FFmpeg nao foram validadas nesta rodada.
- Alteracoes existentes no projeto mobile foram preservadas, sem edicao nesta tarefa.
