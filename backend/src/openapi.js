import { VERSION } from './version.js';
import { extendStudioSpec } from './studio-openapi.js';
import { extendLiveSpec } from './live-openapi.js';
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const string = { type: 'string' },
  nullableNumber = { type: 'number', nullable: true };
const object = properties => ({ type: 'object', properties });
const parameter = (name, schema, description, required = false, where = 'query') => ({
  name,
  in: where,
  required,
  description,
  schema,
});
const scope = [parameter('workspaceId', string, 'Workspace proprietário', true, 'path')];
const filters = [
  parameter('platform', { type: 'string', enum: ['YouTube', 'Twitch', 'Kick'] }, 'Plataforma'),
  parameter('channelId', { type: 'array', items: string }, 'Repita channelId para selecionar vários canais'),
  parameter('from', { type: 'string', format: 'date' }, 'Início inclusivo; padrão: 29 dias antes de to'),
  parameter('to', { type: 'string', format: 'date' }, 'Fim inclusivo; padrão: data UTC atual'),
];
const pagination = [
  parameter('page', { type: 'integer', minimum: 1, default: 1 }, 'Página'),
  parameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }, 'Itens por página'),
];
const responses = (schema, status = '200', list = false) => ({
  [status]: {
    description: 'Sucesso',
    ...(status === '204'
      ? {}
      : {
          content: {
            'application/json': {
              schema: object({
                data: list ? { type: 'array', items: schema } : schema,
                meta: ref('Meta'),
                ...(list ? { pagination: ref('Pagination') } : {}),
              }),
            },
          },
        }),
  },
  400: { description: 'Validação', content: { 'application/json': { schema: ref('Error') } } },
  401: { description: 'Não autorizado' },
  404: { description: 'Recurso não encontrado' },
});
const body = schema => ({ required: true, content: { 'application/json': { schema } } });
const paths = {};
function get(path, summary, schema, { list = false, params = [], scoped = true } = {}) {
  paths[path] = {
    get: { summary, parameters: [...(scoped ? scope : []), ...params], responses: responses(schema, '200', list) },
  };
}
const base = '/api/v1/workspaces/{workspaceId}';
get('/health', 'Estado do processo', object({ status: string, mode: string, version: string }), { scoped: false });
paths['/health'].get.security = [];
get('/api/v1/workspaces', 'Workspaces do proprietário', ref('Workspace'), { scoped: false });
// Workspaces are an unpaginated array; all resource collections below are paginated.
paths['/api/v1/workspaces'].get.responses = responses({ type: 'array', items: ref('Workspace') });
get(base + '/channels', 'Canais; múltiplos canais por plataforma', ref('Channel'), {
  list: true,
  params: [...filters, ...pagination],
});
get(base + '/connections', 'Conexões e capacidades dos conectores', ref('Connections'));
get(base + '/overview', 'Visão geral; métricas agregadas no intervalo', ref('Overview'), { params: filters });
get(base + '/contents', 'Catálogo; período afeta periodViews, não a inclusão no catálogo', ref('Content'), {
  list: true,
  params: [
    ...filters,
    ...pagination,
    parameter('q', string, 'Busca no título'),
    parameter('format', { type: 'string', enum: ['Vídeo', 'Short', 'VOD', 'Clip', 'Live'] }, 'Formato'),
    parameter(
      'sort',
      { type: 'string', enum: ['date', 'views', 'retention'], default: 'date' },
      'Ordenação descendente',
    ),
  ],
});
get(
  base + '/contents/{contentId}',
  'Relatório individual; views é total, periodViews é do intervalo',
  ref('ContentReport'),
  { params: [...filters, parameter('contentId', string, 'ID interno', true, 'path')] },
);
get(base + '/analytics', 'Séries diárias; ausência de dado privado é explícita', ref('Analytics'), { params: filters });
get(base + '/revenue', 'Estado financeiro; indisponível, sem zeros artificiais', ref('Revenue'), { params: filters });
get(base + '/plans', 'Planejamento no intervalo inclusivo', ref('Plan'), {
  list: true,
  params: [...filters, ...pagination],
});
paths[base + '/plans'].post = {
  summary: 'Criar planejamento local; não publica nas plataformas',
  parameters: scope,
  requestBody: body(ref('PlanCreate')),
  responses: responses(ref('Plan'), '201'),
};
paths[base + '/plans/{planId}'] = {
  patch: {
    summary: 'Editar planejamento',
    parameters: [...scope, parameter('planId', string, 'ID interno', true, 'path')],
    requestBody: body(ref('PlanPatch')),
    responses: responses(ref('Plan')),
  },
  delete: {
    summary: 'Excluir planejamento',
    parameters: [...scope, parameter('planId', string, 'ID interno', true, 'path')],
    responses: responses({}, '204'),
  },
};
get(base + '/community/comments', 'Comentários sincronizados; sem filtro temporal', ref('Comment'), {
  list: true,
  params: [
    parameter('platform', string, 'Plataforma'),
    parameter('channelId', { type: 'array', items: string }, 'Canais'),
    ...pagination,
  ],
});
paths[base + '/community/comments/{commentId}'] = {
  patch: {
    summary: 'Alterar curtida local',
    parameters: [...scope, parameter('commentId', string, 'ID interno', true, 'path')],
    requestBody: body({
      type: 'object',
      required: ['hearted'],
      additionalProperties: false,
      properties: { hearted: { type: 'boolean' } },
    }),
    responses: responses(ref('Comment')),
  },
};
paths[base + '/community/comments/{commentId}/replies'] = {
  post: {
    summary: 'Salvar resposta local; nada é enviado à plataforma',
    parameters: [...scope, parameter('commentId', string, 'ID interno', true, 'path')],
    requestBody: body({
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } },
    }),
    responses: responses(ref('Reply'), '201'),
  },
};
for (const suffix of ['/connections/{platform}/authorize', '/channels/{channelId}/sync'])
  paths[base + suffix] = {
    post: {
      summary: 'Contrato reservado; retorna 501',
      parameters: [
        ...scope,
        parameter(
          suffix.includes('platform') ? 'platform' : 'channelId',
          suffix.includes('platform') ? { type: 'string', enum: ['YouTube', 'Twitch', 'Kick'] } : string,
          'Identificador',
          true,
          'path',
        ),
      ],
      responses: {
        501: { description: 'Conector não implementado', content: { 'application/json': { schema: ref('Error') } } },
      },
    },
  };
