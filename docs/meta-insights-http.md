# SocialFlow7A — HTTP autenticado de Insights (Task6)

Escopo local: camada HTTP sobre contratos, repository e service aprovados. Não habilita a Graph API real nem conclui a7A. A autorização da Task6 não inclui dashboard, coleta, persistência de métricas, mídia externa, OAuth real ou produção.

## Rotas e autorização

| GET | Identificador local | Scope |
| --- | --- | --- |
| /insights/facebook/accounts/:socialAccountId | UUID de social_accounts | facebook_page |
| /insights/facebook/publications/:postPublicationId | UUID de post_publications | facebook_post |
| /insights/instagram/accounts/:socialAccountId | UUID de social_accounts | instagram_account |
| /insights/instagram/publications/:postPublicationId | UUID de post_publications | instagram_media |

Publications recebe ID do **destino**, não o ID do post, photo/video/container ou Graph ID. Não há descoberta ou consulta por mídia externa arbitrária.

Cookie de sessão opaca existente obrigatório; tenant e membership vêm da sessão validada no backend. Todos os membros ativos owner/admin/member podem ler contas do Workspace, inclusive destinos de outro autor ou autor removido. Isso não permite administrar tokens/conexões. Cross-tenant e inexistente retornam o mesmo404.

O helper HTTP chama sempre o service real, que resolve os vínculos, gates de provider/grants/expiração e credencial antes de descriptografar, e revalida o mesmo contexto/alvo após sucesso **ou erro** assíncrono. Facebook usa Page token; Instagram Facebook Login usa User token da conexão. Nada disso é selecionável pelo browser.

## Query pública

- `metrics`: opcional, CSV de1–4 nomes únicos, sem vazios/whitespace. Allowlist em `shared/insightsContract.ts`. Defaults de uma métrica: Page `page_media_view`, Post `post_media_view`, IG Account/Media `views`.
- `period`: default `day` em accounts, `lifetime` em publications. FB Page permite day/week/days_28; IG Account somente day; publicações somente lifetime.
- `since` e `until`: obrigatórios para accounts, datas UTC reais YYYY-MM-DD; intervalo `[since,until)`, com until>since. Não aceitar rollover de calendário ou formatos alternativos. Service mantém as janelas locais aprovadas: FB até90dias/últimos2anos; IG Account últimos90dias, sem futuro.
- `metricType`: somente IG Account, default total_value. time_series exige metrics=reach. O parâmetro camelCase é contrato SocialFlow, não pass-through livre da API Meta.
- Publications não aceitam datas ou metricType. Repetição de parâmetro (inclusive após percent-decoding), desconhecidos, valores vazios, campos tenant/token/URL/host/version/proof/Graph ID são400. Não há “todas as métricas” por default.

Exemplo de path, somente com sessão local já autenticada:

```text
/insights/facebook/accounts/<UUID-local>?since=2026-10-01&until=2026-10-20&period=day&metrics=page_media_view
/insights/instagram/publications/<UUID-local-do-destino>?metrics=views,reach
```

## Respostas

200 contém exatamente `InsightsResponse`: scope,period,graphApiVersion,fetchedAt e metrics com points[{value,endTime}]. Sem tokens/ciphertexts/Graph IDs/corpos brutos. Zero legítimo permanece0; ausência permanece explícita, nunca vira0. O DTO é validado antes do envio; um retorno inválido é indisponibilidade, não dado parcial fabricado.

Erros usam `{error:{code,message}}`, mensagens fixas e sem detalhes internos:

| HTTP | Código |
| --- | --- |
|400|invalid_insights_id / invalid_insights_query|
|401|unauthorized|
|404|insights_not_found|
|409|meta_insights_permission_required / meta_insights_token_expired / meta_insights_unsupported_object|
|429|meta_insights_rate_limited|
|503|meta_insights_not_enabled / meta_insights_provider_unavailable / meta_insights_timeout / meta_insights_aborted|

Origin recusado, métodos não permitidos e OPTIONS mantêm a política global existente. As rotas reconhecidas permitem GET/OPTIONS; não há endpoint administrativo. Namespace Insights recebe Cache-Control:no-store e nosniff, inclusive erros; CORS/Vary/cookie não são relaxados. Nenhum Retry-After é inventado sem informação de quota.

## Transporte e cancelamento

Execução normal usa clients **sem transporte**, portanto uma consulta elegível retorna503meta_insights_not_enabled, nunca métricas simuladas. Contas sem autorização/grants, expiradas, desconectadas ou sem prova recebem seu erro específico antes desse ponto. Nenhuma flag/config da aplicação ou campo HTTP fornece transporte.

A seam interna insightsTransportForTests exige NODE_ENV=test e injeção explícita no createApiServer; index/config não a preenchem. Ela serve para testes com service/repository/clients reais e fake somente na fronteira Meta. Não é mecanismo de ativação de rede nem validação da Meta real.

Abort de request ou fechamento prematuro da response propaga sinal ao service; não escrever dados após abort/destruição. Não tratar fechamento normal do GET como abort. Cancelamento da espera não cancela fisicamente SQL já submetido; rejeições tardias são observadas e não expõem reason/erro bruto. Não há await adicional após o gate final do service antes da validação/envio síncronos do DTO.

## Verificação e limites

Testes HTTP: `server/test/metaInsightsHttp.integration.ts`, com servidor efêmero e PostgreSQL exclusivo `_test`/schemas isolados. Reports, RED/GREEN, review e gates desta execução ficam em `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-6-*`; resultados históricos das Tasks4/5 não os substituem.

Consultar `task-6-final-report.md` para aprovação e contagens definitivas; enquanto os gates estiverem pendentes, este documento não constitui aprovação. Nenhuma migration001–011 pode ser reescrita e nenhuma nova migration é necessária. Nenhuma mudança de scheduler, publicação, credenciais reais, env, infraestrutura ou Debian é autorizada.

Fechamento22/10: Task6 aprovada localmente após autorização Buffer-only e revisão independente sem findings. HTTP114/114,frontend357/backend1696 e integração706/706 nos21arquivos,zero falhas/skips; build/typecheck/lint/runtime/diffcheck/hashes verdes. Históricos do timeout e da divergênciaCoordinator preservados em task-6-regression-blocker.md; Coordinator passou nas duas seleções completas novas,sem patch e sem alegação de causa corrigida. Consultar task-6-final-report.md para evidências. Não conclui7A,Meta real ou Task7.

Pendências externas continuam: transporte comprovado de token+appsecret_proof por endpoint, grants efetivos/App Review e testes reais isolados autorizados; elegibilidade/prova top-level de mídia externa. Não prosseguir para Task7 ou rede real automaticamente.
