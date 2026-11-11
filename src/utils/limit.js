/*
 * Cupos de descarga: protege el proceso de quedarse sin recursos cuando
 * varias personas descargan a la vez.
 */
const MAX_TOTAL = Math.max(1, Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 3);
const MAX_PER_IP = Math.max(1, Number(process.env.MAX_CONCURRENT_PER_IP) || 2);

let total = 0;
const perIp = new Map();

function acquire(ip) {
  const key = ip || 'unknown';
  const used = perIp.get(key) || 0;

  if (total >= MAX_TOTAL) {
    return { ok: false, reason: 'total', retryAfter: 8 };
  }
  if (used >= MAX_PER_IP) {
    return { ok: false, reason: 'ip', retryAfter: 8 };
  }

  total++;
  perIp.set(key, used + 1);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    total = Math.max(0, total - 1);
    const left = (perIp.get(key) || 1) - 1;
    if (left <= 0) perIp.delete(key);
    else perIp.set(key, left);
  };

  return { ok: true, release };
}

const stats = () => ({ total, limit: MAX_TOTAL, perIpLimit: MAX_PER_IP });

module.exports = { acquire, stats };
