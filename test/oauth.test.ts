import test from 'node:test';
import assert from 'node:assert';
import { computeExpiry, upsertConnection, getConnection } from '../src/oauth.ts';

test('computeExpiry adds seconds as milliseconds', () => {
  assert.equal(computeExpiry(60, 0), 60_000);
});

test('upsert stores a connection', () => {
  upsertConnection({ connection_id: 'c1', provider: 'github', accessToken: 't', expires_at: 1 });
  assert.ok(getConnection('c1', 'github'));
});

test('get returns the stored connection', () => {
  const c = getConnection('c1', 'github');
  assert.equal(c?.provider, 'github');
});
