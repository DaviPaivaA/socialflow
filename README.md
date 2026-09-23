# SocialFlow TCC

Protótipo de uma plataforma de gestão, planejamento, agendamento e análise de
conteúdo para redes sociais. O projeto foi preparado para publicação gratuita
no GitHub Pages.

## Funcionalidades demonstradas

- painel com indicadores de desempenho;
- calendário editorial semanal;
- criação e agendamento de publicações em memória ou PostgreSQL local;
- cadastro, login e logout com sessão persistida no PostgreSQL;
- listagem e troca explícita de Workspace para usuários com múltiplos memberships;
- isolamento de publicações pelo tenant autenticado;
- filtros por status;
- gráficos e métricas;
- contas sociais persistidas e isoladas por Workspace;
- configurações e automações simuladas;
- layout responsivo para computador e celular.

## Executar no computador

É necessário usar Node.js 22.22.0 ou superior dentro da série 22, ou Node.js 24
ou superior. A série 23 não é suportada. Para o modo HTTP, também é necessário
ter um servidor PostgreSQL disponível.
ou superior. A série 23 não é suportada.

```bash
npm install
cp -n .env.example .env
```

Os valores de `.env.example` são apenas exemplos. Ajuste `DATABASE_URL` e
`TEST_DATABASE_URL` para usuários, senhas, hosts e bancos locais válidos. Crie
os bancos uma única vez, sem remover bancos existentes:

Se o `.env` veio da Etapa 3, remova `CURRENT_TENANT_ID` e
`CURRENT_AUTHOR_USER_ID`, que não são mais usados, adicione as variáveis
`SESSION_*` de `.env.example` e altere `VITE_API_URL` para
`http://localhost:3001`. Para as integrações sociais, gere também uma chave
exclusiva para criptografar credenciais:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Copie o resultado para `SOCIAL_TOKEN_ENCRYPTION_KEY` no `.env`. O valor de
exemplo não é apropriado para dados reais.

```bash
createdb -h 127.0.0.1 -U postgres socialflow
createdb -h 127.0.0.1 -U postgres socialflow_test
```

Se o administrador local não for `postgres`, use no comando o mesmo usuário
configurado nas URLs do arquivo `.env`.

O banco de teste deve ser exclusivo e seu nome precisa terminar em `_test`.
Depois, aplique as migrations versionadas:

```bash
npm run db:migrate
```

Inicie backend e frontend em terminais separados:

```bash
npm run dev:server
```

```bash
npm run dev
```

Abra `http://localhost:5173`, acesse `#/register` e crie a primeira conta. O
cadastro cria usuário, tenant, membership `owner` e sessão na mesma transação.
Com `VITE_POSTS_REPOSITORY=http`, a interface usa o backend em `VITE_API_URL`;
após criar uma publicação, recarregar a página recupera a sessão e faz uma nova
leitura autenticada de `GET /posts` no PostgreSQL.

## Executar o backend compilado

No Debian de produção, configure `NODE_ENV=production`, uma `CORS_ORIGIN`
explícita, `SESSION_COOKIE_SECURE=true` e os demais valores reais no ambiente.
Depois execute:

```bash
npm run db:migrate
npm run build
npm run start:server
```

`start:server` executa o JavaScript compilado em
`dist-server/server/src/index.js`. `HOST` e `PORT` controlam o endereço de
escuta sem alterar o código. O padrão `HOST=127.0.0.1` é apropriado quando o
reverse proxy está no mesmo servidor; use `HOST=0.0.0.0` quando o proxy estiver
em outro namespace de rede, mantendo a porta protegida por firewall/rede
privada. Se OAuth Meta estiver habilitado, `SESSION_COOKIE_SAME_SITE=strict` é
rejeitado no startup porque impediria o cookie de chegar ao callback externo.

Em deploy atrás de Caddy, Nginx ou outro proxy confiável, configure
`TRUST_PROXY=true` somente quando o backend não estiver acessível diretamente e
o proxy substituir/sanitizar `X-Forwarded-For`. Nesse modo, o primeiro IP válido
encaminhado identifica o bucket de rate limit; com `TRUST_PROXY=false` (padrão),
o header é ignorado e vale o endereço do socket. Para Cloudflare, mantenha o
backend protegido atrás de um proxy/gateway que valide a origem Cloudflare e
converta o IP validado para um `X-Forwarded-For` sanitizado; não exponha o
backend aceitando headers fornecidos diretamente pela internet.

