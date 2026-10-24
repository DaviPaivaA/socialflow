# Task 10E — autorização externa e preparação manual

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Sem commits, criação de worktree ou limpeza de checkpoints.

**Goal:** verificar offline aprovações independentes assinadas, impedir replay e preparar uma leitura experimental sem conceder capacidade de rede real.

**Architecture:** módulos novos em server/experiments; Ed25519 de node:crypto com domínio de assinatura próprio, solicitação estritamente validada e imutável, hash canônico e autoridade pública confiável separada do documento recebido. Credenciais e transporte continuam exclusivamente sintéticos. Aprovação técnica não comprova consentimento/posse/grants Meta. Não existe transição para execução real nesta versão.

**Tech Stack:** Node 22 strip-only, TypeScript, Vitest, sem dependências novas.

**Spec:** decisão e requisitos completos do usuário da Task 10E (23/10/2026), descritos no brief do ledger existente. Opt-out explícito de novas decisões/aprovações intermediárias; escolha técnica delegada.

## Global Constraints

- Preservar integralmente Tasks 1A–10D, migrations 001–011 e configuração produtiva.
- Nenhuma chamada Meta, credencial real, Debian, SQL, deploy, commit, push ou merge.
- Nenhuma chave privada no executor; nenhuma assinatura/autoaprovação exportada. Chave de teste somente em testes, nunca aceita como autorização real.
- Chave pública do operador provisionada independentemente, fora do repo e do envelope recebido, é pré-requisito futuro. Não provisionar nem alegar confiança real nesta Task.
- Uma única Page/GET/page_media_view/day/v26.0, limite de uma chamada, sem retry/redirect/paginação, 10s, 32KiB envio/1MiB resposta; gastos monetários automáticos proibidos.
- Verificar assinatura sobre hash e todos os parâmetros: execução UUID, operador, tenant/Workspace UUID, Page, janela, finalidade, código SHA256, ambiente, prazo e orçamento.
- Consumo atômico, irrevogável inclusive erro/abort; replay por execução não pode depender apenas da memória. Diretório de recibos privados contém só IDs/hashes, nunca segredos.

## Review Focus

- Assinatura válida com chave escolhida no envelope não pode estabelecer confiança.
- Reconstrução de plano, reinício de processo e concorrência não podem renovar orçamento.
- Esperas de admissão/entrada revalidam prazo/contexto/código; mutações não podem alterar o que foi assinado.
- DI é fronteira confiável, não sandbox: não prometer impedir código arbitrário/operador comprometido.
- Relatório local nunca promove assinatura de teste a aprovação humana real ou validação Meta.

## Task 10E (uma entrega independente)

- [x] Ler interfaces 10A–10D e capturar hashes de integridade anteriores.
- [x] RED: autorização ausente/inválida/expirada/replay, alteração de plano/código/limites, autoaprovação, separação de ambientes e falha segura sem rede.
- [x] GREEN: novos módulos de solicitação/verificação Ed25519, admissão durável e orquestração sintética; não alterar fontes anteriores.
- [x] Exercitar integração sintética com entrada protegida10D e executor10C, incluindo abort/tempo/80001/erros internos; real permanece bloqueado antes de credenciais.
- [x] Revisão independente de especificação/segurança/qualidade; nenhum Critical/Important aberto. Gate de identidade nativa corrigido RED→GREEN antes da revisão.
- [x] Verificação sequencial experimental, frontend/backend offline e build/typecheck/lint/diff/integridade. PostgreSQL não executado: TEST_DATABASE_URL ausente, condição de segurança não satisfeita; pendência explícita no fechamento.
- [x] Revisão global read-only de 7A, relatório de fechamento local versus bloqueios externos, inventário, manifesto, runbook e ledger. Não iniciar piloto.