paths[base + '/connections/{platform}/authorize'].post.summary = 'YouTube: iniciar autorização; Twitch/Kick: 501';
paths[base + '/connections/{platform}/authorize'].post.responses['200'] = responses(
  object({ authorizationUrl: string }),
)['200'];
paths[base + '/channels/{channelId}/sync'].post.summary =
  'Importar catálogo do canal real; até 10 páginas por execução';
paths[base + '/channels/{channelId}/sync'].post.responses['200'] = responses(
  object({
    channelId: string,
    imported: { type: 'integer' },
    pages: { type: 'integer' },
    complete: { type: 'boolean' },
    lastSyncedAt: string,
  }),
)['200'];
paths[base + '/connections/{connectionId}'] = {
  delete: {
    summary: 'Remover a conexão e os dados do canal; solicita a revogação das credenciais na plataforma',
    parameters: [...scope, parameter('connectionId', string, 'ID da conexão', true, 'path')],
    responses: responses({}, '204'),
  },
};
paths['/api/v1/oauth/google/start'] = {
  get: {
    summary: 'Consumir ticket e redirecionar ao Google; grava cookie HttpOnly de vinculo',
    security: [],
    parameters: [parameter('ticket', string, 'Ticket de uso único emitido pela rota autenticada', true)],
    responses: { 302: { description: 'Redirecionamento ao Google' }, 400: { description: 'Tentativa inválida' } },
  },
};
paths['/api/v1/oauth/google/callback'] = {
  get: {
    summary: 'Callback Google; valida state, cookie de vinculo e PKCE',
    security: [],
    parameters: [
      parameter('state', string, 'Estado de uso único', true),
      parameter('code', string, 'Código temporário'),
      parameter('error', string, 'Recusa da autorização'),
    ],
    responses: {
      303: { description: 'Retorno à dashboard' },
      400: { description: 'Estado inválido' },
      424: { description: 'Falha na autorização junto ao Google' },
    },
  },
};
const planFields = {
  title: { type: 'string', minLength: 1, maxLength: 120 },
  channelId: string,
  format: { type: 'string', enum: ['Vídeo', 'Short', 'VOD', 'Clip', 'Live'] },
  date: { type: 'string', format: 'date' },
  stage: { type: 'string', enum: ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto', 'Publicado'] },
  time: {
    type: 'string',
    nullable: true,
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
    description: 'Horário de publicação (HH:MM)',
  },
  notes: { type: 'string', maxLength: 2000 },
  dealId: { type: 'string', nullable: true, description: 'Negociação (financial deal) vinculada' },
  contentId: { type: 'string', nullable: true, description: 'Conteúdo publicado vinculado manualmente' },
};
const contentFields = {
  id: string,
  workspaceId: string,
  channelId: string,
  externalId: string,
  platform: string,
  title: string,
  format: string,
  date: { type: 'string', format: 'date' },
  publishedAt: { type: 'string', format: 'date-time' },
  duration: string,
  image: string,
  thumbnailUrl: string,
  status: string,
  views: { type: 'integer', nullable: true, description: 'Contador acumulado da fonte' },
  periodViews: { type: 'integer', nullable: true },
  likes: nullableNumber,
  comments: nullableNumber,
  watchUrl: string,
  formatClassification: string,
  retention: nullableNumber,
  dataSource: string,
  lastSyncedAt: { type: 'string', nullable: true },
};
export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Serial Creator API',
    version: '0.1.0',
    description:
      'Esboço executável em modo demo. Credencial de proprietário único, sem autorização multiusuário. OAuth, coleta oficial e receitas não implementados.',
  },
  servers: [{ url: 'http://127.0.0.1:4000' }],
  security: [{ ownerToken: [] }],
  paths,
  components: {
    securitySchemes: {
      ownerToken: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Opcional somente em desenvolvimento loopback. Acesso a todos os workspaces do proprietário; nunca embutir no bundle do client.',
      },
    },
    schemas: {
      Connection: object({
        id: string,
        workspaceId: string,
        platform: string,
        status: string,
        channelIds: { type: 'array', items: string },
        scopes: { type: 'array', items: string },
        createdAt: string,
        lastSyncedAt: { type: 'string', nullable: true },
        lastError: { type: 'string', nullable: true },
      }),
      Meta: object({
        requestId: string,
        mode: { type: 'string', enum: ['live'] },
        dataSource: { type: 'string', enum: ['platforms'] },
        generatedAt: { type: 'string', format: 'date-time' },
      }),
      Pagination: object({
        page: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer' },
        totalPages: { type: 'integer' },
      }),
      Error: object({
        error: object({ code: string, message: string, details: {} }),
        meta: object({ requestId: string }),
      }),
      Workspace: object({ id: string, name: string, timezone: string }),
      Channel: object({
        id: string,
        workspaceId: string,
        platform: string,
        name: string,
        externalId: string,
        connectionId: { type: 'string', nullable: true },
        subscribers: { type: 'integer', nullable: true },
        lastSyncedAt: { type: 'string', nullable: true },
        dataSource: string,
      }),
      Content: object(contentFields),
      ContentReport: object({
        ...contentFields,
        period: ref('Period'),
        retentionCurve: {
          type: 'array',
          nullable: true,
          items: object({ position: { type: 'number' }, percentage: { type: 'number' } }),
        },
        diagnosis: ref('Availability'),
      }),
      Period: object({ from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }),
      Availability: object({ status: string, reason: string }),
      Summary: object({
        views: { type: 'integer', nullable: true },
        subscribers: { type: 'integer', nullable: true },
        subscribersBasis: string,
        watchTimeMinutes: { type: 'integer', nullable: true },
        engagementRate: nullableNumber,
        comparison: { type: 'object', nullable: true },
      }),
      Analytics: object({
        period: ref('Period'),
        summary: ref('Summary'),
        timeseries: {
          type: 'array',
          items: object({
            date: string,
            YouTube: { type: 'number' },
            Twitch: { type: 'number' },
            Kick: { type: 'number' },
          }),
        },
        byPlatform: { type: 'array', items: object({ platform: string, views: { type: 'number' } }) },
        availability: object({ audience: ref('Availability'), revenue: ref('Availability') }),
      }),
      Overview: {
        allOf: [
          ref('Analytics'),
          object({
            latestContent: { ...ref('Content'), nullable: true },
            topContents: { type: 'array', items: ref('Content') },
            nextPlans: { type: 'array', items: ref('Plan') },
            lastSyncedAt: { type: 'string', nullable: true },
          }),
        ],
      },
      Connections: object({
        configured: { type: 'boolean' },
        redirectUri: string,
        items: { type: 'array', items: ref('Connection') },
        providers: {
          type: 'array',
          items: object({
            platform: string,
            status: string,
            oauth: { type: 'boolean' },
            catalog: { type: 'boolean' },
            analytics: { type: 'boolean' },
            revenue: { type: 'boolean' },
            management: { type: 'boolean' },
            reason: string,
          }),
        },
      }),
      Revenue: object({
        period: ref('Period'),
        status: string,
        totals: { type: 'array', items: { type: 'object' } },
        entries: { type: 'array', items: { type: 'object' } },
        payouts: { type: 'array', items: { type: 'object' } },
        reason: string,
      }),
      Plan: object({
        id: string,
        workspaceId: string,
        ...planFields,
        platform: string,
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      }),
      PlanCreate: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'channelId', 'format', 'date'],
        properties: planFields,
      },
      PlanPatch: { type: 'object', additionalProperties: false, minProperties: 1, properties: planFields },
      Comment: object({
        id: string,
        workspaceId: string,
        channelId: string,
        contentId: string,
        platform: string,
        author: string,
        text: string,
        hearted: { type: 'boolean' },
        replies: { type: 'array', items: ref('Reply') },
        dataSource: string,
      }),
      Reply: object({
        id: string,
        text: string,
        createdAt: { type: 'string', format: 'date-time' },
        delivery: { type: 'string', enum: ['local_only'] },
      }),
    },
  },
};

