export function safeRequestPath(value) {
  try {
    return new URL(String(value || '/'), 'https://bd-engine.local').pathname.slice(0, 300) || '/';
  } catch {
    return '/';
  }
}

export function safeErrorSummary(error) {
  const name = String(error?.name || 'Error').replace(/[^a-z0-9_.-]/gi, '').slice(0, 40) || 'Error';
  const code = String(error?.code || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, 40);
  let message = String(error?.message || error || 'Unexpected server error')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\b/g, '[email]')
    .replace(/\b(authorization|password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, (raw) => safeUrlWithoutQuery(raw))
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    .trim()
    .slice(0, 300);
  if (!message) message = 'Unexpected server error';
  return [name, code && `(${code})`, message].filter(Boolean).join(' ');
}

function safeUrlWithoutQuery(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[url]';
  }
}
