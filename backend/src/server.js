import { pruneImportedData } from './retention.js';
import { createRevoker } from './revocations.js';
import { createAuth } from './auth.js';
import { createStreams } from './streams.js';
import { createEventSub } from './eventsub.js';
import { createVault } from './vault.js';
import { createYouTube } from './youtube.js';
import { createApp } from './app.js';
import { openRepository } from './storage/open.js';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4000);
const token = process.env.API_TOKEN ?? '';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida');
if ((process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(host)) && token.length < 32)
  throw new Error('Defina API_TOKEN com pelo menos 32 caracteres antes de aceitar conexões externas.');
const origins = (process.env.CORS_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const repository = await openRepository({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? './data/store.json',
  journalFile: process.env.DELETION_JOURNAL_FILE,
  onFatal: error => {
    console.error(error.message);
    process.exit(1); // systemd restarts the API, which takes the database lock again
  },
});
console.log(`Armazenamento: ${repository.kind === 'postgres' ? 'PostgreSQL' : 'arquivo JSON'}`);
const vault = await createVault(process.env.TOKEN_KEY_FILE ?? './data/token.key', {
  allowCreate: !(repository.snapshot().connections ?? []).some(c => c.encryptedTokens),
});
const auth = createAuth({
  repository,
  logger: console,
  inviteCodes: (process.env.INVITE_CODES ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean),
});
const youtube = createYouTube({
  repository,
  vault,
  auth,
  membershipsEnabled: process.env.YOUTUBE_MEMBERSHIPS_ENABLED === 'true',
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/v1/oauth/google/callback',
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
});
const streams = createStreams({
  repository,
  vault,
  auth,
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
  configs: Object.fromEntries(
    ['Twitch', 'Kick'].map(p => [
      p,
      {
        clientId: process.env[p.toUpperCase() + '_CLIENT_ID'],
        clientSecret: process.env[p.toUpperCase() + '_CLIENT_SECRET'],
        redirectUri:
          process.env[p.toUpperCase() + '_REDIRECT_URI'] ??
          'http://localhost:4000/api/v1/oauth/' + p.toLowerCase() + '/callback',
      },
    ]),
  ),
});
const eventSub = createEventSub({ repository, streams });
const syncMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 30);
if (!Number.isFinite(syncMinutes) || syncMinutes < 5 || syncMinutes > 1440)
  throw new Error('SYNC_INTERVAL_MINUTES must be between 5 and 1440.');
const syncConcurrency = Number(process.env.SYNC_CONCURRENCY ?? 4);
const syncWorkspaces = Number(process.env.SYNC_WORKSPACES ?? 2);
const hours = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
};
const syncCadence = {
  catalogMs: hours('SYNC_CATALOG_HOURS', 6, 1, 48) * 3600000,
  analyticsMs: hours('SYNC_ANALYTICS_HOURS', 24, 6, 168) * 3600000,
  manualCooldownMs: hours('SYNC_MANUAL_COOLDOWN_MINUTES', 15, 0, 240) * 60000,
};
const server = createApp({
  repository,
  auth,
  token,
  requireConsent: true,
  legalConfig: {
    supportEmail: process.env.PRIVACY_CONTACT_EMAIL ?? 'contato.serialhealer@gmail.com',
    backupsConfirmed: process.env.BACKUP_RETENTION_CONFIRMED === 'true',
  },
  revoke: createRevoker({ vault, twitchClientId: process.env.TWITCH_CLIENT_ID }),
  syncConcurrency,
  syncWorkspaces,
  syncCadence,
  trustProxy: process.env.TRUST_PROXY === 'true',
  origins,
  youtube,
  streams,
  autoSync: true,
  syncIntervalMs: syncMinutes * 60000,
});
const maintenance = setInterval(
  () =>
    void pruneImportedData(repository).catch(error =>
      console.error('Data retention maintenance failed:', error?.message ?? error),
    ),
  6 * 3600000,
);
maintenance.unref();
await pruneImportedData(repository);
server.listen(port, host, () => {
  server.privacy.start();
  void streams
    .initialize()
    .then(() => {
      server.synchronizer.start();
      eventSub.start();
    })
    .catch(error => console.error('Global synchronization could not start:', error?.message ?? error));
  console.log(
    `Serial API: http://${host}:${port}\nOpenAPI: /api/v1/openapi.json\nAuth: ${token ? 'owner bearer token' : 'local development, no authentication'}`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(maintenance);
    streams.stop();
    server.privacy.stop();
    server.synchronizer.stop();
    // Pending EventSub writes (events, chat counts) are saved before the storage closes.
    server.close(
      () =>
        void eventSub
          .stop()
          .catch(() => {})
          .then(() => repository.close())
          .finally(() => process.exit(0)),
    );
    setTimeout(() => process.exit(1), 5000).unref();
  });
