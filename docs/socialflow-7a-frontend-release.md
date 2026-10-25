# SocialFlow 7A — acabamento visual, commit adicional e deploy controlado

Preparação em 24/10/2026. **Não executa nem autoriza commit, push, deploy ou abertura pública.** Substitui apenas as premissas operacionais antigas do [roteiro histórico](socialflow-7a-controlled-delivery.md), sem apagar suas evidências.

## 1. Versão e decisão de entrega

- Branch: `feat/socialflow-7a-meta-insights`.
- HEAD publicado preservado: `5ed06d80051c0de58ac6850973d4ef5be037a2c0`.
- O acabamento aprovado está no worktree, ainda não commitado. **5ed06d8 não contém esse delta visual.** A versão a implantar será o SHA completo do **novo commit adicional**, após autorização humana; ainda não existe hash desse commit.
- Mensagem proposta: `feat: polish social composers and channel presentation`.
- Nenhum amend, alteração do índice, merge ou push foi feito nesta preparação.
- Nenhuma alteração de backend, contratos, dependências, Topbar ou migrations foi necessária. Nenhum redesign novo.

## 2. Arquivos propostos para o único commit adicional

Seleção explícita por arquivo; **não usar `git add .`, `git add -A` ou inclusão por diretório inteiro**. Conferir o diff staged somente depois da autorização.

| Grupo | Caminho |
|---|---|
| Produção | `src/components/ChannelBadge.tsx` |
| Produção | `src/components/TikTokComingSoon.tsx` |
| Produção | `src/features/composer/Composer.tsx` |
| Produção | `src/features/composer/ComposerDestinations.tsx` |
| Produção | `src/features/tiktok/TikTokLocalComposer.tsx` |
| Produção | `src/features/tiktok/tiktok.css` |
| Produção | `src/index.css` |
| Produção | `src/pages/Agenda.tsx` |
| Produção | `src/pages/Analytics.tsx` |
| Produção | `src/pages/Channels.tsx` |
| Teste modificado | `src/App.test.tsx` |
| Teste modificado | `src/components/ChannelBadge.test.tsx` |
| Teste modificado | `src/features/composer/ComposerDestinations.test.tsx` |
| Teste modificado | `src/features/tiktok/TikTokAgenda.test.tsx` |
| Teste modificado | `src/features/tiktok/TikTokApp.test.tsx` |
| Teste modificado | `src/features/tiktok/TikTokExperience.test.tsx` |
| Teste modificado | `src/pages/AnalyticsLayout.test.tsx` |
| Teste modificado | `src/pages/Channels.test.tsx` |
| Teste novo | `src/features/composer/ComposerTabs.test.tsx` |
| Teste novo | `src/pages/Agenda.test.tsx` |
| Documentação nova | `docs/socialflow-frontend-finish.md` |
| Documentação nova | `docs/socialflow-7a-frontend-release.md` |

Total: **22 arquivos** — 10 de produção, 10 testes, dois documentos. Não há arquivo auxiliar novo exigido pelo runtime. Os SVGs reutilizam `ChannelBadge`; nenhuma biblioteca foi adicionada.

**Fora da seleção e das imagens:** `.superpowers/`, `tools/tcc-visual/`, `docs/tcc-captures/`, PNGs/ZIPs, manifests/galerias do TCC, logs, `.env*`, chaves, dumps, `node_modules`, `dist`, `dist-server`, `data/`, evidências e diretórios temporários. Nada disso foi excluído do computador. O roteiro operacional abaixo continua documental; não adiciona Dockerfiles/Compose não inspecionados ao commit visual.

## 3. Acabamento confirmado e limitações reais

Abas independentes da seleção, múltiplos destinos Meta, formulário compartilhado, arquivos e legenda TikTok preservados entre abas, prévia 9:16, campos/capa/vídeo, layout responsivo e rodapé acessível correspondem ao [acabamento aprovado](socialflow-frontend-finish.md). Facebook/Instagram usam ícones próprios; nomes de conta reais permanecem separados da plataforma; Instagram ausente é mostrado como desconectado somente após listagem bem-sucedida.

