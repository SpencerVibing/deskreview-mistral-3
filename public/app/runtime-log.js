export function createRuntimeLog(now = () => performance.now()) {
  let startedAt = now();
  let entries = [];
  let keys = new Set();

  return {
    reset() {
      startedAt = now();
      entries = [];
      keys = new Set();
    },
    record(label, detail = '', key = label) {
      if (keys.has(key)) return;
      keys.add(key);
      entries.push({ label, detail, elapsedMs: Math.max(0, now() - startedAt) });
    },
    entries() {
      return entries.slice();
    }
  };
}

