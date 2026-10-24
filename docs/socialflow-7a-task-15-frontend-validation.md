# Task 15 — validação visual local e retorno de revisão

Base: `e44b031d194a959e3f4182b246d17525a0ebc09c`, branch `feat/socialflow-7a-meta-insights`. Data: 2026-10-24. Este relatório complementa, sem substituir, os fechamentos das Tasks 11A, 11B, 12 e 14.

## Recuperação

Não havia commit da 7A nem arquivos staged. O checkpoint interrompido continha teste focal GREEN incompleto (6/7), após RED funcional. Não havia evidência local de build de imagem, transferência ou deploy. O único build local existente não é uma imagem de produção.

## Navegador realmente utilizado

Firefox **158.0.1 headless**, instalado localmente, controlado por WebDriver BiDi nativo, sem instalar Playwright ou dependências globais. Perfil descartável e separado do perfil pessoal. Vite em loopback, `envDir` vazio e repositórios mock explicitamente injetados por entrada exclusiva do harness. Operador, duas contas Meta, Workspaces e um agendamento são **sintéticos**, com aviso visível; não representam ativos reais.

Destinos externos bloqueados por interceptação de rede e proxy local fechado; aplicação testada sem backend. Nenhuma credencial real, banco, publicação ou consulta Meta/TikTok. Essa montagem verifica frontend e payloads, não autenticação HTTP real nem publicação operacional.

Canais, Agenda, Analytics e Composer TikTok foram capturados nos viewports CSS **1920×1080, 1366×768, 768×1024, 390×844 e 360×800**, DPR 1: 20 capturas por rodada completa. Não equivalem a aparelhos físicos. Capturas examinadas incluem Canais desktop, Composer notebook/mobile, Agenda mobile e Analytics mobile antes/depois.

## Defeitos demonstrados e correções

1. Composer sem semântica de diálogo, foco inicial/trap/Escape. Reutilizado o comportamento anterior de `AccessibleDialog` em `useDialogFocus`; ordenação explícita DOM dos controles evita dependência da ordem dos grupos de seletor no ambiente de testes. Composer recebe nome acessível, papel e foco; fechamento restaura o foco. Sem alteração de auth, upload ou payload.
2. Analytics herdava `min-height: 560px` de `.page-panel`, deixando espaço vazio excessivo. O retorno independente detectou que a primeira correção perdia na cascata real. Correção mínima: `.page-panel.analytics-filters-panel { min-height: 0; }`. Teste agora usa CSS na ordem adversa/real, não a ordem favorável anterior.

Arquivos produtivos do delta Task15: `src/components/AccessibleDialog.tsx`, novo `src/components/useDialogFocus.ts`, `src/features/composer/Composer.tsx`, `src/pages/Analytics.tsx`, `src/features/tiktok/tiktok.css`. Testes novos: `ComposerAccessibility.test.tsx` e `AnalyticsLayout.test.tsx`. Em `src/App.test.tsx`, a asserção antiga de ausência de qualquer diálogo com Composer aberto foi substituída por exatamente um diálogo chamado Criar publicação contendo o mesmo textbox e nenhum combobox de busca; preservada a verificação de Ajuda desabilitada.

## Evidências locais e limites

Acervo ignorado: `.superpowers/sdd/2026-10-24-socialflow-7a-task-15-frontend/`.

- RED inicial: quatro falhas funcionais; GREEN inicial 6/7; retorno focal **7/7**.
- Finding **F15-review-1**: `analytics-cascade-red.json` 0/1 (560px em vez de 0px) → `analytics-cascade-green.json` **1/1**.
- `verified-return-browser-report.json`: **60/60 controles da matriz** nos cinco viewports. Comprovados: ausência de overflow horizontal do documento, altura Analytics corrigida, vídeo com metadados/preview 9:16, TikTok-only bloqueando criação/upload, foco/Tab/Escape e revogação de ObjectURLs no fechamento.
- Esse relatório **não é uma execução inteira GREEN**: depois da matriz, a automação parou ao tentar alcançar o botão Canais no viewport mobile. Preservado o blocker e as tentativas anteriores; não atribuído ao código como defeito sem prova.
- `extras-browser-report.json`: execução separada concluída, **11/11**, em 1366×768, sem erros de navegador ou destinos externos. Conectar TikTok é informativo; sino preservado; arquivos vazio/tipo errado/>100MiB rejeitados sem ObjectURL; WebM reproduziu e avançou; MP4 sintético H264 decodificou; troca de Workspace descarta rascunho e URLs; reabertura vazia; payload Meta exclui vídeo/legenda TikTok; notificações restauram foco com Escape. Não extrapolar esses extras para todos os viewports ou codecs.

## Revisão independente

Revisor `/root/review_delivery_12`, somente leitura, sem duplicar execuções. Important F15-review-1 encerrado após examinar RED/GREEN, especificidade CSS e captura mobile. Nenhum Critical/Important adicional confirmado. Revisão distingue matriz positiva, extras concluídos e blocker histórico de automação. Aceite do commit condicionado aos gates finais registrados no manifesto.

## Regressão e integridade

Resultados finais dos comandos e hashes: `verification.json` e `frontend-final-return.json` no acervo local. Frontend completo **399/399**, 31 arquivos, zero falhas/skips/todo; primeira execução 398/399 está preservada em `frontend-final.json`. `app-green.json`: **98/98**, incluindo o teste legado corrigido de exclusividade do Composer.

TypeScript app e experimental, build frontend de validação, build server, ESLint e diff-check: **exit0**, sequenciais. Houve uma falha de tipagem no teste novo por `exact` não existir em ByRoleOptions; removida essa opção redundante, mantendo `name: "Fechar"` literal e exato. RED de tipo preservado, sem mudança funcional posterior à suíte399. Retorno focal final em `focal-final.json`.

Build frontend usou `envDir` vazio, sem ler credenciais; **não é artefato de produção**. Backend/PostgreSQL da Task14 não foram reexecutados apenas por esse delta frontend: 709/709 PostgreSQL17.11 e 2045/2045 backend11B são históricos preservados, não execuções desta Task. Não há defeito produtivo novo confirmado nem autorização para ativação Meta/TikTok.

Verificação final confirmou **90/90 registros Meta idênticos e migrations 001–011 idênticas à base**. Dos 15 arquivos TikTok protegidos anteriormente, **12 são idênticos e três têm delta autorizado nesta Task** (Composer, Analytics e CSS). Os registros originais não foram sobrescritos. Topbar/sino, backend, OAuth, publisher, Coordinator e scheduler não foram modificados nesta Task.

## Pendências manuais não cobertas

Dispositivos físicos/touch, outros navegadores e sistemas, leitor de tela, auditoria integral de contraste/WCAG, codecs arbitrários, sessões longas e clique TikTok em viewport mobile após rolagem. Agenda usa rolagem horizontal interna para os sete dias; não foi identificada rolagem horizontal do documento. A aprovação local é restrita ao ambiente e aos controles acima, não uma certificação universal de acessibilidade ou autorização de deploy.

## Entrega

O usuário substituiu a proposta histórica de 14 commits por **um único commit local da 7A**. Ver [preparação da entrega controlada](socialflow-7a-controlled-delivery.md). Não há autorização para o Codex usar SSH administrativo nem modificar o Debian.