Não restam banners de desenvolvimento ou instruções técnicas repetidas no editor TikTok. Foram mantidos formatos/tamanhos como ajuda discreta, erros de arquivo e feedbacks curtos e verdadeiros de indisponibilidade. Não houve nova edição funcional nesta preparação.

TikTok não conecta, publica, agenda, persiste ou envia arquivo ao backend. Desmarcar, fechar ou trocar Workspace descarta o rascunho e revoga ObjectURLs. Selecionar aba não seleciona conta. O handler e o botão impedem submit TikTok mesmo com Meta selecionada. O payload Meta não recebe dados TikTok.

Dashboard produtivo usa contagem real de posts do Workspace e `—` para métricas não disponíveis. Analytics produtivo não mostra números simulados nem gráficos de desempenho inventados. As capturas acadêmicas **não são uma representação das capacidades operacionais liberadas**.

## 4. Verificações executadas nesta preparação

Acervo novo: `.superpowers/sdd/2026-10-24-socialflow-release-preparation/`. Configurações com `envDir` vazio; nenhum `.env` ou banco real utilizado.

| Gate | Resultado novo |
|---|---|
| Frontend completo | **411/411**, zero falhas/skips, 33 arquivos |
| Composer, contido no frontend completo | 65/65, seis arquivos; inclui abas, payload, múltiplos destinos e rascunho |
| TikTok, contido no frontend completo | 28/28, três arquivos; sem upload/criação real, ObjectURLs/Workspace |
| HTTP frontend, contido no frontend completo | 65/65 em cinco arquivos: ApiClient e repositories Auth/Posts/Media/SocialAccounts, com fetch injetado |
| Meta/OAuth/service/scheduler unitários | **455/455**, zero falhas/skips; banco removido do ambiente; somente mocks |
| TypeScript frontend | Exit 0 |
| Compilação TypeScript backend em saída isolada | Exit 0; não inicia API/scheduler |
| Build frontend HTTP de validação | Exit 0, 138 módulos transformados; `/api` é configuração pública de validação, **não confirmação do endereço produtivo** |
| Auditoria de chunks | 97 módulos emitidos; zero módulos `tools/tcc-visual`, `.superpowers` ou `server/experiments` |
| ESLint global e diff-check | Exit 0 |
| Integridade histórica | **90/90 Meta, 11/11 migrations, 2/2 Topbar** idênticos |

O frontend completo foi executado com `npm run test:frontend -- --config .../validation.config.mjs --reporter=json --outputFile=.../frontend.json`. Backend focal: `env -u TEST_DATABASE_URL -u DATABASE_URL node node_modules/vitest/vitest.mjs run --config .../server-validation.config.mjs` sobre `metaInsightsClient`, `facebookInsightsClient`, `instagramInsightsClient`, `insightsContract`, `insightsService`, `metaOAuthClient`, `metaOAuthService`, `publicationScheduler` (todos `.test.ts`).

HTTP frontend usa mocks de transporte, não é teste HTTP do Debian. A suíte HTTP Insights que exige PostgreSQL e as suítes completas backend/PG **não foram reexecutadas** neste delta exclusivamente frontend. A aprovação PostgreSQL 17.11 de 709/709 permanece histórica e não é apresentada como resultado desta execução. Nenhuma publicação/API Meta/TikTok foi utilizada.

### Isolamento TCC: garantia e ressalva

`src/main.tsx` carrega o App real; nenhuma importação do harness documental foi adicionada ao produto. O bundle auditado não contém identidade Davi Paiva/Marina Costa do TCC nem caminhos de assets do harness. Produção exige `VITE_POSTS_REPOSITORY=http` e URL não vazia; configuração ausente/mock falha de forma explícita, testada em `createAppServices.test.ts`.

