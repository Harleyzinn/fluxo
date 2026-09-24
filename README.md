# Fluxo Music

Seu player, do seu jeito. Musica do YouTube e SoundCloud, dezenas de temas, ferramentas de audio e salas para ouvir junto, em um aplicativo para Windows.

**Versao 3.9.32** | [Baixar o Fluxo](https://github.com/Harleyzinn/fluxo/releases/latest) | [Todas as releases](https://github.com/Harleyzinn/fluxo/releases) | [Apoiar no LivePix](https://livepix.gg/devpotato)

## Baixar e instalar

Nao precisa usar terminal, clonar o repositorio ou instalar Node.js.

1. Abra a aba [Releases](https://github.com/Harleyzinn/fluxo/releases) deste repositorio.
2. Entre na versao mais recente marcada como **Latest**.
3. Abra **Assets**, abaixo das notas da versao, e baixe **Fluxo-Music-Setup-3.9.32.exe**. Em versoes futuras, muda somente o numero no nome.
4. Execute o instalador e aguarde a conclusao.
5. Abra **Fluxo Music** pelo menu Iniciar ou pelo atalho na area de trabalho.

**Qual arquivo escolher?** O aplicativo vem no `.exe`. Nao baixe `Source code (zip)` ou `Source code (tar.gz)` para instalar. Os arquivos `.blockmap` e `latest.yml` sao usados pela atualizacao automatica.

O aplicativo e destinado a **Windows 10/11 de 64 bits**. Se o Windows mostrar um alerta de editor desconhecido, confirme que o arquivo veio deste repositorio oficial antes de prosseguir. Nao e necessario desativar o antivirus.

## Atualizar sem perder a biblioteca

O Fluxo verifica atualizacoes publicadas no GitHub. Quando uma atualizacao estiver pronta, o aplicativo avisa e reinicia para concluir a instalacao.

Para atualizar manualmente, feche o Fluxo, baixe o novo `.exe` em [Releases](https://github.com/Harleyzinn/fluxo/releases/latest) e execute-o. Nao desinstale nem apague os dados do aplicativo. Voce tambem pode exportar um backup pela Biblioteca antes de atualizar.

## O que mudou na 3.9.32

- **Reproducao recuperada:** extrator atualizado e runtime de midia incluido no instalador. Nao depende de ferramentas instaladas separadamente no computador.
- **Streams por blocos:** ajuste na entrega de audio e video para lidar com recusas HTTP 403 em pedidos abertos e preservar o avanco pela faixa.
- **Video com audio sincronizado:** suporte ao manifesto HLS quando o YouTube entrega audio e imagem separados.
- **Troca de musica consistente:** uma resolucao antiga nao pode substituir a faixa que voce acabou de escolher.
- **Cache renovado de verdade:** links expirados sao descartados no player e no processo principal. Faixas indisponiveis nao viram outra musica silenciosamente.
- **Busca cancelavel:** cancele uma pesquisa demorada ou envie outra. Resultados antigos nao invadem a tela atual.
- **Status por servico:** YouTube e SoundCloud mostram sua disponibilidade separadamente. Uma falha nao precisa inutilizar a busca inteira.
- **Diagnostico melhor:** testes das buscas e da entrega de midia, runtime incluido e limpeza de cache sem apagar a biblioteca.
- **Discord mais tranquilo:** reconexao com intervalo quando o Discord esta fechado, sem disparar tentativas continuamente.
- **Instalador mais restrito:** mapas locais, backups, testes e arquivos privados nao entram no aplicativo distribuido.

As mudancas anteriores, incluindo importacao seletiva de playlists e melhorias do Infinite Radio, continuam disponiveis. O changelog completo fica no proprio app.

## Musica e biblioteca

- Pesquise no **YouTube e SoundCloud** ou cole links de faixas, playlists, mixes e sets publicos.
- Escolha quais musicas importar de uma playlist do YouTube ou importe todas. O Fluxo nao impoe um limite artificial de faixas; a disponibilidade depende do que a plataforma entregar.
- Importe metadados de links do **Spotify** e procure as gravacoes para tocar. O Fluxo nao reproduz diretamente o catalogo protegido do Spotify.
- Organize playlists, favoritos, historico e Inbox. Importe, exporte e faca backup da sua biblioteca.
- Use **Infinite Radio**, reproducao aleatoria, repeticao e transicao suave.
- Abra musicas locais e use o diagnostico de biblioteca para revisar problemas.

## Audio e personalizacao

O equalizador inclui presets, velocidade, reverb, compressor, ganho e pan, com perfis como **Normal**, **Slowed + Reverb** e **Nightcore**.

Os temas mudam a identidade da interface, do equalizador, do Modo Festa e dos widgets. Entre eles: Soul Eater, Adolla, Minecraft, Tensura, Ophiuchus, Dark Brotherhood, Morioh-Cho, Orokin Cell e Fluxo Bug.

Tambem fazem parte do Fluxo:

- **Modo Festa**, mini-player e controles de video.
- **Discord Rich Presence**, com faixa, capa e tempo de reproducao quando aceitos pelo Discord.
- **Widget e overlay OBS** baseados no tema ativo.
- **Soundboard personalizavel**, com selecao de saida. Para enviar audio como microfone no Discord, e necessario um dispositivo de audio virtual configurado no Windows; o Fluxo nao instala um driver de microfone.
- **Sleep Timer** e ferramentas de conversao e recorte de audio, conforme a disponibilidade do formato e das ferramentas de midia.

## Ouvir junto

Abra **Sessao Compartilhada**, crie uma sala e envie o codigo para seus amigos.

O dono da sala escolhe quem pode controlar a reproducao, se os convidados precisam pedir musicas ou podem adiciona-las diretamente, e se o salto de faixa exige votos de pelo menos metade da sala. Tambem pode ativar Infinite Radio, compartilhar as configuracoes de audio e ligar o video da sessao.

Os participantes podem acompanhar os membros, pedidos e fila, reagir e salvar a fila ou as musicas tocadas em uma playlist. A sincronizacao depende da conexao de cada participante e da disponibilidade das faixas.

## Algo nao funcionou?

**A musica nao inicia:** atualize o Fluxo e abra **Central Fluxo > Rede**. Confira os testes de busca e o runtime de midia. Limpar o cache de streams nao apaga playlists. Use o diagnostico da faixa para verificar a resposta do servidor.

**So uma faixa falha:** confira o link no navegador. Conteudos privados, removidos, com DRM, restricao de idade, login ou bloqueio regional podem nao estar disponiveis. Teste outro resultado explicitamente ou somente audio.

**A busca demora:** cancele pelo botao ao lado da barra e tente novamente. O status dos resultados indica quando um dos provedores esta indisponivel.

**O Discord nao mostra a musica:** mantenha o Discord Desktop aberto e o compartilhamento de atividade ativado. O Fluxo tenta reconectar automaticamente; o painel RPC tambem oferece reset. A exibicao final depende do Discord.

**A sessao nao conecta:** verifique a internet e o teste de sessao compartilhada no diagnostico de rede. O servico depende do Firebase; reinstalar o Fluxo nao resolve uma indisponibilidade do servidor.

Para relatar um problema, abra uma [issue](https://github.com/Harleyzinn/fluxo/issues) com a versao do Fluxo, passos para reproduzir e mensagem de erro. Nao envie senhas, tokens, dados de pagamento ou sua biblioteca privada.

## Apoie o Fluxo

O Fluxo e mantido por um desenvolvedor independente. As doacoes ajudam a manter o projeto e suas atualizacoes.

**[Doar pelo LivePix](https://livepix.gg/devpotato)** ou abra **Apoiar Fluxo** no aplicativo. O pagamento acontece na pagina publica do LivePix; nenhum segredo privado de pagamento precisa ser configurado no player.

---

Fluxo Music e um projeto independente, sem afiliacao com YouTube, SoundCloud, Spotify, Discord ou com as obras que inspiram seus temas. Servicos externos podem mudar suas regras e disponibilidade. Utilize conteudos que voce tem direito de acessar.
