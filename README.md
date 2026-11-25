# Serial Creator Studio

Dashboard Web para administrar canais do **YouTube, Twitch e Kick**, reunindo conteúdo, métricas, comunidade e planejamento. Cada usuário entra com uma plataforma, acessa seu próprio estúdio e pode conectar outras contas.

**Acesse: [creatorstudio.serialhealer.com.br](https://creatorstudio.serialhealer.com.br/)**

A aplicação já está publicada. Não é necessário instalar Node ou executar comandos no PC para utilizá-la pelo navegador.

## Funcionalidades

| Área | Recursos |
| --- | --- |
| Visão geral | Conteúdo em destaque, retenção disponível, indicadores, metas e rankings |
| Conteúdo | Vídeos, Shorts, playlists e relatórios YouTube; vídeos/VODs e clipes Twitch |
| Analytics | Audiência, alcance, engajamento e dados específicos de cada integração |
| Comunidade | Comentários YouTube, respostas, filtros e moderação; membros quando autorizados |
| Planejamento | Calendário, lista e pipeline de produção por canal |
| Receitas | Dados e estimativas disponíveis, pagamentos e parcerias registrados pelo usuário |
| Conexões | Vinculação e desconexão de contas e controles de privacidade |

Os dados dependem das permissões concedidas e da disponibilidade nas plataformas. Valores indisponíveis permanecem identificados como ausentes. A prévia do login e os testes usam dados fictícios, separados dos estúdios autenticados.

No YouTube, responder publica a resposta, ocultar retém para revisão, republicar aprova novamente e excluir solicita remoção com confirmação. Heart e Pin abrem o comentário no YouTube para concluir a ação; a integração implementada não grava essas duas ações.

A Twitch inclui eventos recebidos por EventSub e histórico construído pelas coletas. O conector Kick atual não importa VODs. Os relatórios não reproduzem todas as telas dos estúdios oficiais, nem todo o histórico anterior à conexão.

Receitas estimadas e registros manuais são apresentados separadamente; não equivalem a pagamentos confirmados. A curadoria por IA do Planner e o empacotamento Desktop/WebView são evoluções futuras.

## Acesso

1. Abra o endereço Web e aceite os Termos de uso e a Política de privacidade.
2. Entre com Google/YouTube, Twitch ou Kick e autorize o acesso solicitado.
3. Conecte outras contas em **Conexões** e escolha a plataforma pelo seletor.

Se o ambiente exigir convite, usuários novos precisarão de um código. A união de estúdios previamente separados exige confirmação.

O frontend React/Vite e a API Node são independentes. A interface publicada consome a API em `https://www.serialhealer.com.br/api/v1`. O endereço da interface não precisa ser o mesmo da API.

O projeto inclui manifesto e service worker para PWA. Isso é separado de um futuro executável Desktop.

## Desenvolvimento

Requisitos: Node.js **22.18 ou superior** e npm. Os comandos abaixo usam PowerShell no Windows.

Na raiz do projeto:

```powershell
npm.cmd ci
npm.cmd run dev
```

Configure `.env.local` na raiz com a **origem** da API, sem acrescentar `/api/v1`. Para um backend local:

```dotenv
VITE_API_URL=http://localhost:4000
```

Em outro terminal, na pasta `backend`:

```powershell
npm.cmd ci
if (!(Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
# Preencha o .env com credenciais do seu ambiente de desenvolvimento.
npm.cmd run dev
```

O Vite informa o endereço local do frontend; a API usa `http://localhost:4000` por padrão. Ajuste callbacks OAuth, `DASHBOARD_URL` e `CORS_ORIGINS` para o ambiente escolhido. Preserve qualquer `.env` existente.

É possível desenvolver o frontend com uma API remota configurando `VITE_API_URL` com sua origem HTTPS. **Nesse caso, as ações afetam os dados e as contas conectadas àquela API.** Não é necessário iniciar outro backend local.

Client Secrets, tokens OAuth e a credencial administrativa pertencem exclusivamente ao backend. Não os inclua em variáveis `VITE_*`, no build ou no repositório. O arquivo `backend/.env.example` contém apenas configuração genérica de desenvolvimento.

## Arquitetura

- **Frontend:** React, TypeScript, Vite e Recharts, com navegação por hash e cache em memória.
- **Backend:** Node, autenticação por plataforma, isolamento por estúdio e conectores OAuth.
- **Dados:** PostgreSQL quando `DATABASE_URL` está definida; fallback JSON para ambientes sem banco.
- **Sincronização:** fila por estúdio, prioridades, cadências por tipo de dado e coleta incremental.

Abrir uma tela consulta os dados armazenados, sem exigir importação completa. A versão atual trabalha com um único processo escritor e mantém o estado em memória; PostgreSQL não habilita automaticamente múltiplas instâncias.

Eventos EventSub com falha de gravação voltam à fila em memória, com deduplicação. Eventos ainda não persistidos podem ser perdidos numa queda abrupta do processo.

## Verificação

```powershell
npm.cmd run verify
```

O comando verifica formatação, build, testes, sintaxe e fluxos no navegador. As verificações usam dados isolados e provedores simulados; não publicam nem moderam comentários de contas reais.

| Comando | Escopo |
| --- | --- |
| `npm.cmd test` | Testes unitários do frontend e componentes |
| `npm.cmd run test:components` | Componentes com Vitest e Testing Library |
| `npm.cmd run backend:test` | API e integrações simuladas |
| `npm.cmd run backend:check` | Sintaxe do backend |
| `npm.cmd run verify:ui` | Interface em navegador com dados simulados |
| `npm.cmd run verify:motion` | Prévia, contagem numérica e controle de animações |
| `npm.cmd run format:check` | Formatação sem reescrever arquivos |

As verificações de navegador usam Playwright. Numa máquina nova, instale Chromium com `npx.cmd playwright install chromium`.

## Build

```powershell
npm.cmd run build
```

O frontend compilado fica em `dist/`. `VITE_API_URL` é resolvida durante o build; alterar o endereço posteriormente exige recompilar. Frontend e backend são entregas independentes, e um push não realiza publicação automática.

## Estrutura versionada

```text
src/             Frontend e testes de componentes
public/          Arquivos públicos, manifesto, service worker e páginas legais
assets/          Identidade visual da aplicação
backend/src/     API, conectores, sincronização e armazenamento
backend/test/    Testes isolados do backend
tests/           Testes unitários do frontend
scripts/         Ferramentas de verificação e geração da prévia
```

Somente código da aplicação, testes, ferramentas necessárias, recursos públicos, exemplos genéricos e este README pertencem ao repositório. Documentação interna, configuração da hospedagem, histórico operacional, credenciais, dados, backups e pacotes de publicação permanecem locais e excluídos pelo `.gitignore`.
