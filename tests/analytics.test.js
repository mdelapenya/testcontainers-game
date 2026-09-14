import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalPreviewHost } from '../src/analytics.js';

test('local preview hosts are detected', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.0.1:4173', '127.9.4.2', '::1', '[::1]', '[::1]:4173', '::ffff:127.0.0.1', '[::ffff:127.1.2.3]', '::ffff:7f00:1']) {
    assert.equal(isLocalPreviewHost(host), true);
  }
});

test('non-local hosts still inject analytics', () => {
  for (const host of ['example.com', 'example.com:4173', 'testcontainers-game.vercel.app', '127.example.com', '192.168.1.10', '::ffff:192.168.1.10', '::ffff:0808:0808']) {
    assert.equal(isLocalPreviewHost(host), false);
  }
});