extendLiveSpec(openapi);

extendStudioSpec(openapi);

// Final production contract: only real records and supported operations.
openapi.info.version = VERSION;
openapi.info.description =
  'Personal creator studio: YouTube catalog, complete conversations and private reports; Twitch OAuth/profile/VODs/clips/live snapshots; Kick OAuth/profile/live snapshots. No demo records or unsupported metrics are fabricated.';
const productionRoot = '/api/v1/workspaces/{workspaceId}';
for (const route of ['/community/comments/{commentId}', '/community/comments/{commentId}/replies'])
  delete openapi.paths[productionRoot + route];
openapi.paths[productionRoot + '/connections/{platform}/authorize'].post.summary =
  'Authorize a YouTube, Twitch or Kick account with one provider consent';
for (const provider of ['twitch', 'kick'])
  for (const action of ['start', 'callback'])
    openapi.paths['/api/v1/oauth/' + provider + '/' + action] = {
      get: {
        summary: provider + ' OAuth ' + action,
        security: [],
        responses: {
          302: { description: 'Provider redirect' },
          303: { description: 'Return to dashboard' },
          400: { description: 'Invalid or expired state' },
          503: { description: 'Provider credentials missing' },
        },
      },
    };
openapi.components.schemas.Reply.properties = {
  ...openapi.components.schemas.Reply.properties,
  author: { type: 'string' },
  authorChannelId: { type: 'string', nullable: true },
  isOwner: { type: 'boolean' },
  source: { type: 'string' },
  updatedAt: { type: 'string' },
};
openapi.components.schemas.Reply.properties.delivery.enum = ['youtube', 'published'];
openapi.components.schemas.LiveAnalytics.properties.audience.properties.ages = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    items: {
      type: 'array',
      items: { type: 'object', properties: { label: { type: 'string' }, percentage: { type: 'number' } } },
    },
    reason: { type: 'string', nullable: true },
  },
};
openapi.components.schemas.LiveAnalytics.properties.audience.properties.subscribed = {
  $ref: '#/components/schemas/LiveAudience',
};
openapi.components.schemas.LiveAnalytics.properties.traffic = { $ref: '#/components/schemas/LiveAudience' };

