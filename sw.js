// Service worker : garde une copie de l'app sur le téléphone pour qu'elle s'ouvre sans réseau.
//
// - La page (index.html) : réseau d'abord (pour avoir la dernière version), copie locale si pas de réseau.
// - Les fichiers de l'app (js/, css/, icones/, polices/) et la bibliothèque du scanner : copie locale d'abord.
//   Leur nom contient ?v=…, donc une nouvelle version de l'app demande de nouveaux fichiers.
// - Tout le reste (Worker, AniList, BnF, jaquettes…) passe normalement par le réseau.
//
// À chaque nouvelle version de l'app, changer VERSION : le téléphone installe alors la nouvelle copie.

const VERSION = '3.44';
const CACHE = 'mangatheque-' + VERSION;
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.23.0/umd/index.min.js';
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
      if (nom.startsWith('mangatheque-') && nom !== CACHE) await caches.delete(nom);
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
  }
});
