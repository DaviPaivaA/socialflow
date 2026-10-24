# Task11A — experiência TikTok exclusivamente frontend

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Preservar worktree/branch e todo histórico. Não fazer commits nem limpar checkpoints.

**Goal:** concluir Canais, Composer/Preview local, Agenda e Analytics TikTok sem conectar backend/API, respeitando os requisitos completos da solicitação Task11A.

**Architecture:** aproveitar ChannelBadge/TikTokComingSoon/estilos e o compositor existentes. Componentes tipados de vídeo/capa/legenda só em memória, ObjectURLs locais com descarte. Payloads e mídia Meta ficam independentes. Plataforma/period selectors locais e estados honestos. Nenhuma persistência ou sucesso simulado.

**Tech Stack:** React19, TypeScript/Vite, CSS existente, Vitest/TestingLibrary, sem dependências novas.

**Spec:** solicitação humana Task11A desta conversa e brief integral no ledger próprio. Usuário especificou implementação, escopo, bloqueios e critérios; escolhas menores serão registradas, sem expandir para backend.

## Global Constraints

- Nenhuma edição server/,shared/,package,OAuth,MetaInsights/10E,migrations,Docker,.env ou credenciais; sem produção/DB/deploy/commit/push/merge.
- Preservar os90registros do manifesto task-10e-final-verification.json e implementações TikTok anteriores; alterações necessárias em seus testes devem refletir a evolução explicitamente pedida, não suprimir cobertura.
- TikTok sem fetch/repository/upload/create/update/cancel/OAuth; arquivo, capa, legenda e seleção não entram em payloadMeta nem em localStorage/sessionStorage/IndexedDB/URL.
- Memória escopada ao Workspace/compositor; troca de Workspace, fechamento, substituição/remoção de arquivo e desmontagem descartam URLs/estado. Callbacks tardios não podem reintroduzir recursos antigos.
- Publicação/agendamento somente dos IDs Meta elegíveis; nenhum ID simbólico TT ou dados locais no payload. TikTok único bloqueado com explicação. Mixed mode deixa claro que só Meta será enviado e nunca mostra sucesso TikTok.
- Arquivos: allowlist local de formatos reproduzíveis (MP4/WebM; capa JPEG/PNG/WebP), arquivos não vazios, teto de segurança local explicitamente rotulado e NÃO alegado oficial. Não verificar/afirmar duração/codec/proporção oficialmente aceitos. Preview pode letterbox em9:16 sem alterar arquivo.
- Não inventar avatar,username,métricas,histórico ou agendamentos. Identidade conhecida somente com dados legítimos; fallback é ausência, não perfil fictício.

## Review Focus

- Nenhum upload/submit adicional disparado por escolha de vídeo/capa ou TikTok.
- URLcleanup e scoped state, inclusive StrictMode, substituição e callbacks tardios.
- Mixed Meta+TikTok não usa arquivo/legenda TikTok em Meta nem bloqueia Meta indevidamente.
- Agenda não classifica posts legados sem destino e não consulta backend por ação TikTok.
- UX de conexão/analytics não muda disconnected para connected nem indisponível para zero.

## Auditoria e decisões técnicas

Estado inicial: branch feat/socialflow-7a-meta-insights, HEADe44b031d194a959e3f4182b246d17525a0ebc09c, alterações anteriores dirty/untracked. Topbar já contém sino; não tocar seu código. Não existe biblioteca de ícones nem tema escuro dedicado.367testesfrontend é histórico, não nova execução.

Composer atual usa useComposerMedia(repository.upload) e captionMeta limitada500; não reutilizar esse upload para TT. Criar uma seção selecionável independente com campo de legenda local sem limite oficial presumido, contador e preview reutilizável. Meta continua validando seus próprios campos e mídias. Explicar diferenças no mixedmode.

Post não contém provider. Se for implementado filtroFB/IG real, resolver somente por leitura de PostsRepository.get + contas do Workspace, com associações tenant/post/account conferidas, cancelamentos/legados tratados honestamente e sem chamadas novas para all/TikTok. Nunca adivinhar plataforma. Sem dependência disponível mostrar indisponibilidade, não zero. Default daAgenda continua exibindo os posts existentes sem nova consulta. Não criar novos endpoints/contratos.

## Task1 — interface completa local11A (entrega única integrada)

- [x] Snapshot de recuperação e conferência90hashes; ler fontes e testes conectados.
- [x] RED funcional de seleção/localfile/preview/URLcleanup/payloads, cartão conexão semOAuth, filtros/analytics semdados.
- [x] GREEN módulos tipados TikTok, integração mínima com Canais/Composer/Agenda/Analytics eCSSresponsivo, preservando toda lógicaMeta.
- [x] Focados e regressãofrontend, TypeScript/buildfrontend/lint/diffcheck; novos testes de navegação/Workspace/zerochamadasTT.
- [x] Revisão independente de especificação/segurança/qualidade; corrigir Critical/Important no escopo comRED→GREEN.
- [x] Relatório/inventário/diff/checkpoints próprios,90hashes intactos, nenhuma autorização/ativação real, nenhum commit.

## Fechamento

Relatório: `docs/tiktok-frontend-11a.md`. Evidências e limitações no ledger próprio. Frontend completo394/394 antes do MinorM1, regressão focada pósM1 em93/93, build completo/TypeScript e lint aprovados. M1 encerrado em revisão independente de retorno. Nenhum finding pendente.90hashes Meta,11migrations e Topbar intactos. TestesDOM/CSS não substituem validação visual física de dispositivo/codec. Nenhuma integração realTikTok/Meta ou próxima etapa ativada.
