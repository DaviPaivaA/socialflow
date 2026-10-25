# SocialFlow 7A — acabamento definitivo do frontend

Base: `5ed06d80051c0de58ac6850973d4ef5be037a2c0`, branch `feat/socialflow-7a-meta-insights`. Escopo aprovado pelo usuário: abas de edição, destinos independentes, apresentação SaaS consistente e nenhuma integração TikTok. Não houve commit, amend, push, merge, SSH ou deploy nesta tarefa.

## Interface entregue

- **Canais:** Facebook, Instagram e TikTok identificados por SVGs próprios em `ChannelBadge`. Nome real, plataforma e estado são apresentados separadamente. Avatar existente é preservado, com o ícone da plataforma ao lado. Quando Facebook/Instagram não estão presentes, cartões desconectados aparecem somente após uma listagem bem-sucedida; loading/erro não são convertidos em falsa ausência de conexão.
- **Instagram desconectado:** cartão e estado verdadeiro, sem criar `SocialAccount`, usuário ou avatar fictício. Conexão usa somente o fluxo Meta existente, quando disponível; sem ampliar permissões.
- **TikTok em Canais:** visual consistente e ação indisponível acessível. A tentativa oferece feedback curto; não inicia OAuth, navegação, API ou conexão fictícia.
- **Composer:** abas “Facebook e Instagram” e “TikTok”. A escolha da aba não altera contas selecionadas. Destinos permanecem em uma faixa própria, enquanto os painéis mantêm seus dados ao alternar abas.
- **Facebook/Instagram:** formulário compartilhado, seleção de mídia, validações, publicação imediata e agendamento existentes preservados. O payload continua usando exclusivamente IDs, mídia e legenda Meta.
- **TikTok:** editor completo com vídeo MP4/WebM, capa JPEG/PNG/WebP opcional, legenda, contador, prévia vertical 9:16 e controles de reprodução. Desmarcado, seus campos ficam desabilitados; selecionar a aba não seleciona TikTok automaticamente.
- **Layout:** prévia ao lado dos campos no desktop e abaixo no mobile. Header, destinos, abas e rodapé ficam fora da região rolável dos campos, mantendo fechamento e ação da aba acessíveis.
- **Calendário/Analytics:** filtros e estrutura preservados, identificação gráfica equivalente e estados vazios verdadeiros; sem métricas, publicações ou promessa de sincronização inventadas.

## Linguagem visual e nome “Teste”

Saíram os banners e rótulos “prévia local”, “integração em desenvolvimento”, “somente neste compositor”, explicações de persistência e avisos técnicos repetidos. Entraram “Vídeo”, “Capa”, “Legenda”, “Selecionar vídeo”, “Selecionar capa” e “Prévia da publicação”. Formatos e limites aparecem como ajuda discreta e validações específicas, não como alegações sobre limites oficiais do TikTok.

A apresentação anterior `Facebook — ${page.displayName}` concatenava plataforma e nome recebido pelo frontend. “Teste” não foi tratado como indicador de ambiente: o `displayName` permanece intacto, agora em linha separada do nome Facebook. Não foi consultado ou alterado o banco para inferir a identidade da conta. Os nomes acessíveis dos checkboxes Meta foram preservados para compatibilidade, sem exigir a mesma concatenação na apresentação visual.

## Bloqueios reais preservados

- TikTok não possui OAuth, upload ao backend, publicação, agendamento, salvamento persistido ou métricas nesta versão.
- A ação “Publicar no TikTok” informa **“Publicação TikTok indisponível.”**. É um botão de feedback, não um submit. O handler do formulário também impede submissão imperativa na aba TikTok, mesmo havendo contas Meta selecionadas.
- Na aba Meta, publicar não envia arquivos, capa ou legenda TikTok. Nenhum sucesso é atribuído ao TikTok.
- Alternar abas preserva o rascunho. Desmarcar TikTok, fechar ou trocar Workspace descarta o rascunho e revoga ObjectURLs. Eventos tardios de recursos substituídos continuam protegidos.
- Os tetos de 100 MiB para vídeo e 10 MiB para capa são limites de recursos do editor; não comprovação de compatibilidade com a API TikTok. O player não converte arquivos nem garante suporte a todos os codecs.
- Backend, contratos compartilhados, sessões, OAuth, Task10E, Meta Insights, publisher, Coordinator, scheduler, dependências e Topbar não foram alterados.

