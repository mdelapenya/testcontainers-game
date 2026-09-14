import { inject } from '@vercel/analytics';

export function isLocalPreviewHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
  if (!host.startsWith('::ffff:')) return false;
  const mapped = host.slice(7);
  if (mapped.startsWith('127.')) return true;
  const parts = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!parts) return false;
  const upper = Number.parseInt(parts[1], 16);
  const lower = Number.parseInt(parts[2], 16);
  const ipv4 = ((upper << 16) | lower) >>> 0;
  return (ipv4 >>> 24) === 127;
}

export function initAnalytics(hostname) {
  const host = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  if (!host || isLocalPreviewHost(host)) return;
  inject();
}
