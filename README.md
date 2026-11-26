<div align="center">
  <img width="256" alt="Serial ClipPRO" src="https://github.com/user-attachments/assets/2953e1f4-7822-4cbd-99e9-09bf8a27694a" />
  <p><b><font size="6">Serial Creator Studio</font></b></p>
</div>

[LoginPreview-Simulation.webm](https://github.com/user-attachments/assets/c3133ff3-77f9-4884-81ce-56ab5e92a8f8)


-

Dashboard Web para administrar canais do **YouTube, Twitch e Kick**, reunindo conteúdo, métricas, comunidade, planejamentos e ganhos. Cada usuário entra com uma plataforma, acessa seu próprio estúdio e pode conectar outras contas.

**Acesse: [Serial Creator Studio](https://creatorstudio.serialhealer.com.br/)**

A aplicação está disponível diretamente pelo navegador.

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

Os dados dependem das permissões concedidas e da disponibilidade nas plataformas. Valores indisponíveis permanecem identificados como ausentes.

No YouTube, as respostas e ações de moderação são aplicadas ao canal: **Responder** publica uma resposta, **Ocultar** retém o comentário para revisão, **Republicar** aprova novamente e **Excluir** solicita remoção com confirmação. **Heart e Pin** abrem o comentário no YouTube para concluir a ação; essas duas ações ainda não são executadas diretamente pela Dashboard.

A Twitch inclui eventos de transmissão recebidos por EventSub e histórico construído a partir das coletas. A integração Kick atual ainda não importa VODs. Os relatórios não reproduzem todas as telas dos estúdios oficiais nem todo o histórico anterior à conexão.

Receitas estimadas e registros manuais são apresentados separadamente; não equivalem a pagamentos confirmados.

A curadoria por IA do Planner e o aplicativo Desktop/WebView são evoluções futuras.

## Acesso

1. Abra o [Serial Creator Studio](https://creatorstudio.serialhealer.com.br/) e aceite os Termos de uso e a Política de privacidade.
2. Entre com Google/YouTube, Twitch ou Kick e autorize o acesso solicitado.
3. Conecte outras contas em **Conexões** e escolha a plataforma pelo seletor.

A união de estúdios previamente separados exige confirmação.

## Instalação pelo navegador

A aplicação possui suporte a **PWA (Progressive Web App)**. Em navegadores compatíveis, a opção de instalar permite abri-la em uma janela própria, com um atalho no dispositivo.

O **Web App Manifest** define o nome, os ícones e a apresentação da aplicação instalada. Ele é parte do suporte a PWA, não um aplicativo Desktop/WebView separado. O acesso aos dados dos canais continua dependendo de conexão com a internet.

## Tecnologias

**Linguagens**

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-323330?style=for-the-badge&logo=javascript&logoColor=F7DF1E)

**Interface**

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Recharts](https://img.shields.io/badge/Recharts-22B5BF?style=for-the-badge)

**Backend, dados e autenticação**

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![OAuth 2.0](https://img.shields.io/badge/OAuth_2.0-2E7D32?style=for-the-badge)

**Integrações**

![YouTube](https://img.shields.io/badge/YouTube-FF0033?style=for-the-badge&logo=youtube&logoColor=white)
![Twitch EventSub](https://img.shields.io/badge/Twitch_EventSub-9146FF?style=for-the-badge&logo=twitch&logoColor=white)
![Kick](https://img.shields.io/badge/Kick-151A21?style=for-the-badge&logo=kick&logoColor=53FC18)

O frontend e a API são independentes. A interface consulta os dados já coletados e usa cache para tornar a navegação mais rápida.

## Estrutura do projeto

```text
src/             Frontend e testes de componentes
public/          Arquivos públicos, manifesto, service worker e páginas legais
assets/          Identidade visual da aplicação
backend/src/     API, conectores, sincronização e armazenamento
backend/test/    Testes isolados do backend
tests/           Testes unitários do frontend
scripts/         Ferramentas de verificação e geração da prévia
```

O repositório reúne o código da aplicação, testes, ferramentas e recursos públicos. Credenciais, dados dos usuários, configurações da hospedagem e documentação interna não fazem parte do conteúdo versionado.
