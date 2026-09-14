import { inject } from '@vercel/analytics';

function isIpv4Loopback(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return NaN;
    return Number.parseInt(part, 10);
  });
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 127;
}

export function isLocalPreviewHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || isIpv4Loopback(host)) return true;
  if (!host.startsWith('::ffff:')) return false;
  const mapped = host.slice(7);
  if (isIpv4Loopback(mapped)) return true;
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
