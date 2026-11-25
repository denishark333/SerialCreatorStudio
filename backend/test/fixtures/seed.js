export const platforms = ['YouTube', 'Twitch', 'Kick'];
export const formats = ['Vídeo', 'Short', 'VOD', 'Clip', 'Live'];
export const stages = ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Pronto', 'Publicado'];
export const workspaceId = 'studio-demo';
export function seed() {
  const channels = [
    { id: 'youtube-main', platform: 'YouTube', name: 'Serial · principal', subscribers: 28400 },
    { id: 'youtube-cuts', platform: 'YouTube', name: 'Serial · cortes', subscribers: 1700 },
    { id: 'twitch-main', platform: 'Twitch', name: 'Serial · Twitch', subscribers: 10200 },
    { id: 'kick-main', platform: 'Kick', name: 'Serial · Kick', subscribers: 4250 },
  ].map(c => ({
    ...c,
    workspaceId,
    connectionId: null,
    externalId: `demo-${c.id}`,
    lastSyncedAt: null,
    dataSource: 'demo',
  }));
  const rows = [
    [
      'youtube-main',
      'O jogo mudou. E a gente também.',
      'Vídeo',
      48320,
      62,
      '18:24',
      '2026-11-11',
      'photo-1511512578047-dfb367046420',
    ],
    [
      'twitch-main',
      'Uma noite, muitas histórias',
      'VOD',
      12480,
      38,
      '3:42:10',
      '2026-11-10',
      'photo-1542751371-adc38448a05e',
    ],
    [
      'youtube-cuts',
      'Esse final não estava no roteiro',
      'Short',
      126500,
      84,
      '0:48',
      '2026-11-09',
      'photo-1493711662062-fa541adb3fc8',
    ],
    [
      'kick-main',
      'Explorando sem olhar para trás',
      'VOD',
      8360,
      41,
      '2:16:32',
      '2026-11-08',
      'photo-1472396961693-142e6e269027',
    ],
    [
      'youtube-main',
      'Vale mesmo a pena jogar em 2026?',
      'Vídeo',
      32140,
      57,
      '14:08',
      '2026-11-06',
      'photo-1593305841991-05c297ba4575',
    ],
    [
      'twitch-main',
      'O melhor momento da semana',
      'Clip',
      18320,
      76,
      '0:32',
      '2026-11-05',
      'photo-1518709268805-4e9042af9f23',
    ],
    ['kick-main', 'Só mais uma partida…', 'Clip', 6240, 79, '0:56', '2026-11-04', 'photo-1519669556878-63bdad8a1a49'],
  ];
  const contents = rows.map(([channelId, title, format, views, retention, duration, date, image], i) => ({
    id: String(i + 1),
    workspaceId,
    channelId,
    platform: channels.find(c => c.id === channelId).platform,
    externalId: `demo-content-${i + 1}`,
    title,
    format,
    duration,
    date,
    publishedAt: `${date}T15:00:00Z`,
    image,
    thumbnailUrl: `https://images.unsplash.com/${image}?auto=format&fit=crop&w=800&q=80`,
    status: 'Público',
    views,
    retention,
    dataSource: 'demo',
    lastSyncedAt: null,
  }));
  // Separate dated observations; filters aggregate these, never lifetime counters.
  const metrics = [];
  for (const content of contents)
    for (let offset = 0; offset < 3; offset++) {
      const date = new Date(`${content.date}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const views = Math.round(content.views * [0.5, 0.3, 0.2][offset]);
      metrics.push({
        workspaceId,
        channelId: content.channelId,
        contentId: content.id,
        date: date.toISOString().slice(0, 10),
        views,
        watchTimeMinutes: Math.round(views * 1.4),
        interactions: Math.round(views * 0.068),
        dataSource: 'demo',
      });
    }
  const plans = [
    {
      id: 'a',
      title: 'Primeiras impressões: o próximo capítulo',
      channelId: 'youtube-main',
      format: 'Vídeo',
      date: '2026-11-16',
      stage: 'Edição',
    },
    {
      id: 'b',
      title: 'Live com a comunidade',
      channelId: 'twitch-main',
      format: 'Live',
      date: '2026-11-18',
      stage: 'Ideia',
    },
    {
      id: 'c',
      title: 'Os melhores momentos da semana',
      channelId: 'youtube-cuts',
      format: 'Short',
      date: '2026-11-20',
      stage: 'Pronto',
    },
    {
      id: 'd',
      title: 'Explorando um novo mundo',
      channelId: 'kick-main',
      format: 'Live',
      date: '2026-11-22',
      stage: 'Roteiro',
    },
  ].map(p => ({
    ...p,
    workspaceId,
    platform: channels.find(c => c.id === p.channelId).platform,
    createdAt: '2026-11-13T12:00:00Z',
    updatedAt: '2026-11-13T12:00:00Z',
  }));
  return {
    schemaVersion: 1,
    workspaces: [{ id: workspaceId, name: 'Meu estúdio', timezone: 'America/Sao_Paulo' }],
    channels,
    contents,
    metrics,
    plans,
    comments: [
      'Esse formato ficou incrível! Faz uma parte 2?',
      'A explicação aos 4:32 me ajudou muito.',
      'Qual foi a configuração que você usou nessa live?',
      'Seria muito bom ver os bastidores desse vídeo.',
    ].map((text, i) => ({
      id: String(i + 1),
      workspaceId,
      channelId: contents[i].channelId,
      contentId: contents[i].id,
      platform: contents[i].platform,
      author: ['Lucas Martins', 'Ana Costa', 'João Pedro', 'Beatriz Rocha'][i],
      text,
      hearted: false,
      replies: [],
      dataSource: 'demo',
    })),
  };
}
