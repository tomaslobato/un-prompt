const NAME = 'sector-rojo-session';

function holdWithLocks() {
  return new Promise((resolve) => {
    let done = false;
    navigator.locks.request(NAME, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (done) return undefined;
      done = true;
      if (!lock) {
        resolve(false);
        return undefined;
      }
      resolve(true);
      return new Promise(() => {});
    }).catch(() => {
      if (!done) {
        done = true;
        holdWithChannel().then(resolve);
      }
    });
  });
}

function holdWithChannel() {
  return new Promise((resolve) => {
    let denied = false;
    const id = crypto.randomUUID();
    let bc = null;
    try {
      bc = new BroadcastChannel(NAME);
    } catch {
      resolve(true);
      return;
    }
    bc.onmessage = (ev) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ping') bc.postMessage({ type: 'pong', id });
      if ((data.type === 'pong' || data.type === 'claim') && data.id !== id) denied = true;
    };
    bc.postMessage({ type: 'ping', id });
    bc.postMessage({ type: 'claim', id });
    setTimeout(() => {
      if (denied) {
        resolve(false);
        return;
      }
      const beat = () => {
        try { localStorage.setItem(NAME, JSON.stringify({ id, t: Date.now() })); } catch { /* ignore */ }
      };
      try {
        const prev = JSON.parse(localStorage.getItem(NAME) || 'null');
        if (prev && prev.id !== id && Date.now() - prev.t < 1500) {
          resolve(false);
          return;
        }
      } catch { /* ignore */ }
      beat();
      const timer = setInterval(beat, 800);
      window.addEventListener('pagehide', () => {
        clearInterval(timer);
        try {
          const cur = JSON.parse(localStorage.getItem(NAME) || 'null');
          if (cur?.id === id) localStorage.removeItem(NAME);
        } catch { /* ignore */ }
      });
      resolve(true);
    }, 160);
  });
}

export function acquireSingleTabLock() {
  if (navigator.locks?.request) return holdWithLocks();
  return holdWithChannel();
}
