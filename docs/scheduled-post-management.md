# Gerenciamento seguro de agendamentos

Este documento descreve os contratos implementados na branch de gerenciamento
de agendamentos sobre a Etapa 6E. Não é autorização de deploy: na preparação
do Task 9, os gates finais e a revisão independente da branch ainda estão
pendentes. Consulte o [handoff](../HANDOFF.md) para o checkpoint de execução.

## Rotas e permissões

Na interface, `#/publicacoes` lista publicações e
`#/publicacoes/:postId` abre o detalhe, inclusive por recarga direta. O menu
oferece detalhes e, para agendamentos autorizados, edição e cancelamento.
Agenda e próximo agendamento usam o mesmo conjunto de posts do Workspace.

| HTTP | Sucesso | Contrato |
| --- | --- | --- |
| `GET /posts` | 200 | Array de posts do Workspace, sem `cancelled` |
| `POST /posts` | 201 | Criação 6E preservada; `{ post, publications }` |
| `GET /posts/:id` | 200 | `{ post, publications, permissions }`, inclusive cancelados |
| `PATCH /posts/:id` | 200 | Mesmo detalhe, após edição transacional |
| `DELETE /posts/:id` | 204, sem corpo | Cancelamento lógico persistente |

`permissions` contém `canEditSchedule` e `canCancelSchedule`. São indicações
do snapshot de leitura, não uma reserva de permissão futura. Detalhe e
permissões são lidos numa transação read-only de snapshot consistente.
GET/PATCH/DELETE individuais usam `Cache-Control: no-store`.

Todos os papéis autenticados veem os posts do próprio Workspace. `owner` e
`admin` gerenciam seus agendamentos e os de outros autores; `member` gerencia
somente os próprios. Autoria não identificável não concede autoridade a member.
O schema continua exigindo autor UUID não nulo; não foi flexibilizado.

Tenant, usuário, sessão, membership e papel vêm do servidor. As mutações
revalidam a sessão, usuário ativo e membership/papel dentro da transação,
protegendo suas linhas contra alteração concorrente. A sessão é revalidada
com o relógio atual após esperas de locks. O ator administrativo nunca
substitui `author_user_id`; o publisher continua revalidando o autor original.

Outro tenant e ID inexistente retornam o mesmo `404 post_not_found`, antes
da comparação de autoria. Falta de privilégio no próprio tenant retorna
`403 post_forbidden`; sessão/membership inválidos, `401 unauthorized`.
ID malformado retorna `400 invalid_post_id`. Conflitos de estado retornam
`409 post_not_editable` ou `post_not_cancellable`, sem reparação/reenvio.
As mutações exigem Origin exata, preservando CORS/cookie HttpOnly existentes
e limite de JSON de 1 MiB. Erros não expõem SQL ou respostas Graph brutas.

## PATCH parcial e preservação

Somente estes campos podem ser enviados; corpo vazio e campos desconhecidos
(inclusive tenant, autor, papel, status e `publicationMode`) são recusados:

```ts
type UpdateScheduledPostInput = {
  title?: string | null;
  caption?: string;
  scheduledFor?: string;
  socialAccountIds?: string[];
  mediaAssetIds?: string[];
};
```

Campos omitidos preservam os valores persistidos. `title: null` remove título;
string deve ser não vazia e ter até 255 caracteres. Legenda não pode ser vazia:
vale a política 6E do conjunto final de destinos, incluindo 2.200 caracteres
para Instagram, sem impor o teto visual de 500 do Composer a texto antigo.
Não há truncamento silencioso. `scheduledFor` exige timestamp com timezone;
o horário final deve ser estritamente futuro no relógio do banco após locks.
Erro de validação estrutural/data usa `400 invalid_post` com `fields`.

Destinos explícitos exigem ao menos um UUID único e elegível do tenant.
Mídia permite zero ou um UUID único; `mediaAssetIds: []` remove somente a
associação em `post_media`, não o arquivo ou asset. Mídia de qualquer uploader
do mesmo tenant pode ser reutilizada se não estiver soft-deleted. Mídia ausente,
de outro tenant e excluída têm a mesma resposta segura. Destinos indisponíveis
e IDs de outro tenant também não revelam existência. Credenciais, scopes/tasks
e expiração são validados usando linhas protegidas e relógio posterior à espera.

