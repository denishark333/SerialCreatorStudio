// Offline fixture API: used by the preview media generator, Playwright checks and component tests. Never bundled into the application.
export function previewFixtures(origin) {
  const image = origin + '/studio-wallpaper.jpg',
    channelId = 'preview-channel';
  const daily = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 3 + i)).toISOString().slice(0, 10),
    YouTube: 2200 + Math.round(1400 * Math.sin(i * 0.5) ** 2) + (i === 22 ? 6400 : 0),
    likes: 90 + Math.round(160 * Math.sin(i * 0.4) ** 2),
    comments: 12 + (i % 9),
    shares: 9 + (i % 13),
    subscribersGained: 18 + (i % 20),
    subscribersLost: 2,
  }));
  daily[29].date = '2026-11-01';
  const curve = Array.from({ length: 80 }, (_, i) => ({
    elapsedVideoTimeRatio: i / 79,
    audienceWatchRatio: 1.02 - 0.47 * Math.sqrt(i / 79) + 0.035 * Math.sin(i * 0.6),
  }));
  const videos = [
    'Uma nova aventura começa aqui',
    'Os melhores momentos da semana',
    'O guia que faltava para sua próxima live',
    'Uma jornada com a comunidade',
    'Cada detalhe faz a diferença',
    'O próximo capítulo já começou',
  ].map((title, i) => ({
    id: 'preview-video-' + i,
    externalId: 'preview-' + i,
    workspaceId: 'preview-studio',
    channelId,
    platform: 'YouTube',
    title,
    format: 'Vídeo',
    date: '2026-10-' + String(28 - i * 3).padStart(2, '0'),
    publishedAt: '2026-10-' + String(28 - i * 3).padStart(2, '0') + 'T18:00:00Z',
    duration: '18:24',
    views: 48200 - i * 4500,
    periodViews: 18900 - i * 1500,
    likes: 2400 - i * 180,
    comments: 163 - i * 12,
    shares: 231 - i * 13,
    thumbnailUrl: image,
    image,
    status: 'Público',
    watchUrl: 'https://example.invalid/',
    retentionCurve: curve,
    averageViewPercentage: 61 - i * 2,
    estimatedRevenue: 96 - i * 10,
    dailyViews: daily.map((row, j) => ({ day: row.date, views: Math.round(row.YouTube * (0.3 - i * 0.025)) })),
    dataSource: 'youtube',
  }));
  const shorts = videos.slice(0, 3).map((v, i) => ({
    ...v,
    id: 'preview-short-' + i,
    externalId: 'short-' + i,
    title: ['Um momento inesperado', 'A jogada da semana', 'Bastidores da live'][i],
    format: 'Short',
    duration: '0:45',
  }));
  const channels = [
    {
      id: channelId,
      workspaceId: 'preview-studio',
      name: 'Canal de demonstração',
      platform: 'YouTube',
      externalId: 'preview-creator',
      connectionId: 'preview-google',
      subscribers: 24800,
      lastSyncedAt: '2026-11-01T18:00:00Z',
      dataSource: 'youtube',
    },
  ];
  const comments = [
    'Esse foi o melhor momento do vídeo!',
    'Como você organiza os próximos conteúdos?',
    'A edição ficou muito boa. Já esperando o próximo!',
    'Esse trecho merecia um Short!',
  ].map((text, i) => ({
    id: 'preview-comment-' + i,
    externalId: 'preview-comment-' + i,
    channelId,
    platform: 'YouTube',
    author: ['Marina', 'Lucas', 'Camila', 'Rafael'][i],
    text,
    publishedAt: '2026-11-01T16:30:00Z',
    videoId: videos[i].externalId,
    video: { id: videos[i].id, title: videos[i].title, thumbnailUrl: image },
    likeCount: 24 + i * 8,
    canReply: true,
    replies: [],
    membership: { status: 'unknown', member: null },
  }));
  const audience = items => ({ status: 'available', items, coverage: [] });
  const summary = {
    views: daily.reduce((n, r) => n + r.YouTube, 0),
    likes: daily.reduce((n, r) => n + r.likes, 0),
    comments: daily.reduce((n, r) => n + r.comments, 0),
    shares: daily.reduce((n, r) => n + r.shares, 0),
    subscribers: 24800,
    watchTimeMinutes: 318000,
    engagementRate: 8.2,
    subscribersGained: 740,
    subscribersLost: 60,
  };
  const report = {
    status: 'available',
    period: { from: '2026-10-03', to: '2026-11-01' },
    timezone: 'America/Los_Angeles',
    dataThrough: '2026-11-01',
    summary,
    coverage: [{ channelId, name: channels[0].name, status: 'available', reason: null }],
    timeseries: daily,
    topContents: videos,
    latestContent: videos[0],
    nextPlans: [],
    audience: {
      countries: audience([
        { label: 'BR', views: 74000 },
        { label: 'PT', views: 12000 },
        { label: 'US', views: 9000 },
      ]),
      devices: audience([
        { label: 'MOBILE', views: 64000 },
        { label: 'DESKTOP', views: 28000 },
        { label: 'TV', views: 8000 },
      ]),
      ages: {
        status: 'available',
        items: [
          { label: '18–24', percentage: 28 },
          { label: '25–34', percentage: 42 },
          { label: '35–44', percentage: 20 },
        ],
      },
      subscribed: audience([
        { label: 'SUBSCRIBED', views: 62000 },
        { label: 'UNSUBSCRIBED', views: 38000 },
      ]),
    },
    traffic: audience([
      { label: 'YT_SEARCH', views: 56000 },
      { label: 'RELATED_VIDEO', views: 32000 },
      { label: 'EXT_URL', views: 12000 },
    ]),
  };
  return function respond(path, query) {
    if (path.endsWith('/auth/login/google'))
      return { data: { id: 'preview-flow', secret: 'preview-only', authorizationUrl: 'https://preview.invalid/' } };
    if (path.endsWith('/auth/login/poll'))
      return {
        data: {
          status: 'connected',
          accessToken: 'preview-not-a-real-token',
          workspaceId: 'preview-studio',
          primaryChannelId: channelId,
          expiresIn: 43200,
        },
      };
    let data = [],
      list = false;
    if (path.endsWith('/preferences')) data = { platform: 'YouTube' };
    else if (path.endsWith('/channels')) {
      data = channels;
      list = true;
    } else if (path.endsWith('/connections'))
      data = {
        providers: [{ platform: 'YouTube', configured: true }],
        items: [{ id: 'preview-google', platform: 'YouTube', channelIds: [channelId], status: 'connected' }],
      };
    else if (path.endsWith('/sync/status')) data = { running: null, queued: [], latest: null };
    else if (path.endsWith('/overview') || path.endsWith('/analytics')) data = report;
    else if (path.endsWith('/catalog-summary')) data = { videos: videos.length, shorts: shorts.length, playlists: 0 };
    else if (path.endsWith('/catalog')) {
      data = query.get('externalId')
        ? videos.filter(v => v.externalId === query.get('externalId'))
        : query.get('format') === 'Short'
          ? shorts
          : videos;
      list = true;
    } else if (path.endsWith('/details')) {
      const video = videos.find(v => path.includes(v.id)) ?? videos[0];
      data = {
        ...video,
        period: report.period,
        summary: {
          views: video.periodViews,
          likes: video.likes,
          comments: video.comments,
          shares: video.shares,
          estimatedMinutesWatched: 64000,
          averageViewPercentage: 61,
          averageViewDuration: 673,
        },
        report: {
          fetchedAt: '2026-11-01T18:00:00Z',
          retention: { rows: curve },
          daily: { rows: video.dailyViews },
          traffic: {
            rows: [
              { insightTrafficSourceType: 'YT_SEARCH', views: 560 },
              { insightTrafficSourceType: 'RELATED_VIDEO', views: 320 },
              { insightTrafficSourceType: 'EXT_URL', views: 120 },
            ],
          },
          revenue: { rows: [{ estimatedRevenue: video.estimatedRevenue }] },
        },
      };
    } else if (path.endsWith('/community/comments')) {
      data = comments;
      list = true;
    } else if (path.endsWith('/community/members'))
      data = {
        status: 'unavailable',
        total: null,
        knownCount: 0,
        levels: [],
        items: [],
        coverage: [],
        pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
        revenue: { amount: null },
      };
    else if (path.endsWith('/plans')) {
      data = videos.slice(0, 4).map((v, i) => ({
        id: 'plan-' + i,
        channelId,
        title: v.title,
        format: 'Vídeo',
        date: '2026-11-' + (18 + i * 2),
        stage: ['Ideia', 'Roteiro', 'Edição', 'Pronto'][i],
      }));
      list = true;
    } else if (path.endsWith('/subscriber-goal')) data = { target: 30000 };
    else if (path.endsWith('/revenue'))
      data = {
        status: 'available',
        currency: 'USD',
        amount: 840,
        coverage: [],
        entries: Array.from({ length: 6 }, (_, i) => ({
          date: '2026-' + String(6 + i).padStart(2, '0') + '-15',
          amount: 320 + i * 104,
          currency: 'USD',
        })),
      };
    return { data, ...(list ? { pagination: { page: 1, limit: 100, total: data.length, totalPages: 1 } } : {}) };
  };
}