## Camada de dados

O frontend mantém dois modos. `VITE_POSTS_REPOSITORY=mock` usa
`MockPostsRepository`, mantém as publicações apenas em memória e não faz
requisições externas. Nesse modo, `/canais` também usa um
`MockSocialAccountsRepository` isolado. `VITE_POSTS_REPOSITORY=http` usa
`HttpPostsRepository` e `HttpSocialAccountsRepository` com a API local; a tela
`/canais` deixa de consultar fixtures diretamente.

As variáveis relevantes para o frontend são:

```bash
VITE_POSTS_REPOSITORY=http
VITE_API_URL=http://localhost:3001
```

No build de produção, `VITE_POSTS_REPOSITORY=http` é obrigatório: a aplicação
não usa o modo mock como fallback quando a configuração está ausente. O modo
mock permanece disponível para desenvolvimento e testes. Métricas de Analytics
ainda não têm backend; a interface mostra estado indisponível em vez de valores
simulados.

O backend usa `DATABASE_URL`, aceita `HOST` e `PORT` e libera, com credenciais,
somente a origem exata definida em `CORS_ORIGIN`. No desenvolvimento, mantenha
frontend e API usando o mesmo hostname (`localhost` nos exemplos) para que o
cookie `SameSite=Lax` permaneça first-party. A API oferece:

- `GET /health`, que também verifica a conexão com o banco;
- `POST /auth/register`, que cria usuário, tenant, membership e sessão;
- `POST /auth/login`, que autentica email e senha;
- `GET /auth/me`, que retorna apenas usuário e tenant seguros;
- `GET /auth/workspaces`, que lista somente os memberships do usuário atual;
- `POST /auth/workspaces/select`, que valida o membership e rotaciona a sessão;
- `POST /auth/logout`, que revoga a sessão;
- `POST /auth/meta/start`, que cria um state vinculado à sessão e retorna a URL
  de autorização Meta;
- `GET /auth/meta/callback`, que consome o state e conclui a descoberta no
  backend;
- `GET /posts`, que lista os posts do tenant autenticado;
- `POST /posts`, que persiste com tenant e autor autenticados.
- `GET /social-accounts`, que lista as contas do Workspace autenticado;
- `GET /social-accounts/:id`, que consulta uma conta no mesmo Workspace;
- `PATCH /social-accounts/:id`, que altera apenas nome, username e imagem;
- `DELETE /social-accounts/:id`, que revoga a conta e apaga suas credenciais.
- `POST /media-assets`, upload autenticado de um arquivo no campo multipart
  `file` (resposta `201` com metadados seguros);
- `GET /media-assets` e `GET /media-assets/:id`, leitura dos metadados somente
  do Workspace autenticado.

### Mídia local — Etapa 6A

Configure `MEDIA_STORAGE_PATH` para um diretório persistente e gravável pela
API. Em desenvolvimento o padrão é `./data/media` (ignorado pelo Git); em
produção a variável é obrigatória. O backend cria e testa o diretório antes de
escutar conexões. Os limites padrão são `MEDIA_MAX_IMAGE_BYTES=26214400` (25 MiB)
e `MEDIA_MAX_VIDEO_BYTES=262144000` (250 MiB), ajustáveis no ambiente. Aceitos:
JPEG, PNG e WebP; MP4 e QuickTime/MOV. A API confirma a assinatura do arquivo
e exige que ela corresponda ao MIME declarado. O upload usa streaming para
arquivo temporário, calcula SHA-256, move o arquivo para
`<MEDIA_STORAGE_PATH>/<tenant UUID>/<media UUID>.<extensão>` e só então grava os
metadados em `media_assets`. Se o INSERT falhar, a API tenta remover o arquivo
movido. O nome original é apenas metadado sanitizado; não define o caminho.
`GET` nunca expõe `storage_key`, SHA-256 ou caminhos internos. Não há URL de
conteúdo/pública nesta etapa; mídia ainda não é vinculada ao Post e não é
publicada na Meta.

