const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.dulcemaria.hrcastell.com';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safePublicUrl(value, fallback = '#') {
  if (!value) return fallback;
  try {
    const url = new URL(String(value), window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}