openapi.info.description +=
  ' Platform OAuth login creates private per-user studios; API_TOKEN remains administrator-only.';
for (const provider of ['google', 'twitch', 'kick'])
  openapi.paths['/api/v1/auth/login/' + provider] = {
    post: {
      summary: 'Start platform login for a private user studio',
      security: [],
      responses: {
        200: { description: 'One-use authorization URL and polling credentials' },
        429: { description: 'Try again later' },
      },
    },
  };
openapi.paths['/api/v1/auth/login/poll'] = {
  post: {
    summary: 'Redeem completed login once using id and secret in JSON body',
    security: [],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'secret'],
            properties: { id: { type: 'string' }, secret: { type: 'string' } },
          },
        },
      },
    },
    responses: { 200: { description: 'Pending or private studio session' }, 403: { description: 'Login denied' } },
  },
};
openapi.paths['/api/v1/auth/logout'] = {
  post: { summary: 'Revoke current platform session', responses: { 204: { description: 'Session revoked' } } },
};

openapi.paths['/api/v1/auth/refresh'] = {
  post: {
    summary: 'Exchange the current platform session token for a new one (12 h; at most 7 days after sign-in)',
    responses: {
      200: { description: '{ accessToken, expiresIn } — the previous token stops working' },
      401: { description: 'UNAUTHORIZED or SESSION_MAX_AGE: sign in again' },
    },
  },
};

