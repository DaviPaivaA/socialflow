# SocialFlow TCC

Protótipo de uma plataforma de gestão, planejamento, agendamento e análise de
conteúdo para redes sociais. O projeto foi preparado para publicação gratuita
no GitHub Pages.

## Funcionalidades demonstradas

- painel com indicadores de desempenho;
- calendário editorial semanal;
- criação e agendamento simulado de publicações;
- filtros por status;
- gráficos e métricas;
- gerenciamento visual de canais;
- configurações e automações simuladas;
- layout responsivo para computador e celular.

## Executar no computador

É necessário usar Node.js 22.22.0 ou superior dentro da série 22, ou Node.js 24
ou superior. A série 23 não é suportada.

```bash
npm install
npm run dev
```

Depois, abra `http://localhost:5173`.

## Camada de dados

Por padrão, a aplicação usa `MockPostsRepository`, mantém as publicações apenas
em memória e não faz requisições externas.

Para conectar a futura API HTTP, crie um arquivo local `.env.local` com as
variáveis abaixo antes de iniciar ou gerar o frontend:

```bash
VITE_POSTS_REPOSITORY=http
VITE_API_URL=https://api.seudominio.example
```

O contrato esperado atualmente é `GET /posts` para listar e `POST /posts` para
criar uma publicação. Tanto a criação quanto os itens retornados pela API usam
`scheduledAt` como a única fonte do agendamento. O valor deve ser um timestamp
ISO 8601 com fuso explícito (`Z` ou `±HH:MM`); datas sem ano, rótulos como
`"13 ago"` e horários sem fuso não são aceitos.

Neste MVP, a data e o horário escolhidos no formulário são interpretados no
fuso local do navegador. O instante correspondente é convertido corretamente
para UTC antes do `POST`. Por exemplo, a seleção de 13/08/2026 às 10:00 em um
navegador no fuso UTC-03 gera:

```json
{
  "title": "Nova publicação",
  "caption": "Conteúdo programado.",
  "scheduledAt": "2026-08-13T13:00:00.000Z",
  "channels": ["IG", "FB"],
  "status": "Agendado",
  "color": "purple"
}
```

O `POST /posts` deve retornar o mesmo formato acrescido de `id`, e cada item de
`GET /posts` deve seguir esse mesmo contrato completo. Data e horário abreviados
são derivados de `scheduledAt` apenas na interface. `VITE_API_URL` é incorporada
ao bundle, portanto deve conter somente o endereço público da API, nunca tokens,
chaves ou segredos.

## Pendências conhecidas

- Ao manter o painel aberto durante a virada do dia, o rótulo relativo da
  próxima publicação ainda não é reavaliado à meia-noite local e pode demorar a
  mudar para “Hoje”.
- Em fusos com mudança de horário de verão, um horário local inexistente durante
  o salto do relógio ainda não apresenta uma mensagem de validação explícita no
  Composer.

## Publicar gratuitamente

Consulte o arquivo [PUBLICAR_NO_GITHUB.md](PUBLICAR_NO_GITHUB.md). A publicação
automática já está configurada e será executada sempre que houver uma alteração
na branch `main`.

## Observação acadêmica

Esta versão é uma demonstração estática. Integrações reais com Instagram,
Facebook, TikTok ou LinkedIn exigiriam APIs oficiais, autenticação e um serviço
de backend.