## Testes e evidências

Acervo local: `.superpowers/sdd/2026-10-24-socialflow-frontend-finish/`. Planos, relatórios dos implementadores, REDs, GREENs, diffs e resultados anteriores foram preservados. O acervo é ignorado pelo Git e não deve ser confundido com código ou dados de produção.

| Gate | Resultado efetivamente registrado |
| --- | --- |
| Identidade/Canais | RED 53 aprovados/13 falhas esperadas; GREEN final **67/67** |
| Abas/Composer | RED 0/3 por abas ausentes; GREEN integrado **68/68** |
| Correção do rodapé | RED comprovou submit Meta indevido na aba TikTok; corrigido e coberto pelos testes |
| Regressão frontend completa final | **411/411**, zero falhas/pending/todo, depois da correção CSS mobile |
| TypeScript frontend | `tsc --noEmit -p tsconfig.app.json`: exit 0 |
| Build frontend de validação | Vite com `envDir` vazio: exit 0; não é um artefato de deploy |
| ESLint global / diff-check | Ambos exit 0 |
| Integridade | **90/90 registros Meta, 11/11 migrations e 2/2 arquivos Topbar idênticos** |

Os comandos exatos, duração e códigos de saída estão em `verification-frontend.json` e `verification-static.json`. Não foram repetidas suítes backend/PostgreSQL: não há delta em `server`, `shared`, `package.json` ou lockfile. Aprovações históricas de PostgreSQL não são apresentadas como novas execuções.

## Navegador real

Firefox **158.0.1 headless**, WebDriver BiDi nativo, perfil isolado, Vite em loopback e dependências de dados sintéticas injetadas. Sem carregar `.env`, sessões reais ou credenciais. Interceptação e proxy bloquearam destinos externos; nenhum request não local foi observado.

Viewports CSS com DPR1: **1920×1080, 1366×768, 768×1024, 390×844 e 360×800**. A rodada final produziu **30 capturas e 106/106 controles aprovados**, zero erros de navegador/harness, incluindo:

- Canais, Agenda, Analytics e os dois painéis do Composer sem overflow horizontal do documento;
- seleção independente da aba e editor TikTok desabilitado quando não selecionado;
- vídeo com metadados reais 180×320, enquadramento 9:16, capa e legenda refletidos na prévia;
- rascunho/URL preservados nas trocas de aba, rodapé visível, foco contido e fechamento por Escape;
- conexão TikTok somente informativa e tentativa de publicação sem criação/upload;
- rejeição de arquivo vazio, tipo inválido e vídeo acima do teto;
- reprodução WebM avançando e MP4 sintético decodificado (não garantia universal de codec);
- troca de Workspace descartando rascunho/URLs, reabertura vazia e payload Meta sem conteúdo TikTok;
- sino preservado e foco das notificações restaurado ao fechar.

O fixture de Canais possui uma conta Facebook **sintética** chamada “Teste” e nenhuma conta Instagram; isso demonstra a apresentação desses estados sem consultar ou simular produção. O nome de Workspace/operador e a faixa inferior das capturas identificam o ambiente de teste. **Essa faixa pertence exclusivamente ao harness, não ao frontend entregue**, e pode sobrepor visualmente o limite inferior de uma captura; as medições de viewport/rodapé são registradas separadamente.

Capturas locais representativas:

- `finish-final-screenshots/channels-1366x768.png`;
- `finish-final-screenshots/composer-fields-1366x768.png`;
- `finish-final-screenshots/composer-fields-360x800.png`;
- `finish-final-screenshots/composer-preview-390x844.png`;
- `finish-final-screenshots/analytics-390x844.png`.

### Defeito encontrado pela inspeção visual

**F-UI1:** o chip TikTok mobile tinha largura máxima de 120 px, restando 41 px para o texto depois do checkbox, ícone e espaçamentos. “TikTok” quebrava em duas linhas apesar de não haver overflow global. O teste Firefox adicional registrou RED nos dois tamanhos mobile.