No futuro deploy Docker, use por exemplo `MEDIA_STORAGE_PATH=/app/data/media`
na API e um bind mount persistente como `./data/media:/app/data/media` para
backup; não monte o diretório como raiz estática pública. No Nginx, a rota
`/media-assets` precisará aceitar corpos acima de 250 MiB mais o overhead
multipart (`client_max_body_size`, por exemplo 251m) e, para preservar o
streaming até a API, `proxy_request_buffering off`. Ajuste esses parâmetros
na configuração existente do proxy, preservando os headers e regras atuais.

`GET /posts` e `POST /posts` retornam `401` sem sessão válida. `tenantId` e
`authorUserId` nunca são aceitos como autoridade do cliente: são derivados do
membership guardado na sessão e novamente validados pela store.

## Autenticação e sessão

Senhas são transformadas com Argon2id pelo pacote `argon2`; somente o PHC hash
é armazenado em `users.password_hash`. O cookie contém um token aleatório opaco
de 256 bits. O PostgreSQL armazena somente seu SHA-256 em `auth_sessions`, ligado
a `tenant_members.id`. O cookie usa `HttpOnly`, `Path=/`, `SameSite` configurável
e expira por padrão em 168 horas. Logout apaga a linha da sessão e expira o
cookie.

Variáveis de sessão:

```bash
SESSION_TTL_HOURS=168
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAME_SITE=lax
AUTH_RATE_LIMIT_MAX_ATTEMPTS=10
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
```

Em `NODE_ENV=production`, `SESSION_COOKIE_SECURE=false` é rejeitado. Use HTTPS e
`SESSION_COOKIE_SECURE=true`. Deploys realmente cross-site podem usar
`SESSION_COOKIE_SAME_SITE=none`, opção que também exige cookie Secure. Nenhum
segredo de sessão é necessário: tokens têm alta entropia, são armazenados apenas
como hash e podem ser revogados individualmente.

Todas as operações HTTP que alteram estado exigem o header `Origin` exatamente
igual a `CORS_ORIGIN`. Essa validação é aplicada no servidor, além dos headers de
CORS, e protege também a configuração cross-site com `SameSite=None`. O
navegador envia esse header automaticamente; chamadas manuais devem incluir, por
exemplo, `Origin: http://localhost:5173`.

Login e cadastro usam um rate limiter em memória, separado por rota e endereço
do cliente, configurado pelas variáveis `AUTH_RATE_LIMIT_*` e `TRUST_PROXY`. A
implementação é adequada ao backend single-process deste MVP, mas não compartilha contadores
entre réplicas; um deploy horizontal futuro deverá substituir essa abstração por
um armazenamento distribuído ou limitação no gateway. O backend também remove
sessões expiradas oportunisticamente durante autenticação e sempre rejeita
`expires_at <= now()`.

Para um usuário com múltiplos tenants, o MVP seleciona deterministicamente o
membership mais antigo, usando o UUID como desempate, e grava essa escolha na
sessão no login. Depois disso, o seletor de Workspace lista os memberships em
ordem de `tenant_members.created_at` e UUID e permite uma escolha explícita. O
backend resolve o membership pelo usuário autenticado; o `tenantId` enviado é
somente uma intenção, nunca contexto de autorização.

Uma troca válida cria um token opaco novo, persiste sua sessão com o novo
`membership_id` e revoga a sessão anterior na mesma transação. O frontend só
confirma a troca depois da resposta do servidor, desmonta o estado de posts do
Workspace anterior e faz uma nova listagem identificada pelo tenant atual. Não
há cache permanente nem preferência de “último Workspace” nesta etapa. Trocas e
logout são sincronizados entre abas por `BroadcastChannel`, com fallback para
eventos de storage contendo somente o tipo do evento — sessão e tokens nunca
são gravados no storage nem transmitidos entre abas.

Tanto a criação quanto os itens retornados pela API usam `scheduledFor` como a
única fonte do agendamento. O valor deve ser um timestamp ISO 8601 com fuso
explícito (`Z` ou `±HH:MM`); datas sem ano, rótulos como `"13 ago"` e horários
sem fuso não são aceitos.

Neste MVP, a data e o horário escolhidos no formulário são interpretados no
fuso local do navegador. O instante correspondente é convertido corretamente
para UTC antes do `POST`. Por exemplo, a seleção de 13/08/2026 às 10:00 em um
navegador no fuso UTC-03 gera:

