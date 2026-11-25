export function extendStudioSpec(spec) {
  const root = '/api/v1/workspaces/{workspaceId}',
    string = { type: 'string' },
    obj = properties => ({ type: 'object', properties });
  const param = (name, where = 'path', schema = string) => ({ name, in: where, required: where === 'path', schema });
  const path = (name, method, summary, params = [], properties) => {
    spec.paths[root + name] ??= {};
    spec.paths[root + name][method] = {
      summary,
      parameters: [param('workspaceId'), ...params],
      ...(properties
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties } } },
            },
          }
        : {}),
      responses: {
        200: { description: 'Success; values identify provider data or local records' },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' },
        404: { description: 'Resource not found' },
        409: { description: 'Concurrent operation or conflicting request' },
      },
    };
  };
  const dates = [
      param('from', 'query', { type: 'string', format: 'date' }),
      param('to', 'query', { type: 'string', format: 'date' }),
    ],
    channel = param('channelId'),
    content = param('contentId'),
    comment = param('commentId');
  path('/catalog', 'get', 'Enriched video catalog; search, format, date-range metrics and sort', [
    ...dates,
    param('q', 'query'),
    param('kind', 'query'),
    param('format', 'query'),
    param('sort', 'query'),
    param('channelId', 'query', { type: 'array', items: string }),
    param('page', 'query', { type: 'integer' }),
    param('limit', 'query', { type: 'integer' }),
  ]);
  path('/catalog-summary', 'get', 'Counts of imported videos, Shorts and playlists', [
    param('channelId', 'query', { type: 'array', items: string }),
  ]);
  path(
    '/community/members',
    'get',
    'Current paid members and highest membership level, only from authorized complete snapshots; unknown totals remain null',
    [
      param('channelId', 'query', { type: 'array', items: string }),
      param('q', 'query'),
      param('page', 'query', { type: 'integer' }),
      param('limit', 'query', { type: 'integer', maximum: 100 }),
    ],
  );
  path('/contents/{contentId}/details', 'get', 'Content plus saved per-video analytics for exact interval', [
    content,
    ...dates,
  ]);
  path(
    '/contents/{contentId}/reports/sync',
    'post',
    'Collect retention, daily views, traffic and monetary report for a video',
    [content, ...dates],
  );
  path(
    '/contents/{contentId}/format',
    'patch',
    'Local classification override; does not change published content',
    [content],
    { format: { type: 'string', enum: ['Vídeo', 'Short', 'VOD', 'Live'] } },
  );
  path(
    '/channels/{channelId}/formats/sync',
    'post',
    'Classify up to 200 videos using creatorContentType from Analytics',
    [channel, ...dates],
  );
  path('/playlists', 'get', 'Imported playlists with ordered items', [
    param('channelId', 'query', { type: 'array', items: string }),
    param('q', 'query'),
  ]);
  path(
    '/channels/{channelId}/playlists/sync',
    'post',
    'Import up to 10 playlists, with first 50 items each; resume cursor',
    [channel],
  );
  path('/playlists/{playlistId}/more', 'post', 'Import next 50 items of an existing playlist', [param('playlistId')]);
  path(
    '/community/comments/{commentId}/annotations',
    'patch',
    'Local heart, pin and hide flags; no remote action',
    [comment],
    { localHearted: { type: 'boolean' }, localPinned: { type: 'boolean' }, localHidden: { type: 'boolean' } },
  );
  path(
    '/community/comments/{commentId}/publish-reply',
    'post',
    'Publish a public reply on YouTube after explicit user submission',
    [comment],
    {
      text: { type: 'string', minLength: 1, maxLength: 5000 },
      requestId: { type: 'string', minLength: 1, maxLength: 100 },
    },
  );
  for (const type of ['payouts', 'deals'])
    path(
      '/financial/' + type,
      'get',
      'Manual financial records, with source, currency and integer cents; history=all includes future forecasts',
      [
        ...dates,
        param('history', 'query', { type: 'string', enum: ['all'] }),
        param('page', 'query', { type: 'integer' }),
        param('limit', 'query', { type: 'integer', maximum: 100 }),
        param('channelId', 'query', { type: 'array', items: string }),
      ],
    );
  path('/financial', 'post', 'Create a manual payout or brand deal', [], {
    type: { type: 'string', enum: ['payout', 'deal'] },
    title: string,
    channelId: string,
    amount: { type: 'number', minimum: 0, maximum: 1e9 },
    currency: { type: 'string', enum: ['BRL', 'USD', 'EUR'] },
    date: { type: 'string', format: 'date' },
    stage: string,
  });
  path('/financial/{recordId}', 'patch', 'Update stage of a manual financial record', [param('recordId')], {
    stage: string,
  });
  path('/financial/{recordId}', 'delete', 'Delete a manual financial record', [param('recordId')]);
  path(
    '/streams/sessions',
    'get',
    'Twitch/Kick broadcasts of the period: sampled viewers, followers gained, raids, subs, bits and unique chatters',
    [...dates, param('channelId', 'query', { type: 'array', items: string })],
  );
  path(
    '/streams/analytics',
    'get',
    'Twitch/Kick analytics of the period: totals, one row per day, games and raiding channels',
    [...dates, param('channelId', 'query', { type: 'array', items: string })],
  );
  path(
    '/streams/revenue',
    'get',
    "This month's Twitch revenue estimate (subscribers by tier × net value per tier, plus bits); ads not included",
    [param('channelId', 'query', { type: 'array', items: string })],
  );
  path(
    '/channels/{channelId}/revenue-settings',
    'patch',
    'Net US$ per active subscriber of each tier and per Prime Gaming sub, used by the Twitch estimate',
    [param('channelId')],
    Object.fromEntries(
      ['tier1', 'tier2', 'tier3', 'prime'].map(k => [k, { type: ['number', 'null'], minimum: 0, maximum: 100 }]),
    ),
  );
  path('/subscriber-goal', 'get', 'Workspace subscriber goal');
  path('/subscriber-goal', 'patch', 'Set a local workspace subscriber target', [], {
    target: { type: 'integer', minimum: 1, maximum: 1e9 },
  });
  path(
    '/sync',
    'post',
    'Queue a global workspace sync, deduplicated by date interval. force=true is the manual "Sincronizar": collects everything again, at most once per SYNC_MANUAL_COOLDOWN_MINUTES (429 SYNC_COOLDOWN with details.retryAt); force=false follows the automatic cadence',
    [...dates, param('force', 'query', { type: 'boolean' })],
  );
  path('/sync/status', 'get', 'Global queue progress, terminal status, per-phase failures and unavailable sections');
  path(
    '/community/comments/{commentId}/moderation',
    'post',
    'Moderate on YouTube; local status changes only after provider confirmation',
    [comment],
    { status: { type: 'string', enum: ['rejected', 'published'] } },
  );
  spec.paths[root + '/community/comments/{commentId}/annotations'].patch.deprecated = true;
  spec.paths[root + '/community/comments/{commentId}/annotations'].patch.responses = {
    410: { description: 'Local simulated management actions have been removed' },
  };
  spec.info.version = '0.5.0';
  spec.info.description +=
    ' Creator studio includes playlists, Shorts classification, side reports, remote comment moderation, explicit public reply publishing and manual financial records. Native creator hearts/pins and paid membership lists are not integrated.';
}