**Não afirmar remoção física de todos os mocks:** quatro classes mock legadas da aplicação e o nome legado de demonstração ainda aparecem compilados, por serem imports existentes de `createAppServices`. Não são fixtures do TCC. No modo HTTP obrigatório não são instanciadas como sessão/conta real, e Analytics não as usa para métricas. Excluir fisicamente todo suporte mock do bundle exigiria outra refatoração; não foi feita de forma disfarçada nesta tarefa. Não há flag TCC no build normal.

## 5. Estado do Debian observado agora — apenas diagnóstico restrito

Comandos executados pelo Codex, ambos somente leitura:

```bash
ssh -F ~/.ssh/config_codexdiag socialflow-diag disk
ssh -F ~/.ssh/config_codexdiag socialflow-diag socialflow
```

- `/srv`: 205 GiB totais, 60 GiB usados, **135 GiB livres / 31%**. `/`: 14 GiB livres. O alerta histórico de 90% não corresponde a esta captura. O Docker Root Dir ainda precisa ser confirmado.
- `socialflow-api`: **running**, tag **`socialflow-api:7a-5ed06d8`**, ativo há cinco horas, sem healthcheck Docker; CPU 0,10%, memória 65,39 MiB na amostra.
- `socialflow-web`: **exited (0)** há quatro horas, tag **`socialflow-web:7a-5ed06d8`**, sem healthcheck Docker.
- PostgreSQL: `postgres:17`, **healthy**, sem alteração; pgAdmin em execução. Nenhum comando foi emitido para Deluge/AdGuard.

Isso diverge das premissas antigas `postmanagement-e44b031`. **Não foi este Codex que atualizou ou parou containers nesta tarefa.** As tags não provam conteúdo, digest, revision OCI ou SHA do código interno. As imagens antigas e a versão 5ed devem ser preservadas e identificadas por ID antes de qualquer troca. Não foi realizado teste de health/login/publicação na produção.

O frontend parado deve continuar parado até autorização explícita para sua inicialização/disponibilidade. Não presumir que loopback impede exposição por túnel ou proxy já existente.

## 6. Backup: decisão humana atualizada

O usuário **dispensou backup adicional nesta atualização**. Não foi executado backup, dump ou restore. A exigência documental antiga de novo backup foi substituída por essa aceitação de risco, não por uma alegação de que os dados estão protegidos.

Risco: falha de disco, volume/configuração equivocada ou problema da aplicação pode afetar dados/mídias sem ponto novo e verificado de recuperação. **Rollback de imagem não recupera dados**, e restaurar um dump antigo pode perder publicações e comprometer idempotência/admissões. Nenhum restore automático é permitido. A dispensa de backup não dispensa os gates de volumes, credenciais existentes e parada coordenada.

## 7. Gates ainda impeditivos

1. Autorização para criar o commit adicional, revisar staged e depois fazer push; novo SHA exato ainda inexistente.
2. Receber/revisar os arquivos reais `Dockerfile.api`, `Dockerfile.web`, `.dockerignore`, `deploy/nginx.conf` e os dois Compose. Não estão no checkout local; não foram lidos pela conta restrita. Seu conteúdo/mesclagem não está validado.
3. Confirmar configuração **pública** de `VITE_API_URL`, base `/` (sem modo GitHub Pages), HTTP obrigatório e mapeamento Nginx da API. Nunca enviar secrets como build args. `/api` foi somente valor de validação.
4. Confirmar arquitetura do Docker, diretório de dados, espaço nesse filesystem e IDs das imagens de rollback. Não há Docker/Podman disponível neste ambiente local; nenhuma imagem foi construída/salva/transferida.
5. Comprovar mount de `/home/servercasa/apps/socialflow/data/media` no caminho que a API realmente utiliza, sem trocar UID/GID, chaves, cookies, env_files ou redes. Não fazer `chown`/remoção de volumes como solução improvisada.
6. Provar entrega de SIGTERM ao Node atual iniciado por npm, drenagem e política de restart. A configuração de imagem nova não corrige retroativamente o PID1 da imagem em execução.
7. Confirmar `stop_grace_period` efetivo **maior que 330 s**; proposta 7 minutos (420 s). Não usar o default curto.
8. Atestar `META_INSIGHTS_OAUTH_ENABLED=false` sem divulgar secrets; transporte sem binding e nenhum comando experimental. Manter origem/cookies/Meta publishing existentes.

