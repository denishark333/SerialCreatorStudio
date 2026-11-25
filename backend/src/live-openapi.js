// Authenticated platform reports.
export function extendLiveSpec(spec) {
  const string = { type: 'string' },
    number = { type: 'number', nullable: true },
    ref = name => ({ $ref: '#/components/schemas/' + name }),
    obj = properties => ({ type: 'object', properties }),
    arr = items => ({ type: 'array', items });
  const schemas = spec.components.schemas;
  schemas.Coverage = obj({
    channelId: string,
    name: string,
    status: string,
    reason: { type: 'string', nullable: true },
    fetchedAt: { type: 'string', nullable: true },
  });
  schemas.LiveAudience = obj({
    status: string,
    items: arr(obj({ label: string, views: { type: 'number' } })),
    coverage: arr(ref('Coverage')),
  });
  schemas.LiveAnalytics = obj({
    period: ref('Period'),
    timezone: string,
    dataThrough: { type: 'string', nullable: true },
    status: string,
    coverage: arr(ref('Coverage')),
    summary: obj({
      views: number,
      subscribers: number,
      watchTimeMinutes: number,
      engagementRate: number,
      subscribersGained: number,
      subscribersLost: number,
      comparison: { type: 'object', nullable: true },
    }),
    timeseries: arr(
      obj({
        date: string,
        YouTube: { type: 'number' },
        watchTimeMinutes: { type: 'number' },
        likes: { type: 'number' },
        comments: { type: 'number' },
        shares: { type: 'number' },
        subscribersGained: { type: 'number' },
        subscribersLost: { type: 'number' },
      }),
    ),
    topContents: arr(
      obj({
        id: { type: 'string', nullable: true },
        externalId: string,
        channelId: string,
        title: string,
        thumbnailUrl: { type: 'string', nullable: true },
        views: { type: 'number' },
        watchTimeMinutes: { type: 'number' },
        averageViewPercentage: number,
      }),
    ),
    topLimitPerChannel: { type: 'integer' },
    audience: obj({ countries: ref('LiveAudience'), devices: ref('LiveAudience') }),
  });
  for (const metric of ['likes', 'comments', 'shares'])
    schemas.LiveAnalytics.properties.topContents.items.properties[metric] = {
      type: 'number',
      nullable: true,
      description: 'Interações por vídeo no mesmo período; null quando não coletadas',
    };
  schemas.LiveOverview = {
    allOf: [
      ref('LiveAnalytics'),
      obj({
        channels: arr(ref('Channel')),
        catalogCount: { type: 'integer' },
        lifetimeViews: number,
        latestContent: { ...ref('Content'), nullable: true },
        nextPlans: arr(ref('Plan')),
      }),
    ],
  };
  schemas.LiveRevenue = obj({
    period: ref('Period'),
    status: string,
    currency: { type: 'string', enum: ['USD'] },
    nature: { type: 'string', enum: ['estimated'] },
    amount: number,
    coverage: arr(ref('Coverage')),
    entries: arr(
      obj({ channelId: string, date: string, amount: { type: 'number' }, currency: string, nature: string }),
    ),
    payouts: arr({ type: 'object' }),
    payoutsStatus: string,
    reason: string,
  });
  schemas.Comment.properties = {
    ...schemas.Comment.properties,
    externalId: string,
    publishedAt: string,
    videoId: string,
    likeCount: { type: 'integer' },
    replyCount: { type: 'integer' },
    lastSyncedAt: string,
  };
  const base = '/api/v1/workspaces/{workspaceId}';
  for (const [route, demo, live] of [
    ['overview', 'Overview', 'LiveOverview'],
    ['analytics', 'Analytics', 'LiveAnalytics'],
    ['revenue', 'Revenue', 'LiveRevenue'],
  ]) {
    spec.paths[base + '/' + route].get.responses['200'].content['application/json'].schema.properties.data = ref(live);
  }
  const scope = [
    { name: 'workspaceId', in: 'path', required: true, schema: string },
    { name: 'channelId', in: 'path', required: true, schema: string },
  ];
  const dates = ['from', 'to'].map(name => ({
    name,
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date' },
  }));
  const response = schema => ({
    200: {
      description: 'Synchronization completed; each optional report has its own availability',
      content: { 'application/json': { schema: obj({ data: schema, meta: ref('Meta') }) } },
    },
    400: { description: 'Invalid dates' },
    401: { description: 'Authorization expired' },
    409: { description: 'Sync already running' },
  });
  spec.paths[base + '/channels/{channelId}/reports/sync'] = {
    post: {
      summary: 'Collect private reports for the exact date interval; requires Analytics scope',
      parameters: [...scope, ...dates],
      responses: response(
        obj({
          channelId: string,
          from: string,
          to: string,
          fetchedAt: string,
          sections: { type: 'object', additionalProperties: string },
        }),
      ),
    },
  };
  spec.paths[base + '/channels/{channelId}/comments/sync'] = {
    post: {
      summary: 'Import up to 100 published comment threads; resumes pagination',
      parameters: scope,
      responses: response(obj({ imported: { type: 'integer' }, complete: { type: 'boolean' }, fetchedAt: string })),
    },
  };
  spec.paths[base + '/connections/{platform}/authorize'].post.summary =
    'Single consent: catalog, analytics, monetary reports and comments';
  spec.info.version = '0.3.0';
  spec.info.description =
    'Personal API: YouTube authenticated catalog, private date-range reports, estimated USD revenue, comments and server-side planning. Real records stay in studio-live. No multiuser authorization or payments API.';
}