```json
{
  "title": "Nova publicação",
  "caption": "Conteúdo programado.",
  "scheduledFor": "2026-08-13T13:00:00.000Z",
  "status": "scheduled"
}
```

O `POST /posts` associa `tenantId` e `authorUserId` exclusivamente a partir da
sessão validada no servidor. A resposta e cada item de `GET /posts` usam o
contrato abaixo:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "tenantId": "11111111-1111-4111-8111-111111111111",
  "authorUserId": "22222222-2222-4222-8222-222222222222",
  "ragRunId": null,
  "title": "Nova publicação",
  "caption": "Conteúdo programado.",
  "status": "scheduled",
  "scheduledFor": "2026-08-13T13:00:00.000Z",
  "publishedAt": null,
  "createdAt": "2026-08-10T12:00:00.000Z",
  "updatedAt": "2026-08-10T12:00:00.000Z"
}
```

Todos os identificadores persistidos são UUID. Data e horário abreviados são
derivados de `scheduledFor` somente na interface; o PostgreSQL armazena o
instante em `scheduled_for timestamptz`. `channels` e `color` não pertencem ao
contrato persistente de `Post`: a cor é derivada do status na apresentação, e
os futuros destinos sociais serão modelados por `post_targets` e
`social_accounts`.

## Contas sociais (Etapa 5A)

O modelo oficial separa três responsabilidades: `social_accounts` contém o
perfil social, `oauth_connections` contém o contexto/status da autorização e
`social_account_credentials` contém a credencial específica da conta. Instagram
e Facebook usam a plataforma técnica `meta`; o tipo da conta distingue
`instagram_business` e `facebook_page`. TikTok usa `tiktok_account`. Os DTOs
públicos traduzem esses valores para `instagram`, `facebook` e `tiktok`.

Cada uma dessas entidades pertence ao mesmo `tenant_id`; listagem, consulta,
alteração e desconexão derivam esse tenant exclusivamente da sessão. Um UUID de
outro Workspace recebe a mesma resposta `404` de um recurso inexistente. A API
não aceita `tenantId`, usuário criador, provider, status ou credenciais nos
endpoints públicos de alteração. O registro controlado continua disponível
somente no service para fixtures e testes. Em uso HTTP, contas Meta são criadas
apenas pelo callback OAuth server-side; não existe endpoint público que aceite
token ou finja uma conexão.

O contrato público usa `pending`, `connected`, `expired`, `revoked` e `error`.
No enum oficial do banco, `connected` é persistido como `active`; os demais
valores mantêm o mesmo significado. Desconectar é um soft-delete: define `revoked`, preenche
`disconnected_at` e limpa imediatamente access/refresh tokens, mantendo os
metadados não sensíveis para histórico. A UI pode exibir esse registro como
revogado. Não há refresh automático de tokens nesta etapa.

A unicidade é garantida por
`tenant_id + provider + provider_account_id`. O mesmo identificador externo
pode existir em Workspaces diferentes: essa escolha atende ao cenário de
agências e mantém o isolamento no tenant; uma regra global dependeria de uma
decisão de produto futura. `tenant_id` usa `ON DELETE CASCADE`, pois a conta é
um ativo do Workspace. `created_by_user_id` usa `ON DELETE SET NULL`, para a
saída de um usuário não apagar a conta compartilhada.

Access e refresh tokens são cifrados antes de chegarem ao repository com
AES-256-GCM. O schema oficial possui ciphertext de conexão e de conta para
suportar futuramente tokens com escopos distintos; o mecanismo interno desta
etapa persiste somente payloads cifrados nesses campos. O formato é versionado como
`v1.<nonce>.<authentication-tag>.<ciphertext>`, com as partes binárias em
Base64 URL-safe. Somente a chave Base64 de 32 bytes de
`SOCIAL_TOKEN_ENCRYPTION_KEY` permite a decriptação; ausência ou formato
incorreto impede o backend de iniciar. Nenhum DTO público seleciona ou retorna
ciphertext, nonce, tag, token ou `provider_metadata`.

`provider_metadata` é um objeto JSONB restrito pelo service a dicas não
secretas (`accountType`, `businessAccountId`, `pageId`, `category` e `locale`),
com limites de tamanho. Tokens e credenciais não pertencem a esse campo.
`scopes` é um array limitado. Para Meta, ele contém somente permissões que a
Graph API informou como efetivamente concedidas; o fluxo TikTok futuro seguirá
o mesmo contrato.

No modo HTTP, “Conectar Facebook / Instagram” inicia o OAuth Meta quando ele
está habilitado no backend. TikTok permanece desabilitado como “Em breve”. No
modo mock, nenhum OAuth externo é iniciado. Contas controladas para
desenvolvimento e testes são inseridas diretamente pelo service/repository,
nunca por um endpoint público de criação.

Na gestão de Canais, contas conectadas podem ser desconectadas. Contas Meta
`expired`, `revoked` ou `error` reutilizam o OAuth existente para reconexão;
`pending` não inicia OAuth automaticamente e TikTok continua sem OAuth. A API
calcula `expired` quando `tokenExpiresAt` da credencial é igual ou anterior ao
instante atual; expiração ausente não é presumida. A desconexão apaga os tokens
da conta e só revoga a autorização compartilhada quando não há outra conta
ativa. Não há polling da Meta nem renovação automática de tokens nesta etapa.

## OAuth Meta (Etapa 5B.1)

A integração usa **Instagram API with Facebook Login** e a Graph API
versionada, com `v26.0` como padrão configurável. Ela importa todas as Facebook
Pages devolvidas por `/me/accounts` para a autorização efetivamente concedida e
cria uma conta `instagram_business` quando a Page possui um Instagram
Professional compatível vinculado. Contas Instagram pessoais/consumer não são
suportadas por esse fluxo.

Configure apenas no ambiente do backend:

```bash
META_OAUTH_ENABLED=true
META_APP_ID=123456789012345
META_APP_SECRET=substitua-pelo-app-secret-real
META_GRAPH_API_VERSION=v26.0
META_OAUTH_REDIRECT_URI=http://localhost:3001/auth/meta/callback
OAUTH_STATE_TTL_SECONDS=600
```

`META_APP_ID`, `META_APP_SECRET` e `META_OAUTH_REDIRECT_URI` devem ser
configurados juntos. Se `META_OAUTH_ENABLED=false`, o backend inicia normalmente
e o endpoint de início informa que a integração não está disponível. Se for
`true`, configuração incompleta interrompe o startup. O App Secret nunca usa
prefixo `VITE_` e não deve ser exposto ao frontend ou versionado.

No painel Meta, cadastre **exatamente** este URI de redirecionamento para o
ambiente local:

```text
http://localhost:3001/auth/meta/callback
```

O frontend local permanece em `http://localhost:5173`, que também deve ser o
`CORS_ORIGIN`. O callback sempre volta para o destino fixo
`http://localhost:5173/#/canais`; o cliente não fornece `returnUrl`.