Migrations 001–011 estão idênticas a HEAD e à baseline protegida; **nenhuma nova migration**. Nenhuma migration deve ser executada neste rollout. Meta Insights não persiste snapshots nesta etapa; não criar tabelas para aparentar integração.

## 8. Coleta específica para o operador — somente leitura

**Somente o operador no Debian.** Não usar a conta codexdiag para estes comandos. Não colar Compose resolvido, `.Config.Env`, `.env`, segredos ou logs brutos. Os nomes dos arquivos abaixo são os informados pelo usuário; não pressupõem conteúdo validado.

```bash
cd /home/servercasa/apps/socialflow
docker compose version
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --quiet
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --services
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --images
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --volumes
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --networks
docker info --format 'root={{.DockerRootDir}} arch={{.Architecture}} driver={{.Driver}}'
docker system df
docker image ls --no-trunc socialflow-api
docker image ls --no-trunc socialflow-web
docker inspect --format '{{.Name}} image={{.Config.Image}} id={{.Image}} state={{.State.Status}} stop={{.Config.StopSignal}} grace={{json .Config.StopTimeout}}' socialflow-api socialflow-web
docker inspect --format '{{.Name}}{{range .Mounts}} type={{.Type}} source={{.Source}} target={{.Destination}} rw={{.RW}}{{end}}' socialflow-api
docker top socialflow-api -eo pid,ppid,comm
```

Operador deve inspecionar **localmente** os quatro arquivos de build/proxy e fornecer somente trechos sanitizados: context/Dockerfile/estágios/COPY/CMD/ENTRYPOINT, ignores, locations e headers do proxy; serviços api/web, portas, volumes, redes, command/entrypoint, grace e nomes de env_files, sem valores de ambiente. Não usar `docker compose config` sem filtros para compartilhar resultados.

`docker top` identifica a árvore, mas **não prova encaminhamento ou drenagem**. Também não usar PID do host diretamente como PID interno do container. Se npm/shell não entregar sinais ao Node, interromper o roteiro: um procedimento específico e validado de shutdown da imagem atual será necessário, sem TERM/KILL às cegas, pausa de banco ou retry de publicações.

## 9. Preparar contextos e imagens — somente após os gates

Preferência: build local no CachyOS e transferência manual de imagens prontas se houver Docker autorizado, arquitetura compatível e receita revisada. Como não há Docker/Podman aqui, não foi instalado nem prometido build local. Alternativa futura: build pelo operador no Debian, **em staging**, sem usar o diretório de produção como contexto amplo.

Após o novo commit autorizado, montar contexto imutável a partir dele. Exemplo **local**, sem deploy e sem incluir arquivos não commitados:

```bash
RELEASE_SHA='<SHA_COMPLETO_DO_NOVO_COMMIT_APROVADO>'
git cat-file -e "$RELEASE_SHA^{commit}"
RELEASE_CONTEXT=$(mktemp -d /tmp/socialflow-release-context-XXXXXX)
git archive --format=tar "$RELEASE_SHA" package.json package-lock.json tsconfig.app.json tsconfig.server.json vite.config.ts index.html src shared server/src public | tar -xf - -C "$RELEASE_CONTEXT"
```

**Não executar enquanto o SHA for placeholder.** Inspecionar o contexto. Adicionar somente cópias revisadas dos Dockerfiles, `.dockerignore` e `deploy/nginx.conf`; registrar SHA-256 desses arquivos externos ao Git. O contexto acima não inclui `data/`, `.env`, TCC, banco, experimentos ou checkpoints. Testes do frontend podem ser excluídos do contexto final por `.dockerignore`, sem alterar fontes.

