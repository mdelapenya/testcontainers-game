import { inject } from '@vercel/analytics';

export function isLocalPreviewHost(hostname) {
  return hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('::ffff:127.');
}

export function initAnalytics(hostname = window.location.hostname) {
  if (!isLocalPreviewHost(hostname)) inject();
}