A autorização solicita somente:

- `pages_show_list`;
- `pages_read_engagement`;
- `instagram_basic`.

`pages_manage_posts` e `instagram_content_publish` serão avaliadas somente na
Etapa 6. Permissões de insights/Analytics ficam para a Etapa 7. O backend
consulta `/me/permissions` e não assume que tudo foi concedido. Sem
`pages_show_list`, a conexão falha; sem as permissões necessárias ao Instagram,
as Facebook Pages válidas ainda podem ser importadas, mas o perfil Instagram é
omitido.

O fluxo é: `POST /auth/meta/start` autenticado gera 32 bytes aleatórios, entrega
o state real somente ao navegador e persiste apenas seu SHA-256. O pedido fica
vinculado à sessão e ao membership atuais, expira por padrão em dez minutos e é
consumido atomicamente uma única vez. Logout, expiração ou rotação da sessão ao
trocar de Workspace remove o pedido por FK e invalida o callback anterior. O
`GET /auth/meta/callback` não exige `Origin`, pois vem de navegação externa; sua
proteção é o state single-use ligado à sessão. As demais mutações continuam
exigindo a origem exata.

O backend troca o code por user access token, realiza o exchange de maior
duração suportado pelo endpoint oficial e consulta `/me`, `/me/permissions` e
`/me/accounts`. A paginação usa somente cursores e reconstrói URLs sob o host
fixo da Graph API, com limites defensivos. Perfis Instagram são consultados pelo
ID vinculado à Page. As requisições têm timeout, Graph host fixo, Bearer token e
`appsecret_proof`; code, state, tokens e mensagens brutas do provider não são
registrados nem retornados na URL final.

