// Run at most `limit` tasks at once; the JOHO relay rejects more than ~3 concurrent requests.
export function createQueue(limit = 3) {
  let active = 0;
  const waiting = [];
  const next = () => {
    while (active < limit && waiting.length) {
      const { fn, resolve, reject } = waiting.shift();
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
    }
  };
  return {
    run: fn => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); }),
    get active() { return active; },
    get pending() { return waiting.length; },
  };
}

export async function withRetry(fn, { tries = 4, delay = 8000, retryIf = () => false, onError } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (err) {
      onError?.(err);
      if (i >= tries - 1 || !retryIf(err)) throw err;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}
