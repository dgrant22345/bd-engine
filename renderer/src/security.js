import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOST_SUFFIXES = ['.internal', '.local', '.localhost', '.home.arpa'];

export async function validatePublicUrl(value, lookup = dns.lookup) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw publicError(400, 'A valid public URL is required.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw publicError(400, 'Only HTTP and HTTPS URLs are allowed.');
  if (parsed.username || parsed.password) throw publicError(400, 'URLs with credentials are not allowed.');
  if (parsed.port && !['80', '443'].includes(parsed.port)) throw publicError(400, 'Non-standard target ports are not allowed.');

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || !hostname.includes('.') || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw publicError(400, 'Private or local destinations are not allowed.');
  }

  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw publicError(400, 'Private or local destinations are not allowed.');
  } else {
    let addresses;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw publicError(400, 'The destination hostname could not be resolved.');
    }
    if (!addresses?.length || addresses.some((item) => !isPublicAddress(item.address))) {
      throw publicError(400, 'Private or local destinations are not allowed.');
    }
  }

  parsed.hash = '';
  return parsed.toString();
}

export function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

function isPublicIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return false;
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || /^ff/.test(normalized)) return false;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPublicIpv4(mapped[1]) : false;
  }
  return true;
}

export function publicError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