User access tokens ficam cifrados em `oauth_connections`; Page access tokens
ficam cifrados em `social_account_credentials` e podem ser cifrados novamente
para o Instagram associado. Todos reutilizam o AES-256-GCM versionado e a mesma
`SOCIAL_TOKEN_ENCRYPTION_KEY` da Etapa 5A. O banco nunca recebe plaintext. A
expiração só é persistida quando fornecida de forma confiável pela Meta; não há
data inventada para Page tokens.

Enquanto o app Meta estiver em **Development Mode**, um teste real só funciona
para contas que sejam administradoras, desenvolvedoras ou testers permitidos no
painel Meta e para Pages/Instagram Professional disponíveis a essas contas. O
SocialFlow não publica o app nem automatiza App Review.

As migrations ficam em `server/migrations`, são aplicadas em ordem e registradas
em `schema_migrations`. Em um banco vazio, toda a cadeia cria o schema oficial.
Em um banco preexistente com `schema_migrations` vazio, o executor só registra o
baseline `001` depois de validar tabelas, todas as colunas relevantes, tipos,
nullable, PKs, FKs, uniques, enums, índices e trigger. Depois aplica as migrations
incrementais que renomeiam `created_by_user_id` para `author_user_id` e
`scheduled_at` para `scheduled_for`, preservando os valores. A migration `004`
cria `auth_sessions` e torna `password_hash` obrigatório apenas quando não há
usuários legados sem senha; caso existam, preserva os registros e deixa a coluna
nullable até um fluxo futuro de ativação de senha. O executor não remove nem
recria bancos ou tabelas. A migration `005_add_social_accounts.sql` reconcilia
ou cria as três tabelas oficiais, constraints, índices e triggers da Etapa 5A,
sem inserir fixtures nem alterar tabelas de identidade. A migration `006` inclui
`pending` no enum em uma transação separada, como exigido pelo PostgreSQL para
uso seguro de um novo valor de enum. A migration
`007_add_oauth_authorization_requests.sql` cria pedidos OAuth provider-neutral,
com state em hash, expiração, consumo e FK composta para a sessão/membership;
ela não insere dados fake. `auth_sessions.membership_id` continua
representando o Workspace ativo. Para aplicar as migrations, execute:

```bash
npm run db:migrate
```

`VITE_API_URL` é incorporada ao bundle e deve conter somente o endereço público
da API, nunca tokens, chaves ou segredos. `DATABASE_URL` também não deve ser
versionada; mantenha credenciais somente no arquivo `.env` local.

## Testes e build

Com `TEST_DATABASE_URL` configurada para o banco exclusivo terminado em
`_test`, execute:

```bash
npm run test
npm run build
```

A integração cria schemas temporários dentro desse banco e testa instalação
nova, baseline preexistente, tipos UUID, enum oficial, FKs, cadastro atômico,
rollback, Argon2id, login, sessão, logout, usuário inativo, seleção de tenant,
isolamento entre dois tenants, criação, listagem e persistência após reiniciar o
servidor. Também valida contas sociais em três Workspaces, segredos cifrados,
unicidade, consulta cross-tenant, revogação e limpeza de credenciais. A cobertura
Meta usa um client controlado sem internet para testar state, replay, callback,
Pages, Instagram Professional, reconexão, criptografia e invalidação após
logout/troca de Workspace. Ela remove somente esses schemas próprios ao
terminar. Para executar somente essa
cobertura:

```bash
npm run test:integration
```

Sem `TEST_DATABASE_URL`, os testes do frontend e do contrato do backend rodam
normalmente e a integração PostgreSQL é explicitamente marcada como ignorada.

## Pendências conhecidas

- Ao manter o painel aberto durante a virada do dia, o rótulo relativo da
  próxima publicação ainda não é reavaliado à meia-noite local e pode demorar a
  mudar para “Hoje”.
- Em fusos com mudança de horário de verão, um horário local inexistente durante
  o salto do relógio ainda não apresenta uma mensagem de validação explícita no
  Composer.