Na `.dockerignore` efetiva incluir ao menos:

```dockerignore
.git
.superpowers
.agents
.codex
node_modules
dist
dist-server
/data/
.env*
**/.env*
tools
docs
server/test
server/experiments
src/test
**/*.test.*
**/*.integration.*
*.log
**/*.log
*.zip
**/*.zip
*.sql
**/*.sql
```

Não ignorar todas as imagens PNG do projeto: pode haver assets legítimos. Excluir o diretório de capturas, não tipos gráficos usados pela aplicação. Conferir também arquivos `Dockerfile.api.dockerignore`/`Dockerfile.web.dockerignore`: eles podem prevalecer sobre a `.dockerignore` raiz, conforme [Docker — contexto](https://docs.docker.com/build/concepts/context/#dockerignore-files).

A exclusão `/data/` é somente do diretório operacional na raiz do contexto; preservar `src/data/`, que contém serviços/repositories necessários. A revisão independente identificou a regra ampla anterior como impeditiva; a regressão offline de padrões reproduziu a exclusão indevida e passou após a correção (cinco fontes preservadas, sete exemplos não produtivos excluídos). Esse teste usa o subconjunto comum de padrões ancorados/wildcards, não substitui a validação Docker/BuildKit ainda pendente.

Ajustes mínimos da **receita existente**, não substituição cega de Dockerfile:

- API: manter dependências/OS/arquitetura/UID compatíveis, compilar `dist-server` e copiar apenas runtime/dependências de produção. `STOPSIGNAL SIGTERM` e **`CMD ["node", "dist-server/server/src/index.js"]`**, sem npm/shell pai. Revisar overrides Compose que possam desfazer isso. Ambiente deve ser injetado pelo mecanismo produtivo existente, nunca por `.env` copiado na imagem. Exec form permite tratamento direto de sinais; ver [Docker — JSON args](https://docs.docker.com/reference/build-checks/json-args-recommended/).
- Web: builder HTTP obrigatório com `VITE_POSTS_REPOSITORY=http`, `VITE_API_URL` público aprovado e base `/`; estágio Nginx copia somente `dist` e configuração revisada. Sem ferramentas/capturas/testes no runtime.
- Etiquetar ambas com `socialflow-api:7a-<NOVO_SHA_CURTO>` / `socialflow-web:7a-<NOVO_SHA_CURTO>` e revision OCI do SHA completo. Preservar tags/IDs 5ed e e44, não sobrescrevê-las. Hash do contexto não substitui revisão da receita.

Exemplo de build **condicionado aos ARGs reais dos Dockerfiles**, executado pelo operador no ambiente de build aprovado:

```bash
docker build -f Dockerfile.api --label "org.opencontainers.image.revision=$RELEASE_SHA" -t "socialflow-api:7a-$RELEASE_SHORT" "$RELEASE_CONTEXT"
docker build -f Dockerfile.web --label "org.opencontainers.image.revision=$RELEASE_SHA" --build-arg VITE_POSTS_REPOSITORY=http --build-arg "VITE_API_URL=$PUBLIC_API_URL" -t "socialflow-web:7a-$RELEASE_SHORT" "$RELEASE_CONTEXT"
```

Derivar `RELEASE_SHORT` de `RELEASE_SHA` somente depois de validá-lo; definir `PUBLIC_API_URL` com o valor público aprovado. Os Dockerfiles precisam declarar e usar esses ARGs; os comandos não comprovam isso. Fixar bases oficiais por digest em receita aprovada. Se build ocorrer fora do Debian, `docker save` somente as duas tags novas, produzir checksum SHA-256 e realizar transferência manual; nenhuma transferência pela conta restrita. Importar/verificar IDs antes de trocar serviços.

## 10. Nginx: Insights não pode cair no fallback SPA

Backend recebe `/insights/facebook/...` e `/insights/instagram/...`. Se o frontend usa raiz, são necessários os dois matches abaixo; **fragmento a adaptar no arquivo real**, sem substituir outros locations ou headers:

```nginx
location = /insights {
    proxy_pass http://api:3001;
    proxy_cache off;
    proxy_intercept_errors off;
}
location ^~ /insights/ {
    proxy_pass http://api:3001;
    proxy_cache off;
    proxy_intercept_errors off;
}
```

`api:3001` depende do alias/rede Compose efetivos. Reutilizar os headers e política do proxy API existente; não inventar Origin, não reescrever cookies, não desabilitar CORS. `proxy_pass` sem URI preserva o caminho. Se a URL pública usa `/api`, o location `/api/` existente deve remover somente esse prefixo e encaminhar `/insights/...` à API. Não combinar variantes sem conferir a configuração. A semântica de URI está em [Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

Conferir também `/auth`, `/social-accounts`, `/posts`, `/media-assets`, `/meta-media` e `/health` existentes, limites de upload e assinaturas de mídia. Manter 401/404/429/503 JSON e `Cache-Control: no-store`, não converter para index.html/HTTP 200. Não ativar API Meta Insights ao corrigir o proxy.

## 11. Scheduler, grace e override futuro

`server/src/index.ts` recebe SIGINT/SIGTERM, interrompe admissões do scheduler, fecha HTTP e aguarda `whenIdle()` antes de encerrar o pool. O deadline interno é **330.000 ms**, inclusive uploads/checkpoints pendentes. Esse código foi preservado; `publicationScheduler.stop()`/`whenIdle()` têm regressão unitária nova.

Proposta de fragmento `compose.release.yaml`, **para o operador preparar futuramente após revisão da mesclagem**:

```yaml
services:
  api:
    image: socialflow-api:7a-<NOVO_SHA_CURTO>
    command: ["node", "dist-server/server/src/index.js"]
    stop_signal: SIGTERM
    stop_grace_period: 7m
  web:
    image: socialflow-web:7a-<NOVO_SHA_CURTO>
```

Não altera redes/portas/volumes/env_files. Não presumir que `entrypoint` existente seja compatível: é gate prévio. Não usar `init: true` como substituto de encaminhamento comprovado ao Node. O [grace do Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period) antecede o eventual SIGKILL; aumentar grace não demonstra drenagem, nem corrige a imagem npm atual.

**Atenção:** iniciar a API inicia também o scheduler existente, que pode processar posts já autorizados e vencidos. Não iniciar duas APIs/schedulers para “testar a imagem”, não repetir publicações e não consultar a Meta como smoke test. Se for necessário manter o scheduler pausado após iniciar HTTP, não há flag operacional nova criada nesta tarefa: planejar janela ou solicitar solução específica, sem improvisar.

## 12. Sequência futura de atualização — NÃO EXECUTADA

Somente operador autorizado, depois de resolver os gates, revisar o commit/receitas/IDs, aceitar a dispensa de backup, confirmar volume/chaves e comprovar shutdown da API antiga. Exemplos assumem que `compose.release.yaml` já foi criado com as tags aprovadas e que a versão Compose suporta as opções. Não executar comandos em bloco antes dessas condições.

```bash
cd /home/servercasa/apps/socialflow
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml -f compose.release.yaml config --quiet
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml -f compose.release.yaml config --images
```

O operador compara a mesclagem sanitizada com a configuração anterior: mesmo mount/media, portas, redes, secrets, env_files e demais serviços; mudam apenas as duas imagens e o comando/grace aprovados. `config --quiet` valida sintaxe, não essa equivalência nem a ausência de vazamentos; ver [Compose config](https://docs.docker.com/reference/cli/docker/compose/config/).

**Só com a entrega de sinal já comprovada e janela de manutenção coordenada:**

```bash
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml stop --timeout 420 api
docker inspect --format '{{.Name}} state={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' socialflow-api
```

**Gate após stop:** esperar saída limpa/drenagem confirmada. Se timeout, SIGKILL, exit não zero, dúvida sobre operações ou reinício inesperado, não continuar e não fazer rollback automático. Inspecionar apenas eventos sanitizados/checkpoints com autorização específica. Não pressupor ausência de publicação em voo a partir de CPU baixa, tempo decorrido ou frontend parado.

Depois do gate, atualizar/iniciar **somente API** e preparar web **sem iniciá-lo**:

```bash
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml -f compose.release.yaml up -d --no-deps --no-build --pull never api
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml -f compose.release.yaml up --no-start --no-deps --no-build --pull never web
docker inspect --format '{{.Name}} image={{.Config.Image}} id={{.Image}} state={{.State.Status}}' socialflow-api socialflow-web
```

`--no-deps` não toca PostgreSQL/pgAdmin/Deluge/AdGuard; não usar `down`, prune, remoção de volumes/orphans. `up` pode recriar o serviço nomeado e não significa validar sua saúde; ver [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/). O frontend continua sem servidor iniciado; o operador deve confirmar esse estado.

Health interno API (um GET de saúde, sem publicação):

```bash
docker exec socialflow-api node --input-type=module -e 'const r=await fetch("http://127.0.0.1:3001/health",{signal:AbortSignal.timeout(2000),redirect:"error"});if(r.status!==200||(await r.json()).status!=="ok")process.exit(1);console.log("API health OK")'
```

Não confirmar “produção validada” só com health. Login, Workspace, histórico e agendamentos exigem inspeção funcional posterior autorizada. Meta Insights deve continuar bloqueado em consultas elegíveis; sem sessão é esperado 401, não necessariamente 503. Não enviar tokens/cookies pelo chat.

**Somente após autorização separada para iniciar/disponibilizar o frontend**:

```bash
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml -f compose.release.yaml up -d --no-deps --no-build --pull never web
```

Então validar HTTP local no endereço/porta efetivos, sem seguir redirects, com deadline; 200 de index.html, assets corretos, API JSON, login/Workspace, posts/agendamentos, composer, TikTok sem backend e sino. Não criar posts reais para teste. A porta histórica 8080 precisa ser reconfirmada, não assumida. Manter eventual túnel/proxy público fechado conforme decisão do usuário.

## 13. Rollback e prontidão

Preservar configuração anterior e IDs/digests **das imagens em execução agora**, incluindo `7a-5ed06d8`, além das tags antigas e44 se existirem. Não supor que rollback significa necessariamente e44. Em falha, primeiro avaliar operações processadas pela API nova e executar seu shutdown coordenado. Reverter as duas imagens/configuração para o par anterior aprovado, sem restaurar banco/volumes e sem iniciar web que antes estava parado. Nenhum rollback automático foi implementado.

**Pronto para revisão do commit visual adicional, não para deploy imediato.** Gates impeditivos restantes: autorização Git e SHA novo; receitas/Compose/Nginx reais; configuração pública; volume/UID/chaves; IDs de rollback; Docker Root Dir/capacidade; sinalização/drain da API npm atual; grace efetivo e autorização para disponibilização do web. Dispensa de backup adicional está registrada como risco humano aceito, não como proteção comprovada.

Revisão independente do pacote: nenhum Critical nem defeito funcional confirmado no frontend; um Important documental na exclusão de contexto, corrigido com regressão RED → GREEN. Nenhum Minor. O revisor conferiu diffs, testes/manifestos e limites do roteiro, sem executar testes ou acessar o Debian. Não certifica configuração remota, imagens, aparelhos/codecs/WCAG ou operação real da Meta. Após a correção documental, TypeScript/lint/build/testes da aplicação não precisaram de nova execução: seus arquivos e configurações não mudaram; reexecutados regressão afetada, hashes/manifesto e diff-check.

Depois de commit/push aprovados e deploy manual comprovado, a próxima tarefa funcional será o piloto real Meta Insights separado e autorizado para Facebook/Instagram. Esta preparação não habilita transporte, grants ou código experimental; TikTok permanece somente frontend.
