# SocialFlow 7A — execução local controlada (20/10/2026)

Base aprovada: `e44b031d194a959e3f4182b246d17525a0ebc09c`. Branch local: `feat/socialflow-7a-meta-insights`. Esta entrega **não conclui a 7A** nem habilita métricas reais. A auditoria permanece em [meta-insights-task-1-security-review.md](meta-insights-task-1-security-review.md); o plano restrito está em `docs/superpowers/plans/2026-10-20-socialflow-7a-local-oauth-clients.md` e o ledger em `.superpowers/sdd/2026-10-20-socialflow-7a-local-oauth-clients/progress.md` (arquivos locais ignorados pelo Git).

## Escopo e diferença em relação ao plano amplo

Autorizados somente OAuth opcional, grants efetivos, contratos, allowlists, normalização e clients locais com transporte injetável. Nenhum Insights repository/service/endpoint, coletor, dashboard ou migration. Os clients de publicação, scheduler e armazenamento de mídia não são substituídos.

**Configuração opcional implementada:** `META_INSIGHTS_OAUTH_ENABLED`, booleano server-side, desligado por padrão. Habilitar explicitamente permite pedir `read_insights` e `instagram_manage_insights` no fluxo Facebook Login existente, preservando os escopos de publicação. Não aceitar listas de scopes do browser. Essa flag não concede scopes, não prova App Review e não habilita transporte Insights. Nenhum arquivo `.env` real é alterado; não copiar credenciais para documentação. Não adicionar os scopes Insights a `requiredPublishingScopes` nem forçar reconexão das contas existentes.

## Bloqueios externos preservados

- Nenhuma rede Insights real para Facebook ou Instagram nesta entrega. Transporte sem implementação fornecida deve falhar explicitamente como bloqueado, nunca usar `globalThis.fetch` como fallback.
- Transporte seguro de access token + appsecret_proof sem URLs/headers inventados precisa de confirmação por endpoint e autorização separada. Graph batch genérico documentado não é prova específica de IG Insights. Não implementar fallback silencioso em query string.
- Facebook Insights: Page Access Token. Instagram via Facebook Login: Facebook User Access Token da conexão, não o Page token de publicação. Tipos privados devem distinguir isso; não há novo lookup de credenciais nesta fatia.
- Grants devem ser concedidos de fato; App Review, Advanced Access, tasks/roles e condições Business Manager ainda exigem verificação. Não pedir ads scopes automaticamente.
- Objeto IG externo exige ownership atual e prova top-level independente. Owner + IMAGE/FEED não prova que não é filho de álbum. Formatos/ID de Reel Facebook não são automaticamente Page Post.
- Fixtures simuladas provam apenas o comportamento local, não o funcionamento da API Meta real.

## Estado de execução

- **Task 1A OAuth:** módulo aprovado,86/86 focados com PostgreSQL real exclusivo de testes e revisão independente. Revalidação com relógio atual após locks e antes de COMMIT; expiração durante locks reverte mudanças de credenciais. State consume usa transação curta, sem chamada Meta dentro dela. Grants parciais preservam publicação e IDs; grants revogados não são somados aos novos.
- **Task 2 contratos/core/Facebook:** módulo aprovado localmente,179/179 focados após corrigir F1 e M1; revisão de retorno sem pendências. Page/Post separados; allowlistv26.0 e períodos próprios, Page token+grants+ANALYZE, timeout/abort, erros sanitizados, limite4métricas/1000pontos/1MiB. Nenhum HTTP concreto. Instantes equivalentes com offsets diferentes são duplicatas rejeitadas; Page disponível exige timestamp. Zero não vira ausência, ausência não vira zero.
- **Task 3 Instagram:** módulo aprovado,313/313 focados (134 novos +179 regressão), revisão independente sem findings. Reutiliza núcleo, credencial User, parsers próprios de Account total_value/time_series e Media lifetime. Prova interna precisa coincidir com mídia e conta exatas; owner sozinho não permite consulta. Nenhum lookup real de ownership/top-level/formato está implementado.
- **Regressão global concluída em 21/10/2026:** após a última correção, OAuth86/86, Insights316/316, frontend357/357 e backend1426/1426, sem falhas/skips. Integração explícita516/516 em18arquivos, sem skips. Totalfrontend+backend1783; integração/focados são subconjuntos, não somar novamente. Build/typecheck,lint e diff-check passaram. Node22.23.3 importou8módulos sem conexão/HTTP/listen/timer; checksums11/11migrations preservados. Revisão global e retorno aprovados; F1/M1/G1 fechados, nenhum finding local aberto. Evidências e decisões em `task-4-report.md` na pasta do ledger.

Uma primeira execução de integração falhou em um teste existente de mídia (35,7s, limite30s); o JSON trouxe STACK_TRACE_ERROR sem diagnóstico conclusivo. Mesmo código passou isoladamente18,5s e na integração completa21,9s, sem patch nem aumento de timeout. Ambiente com carga/swap altas sustenta hipótese de contenção, não causa exclusiva comprovada. Runs/limitação preservados; não foi ocultada a falha anterior.

O DTO local é discriminado por scope/período e carrega `graphApiVersion`, `fetchedAt`, `metrics:[{name,status,points:[{value,endTime}]}]`. Pontos de séries não são somados nem reduzidos a escalar; estados de ausência têm value:null/endTime:null. O contrato de reações é deliberadamente restrito às seis chaves canônicas completas: variantes/omissões não são convertidas em zeros. **Esse shape ainda não foi validado contra a Meta**; confirmar cardinalidade externa antes de habilitar rede.

## Configuração e operação futuras

Nenhuma ação de produção autorizada. Não ativar a flag no Debian nesta execução. Futuras operações requerem decisão separada de consentimento/App Review, comprovação do transporte por endpoint, lookup de conta/autorização por sessão/membership/tenant e smoke isolado autorizado. Sessões e OAuth continuam usando configuração/criptografia existentes; nenhum segredo deve ir ao frontend, logs, URL de diagnóstico ou erros.

## Extensão autorizada em21/10/2026 — Tasks4/5 do plano amplo

A fatia acima permanece como histórico da entrega anterior. A autorização posterior permite exclusivamente repository e service privados de Insights, sem endpoints/rede real/persistência de métricas. Arquitetura, interfaces, limites e localização das novas evidências estão em [meta-insights-repository-service.md](meta-insights-repository-service.md). O ledger ativo dessa extensão é `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/progress.md`; não confundir sua Task4 repository com a Task4 de verificação do plano local de20/10.
