export function createRevoker({ vault, fetcher = fetch, twitchClientId = '' }) {
  async function post(url, values, invalid) {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return;
    let value;
    try {
      value = await response.json();
    } catch {}
    if (invalid(response.status, value)) return;
    throw Error('REVOCATION_FAILED');
  }
  return async function revoke(job) {
    const tokens = vault.open(job.encryptedTokens);
    if (job.platform === 'YouTube') {
      const token = tokens.refresh_token ?? tokens.access_token;
      if (!token) return;
      return post(
        'https://oauth2.googleapis.com/revoke',
        { token },
        (status, value) => status === 400 && value?.error === 'invalid_token',
      );
    }
    if (job.platform === 'Twitch') {
      if (!tokens.access_token) return;
      if (!twitchClientId) throw Error('REVOCATION_NOT_CONFIGURED');
      return post(
        'https://id.twitch.tv/oauth2/revoke',
        { client_id: twitchClientId, token: tokens.access_token },
        (status, value) => status === 400 && value?.message === 'Invalid token',
      );
    }
    if (job.platform === 'Kick') {
      for (const [key, hint] of [
        ['refresh_token', 'refresh_token'],
        ['access_token', 'access_token'],
      ])
        if (tokens[key]) {
          const url = new URL('https://id.kick.com/oauth/revoke');
          url.searchParams.set('token', tokens[key]);
          url.searchParams.set('token_hint_type', hint);
          await post(url, {}, (status, value) => status === 400 && value?.error === 'invalid_token');
        }
      return;
    }
    throw Error('UNKNOWN_PROVIDER');
  };
}