Correção mínima: apenas duas regras no breakpoint existente; a faixa de destinos passa a coluna e o chip usa largura intrínseca até o contêiner, sem margem superior de desktop. No GREEN real, o nome ocupa uma linha e dispõe de aproximadamente 120,47 px nos dois smartphones. Regressão focal **7/7** e nova matriz final confirmaram rodapé e demais comportamentos. Nenhum código funcional foi alterado nessa correção.

## Revisão e limites do aceite

Identidade e Composer passaram por implementadores e revisores independentes. A revisão de retorno de F-UI1 confirmou **ADDRESSED**, spec PASS e quality APPROVE, sem nova regressão. A revisão global final também confirmou **spec PASS / quality APPROVE**, sem achados Critical, Important ou Minor; conferiu o diff completo, testes, relatório e capturas selecionadas. Os pareceres completos estão no acervo local.

Não foram validados aparelhos físicos, touch, Safari/Chrome, leitor de tela, auditoria integral de contraste/WCAG, codecs arbitrários ou publicação operacional Meta. Testes Meta usam mocks explicitamente injetados; não são comprovação de publicação real. Os controles sintéticos não autorizam integração TikTok ou ativação Meta Insights.

Decisões de execução: reutilizar o worktree e evidências anteriores, testar novamente a árvore final após o defeito CSS e manter toda a implementação sem commit. A seleção é independente das abas; campos desabilitados não representam conta TikTok conectada. O acervo e os arquivos preexistentes foram preservados.

**Estado de entrega:** alterações locais prontas para revisão do usuário após os gates, sem reescrever `5ed06d8`. A aprovação visual humana precede qualquer novo commit, push ou deploy.

## Arquivos para revisão

| Grupo | Arquivos |
| --- | --- |
| Identificação e conexão | `src/components/ChannelBadge.tsx`, `src/components/TikTokComingSoon.tsx` |
| Páginas | `src/pages/Channels.tsx`, `src/pages/Agenda.tsx`, `src/pages/Analytics.tsx` |
| Composer e destinos | `src/features/composer/Composer.tsx`, `src/features/composer/ComposerDestinations.tsx` |
| Editor e estilos | `src/features/tiktok/TikTokLocalComposer.tsx`, `src/features/tiktok/tiktok.css`, `src/index.css` |
| Novos testes | `src/features/composer/ComposerTabs.test.tsx`, `src/pages/Agenda.test.tsx` |
| Testes adaptados/ampliados | `src/App.test.tsx`, `src/components/ChannelBadge.test.tsx`, `src/features/composer/ComposerDestinations.test.tsx`, `src/features/tiktok/TikTokAgenda.test.tsx`, `TikTokApp.test.tsx`, `TikTokExperience.test.tsx`, `src/pages/AnalyticsLayout.test.tsx`, `src/pages/Channels.test.tsx` |

Total do delta versionável: 18 arquivos modificados, dois testes novos e este relatório novo; nada staged. Spec, plano e evidências de execução ficam nos diretórios locais de acompanhamento, preservados sem commit.

## Retomada para publicação e deploy controlado — 24/10/2026

O acabamento acima foi preservado sem novo redesign ou alteração funcional. A [preparação atual de release](socialflow-7a-frontend-release.md) registra os novos gates: frontend 411/411, regressão unitária Meta/OAuth/service/scheduler 455/455, TypeScript frontend/backend, build HTTP isolado, lint/diff-check e integridade 90/11/2. A seleção proposta agora tem 22 arquivos, incluindo o novo roteiro; TCC e evidências continuam fora dela. Nada foi staged, commitado ou enviado.

O diagnóstico restrito atual encontrou API com tag `7a-5ed06d8` e web da mesma tag parado; não corresponde às imagens e44 presumidas no roteiro antigo. Produção não foi alterada nesta retomada. Dockerfiles/Compose/Nginx, sinais do npm atual, volumes, SHA novo e autorização de abertura do web permanecem gates operacionais. A dispensa humana de backup adicional foi documentada com seu risco. Consulte o roteiro atual antes de preparar qualquer implantação.
