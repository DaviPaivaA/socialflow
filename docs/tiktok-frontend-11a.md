# Task 11A — TikTok exclusivamente no frontend

Data: 2026-10-23. Branch: `feat/socialflow-7a-meta-insights`. HEAD preservado: `e44b031d194a959e3f4182b246d17525a0ebc09c`.

## Conclusão e recuperação

Interface local concluída, com testes e revisão independente. **Não constitui integração TikTok real nem habilita a rede Meta.**

Na retomada, o implementador anterior havia sido interrompido antes do primeiro RED/código11A. Foram recuperados o plano, o brief, os hashes e o trabalho visual TikTok anterior. O mesmo implementador foi reutilizado; nenhuma Task Meta foi reiniciada e nenhuma alteração anterior foi descartada. O plano existente foi seguido, sem criar branch ou worktree.

## Experiência disponível

| Área | Funciona localmente | Não executa |
| --- | --- | --- |
| Canais | Cartão TikTok, SVG existente, estado Não conectado, ausência explícita de avatar/usuário; CTA informa indisponibilidade | OAuth, conexão, conta fictícia ou sucesso simulado |
| Composer | Seleção TikTok, vídeo e capa locais, legenda e contador, validação, remoção, substituição e tentativa de prévia | Upload, rascunho persistido, publicação ou agendamento TikTok |
| Preview | Componente reutilizável, vídeo com controles em enquadramento 9:16, legenda e capa local; loading/erro/vazio | Conversão do arquivo, autoplay, perfil ou métricas inventadas |
| Agenda | Filtros Todos/Facebook/Instagram/TikTok, calendário TikTok vazio real e explicação do bloqueio | Criação de registros TikTok ou identificação de plataforma por suposição |
| Analytics | Plataforma/período, cabeçalho TikTok, quatro cards com valor ausente e estrutura de gráfico sem dados | Consulta de métricas, curvas fictícias ou ausência convertida em zero |

O sino da Topbar já existia e foi preservado integralmente.

## Fronteiras de dados e segurança

- Vídeo, capa e legenda TikTok ficam somente na memória do compositor. Não entram em `localStorage`, `sessionStorage`, IndexedDB, URLs de navegação, repositories ou payloads Meta.
- ObjectURLs são derivadas de `File`, limitadas a recursos do módulo, e revogadas ao substituir, remover, desmarcar TikTok, fechar, desmontar ou trocar de Workspace. Callbacks tardios verificam atividade e identidade do recurso.
- TikTok único bloqueia publicação/agendamento, inclusive submissão imperativa. Modo misto mantém mídia e legenda Meta separadas e envia somente destinos Meta; a mensagem deixa claro que TikTok não foi publicado.
- O App recebeu apenas dependências de leitura existentes para Agenda. Autenticação, sessões, contratos, OAuth, upload Meta, publisher, Coordinator, scheduler e mecanismos da Task10E não foram alterados.
- Todos/TikTok não disparam lookup adicional da Agenda. Filtros Meta explícitos usam uma leitura de contas e até 50 detalhes de posts, sequencialmente, verificando tenant/post/destino/conta. Sem associação, com erro ou acima do teto, exibem indisponibilidade/identificação parcial, não uma contagem inventada. Sair do filtro/Workspace ignora respostas tardias antes de novos GETs ou callbacks401; isso não promete cancelamento físico de requisições já enviadas.
- Abrir o compositor conserva as leituras Meta iniciais que já existiam; a ausência de chamadas extras é verificada para as ações TikTok, não alegada para toda abertura do App.

## Limitações deliberadas

- Tetos locais: vídeo 100 MiB (MP4/WebM), capa 10 MiB (JPEG/PNG/WebP), arquivos não vazios. São políticas locais de segurança, **não limites oficiais TikTok**.
- 9:16 é enquadramento da prévia, sem conversão ou validação oficial de codec, duração ou proporção. Legenda TikTok não presume um limite oficial de caracteres.
- Não existe tema escuro dedicado no projeto auditado. Foram reutilizados os padrões e variáveis existentes, sem introduzir um tema novo.
- Testes DOM/CSS, labels, controles nativos e breakpoint responsivo foram verificados. Não havia ferramenta de navegador/Playwright disponível; não se alega reprodução física de codecs, auditoria com leitor de tela ou teste visual em dispositivo.
- Referências e ObjectURLs são liberadas; não se promete apagamento físico garantido da memória pelo JavaScript.
- Nenhum backend TikTok, conta, dado Analytics real ou persistência TikTok foi implementado.

## Inventário do delta11A

Fontes existentes alteradas:

- `src/App.tsx`: props de leitura da Agenda, sem alteração de autenticação.
- `src/components/TikTokComingSoon.tsx`: ação informativa reutilizada.
- `src/features/composer/Composer.tsx`: composição local e reset por Workspace; Meta permanece separado.
- `src/pages/Channels.tsx`: cartão TikTok definitivo e estados honestos.
- `src/pages/Agenda.tsx`: seleção de plataforma e calendarização sem registros falsos.
- `src/pages/Analytics.tsx`: seletores e estrutura vazia de indicadores/gráfico.

Fontes novas: `src/features/tiktok/TikTokLocalComposer.tsx`, `MetaAgendaFilter.tsx` e `tiktok.css`.

Testes existentes evoluídos: `src/pages/Channels.test.tsx`, `src/features/composer/Composer.test.tsx`, `ComposerDestinations.test.tsx`. Nenhum caso removido nem timeout aumentado. Novos: `src/features/tiktok/TikTokExperience.test.tsx`, `TikTokAgenda.test.tsx`, `TikTokApp.test.tsx`.

Total: 15 arquivos frontend novos/alterados em relação ao baseline11A (9 existentes + 6 novos). `ChannelBadge`, mock sem conta TikTok e Topbar são entregas anteriores preservadas. Também foram atualizados este documento, o plano11A e os checkpoints próprios; documentação Meta protegida não foi editada.

## Testes e revisão

| Gate | Evidência real |
| --- | --- |
| RED inicial | 9 falhas funcionais esperadas |
| RED Agenda | 3 falhas funcionais e 1 guard já aprovado |
| GREEN integrado inicial | 92/92 em 6 arquivos; 27 novos testes + 65 anteriores |
| Frontend completo | 394/394, 29 arquivos, 0 falhas/pendentes, cerca de 195s; anterior ao ajuste M1 |
| RED M1 | Um caso selecionado falha pela classe de contenção ausente; demais casos não selecionados pelo filtro |
| GREEN M1 | 19/19 no arquivo Experience |
| Regressão pós-M1 | 93/93 em 6 arquivos, 0 falhas/pendentes; 28 novos testes + 65 anteriores |
| Build/TypeScript | `npm run build`: exit0, tsc frontend, Vite e tsc server |
| ESLint | `npm run lint`: exit0 |
| Integridade | 90/90 hashes protegidos iguais; 11 migrations iguais ao HEAD; Topbar igual ao baseline |

Contagens são conjuntos sobrepostos, não devem ser somadas. A suíte completa não foi repetida após o pequeno ajuste CSS/M1; houve regressão focada pós-correção e build/lint. Depois disso, removeu-se somente um import `waitFor` sem uso, sem alterar asserções, confirmado na revisão e pelo compilador.

Falhas intermediárias documentadas: coleta inicial com `File` no título parametrizado; teste novo de Workspace sem aguardar carregamento (corrigido com `findByLabelText`); integração CSS do teste M1 (imports CSS stubados, URL de módulo não-file e normalização 0px); TS6133 por import sem uso. Nenhum timeout aumentado, skip introduzido ou validação produtiva relaxada.

Revisão independente de especificação e qualidade: PASS. Um Minor M1 de nomes longos corrigido com RED→GREEN e revisão de retorno, preservando nomes completos e CSS computado. Nenhum Critical, Important ou Minor pendente. Uma última conferência confirmou a remoção somente do import sem uso.

Backend/PostgreSQL não tiveram suítes reexecutadas: alteração restrita ao frontend, sem fontes backend modificadas; foram preservadas as evidências anteriores e os hashes protegidos. O build completo também compilou o servidor, sem iniciar serviços.

## Evidências para retomada

- [Plano aprovado](superpowers/plans/2026-10-23-socialflow-tiktok-11a.md).
- [Ledger e histórico](../.superpowers/sdd/2026-10-23-socialflow-tiktok-11a/progress.md).
- [Manifesto final](../.superpowers/sdd/2026-10-23-socialflow-tiktok-11a/final-verification.json).
- [Diff final](../.superpowers/sdd/2026-10-23-socialflow-tiktok-11a/task-11a-final.diff).
- [Revisão inicial](../.superpowers/sdd/2026-10-23-socialflow-tiktok-11a/independent-review.md) e [retorno](../.superpowers/sdd/2026-10-23-socialflow-tiktok-11a/independent-return-review.md).
- [Integridade](../.superpowers/sdd/2026-10-23-socialflow-tiktok-11a/final-integrity.json), `baseline.json`, `baseline-code/`, logs e JSONs de testes no mesmo diretório.

O diff de produção usa snapshots pré11A. Os três testes existentes aparecem contra HEAD e incluem preparação TikTok anterior; não atribuir todo `git diff HEAD` à11A. O worktree permanece com alterações anteriores modificadas/não rastreadas, sem commit, push, merge ou deploy.

Produção, Debian, PostgreSQL, migrations, credenciais, Meta/TikTok reais e infraestrutura Docker não foram acessados/modificados por esta tarefa. Próximas etapas exigem autorização separada; nenhuma foi iniciada automaticamente.
