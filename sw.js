// Service worker : garde une copie de l'app sur le téléphone pour qu'elle s'ouvre sans réseau.
//
// - La page (index.html) : réseau d'abord (pour avoir la dernière version), copie locale si pas de réseau.
// - Les fichiers de l'app (js/, css/, icones/, polices/) et la bibliothèque du scanner : copie locale d'abord.
//   Leur nom contient ?v=…, donc une nouvelle version de l'app demande de nouveaux fichiers.
// - Les jaquettes (images d'autres sites) : copie locale d'abord, gardée d'une version à l'autre,
//   pour les voir aussi hors ligne. Seulement les sites qui l'autorisent (CORS), dans la limite de MAX_JAQUETTES.
// - Tout le reste (Worker, AniList, BnF…) passe normalement par le réseau.
// - Notifications des sorties : reçues ici (push), même app fermée ; un appui ouvre l'app.
//
// À chaque nouvelle version de l'app, changer VERSION : le téléphone installe alors la nouvelle copie.

const VERSION = '3.53';
const CACHE = 'mangatheque-' + VERSION;
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.23.0/umd/index.min.js';
const CACHE_JAQUETTES = 'mangatheque-jaquettes';
const MAX_JAQUETTES = 400;
const DELAI_RESEAU_MS = 4000; // réseau trop lent (fond de magasin) : on ouvre la copie locale

// Installation : on lit index.html pour connaître la liste exacte des fichiers à garder
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const reponse = await fetch('index.html', { cache: 'reload' });
    const html = await reponse.clone().text();
    await cache.put('index.html', reponse);
    const fichiers = [...html.matchAll(/(?:src|href)="((?:js|css|icones|polices)\/[^"]+)"/g)].map(m => m[1]);
    await cache.addAll(fichiers);
    // La bibliothèque du scanner vient d'un autre site : si elle est injoignable, on s'en passe
    await cache.add(ZXING_URL).catch(() => {});
    await self.skipWaiting();
  })());
});

// Activation : on supprime les copies des anciennes versions
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const nom of await caches.keys()) {
      if (nom.startsWith('mangatheque-') && nom !== CACHE && nom !== CACHE_JAQUETTES) await caches.delete(nom);
    }
    await self.clients.claim();
  })());
});

async function reseauPuisCopie(requete) {
  const cache = await caches.open(CACHE);
  try {
    const reponse = await Promise.race([
      fetch(requete),
      new Promise((_, refus) => setTimeout(() => refus(new Error('réseau trop lent')), DELAI_RESEAU_MS))
    ]);
    if (reponse.ok) await cache.put('index.html', reponse.clone());
    return reponse;
  } catch (e) {
    return (await cache.match('index.html')) || Response.error();
  }
}

async function copiePuisReseau(requete) {
  const cache = await caches.open(CACHE);
  const copie = await cache.match(requete);
  if (copie) return copie;
  const reponse = await fetch(requete);
  if (reponse.ok) await cache.put(requete, reponse.clone());
  return reponse;
}

async function jaquette(requete) {
  const cache = await caches.open(CACHE_JAQUETTES);
  const copie = await cache.match(requete.url);
  if (copie) return copie;
  let reponse;
  try {
    // Demande « CORS » : une image ainsi reçue peut être gardée sans gonfler le stockage
    reponse = await fetch(requete.url, { mode: 'cors', credentials: 'omit' });
  } catch (e) {
    return fetch(requete); // site sans CORS (ou hors ligne) : affichage normal, pas de copie
  }
  if (reponse.ok) {
    await cache.put(requete.url, reponse.clone());
    // Au-delà de la limite, on oublie les plus anciennes
    const cles = await cache.keys();
    for (const cle of cles.slice(0, Math.max(0, cles.length - MAX_JAQUETTES))) await cache.delete(cle);
  }
  return reponse;
}

self.addEventListener('fetch', (event) => {
  const requete = event.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);
  if (requete.mode === 'navigate') {
    event.respondWith(reseauPuisCopie(requete));
  } else if (url.origin === self.location.origin && /\/(js|css|icones|polices)\//.test(url.pathname)) {
    event.respondWith(copiePuisReseau(requete));
  } else if (url.href === ZXING_URL) {
    event.respondWith(copiePuisReseau(requete));
  } else if (requete.destination === 'image' && url.protocol === 'https:' && url.origin !== self.location.origin) {
    event.respondWith(jaquette(requete));
  }
});

// Notification envoyée par GitHub Actions : { titre, corps, tag, ouvrir: { onglet, vue, serie } }
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { corps: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.titre || 'Ma MangaThèque', {
    body: d.corps || '', icon: 'icones/icone-192.png', tag: d.tag, data: { ouvrir: d.ouvrir || null }
  }));
});

// Un appui ouvre l'endroit concerné : dans l'app déjà ouverte (message), sinon en la lançant (adresse)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ouvrir = event.notification.data && event.notification.data.ouvrir;
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (fenetres.length) {
      if (ouvrir) fenetres[0].postMessage({ ouvrir });
      return fenetres[0].focus();
    }
    const adresse = new URL(self.registration.scope);
    if (ouvrir) for (const [cle, valeur] of Object.entries(ouvrir)) if (valeur) adresse.searchParams.set(cle, valeur);
    return self.clients.openWindow(adresse.href);
  })());
});
