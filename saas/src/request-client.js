import { isIP } from 'node:net';

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : String(value || '').split(',')[0];
  return raw.trim();
}

export function clientAddress(req, { trustRailway = Boolean(process.env.RAILWAY_ENVIRONMENT) } = {}) {
  if (trustRailway) {
    const railwayAddress = firstHeaderValue(req?.headers?.['x-real-ip']);
    if (isIP(railwayAddress)) return railwayAddress;
  }
  const socketAddress = String(req?.socket?.remoteAddress || '').trim();
  return isIP(socketAddress) ? socketAddress : 'unknown';
}
