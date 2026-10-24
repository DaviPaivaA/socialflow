# SocialFlow 7A — Repository e Service locais

Execução de 21/10/2026, sobre `e44b031d194a959e3f4182b246d17525a0ebc09c`, branch `feat/socialflow-7a-meta-insights`. Extensão limitada às Tasks4/5 do plano `docs/superpowers/plans/2026-10-19-socialflow-meta-insights-plan-facebook-instagram.md`. Ledger/evidências: `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/`.

Esta entrega não habilita Insights reais, não conclui a7A e não introduz endpoints. OAuth, contratos e clients anteriormente aprovados permanecem preservados. Não aplicar configurações ou migrations em produção a partir deste documento.

## Fronteiras e interfaces privadas

```text
AuthContext interno (sessão + membership atual)
  → InsightsService.query(context, request, {signal?})
  → PostgresInsightsRepository.load(context, alvo UUID local)
  → gate de conta, conexão, grants, tipo/expiração do token e objeto
  → decrypt sob demanda
  → client Facebook ou Instagram aprovado
  → nova leitura do mesmo contexto/alvo + novo gate + comparação do snapshot
  → InsightsResponse normalizado ou erro seguro
```

- `server/src/insightsRepository.ts`: SELECT parametrizado, somente leitura; sessão/membership/tenant e relações de conta, conexão, credencial, destino, operação e mídia no mesmo snapshot SQL. Não descriptografa. Recursos de outro tenant são ausentes; contexto revogado é erro de autenticação. Ciphertexts são privados, nunca DTOs públicos.
- `server/src/insightsService.ts`: compõe repository, cipher e clients injetáveis. Recebe UUID local da conta ou do destino (`post_publications.id`, não um Graph ID isolado nem o ID do post). Para destino, conta local esperada é opcional e deve coincidir. Não aceita tenant, token, URL ou provas de elegibilidade fornecidas pelo cliente.
- Leitura permitida a todos os membros ativos, independentemente da autoria original e sem conceder administração de conexões. Não reutiliza a política de edição/cancelamento para restringir leitura.
- Facebook usa o ciphertext/expiração de Page selecionado; Instagram Facebook Login usa o User token da conexão. Não existe fallback entre os dois. Grants são efetivos, não inferidos da publicação ou da lista solicitada no OAuth.
- Contexto, seleção e snapshot são copiados; após sucesso **ou erro** assíncrono, a autoridade e o conteúdo privado relevante são relidos. Rotação, desconexão, revogação ou mudança de vínculo/ID/erro descartam o resultado anterior, sem depender de `updated_at`. Não há transação ou lock mantido durante a operação do client.

## Objetos e mídia

- Facebook Post: destino publicado com ID final persistido coerente, sem evidência de erro; texto/foto feed preservados. Reel/video não é presumido feed post. Não há conversão de photo/video/container ID em post ID.
- Instagram Media: ID final publicado e operação local `instagram_image`/`instagram_reel` sucedida, vinculada à conta e à mídia única coerente. A própria origem desse fluxo local fornece a evidência interna de formato/top-level; `owner` ou MIME isolados não fornecem essa prova.
- Publicação legada sem destino ou sem evidência suficiente não recebe associação inventada. Autor removido não impede outro membro atual de ler um destino válido. Agregado parcialmente falho não esconde o destino individual publicado.
- Mídias externas, filhos de carrossel, descoberta e verificador top-level externo continuam fora desta entrega. Um booleano caller não pode habilitá-los.

## Erros, dados e cancelamento

`InsightsResponse` permanece o contrato aprovado, com pontos, timestamps, zero legítimo e ausência explícita. Pré-gates lançam erros tipados, sem fabricar valores ou `fetchedAt` de coleta. `InsightsServiceError` distingue códigos como `permission_required`, `token_expired`, `rate_limited`, `unsupported_object`, `transport_blocked`, `timeout`, `aborted` e indisponibilidade do provider; a disponibilidade acompanha o erro. Erros inesperados/códigos malformados são sanitizados, sem cause, resposta bruta, tokens ou `AbortSignal.reason`.

Abort cancela a espera do serviço e impede entrega de dados/rejeições antigas. Não cancela fisicamente um SELECT já enviado ao PostgreSQL; sua conclusão/rejeição tardia fica observada. Não se altera o estado de publicação nem se apagam tokens em resposta a uma falha de leitura.

## Rede e operação

Os clients padrão não têm transporte Graph conectado: o resultado normal é bloqueio explícito, nunca dados fake. Transportes simulados são injetados exclusivamente nos testes. Nenhum fallback para token/proof em query string, header presumido, endpoint público, cache, coletor, timer ou persistência de métricas foi adicionado.

Permanecem gates externos: transporte oficialmente comprovado de token/proof por endpoint, consentimento/grants, App Review/nível de acesso e validação isolada autorizada com a Meta. Fixtures não provam funcionamento da API real. Não houve alteração de secrets, scheduler ou migrations001–011.

## Evidências e próximos passos

Testes de repository e service estão em `server/test/insightsRepository.integration.ts`, `server/test/insightsService.test.ts`, `server/test/insightsService.integration.ts`; `insightsFixtures.ts` é exclusivamente de teste. Ambos os arquivos PG estão no seletor explícito de integração, sem mudanças de dependências.

Fechamento local aprovado: focados149/149, regressão OAuth/clients402/402, frontend357/357 e backend1575/1575; integração explícita585/585 em20arquivos, sem skips. Integração/focados são subconjuntos do backend: totalfrontend+backend1932. Build/typecheck,lint,diffcheck e imports nativos Node22.23.3 passaram. Reviews independentes Task4,Task5 e global aprovados; Minor de cobertura Task4 atendido, nenhum finding local aberto.11migrations e17arquivos aprovados anteriores intactos. Evidências/comandos/limitações no `final-report.md` e `progress.md` do ledger acima.

A próxima implementação possível é a fronteira HTTP autenticada, somente mediante autorização separada e preservando o bloqueio real de rede. Os testes locais não validam API Meta real ou produção; não implementar nem implantar automaticamente.
