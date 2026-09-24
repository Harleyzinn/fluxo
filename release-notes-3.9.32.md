## Fluxo Music 3.9.32

### Reproducao
- Extrator yt-dlp atualizado e runtime Deno incluido no instalador. Nao precisa instalar Node.js separadamente.
- Corrigida a entrega de streams que retornavam HTTP 403: clientes atualizados e proxy com requisicoes por blocos.
- Video via HLS quando a fonte entrega audio e imagem separados.
- Renovacao descarta links expirados nos dois caches, com protecao contra respostas antigas substituirem a faixa selecionada.
- Uma musica indisponivel nao e mais substituida silenciosamente por outra gravacao.

### Busca e diagnostico
- Busca cancelavel, novas pesquisas sem esperar a anterior e descarte de resultados antigos.
- Disponibilidade separada para YouTube e SoundCloud, com limites de espera.
- Diagnostico redesenhado para os temas, consultas reais de busca e verificacao da entrega de midia.
- Limpeza de cache de streams sem apagar biblioteca ou interromper a faixa atual.
- Discord reconecta com intervalo quando o aplicativo esta fechado, evitando tentativas excessivas.

### Distribuicao
- Mantidas as melhorias de importacao seletiva de playlists do YouTube e Infinite Radio da 3.9.31.
- Instalador com lista explicita de arquivos: mapas, backups e dados privados nao sao incluidos.
- README atualizado com instalacao pela aba Releases e solucao de problemas para usuarios.

### Instalacao
Baixe **Fluxo-Music-Setup-3.9.32.exe** em Assets. Para atualizar manualmente, feche o Fluxo e execute o instalador, sem apagar os dados do aplicativo.

Os arquivos `.blockmap` e `latest.yml` acompanham a release para o atualizador automatico.

Servicos externos ainda podem restringir faixas privadas, removidas, com DRM, login ou bloqueio regional.
