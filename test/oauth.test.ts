import test from 'node:test';
import assert from 'node:assert';
import { computeExpiry } from '../src/oauth.ts';

test('computeExpiry adds seconds as milliseconds', () => {
  assert.equal(computeExpiry(60, 0), 60_000);
});
