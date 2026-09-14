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

function normaliseHost(hostname) {
  if (typeof hostname !== 'string') return '';
  const host = hostname.toLowerCase().trim();
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end >= 0 ? host.slice(1, end) : host.slice(1);
  }
  const colonCount = (host.match(/:/g) || []).length;
  if (colonCount === 1 && host.includes('.')) return host.split(':')[0];
  return host;
}

export function isLocalPreviewHost(hostname) {
  const host = normaliseHost(hostname);
  if (!host) return false;
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
