// Stubs navigateur minimaux pour charger app.js sous Node (tests).
// app.js ne touche au DOM qu'à l'exécution des fonctions UI — les stubs
// renvoient des éléments inertes. localStorage est un Map en mémoire.
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const elStub = () => ({
  value: '', textContent: '', innerHTML: '', style: {}, className: '',
  classList: { add(){}, remove(){}, toggle(){} },
  addEventListener(){}, appendChild(){}, click(){}, focus(){},
  querySelectorAll: () => [], querySelector: () => null, checked: false,
  getContext: () => null, setAttribute(){},
});
global.document = {
  getElementById: () => elStub(),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => elStub(),
  addEventListener(){},
  body: elStub(),
  documentElement: elStub(),
};
global.window = global;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.scrollTo = () => {};
global.navigator = { userAgent: 'test', serviceWorker: undefined, onLine: true };
global.location = { search: '', origin: 'http://x', pathname: '/', href: 'http://x/', hash: '' };
global.crypto = require('crypto').webcrypto;
global.matchMedia = () => ({ matches: false, addEventListener(){} });
global.fetch = () => Promise.reject(new Error('no network in tests'));
global.confirm = () => false;
global.alert = () => {};
global.setTimeout = () => 0; // pas de rendu différé (Taylor chart) en test
global.Notification = undefined;

module.exports = { store, elStub };
