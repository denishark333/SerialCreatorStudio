import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle } from '../src/routes/workspace.js';

test('direct provider calls rest per studio and resource', () => {
  let clock = 0;
  const throttle = createThrottle(() => clock);
  throttle('studio-a|catalog|yt', 15 * 60000);
  assert.throws(
    () => throttle('studio-a|catalog|yt', 15 * 60000),
    error => {
      assert.equal(error.code, 'SYNC_COOLDOWN');
      assert.equal(error.status, 429);
      assert.match(error.message, /15 min/);
      return true;
    },
  );
  throttle('studio-b|catalog|yt', 15 * 60000); // another studio is independent
  throttle('studio-a|reports|yt', 15 * 60000); // another resource too
  clock += 15 * 60000;
  throttle('studio-a|catalog|yt', 15 * 60000);
});
