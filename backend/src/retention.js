const DAY = 86400000;
export async function pruneImportedData(repository, now = Date.now()) {
  const old = (value, days = 29) =>
    !value || !Number.isFinite(Date.parse(value)) || now - Date.parse(value) > days * DAY;
  return repository.update(s => {
    let removed = 0;
    const prune = (key, date) => {
      const rows = s[key] ?? [];
      s[key] = rows.filter(row => !old(date(row)));
      removed += rows.length - s[key].length;
    };
    for (const key of ['reports', 'videoReports']) prune(key, row => row.fetchedAt);
    for (const key of ['contents', 'comments', 'playlists']) prune(key, row => row.lastSyncedAt);
    prune('membershipSnapshots', row => row.checkedAt);
    prune('streamSnapshots', row => row.observedAt);
    prune('streamEvents', row => row.at);
    prune('chatSessions', row => row.endedAt ?? row.startedAt);
    s.syncJobs = (s.syncJobs ?? []).filter(
      row => ['running', 'queued'].includes(row.status) || !old(row.finishedAt ?? row.createdAt, 7),
    );
    s.pendingRevocations = (s.pendingRevocations ?? []).filter(row => row.expiresAt > now);
    for (const channel of s.channels) {
      const collected = [
        channel.lastSyncedAt,
        channel.profileFetchedAt,
        channel.statisticsUpdatedAt,
        s.connections.find(c => c.id === channel.connectionId)?.createdAt,
      ]
        .filter(Boolean)
        .sort()
        .at(-1);
      if (old(collected)) {
        for (const key of Object.keys(channel))
          if (
            ![
              'id',
              'workspaceId',
              'externalId',
              'platform',
              'connectionId',
              'dataSource',
              'uploadsPlaylistId',
              'lastSyncedAt',
            ].includes(key)
          )
            delete channel[key];
        channel.name = 'Canal conectado';
        channel.thumbnailUrl = null;
      }
    }
    return { removed };
  });
}
