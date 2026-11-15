// One provider's requests must not multiply the import worker concurrency.
export function createAsyncLimit(maximum) {
  const queue = []; let active = 0;
  return async work => {
    if (active >= maximum) await new Promise(resolve => queue.push(resolve));
    else active++;
    try { return await work(); }
    finally { if (queue.length) queue.shift()(); else active--; }
  };
}
