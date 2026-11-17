export function ukgBoard(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const pro = url.pathname.match(/^\/([^/]+)\/JobBoard\/([a-f\d-]{36})(?:\/|$)/i);
    if (/^recruiting\d*\.ultipro\.(?:com|ca)$/i.test(url.hostname) && pro) {
      return { type: 'ukg_pro', id: `${url.hostname}/${pro[1]}/${pro[2]}`,
        url: `${url.origin}/${pro[1]}/JobBoard/${pro[2]}` };
    }
    const ready = url.pathname.match(/^\/ta\/([\w-]+)\.careers$/i);
    if (/^secure\d+\.saashr\.com$/i.test(url.hostname) && ready) {
      const board = new URL(`${url.origin}${url.pathname}`);
      for (const key of ['lang', 'ein_id', 'career_portal_id']) if (url.searchParams.has(key)) board.searchParams.set(key, url.searchParams.get(key));
      return { type: 'ukg_ready', id: `${url.hostname}/${ready[1]}`, company: ready[1], url: board.toString() };
    }
  } catch { /* Invalid saved links cannot become a source. */ }
  return null;
}
