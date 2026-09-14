import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalPreviewHost } from '../src/analytics.js';

test('local preview hosts are detected', () => {
  for (const host of ['localhost', '127.0.0.1', '127.9.4.2', '::1', '[::1]', '::ffff:127.0.0.1']) {
    assert.equal(isLocalPreviewHost(host), true);
  }
});

test('non-local hosts still inject analytics', () => {
  for (const host of ['example.com', 'testcontainers-game.vercel.app', '192.168.1.10', '::ffff:192.168.1.10']) {
    assert.equal(isLocalPreviewHost(host), false);
  }
});
