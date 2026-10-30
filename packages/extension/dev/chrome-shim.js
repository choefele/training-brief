// Preview-only stand-in for chrome.* so extension pages render in a normal tab.
(() => {
  const listeners = [];
  const area = (name) => {
    const key = 'shim.' + name;
    const load = () => JSON.parse(localStorage.getItem(key) || '{}');
    const save = (o) => localStorage.setItem(key, JSON.stringify(o));
    return {
      async get(k) { const all = load(); if (k == null) return all; const ks = Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter(x => x in all).map(x => [x, all[x]])); },
      async set(o) { const all = load(); Object.assign(all, o); save(all); listeners.forEach(l => l(Object.fromEntries(Object.keys(o).map(k => [k, { newValue: o[k] }])), name)); },
      async remove(k) { const all = load(); (Array.isArray(k) ? k : [k]).forEach(x => delete all[x]); save(all); },
    };
  };
  window.chrome = {
    storage: { local: area('local'), session: area('session'), onChanged: { addListener: l => listeners.push(l) } },
    runtime: { getURL: p => new URL(p, location.href).href, getContexts: async () => [], ContextType: { TAB: 'TAB' } },
    tabs: { create: async ({ url }) => { location.href = url; }, update: async () => {} },
    windows: { update: async () => {} },
  };
})();