Vale a compatibilidade 6E: Facebook texto ou JPEG/PNG até 4.000.000 bytes;
Instagram exige JPEG até 8.000.000 bytes ou vídeo; destinos mistos com imagem
exigem JPEG até 4.000.000 bytes. MP4/MOV usam Reel, até
`min(MEDIA_MAX_VIDEO_BYTES, 262144000)` bytes. Não há conversão/transcoding,
Stories, carousel ou TikTok. Aceitação de upload não garante publicação.
Consulte também a [documentação 6E no README](../README.md#publicação-meta-e-retomada--etapa-6e).

O estado final combinado é validado, mesmo para campos omitidos. Conta ou mídia
indisponível não desaparece para permitir salvar: a UI pede correção explícita.
O editor preserva texto longo, seleções e precisão do timestamp original quando
a data não muda, envia somente campos alterados e não oferece publicar agora.
Fechar formulário não apaga mídia já enviada à biblioteca nem desfaz PATCH enviado.
Em conflito, mantém rascunho visual e orienta consultar detalhes; não reenvia sozinho.

Exceção legada deliberada: post sem nenhuma linha de destino continua visível
e pode ser editado sem inventar destino quando `socialAccountIds` é omitido.
Pode ser cancelado. `socialAccountIds: []` continua inválido, assim como criação
sem destinos; não há backfill ou envio implícito. Mídia ainda é validada.

## Cancelamento, claims e histórico

Somente post `scheduled`, sem `published_at` e nunca iniciado, pode ser editado
ou cancelado. Qualquer destino com tentativa, erro/resultado, provider ID ou
qualquer `publication_operations` (inclusive prepared, terminal ou lease vencido)
bloqueia a mutação. `draft`, `publishing`, `published`, `failed` e
`partially_failed` são somente leitura. Estado contraditório falha de modo seguro.

DELETE muda post e destinos ainda scheduled atomicamente para `cancelled`.
Não depende de credenciais ainda conectadas. Repetição autorizada de cancelamento
consistente retorna 204 sem UPDATE, alteração de timestamps ou chamada externa.
Autorização continua obrigatória na repetição. PATCH não restaura post cancelado.
Cancelados saem da listagem, agenda, contagens, próximo post e busca, mas permanecem
consultáveis por ID. Texto, horário, autoria, mídia e registros históricos são retidos.

A linha do post é a barreira compartilhada entre edição, cancelamento e claim
inicial. Após autorização nas mutações, a ordem é post → destinos em ordem
determinística → operações relacionadas. O scheduler usa `SKIP LOCKED`, transações
curtas por post e limite por destino; relê estado/horário após obter a barreira.
O COMMIT do claim/preparação ocorre antes da chamada Meta. Nenhuma chamada Meta
faz parte das transações de gestão/claim. A coordenação local de aquisições e
agregados evita autocontenção; a autoridade entre processos é PostgreSQL.

| Quem confirma primeiro | Resultado |
| --- | --- |
| Cancelamento | Descoberta antiga não adquire o post; nenhum envio posterior inicia |
| Claim | Edição/cancelamento retorna 409, mesmo antes da chamada externa |
| Edição que adia horário | Scheduler relê data nova e não usa a antiga |
| Duas exclusões autorizadas | Segunda é 204 sem efeito adicional |
| Duas edições | Serializadas, preservando campos omitidos; mesmo campo: última confirmada |

Não se promete recolher chamada Meta já iniciada ou exactly-once externo.
Leases, polling, retomada e `publication_state_unknown` da 6E permanecem.
Claims de posts anteriores já confirmados são devolvidos ao dispatcher se uma
aquisição posterior falhar; apenas a transação corrente é revertida, com
diagnóstico seguro de falha parcial, sem retry ou exposição de SQL/segredos.

Retirar destino cancela sua linha, sem DELETE. Reintroduzi-lo reutiliza seu ID
somente em post ainda elegível e sem tentativa/operação. O agregado desconsidera
apenas destinos retirados comprovadamente intocados; histórico com evidência de
operação não é descartado. Cancelamento explícito é terminal na reconciliação;
post legado sem destinos preserva estado/timestamps em vez de fabricar resultado.

Auditoria aqui é retenção do registro, autor original e resultados/timestamps
existentes. Não há ledger imutável de versões/atores, tela de arquivo histórico,
detecção editorial por versão, retry, restauração de cancelados ou exclusão na rede.
DTOs não incluem tokens/ciphertext, storage keys, hashes, paths, leases, tickets
temporários ou estado privado das operações; nomes vêm de metadados públicos,
com identificação neutra quando indisponíveis, sem URL externa especulativa.

## Controles e roteiro manual de teste

A pesquisa global usa título/legenda dos posts reais já carregados do Workspace,
sem endpoint novo, exclui cancelados e exibe até 20 resultados. Ctrl+K/Cmd+K
abre/foca; setas selecionam, Enter navega e Escape fecha. Ajuda é local;
Notificações mostra vazio verdadeiro, sem badge fictício. Analytics, automações,
TikTok e configurações sem persistência não ganham funções simuladas.
Trocar Workspace limpa contextos/rascunhos; gerações, respostas autoritativas e
tombstones impedem resposta antiga de contaminar o novo contexto ou ressuscitar
cancelados. Listagem estritamente mais nova pode atualizar overlay de edição.

Executar apenas em ambiente/dados de teste autorizados, com Meta fake/injetada:

1. Com owner/admin/member e dois Workspaces, criar agendamento futuro; comparar
   leitura e ações para próprio/outro autor. Testar 401/403/404 sem revelar tenant;
   rebaixar papel/revogar sessão entre abrir e salvar em fixture controlada.
2. Abrir por menu e URL, recarregar detalhe; verificar destinos pendentes,
   publicados, falhos e retirados sem inventar sucesso/links. Atualizar leitura
   manualmente, sem reenviar.
3. Editar título/legenda/data; abrir texto longo com segundos/timezone e salvar
   somente título, conferindo timestamp intacto. Testar horário local inválido,
   agendamento que vence enquanto aguarda lock e erro com rascunho preservado.
4. Remover/reintroduzir destino intocado e conferir mesmo ID e agregado correto.
   Conferir conta desconectada/mídia indisponível visível; substituir mídia,
   remover associação e cancelar upload/formulário sem apagar asset compartilhado.
   Abrir legado vazio e editar sem selecionar destino: nenhuma linha/envio criado.
5. Desistir de cancelar (sem DELETE), depois confirmar; conferir remoção de todos
   os consumidores, detalhe histórico, DELETE repetido sem timestamps novos e
   impossibilidade de restauração. Conferir que cancelamento não exige reconexão.
6. Em fixture PG com barreiras/fake Meta, exercitar ambos os vencedores de
   cancelamento/claim, edição que adia após descoberta, duplo DELETE, rollback,
   post bloqueado versus outro progredindo e falha parcial de lote.
7. Atrasar listagem/detalhe/PATCH/DELETE/upload e trocar A→B→A; conferir ausência
   de vazamento, ressurreição ou perda de novo rascunho, nas duas ordens de retorno.
8. Usar teclado e tela pequena: menu, setas/Home/End, Tab/Escape/foco, diálogo
   com ação de desistência inicial (atualmente “Voltar”), busca com resultados roláveis, Ajuda/Notificações e
   detalhe do próximo post. Smoke físico mobile/leitor de tela ainda é manual.

Limitação conhecida: Shift+Tab no primeiro item pode manter o menu aberto ao
voltar ao botão disparador; foco não fica preso (Minor M1 registrado). O rótulo
do diálogo atual é “Cancelar agendamento?”/“Voltar”, diferente de
“Excluir agendamento?”/“Cancelar” da especificação; divergência textual pendente
de triagem na revisão final, sem alteração de produto nesta documentação. O rótulo
relativo do próximo post à meia-noite e a mensagem de horário inexistente no
Composer de criação são pendências anteriores, não promessas desta entrega.
Smoke Meta real é separado e exige autorização explícita/contas de teste;
suíte fake não comprova permissões, codecs, banda ou operação em produção.

## Verificação e futura atualização manual do Debian

Gates finais devem rodar sequencialmente: `npm run lint`,
`npm run test:frontend`, `npm run test:server`, `npm run test:integration`,
`npm run build`, `npm run test:server -- server/test/publicationRuntime.test.ts`,
importação inerte dos módulos novos no Node 22 suportado e `git diff --check`.
Conferir inventário completo (incluindo não rastreados), ausência de secrets/env/
infra e checksums originais das onze migrations. Código novo invalida gates afetados.
Integração seleciona 18 arquivos (15 originais + três `postManagement` PG),
incluindo dois `.test.ts` com PostgreSQL. Seleção não é execução/passe:
exigir `TEST_DATABASE_URL` exclusivo `_test`, distinto da aplicação, schemas
isolados e zero skips. Novas fixtures falham sem URL; antigas podem ignorar.
Não executar `db:migrate` contra URL desconhecida.

Nenhuma migration nova existe para esta funcionalidade. O procedimento abaixo
é futuro e manual; não foi executado e não autoriza deploy/SQL:

1. Aprovar revisão/artefato, SHA/base e gates. Confirmar com responsável como o
   Debian é realmente operado; não presumir nomes de serviços/containers.
2. Na janela coordenada, fazer backup PostgreSQL e storage persistente pelo
   procedimento existente, verificar restauração e guardar artefato anterior.
   Preservar configuração e secrets; backup não é desfazer publicação externa.
3. Suspender mutações e encerrar graciosamente **todas** as instâncias antigas
   da API/scheduler, inclusive outros hosts/workers. Nunca operar backend antigo
   e novo juntos. Evitar interromper chamadas externas; se acontecer, preservar
   tratamento conservador de incerteza da 6E.
4. Implantar manualmente artefato revisado, Node suportado, lockfile e configuração
   existente. Não aplicar migration nova: somente conferir presença/checksums
   001–011 pelo procedimento aprovado, sem comandos para DB desconhecido.
5. Iniciar somente versão nova; verificar `/health`, logs seguros, autenticação
   e listagem. Restart retoma operações persistidas/agendamentos vencidos e pode
   publicar de verdade: prever esse efeito na janela.
6. Com dados de teste autorizados, conferir papéis, edição, cancelamento e detalhe
   histórico. Nunca editar posts de clientes para smoke. Meta real exige
   consentimento separado e conta de teste.
7. Liberar usuários, monitorar erros/conflitos/publicação automática. Em falha,
   aplicar o rollback controlado abaixo, nunca automação de deploy pelo GitHub.

### Rollback e riscos

Falha durante mutação faz ROLLBACK SQL integral; não há compensação Meta pois
gestão não chama o provider. Em desenvolvimento, preservar alterações e
checkpoints e corrigir por patch revisado, sem reset/clean.

Antes de liberar usuários, se checks falharem e nenhuma mutação nova tiver
ocorrido, parar a API nova e voltar ao artefato anterior aprovado, com todas as
instâncias paradas na troca. Não há downgrade de schema/restore destrutivo automático.

Depois de edição/cancelamento pela versão nova, **não voltar cegamente ao backend
6E antigo**: ele não conhece a agregação dos destinos retirados e pode ressuscitar
cancelado sem destinos em reconciliação explícita. Manter API/scheduler parados
em manutenção, preservar DB/storage e consultar responsáveis. Preferir correção
forward ou artefato compatível revisado que conserve barreira, filtro de cancelled
e agregado. Não reativar posts, apagar destinos ou restaurar backup por cima de
resultados externos: pode duplicar envio. Novas ações de rollback exigem autorização.

Os riscos centrais são corrida cancelamento/envio, locks/fairness, autoridade
antiga, data vencida/stale UI, legado vazio e histórico retirado contaminando o
agregado. Os controles são, respectivamente, barreira/releitura, ordem determinística
e claims curtos, revalidação protegida, relógio atual/PATCH parcial/gerações,
preservação sem backfill e exclusão do agregado apenas sem evidência de tentativa.
Testes e revisão final precisam confirmar essas garantias; documentação não os substitui.