openapi.paths['/api/v1/auth/options'] = {
  get: {
    summary: 'Public sign-in options',
    responses: { 200: { description: '{ inviteRequired }: a new studio needs an invite code (INVITE_CODES)' } },
  },
};

openapi.paths['/api/v1/workspaces/{workspaceId}/connections/merge'] = {
  post: {
    summary: 'Confirm or cancel a freshly OAuth-verified studio merge',
    parameters: [{ in: 'path', name: 'workspaceId', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'secret', 'confirm'],
            properties: { id: { type: 'string' }, secret: { type: 'string' }, confirm: { type: 'boolean' } },
          },
        },
      },
    },
    responses: {
      200: { description: 'Studios merged or kept separate' },
      403: { description: 'No valid verification or wrong workspace' },
      409: { description: 'Sync running or studio changed' },
    },
  },
};

const platformPreference = object({
  platform: { type: 'string', enum: ['YouTube', 'Twitch', 'Kick'], nullable: true },
});
get(base + '/preferences', 'Preferência de plataforma do estúdio autenticado', platformPreference);
paths[base + '/preferences'].patch = {
  summary: 'Salvar plataforma padrão do próprio estúdio',
  parameters: scope,
  requestBody: body({
    type: 'object',
    required: ['platform'],
    additionalProperties: false,
    properties: { platform: { type: 'string', enum: ['YouTube', 'Twitch', 'Kick'] } },
  }),
  responses: responses(platformPreference),
};

for (const suffix of ['', '/privacy', '/terms'])
  paths['/api/v1/legal' + suffix] = {
    get: {
      summary: 'Public legal metadata or rendered policy page',
      security: [],
      responses: {
        200: { description: suffix ? 'HTML legal page' : 'Policy version, contact and backup confirmation status' },
      },
    },
  };
get(
  base + '/privacy',
  'Private studio deletion preview and counts',
  object({ canDelete: { type: 'boolean' }, counts: { type: 'object' }, mergedStudios: { type: 'integer' } }),
);
paths[base + '/privacy'].delete = {
  summary: 'Erase own personal studio and invalidate sessions; queue provider revocation',
  parameters: scope,
  requestBody: body({
    type: 'object',
    required: ['confirmation'],
    properties: { confirmation: { type: 'string', enum: ['EXCLUIR'] } },
  }),
  responses: {
    200: { description: 'Active data erased; revocation may be queued' },
    400: { description: 'Explicit confirmation required' },
    401: { description: 'Session missing' },
    403: { description: 'Own personal session required' },
    409: { description: 'Sync or operation in progress' },
  },
};
paths[base + '/privacy/connections/{connectionId}'] = {
  delete: {
    summary: 'Erase connection data and request revocation; ends studio sessions',
    parameters: [...scope, parameter('connectionId', string, 'Connection ID', true, 'path')],
    responses: {
      200: { description: 'Active connection data erased; revocation may be queued' },
      401: { description: 'Session missing' },
      403: { description: 'Wrong studio' },
      409: { description: 'Sync in progress' },
    },
  },
};
for (const provider of ['google', 'twitch', 'kick'])
  paths['/api/v1/auth/login/' + provider].post.requestBody = body({
    type: 'object',
    required: ['privacyVersion', 'termsVersion'],
    properties: {
      privacyVersion: { type: 'string', enum: ['2026-11-16'] },
      termsVersion: { type: 'string', enum: ['2026-11-16'] },
    },
  });
paths[base + '/connections/{connectionId}'].delete.summary =
  'Erase connection data, queue credential revocation and end studio sessions';
