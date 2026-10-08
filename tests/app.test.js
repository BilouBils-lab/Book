// Tests automatiques de Ma MangaThèque.
// Lancement : voir tests/README.md (en bref : `cd tests && npm install && npm test`).
//
// Chaque test ouvre l'app dans un navigateur neuf. Les services extérieurs (Worker, AniList,
// Jikan, Google Books, BnF…) sont simulés : les tests sont rapides et ne dépendent pas d'internet.
// La date est figée au 8 octobre 2026 pour que les estimations de sortie restent stables.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const RACINE = path.join(__dirname, '..');
const DONNEES = path.join(__dirname, 'donnees');
const WORKER = 'https://manga-gemini-proxy.nabil-chilla.workers.dev';
const DATE_TEST = new Date('2026-10-08T12:00:00');

// --- Mini cadre de test ---------------------------------------------------------------

const tests = [];
function test(nom, fn) { tests.push({ nom, fn }); }

let verifications = 0;
function verifier(condition, message) {
  verifications++;
  if (!condition) throw new Error(message);
}
function egal(obtenu, attendu, message) {
  verifier(JSON.stringify(obtenu) === JSON.stringify(attendu),
    `${message}\n      attendu : ${JSON.stringify(attendu)}\n      obtenu  : ${JSON.stringify(obtenu)}`);
}

// --- Serveur local : sert les fichiers de l'app (la caméra exige http, pas file://) ---

function demarrerServeur() {
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
  const serveur = http.createServer((req, res) => {
    const chemin = path.join(RACINE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!chemin.startsWith(RACINE) || !fs.existsSync(chemin) || fs.statSync(chemin).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': (types[path.extname(chemin)] || 'application/octet-stream') + '; charset=utf-8' });
    fs.createReadStream(chemin).pipe(res);
  });
  return new Promise(resolve => serveur.listen(0, '127.0.0.1', () => resolve(serveur)));
}

// --- Ouverture de l'app avec les services simulés ---------------------------------------

// `services` : fonctions facultatives { anilist, jikan, googleBooks, worker } qui reçoivent la requête
// et renvoient { status, body } (objet → JSON). Par défaut : 404.
async function ouvrirApp(navigateur, base, services = {}) {
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'], locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  const alertes = [];
  page.on('dialog', d => { alertes.push(d.message()); d.accept(); });
  await page.clock.setFixedTime(DATE_TEST);

  const repondre = (route, rep) => route.fulfill({
    status: (rep && rep.status) || (rep ? 200 : 404),
    contentType: 'application/json',
    body: rep ? (typeof rep.body === 'string' ? rep.body : JSON.stringify(rep.body)) : '{}'
  });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ path: require.resolve('@zxing/library/umd/index.min.js'), contentType: 'application/javascript' }));
  await page.route(WORKER + '/mangainsight/*', route => route.fulfill({
    path: path.join(DONNEES, route.request().url().endsWith('core') ? 'mangainsight-core.json' : 'mangainsight-rows.json'),
    contentType: 'application/json'
  }));
  await page.route(WORKER + '/**', async route => {
    if (route.request().url().includes('/mangainsight/')) return route.fallback();
    repondre(route, services.worker && await services.worker(route.request()));
  });
  await page.route('https://graphql.anilist.co/**', async route => repondre(route, services.anilist && await services.anilist(route.request())));
  await page.route('https://api.jikan.moe/**', async route => repondre(route, services.jikan && await services.jikan(route.request())));
  await page.route('https://www.googleapis.com/**', async route => repondre(route, services.googleBooks ? await services.googleBooks(route.request()) : { body: { totalItems: 0 } }));

  await page.goto(base + '/index.html');
  await page.waitForFunction(() => typeof rendreVues === 'function' && document.readyState === 'complete');
  await page.waitForTimeout(300);
  return { page, erreurs, alertes, fermer: () => contexte.close() };
}

// Tomes 1..n possédés ; les `lus` premiers sont lus ; `sauf` = numéros non possédés
function tomes(n, lus = 0, sauf = []) {
  return Array.from({ length: n }, (_, i) => ({ numero: i + 1, possede: !sauf.includes(i + 1), lu: i < lus }));
}

async function definirBibliotheque(page, series) {
  await page.evaluate((s) => { bibliotheque = s; rendreVues(); }, series);
}

// Charge les données Manga Insight de test et met les séries à jour
async function avecMangaInsight(page, series) {
  await page.evaluate(async (s) => { bibliotheque = s; await majMangaInsightAuDemarrage(); rendreVues(); }, series);
}

// =========================================================================================
// Tests
// =========================================================================================

test('Chaque élément utilisé par le code existe dans la page', async () => {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const js = fs.readdirSync(path.join(RACINE, 'js')).map(f => fs.readFileSync(path.join(RACINE, 'js', f), 'utf8')).join('\n');
  const utilises = new Set([...js.matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1]));
  const definis = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
  const manquants = [...utilises].filter(id => !definis.has(id));
  egal(manquants, [], 'identifiants utilisés par le code mais absents de index.html');
});

test('Le numéro de version est le même partout', async () => {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const affiche = (html.match(/version-tag">v([\d.]+)</) || [])[1];
  const fichiers = [...html.matchAll(/(?:src|href)="(?:js|css)\/[^"?]+\?v=([\d.]+)"/g)].map(m => m[1]);
  verifier(affiche, 'numéro de version affiché introuvable');
  verifier(fichiers.length >= 10, 'fichiers CSS / JS non référencés avec ?v=');
  egal([...new Set(fichiers)], [affiche], 'les ?v= des fichiers doivent correspondre à la version affichée');
  const icone = (html.match(/rel="apple-touch-icon" href="([^"?]+)/) || [])[1];
  verifier(icone && fs.existsSync(path.join(RACINE, icone)), "l'icône de l'écran d'accueil est un fichier du dépôt : " + icone);
});

test("L'app démarre sans erreur, avec ses trois onglets", async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  egal(await page.$$eval('.tab-btn', b => b.map(x => x.textContent.replace(/\s*\(\d+\)/, ''))), ['Pile à lire', 'Collection', 'À venir'], 'onglets');
  egal(erreurs, [], 'erreurs JavaScript au démarrage');
  await fermer();
});

test('Manga Insight : tomes parus, édition, rythme et estimation', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  await avecMangaInsight(page, [
    { titre: 'Ao Ashi', tomes: tomes(3) },
    { titre: 'Berserk (Prestige)', editeur: 'Glénat', tomes: tomes(4) },
    { titre: 'One Piece', tomes: tomes(12) },
    { titre: 'Kagurabachi', tomes: tomes(10) },
    { titre: 'Moi, quand je me réincarne en Slime', tomes: tomes(5) },
    { titre: 'Dragon Ball', statut: 'Terminée', tomes: tomes(42) },
    { titre: 'Série Inexistante', tomes: tomes(1) }]);
  const r = await page.evaluate(() => bibliotheque.map(s => {
    const p = prochaineSortie(s);
    return [s.titre, s.tomesParus || null, s.parution ? s.parution.nom : null, p ? `${p.vol} ${moisTexte(p.k)}` : null];
  }));
  egal(r, [
    ['Ao Ashi', 36, 'Ao Ashi - Playmaker', '37 novembre 2026'],
    ['Berserk (Prestige)', 6, 'Berserk - Edition Prestige', '7 novembre 2026'],
    ['One Piece', 113, 'One Piece', '114 février 2027'],
    ['Kagurabachi', 10, 'Kagurabachi', '11 novembre 2026'],
    ['Moi, quand je me réincarne en Slime', 30, 'Moi quand je me réincarne en slime', '31 novembre 2026'],
    ['Dragon Ball', 42, 'Dragon ball', null],
    ['Série Inexistante', null, null, null]
  ], 'séries retrouvées (coffrets, collectors exclus) et estimations');
  verifier(await page.evaluate(() => !!bibliotheque[0].tomes[0].isbn), "l'ISBN des tomes possédés est rempli");
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Fiche : progression, prochain tome, tranches et ajout d’un tome manquant', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  await definirBibliotheque(page, [
    { titre: 'Ao Ashi', tomesParus: 14, tomesParusSource: 'Manga Insight', statut: 'En cours', genre: 'Seinen, Sport', tomes: tomes(14, 4, [6, 9]) },
    { titre: 'One Piece', tomesParus: 110, tomesParusSource: 'Manga Insight', tomes: tomes(12, 4) }]);
  await page.evaluate(() => ouvrirModalSerie(0));
  egal(await page.textContent('#fiche-compteur'), '12 / 14 possédés · 4 lus', 'compteur');
  egal(await page.textContent('#fiche-prochain'), 'Prochain à acheter : tome 6 · 2 manquants', 'prochain tome');
  egal(await page.$$eval('#modal-pastilles .pastille', p => p.map(x => x.textContent)), ['En cours', 'Seinen', 'Sport'], 'pastilles');
  await page.click('#modal-volumes-grid .tome-box >> text=/^6$/');
  egal(await page.textContent('#fiche-prochain'), 'Prochain à acheter : tome 9', 'après appui sur le tome 6');

  await page.evaluate(() => ouvrirModalSerie(1));
  egal(await page.$$eval('.tranche', t => t.length), 11, '110 tomes → 11 tranches');
  egal(await page.$$eval('.tranche.ouverte .tranche-nom', t => t.map(x => x.textContent)), ['Tomes 11–20'], 'tranche du prochain tome dépliée');
  await page.click('.tranche-entete >> text=Tomes 1–10');
  egal(await page.$$eval('.tranche.ouverte', t => t.length), 2, 'dépliage d’une tranche');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Collection : cartes et tri « À compléter »', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  await definirBibliotheque(page, [
    { titre: 'One Piece', tomesParus: 110, tomes: tomes(12, 4) },
    { titre: 'Berserk (Prestige)', tomesParus: 6, tomes: tomes(4) },
    { titre: 'Dragon Ball', statut: 'Terminée', tomesParus: 42, tomes: tomes(42, 42) },
    { titre: 'Kagurabachi', tomes: tomes(5, 3, [3]) }]);
  await page.selectOption('#tri-select', 'completer');
  egal(await page.$$eval('.series-card', c => c.map(x => x.querySelector('.series-title').textContent + ' — ' + x.querySelector('.series-meta').textContent)), [
    'Kagurabachi — 4 possédés · 1 à acheter · 3 lus',
    'Berserk (Prestige) — 4 / 6 · 2 à acheter · 0 lu',
    'One Piece — 12 / 110 · 98 à acheter · 4 lus',
    'Dragon Ball — 42 / 42 · Complète ✓ · 42 lus'
  ], 'ordre et contenu des cartes');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Pile à lire : en cours, encore un effort, à commencer', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  const t = (n, lus, luLe) => tomes(n, lus).map((x, i) => (i < lus && luLe ? { ...x, luLe } : x));
  await definirBibliotheque(page, [
    { titre: 'Kagurabachi', tomes: t(10, 3, 1000) },
    { titre: 'Ao Ashi', tomes: t(36, 30, 5000) },
    { titre: 'Berserk of Gluttony', tomes: t(13, 12) },
    { titre: 'Berserk (Prestige)', tomes: t(4, 0) },
    { titre: 'Dragon Ball', tomes: t(42, 42) }]);
  await page.evaluate(() => changerOnglet('pal'));
  const onglets = () => page.$$eval('#view-pal .selecteur-vue button', b => b.map(x => (x.className === 'actif' ? '*' : '') + x.textContent));
  const cartes = () => page.$$eval('#view-pal .pal-item', els => els.map(e => e.querySelector('.pal-title').textContent + ' — ' + e.querySelector('.pal-tome').textContent));
  egal(await onglets(), ['*En cours2', 'Effort1', 'À commencer1'], 'sous-onglets avec leur nombre de séries');
  egal(await cartes(), ['Ao Ashi — Tome 31 · encore 6 à lire', 'Kagurabachi — Tome 4 · encore 7 à lire'], 'en cours : la dernière lue en haut');
  await page.click('#view-pal .selecteur-vue button >> text=Effort');
  egal(await cartes(), ['Berserk of Gluttony — Tome 13 · le dernier, courage !'], 'encore un effort');
  await page.click('#view-pal .selecteur-vue button >> text=À commencer');
  egal(await cartes(), ['Berserk (Prestige) — Tome 1 · 4 tomes à lire'], 'à commencer');

  // « Lu ✓ » : la série change de sous-onglet, un message le signale
  await page.click('.pal-item:has-text("Berserk (Prestige)") .btn-read-action');
  egal(await page.textContent('#toast span'), 'Berserk (Prestige) passe dans « Effort »', 'message de changement de groupe');
  egal(await onglets(), ['En cours2', 'Effort2', '*À commencer0'], 'on reste sur le sous-onglet choisi');
  verifier((await page.textContent('#view-pal')).includes('Rien à commencer'), 'message quand le groupe est vide');
  await page.click('#view-pal .selecteur-vue button >> text=En cours');
  await page.click('.pal-item:has-text("Kagurabachi") .btn-read-action');
  egal((await cartes()).slice(0, 2), ['Kagurabachi — Tome 5 · encore 6 à lire', 'Ao Ashi — Tome 31 · encore 6 à lire'], '« Lu ✓ » fait remonter la série lue');
  await page.click('#view-pal .selecteur-vue button >> text=Effort');
  await page.click('.pal-item:has-text("Berserk of Gluttony") .btn-read-action');
  egal(await page.textContent('#toast span'), '🎉 Berserk of Gluttony : plus rien à lire, bravo !', 'série terminée');
  egal(await page.evaluate(() => document.getElementById('detail-modal').classList.contains('active')), false, '« Lu ✓ » n’ouvre pas la fiche');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('À venir : sorties par mois, achats cochables, annuler, mise de côté', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  await avecMangaInsight(page, [
    { titre: 'Ao Ashi', tomes: tomes(36, 30) },
    { titre: 'Berserk (Prestige)', tomes: tomes(4) },
    { titre: 'One Piece', tomes: tomes(12, 4) },
    { titre: 'Kagurabachi', tomes: tomes(10, 0, [4]) }]);
  await page.evaluate(() => changerOnglet('avenir'));
  egal(await page.$$eval('#view-avenir .pal-section', s => s.map(x => x.textContent)),
    ['📅 Novembre 2026 le mois prochain', '📅 Février 2027'], 'mois des prochaines sorties');

  await page.click('.selecteur-vue button >> text=À acheter');
  const achats = () => page.$$eval('.achat-item', c => c.map(x => x.querySelector('.pal-title').textContent + ' ' + [...x.querySelectorAll('.achat-tome, .achat-reste')].map(y => y.textContent).join(',')));
  egal(await achats(), ['Kagurabachi 4', 'Berserk (Prestige) 5,6', 'One Piece 13,14,15,+98'], 'tomes à acheter');
  await page.click('.achat-item:has-text("Berserk") .achat-tome >> text=5');
  egal(await achats(), ['Berserk (Prestige) 6', 'Kagurabachi 4', 'One Piece 13,14,15,+98'], 'après achat du tome 5');
  await page.click('#toast button');
  egal(await page.evaluate(() => bibliotheque[1].tomes.some(t => t.numero === 5)), false, '« Annuler » retire le tome ajouté');

  await page.evaluate(() => ouvrirModalSerie(2));
  await page.click('button[aria-label="Plus d\'actions"]');
  await page.click('#menu-mise-de-cote');
  await page.evaluate(() => fermerModal());
  egal((await achats()).some(a => a.startsWith('One Piece')), false, 'série mise de côté retirée des achats');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('« Mettre à jour mes séries » affiche un bilan', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base, { worker: () => ({ body: { total: 0, notices: [] } }) });
  await definirBibliotheque(page, [{ titre: 'Ao Ashi', tomes: tomes(3) }, { titre: 'Série Inexistante', tomes: tomes(1) }]);
  await page.evaluate(() => ouvrirParametres());
  await page.click('#settings-modal button:has-text("Mettre à jour mes séries")');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => document.getElementById('completion-bouton').textContent === 'Fermer', null, { timeout: 15000 });
  const bilan = await page.textContent('#completion-bilan');
  verifier(bilan.includes('1 série(s) mises à jour avec Manga Insight'), 'bilan Manga Insight : ' + bilan);
  verifier(bilan.includes('Série Inexistante'), 'série introuvable signalée : ' + bilan);
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Sauvegarde : état dans les Paramètres et restauration d\u2019une ancienne version', async ({ navigateur, base }) => {
  const envois = [];
  const versions = {
    actuelle: { date: '2026-10-08T08:15:00.000Z', series: 2, tomes: 5 },
    versions: [{ id: '2026-10-06T19:40:00.000Z', date: '2026-10-06T19:40:00.000Z', series: 3, tomes: 9 }, { id: 'x', date: null, series: 1, tomes: 1 }]
  };
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base, {
    worker: (req) => {
      if (req.headers()['x-backup-token'] !== 'code') return { status: 401, body: {} };
      if (req.url().endsWith('/backup/versions')) return { body: versions };
      if (req.method() === 'POST') { envois.push([JSON.parse(req.postData()).length, req.headers()['x-backup-force']]); return { body: { ok: true } }; }
      if (req.url().includes('version=2026-10-06')) return { body: [{ titre: 'A', tomes: tomes(3) }, { titre: 'B', tomes: tomes(3) }, { titre: 'C', tomes: tomes(3) }] };
      return null;
    }
  });
  await definirBibliotheque(page, [{ titre: 'A', tomes: tomes(3) }, { titre: 'B', tomes: tomes(2) }]);
  const etat = async () => { await page.evaluate(() => ouvrirParametres()); await page.waitForFunction(() => !document.getElementById('etat-sauvegarde').textContent.includes('Vérification')); return page.textContent('#etat-sauvegarde'); };

  verifier((await etat()).includes('non configurée'), 'sans code : alerte');
  await page.evaluate(() => localStorage.setItem('cloud_backup_token', 'faux'));
  verifier((await etat()).includes('Code de sauvegarde incorrect'), 'code incorrect signalé');
  await page.evaluate(() => localStorage.setItem('cloud_backup_token', 'code'));
  egal(await etat(), "✅ Sauvegardée en ligne aujourd'hui à 10:15" + '2 séries, 5 tomes · 2 versions précédentes', 'sauvegarde à jour');
  versions.actuelle.date = null;
  egal(await etat(), '✅ Sauvegardée en ligne' + '2 séries, 5 tomes · la date s\u2019affichera après ta prochaine modification · 2 versions précédentes', 'sauvegarde sans date (ancien Worker)');
  versions.actuelle.date = '2026-10-08T08:15:00.000Z';
  await page.evaluate(() => { bibliotheque[1].tomes.push({ numero: 3, possede: true, lu: false }); });
  verifier((await etat()).includes('sur cet appareil : 2 séries, 6 tomes'), 'différence entre l\u2019appareil et le cloud signalée');

  await page.click('text=Restaurer une sauvegarde en ligne');
  await page.waitForSelector('.version-item');
  egal(await page.$$eval('.version-item', b => b.map(x => x.textContent)), [
    "Dernière sauvegarde · aujourd'hui à 10:152 séries, 5 tomes",
    'Le 6 octobre à 21:403 séries, 9 tomes',
    "Avant la mise en place de l'historique1 série, 1 tome"
  ], 'liste des versions');
  await page.click('.version-item >> nth=1');
  verifier((await page.textContent('#confirm-message')).includes('par la sauvegarde du 6 octobre à 21:40 (3 séries, 9 tomes)'), 'confirmation');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => bibliotheque.length === 3);
  await page.waitForTimeout(300);
  egal(envois, [[3, '1']], 'la version restaurée devient la sauvegarde en ligne (envoi forcé)');
  egal(await page.evaluate(() => document.getElementById('settings-modal').classList.contains('active')), false, 'Paramètres refermés');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Inventaire : avancement, validation des séries et vérification d\u2019un tome scanné', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base, {
    worker: (req) => req.url().includes('/isbn') ? { body: { trouve: true, source: 'BnF', titre: 'Berserk. 1 (Éd. prestige)', auteurs: [], editeur: 'Glénat' } } : null
  });
  await definirBibliotheque(page, [
    { titre: 'Kagurabachi', tomes: tomes(5, 0, [4]) },
    { titre: 'Berserk (Prestige)', tomes: [{ numero: 2, possede: true, lu: false }, { numero: 3, possede: true, lu: false }] },
    { titre: 'Berserk', tomes: tomes(2) }]);
  const lignes = () => page.$$eval('#inventaire-liste > *', els => els.map(e => e.classList.contains('pal-section') ? '# ' + e.textContent
    : e.querySelector('.inventaire-titre').textContent + ' — ' + e.querySelector('.inventaire-detail').textContent + ' ' + e.querySelector('.inventaire-marque').textContent));
  const scanner = async () => {
    await page.click('text=📷 Scanner un tome');
    await page.setInputFiles('#scanner-photo-input', path.join(DONNEES, 'codebarre-berserk-prestige-1.png'));
  };

  await page.evaluate(() => ouvrirParametres());
  await page.click("text=📋 Faire l'inventaire");
  await page.click('#confirm-ok');
  await page.waitForSelector('#inventaire-modal.active');
  egal(await page.textContent('#inventaire-compteur'), '0 / 3 séries vérifiées', 'compteur au départ');
  egal(await lignes(), ['# À vérifier (3)', 'Berserk — 2 tomes : 1–2 ›', 'Berserk (Prestige) — 2 tomes : 2–3 ›', 'Kagurabachi — 4 tomes : 1–3, 5 ›'], 'séries à vérifier');

  // Une série vérifiée
  await page.click('.inventaire-ligne:has-text("Kagurabachi")');
  egal(await page.textContent('#fiche-inventaire-tomes'), 'Dans l\u2019app : 4 tomes : 1–3, 5', 'rappel des tomes dans la fiche');
  await page.click('#fiche-inventaire-valider');
  verifier((await page.textContent('#toast span')).includes('Kagurabachi vérifiée · 1 / 3'), 'message de validation');
  egal((await lignes()).slice(-2), ['# Vérifiées (1)', 'Kagurabachi — 4 tomes : 1–3, 5 ✓'], 'série passée dans « Vérifiées »');

  // Scan d'un tome de la bonne édition : il est ajouté avec son ISBN
  await page.click('.inventaire-ligne:has-text("Berserk (Prestige)")');
  await scanner();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Tome 1'));
  egal(await page.textContent('#toast span'), "✅ Tome 1 · édition Prestige : c'est le bon (ajouté)", 'tome scanné reconnu');
  egal(await page.evaluate(() => bibliotheque[1].tomes.map(t => t.numero + (t.isbn ? '#' : ''))), ['1#', '2', '3'], 'tome 1 ajouté avec son ISBN');
  await scanner();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes("c'est bien celui"), null, { timeout: 15000 });

  // Scan d'un tome d'une autre édition : alerte, rien n'est ajouté si on refuse
  await page.evaluate(() => { fermerModal(); ouvrirModalSerie(2); });
  await page.evaluate(() => { bibliotheque[1].tomes[0].isbn = null; });
  await scanner();
  await page.waitForSelector('#choix-modal.active', { timeout: 15000 });
  verifier((await page.textContent('#choix-message')).includes("c'est l'édition Prestige, la série est en édition standard"), 'édition différente signalée');
  egal(await page.$$eval('#choix-boutons button', b => b.map(x => x.textContent)), [
    '✏️ Corriger la série en « Berserk (Prestige) » (fusion)', '➕ Ranger ce tome dans « Berserk (Prestige) »', 'Ajouter quand même à « Berserk »', 'Annuler'
  ], 'choix proposés (la bonne édition existe déjà)');
  await page.click('#choix-boutons button >> text=Annuler');
  egal(await page.evaluate(() => bibliotheque[2].tomes.length), 2, 'rien ajouté');

  // Bandeau dans la collection, puis fin de l'inventaire
  await page.evaluate(() => { fermerModal(); fermerInventaire(); });
  egal(await page.textContent('.bandeau-inventaire'), '📋 Inventaire en cours · 1 / 3Continuer ›', 'bandeau de la collection');
  await page.click('.bandeau-inventaire');
  await page.click("text=Terminer l'inventaire");
  verifier((await page.textContent('#confirm-message')).includes("2 séries n'ont pas été vérifiées"), 'avertissement avant de terminer');
  await page.click('#confirm-ok');
  egal(await page.$$('.bandeau-inventaire').then(b => b.length), 0, 'bandeau retiré');
  egal(await page.evaluate(() => { ouvrirModalSerie(0); return document.getElementById('fiche-inventaire').style.display; }), 'none', 'barre d\u2019inventaire masquée hors inventaire');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Code de sauvegarde : réinstallation sans perdre la sauvegarde en ligne', async ({ navigateur, base }) => {
  const enLigne = [{ titre: 'Ao Ashi', tomes: tomes(3) }, { titre: 'Berserk (Prestige)', tomes: tomes(4) }];
  const { page, erreurs, alertes, fermer } = await ouvrirApp(navigateur, base, {
    worker: (req) => {
      if (req.headers()['x-backup-token'] !== 'bon-code') return { status: 401, body: {} };
      if (req.url().endsWith('/backup/versions')) return { body: { actuelle: { date: '2026-10-08T08:15:00.000Z', series: 2, tomes: 7 }, versions: [] } };
      if (req.method() === 'GET') return { body: enLigne };
      return { body: { ok: true } };
    }
  });
  await definirBibliotheque(page, []);
  verifier((await page.textContent('#view-collection')).includes('Code de sauvegarde cloud pour la récupérer'), 'collection vide : piste pour récupérer sa collection');

  // Nouveau raccourci : pas de code → on demande d'abord s'il en existe un
  await page.evaluate(() => { configurerCodeCloud(); });
  verifier((await page.textContent('#confirm-message')).startsWith('As-tu déjà un code'), 'question posée avant de générer un code');
  egal([await page.textContent('#confirm-ok'), await page.textContent('#confirm-cancel')], ["Oui, j'ai un code", 'Non, première fois'], 'libellés des deux réponses');
  await page.click('#confirm-ok');
  egal(await page.inputValue('#form-text-input'), '', 'aucun code inventé quand on en a déjà un');

  // Mauvais code : prévenu tout de suite
  await page.fill('#form-text-input', 'faux-code');
  await page.click('#form-text-ok');
  await page.waitForFunction(() => document.getElementById('etat-sauvegarde').textContent.includes('incorrect'));
  verifier(alertes.some(a => a.includes('Le serveur ne reconnaît pas ce code')), 'alerte immédiate si le code est faux');

  // Bon code : la collection en ligne est proposée et récupérée
  await page.evaluate(() => { configurerCodeCloud(); });
  egal(await page.inputValue('#form-text-input'), 'faux-code', 'le code enregistré est proposé pour être corrigé');
  await page.fill('#form-text-input', 'bon-code');
  await page.click('#form-text-ok');
  await page.waitForFunction(() => document.getElementById('confirm-message').textContent.includes('Code reconnu'));
  verifier((await page.textContent('#confirm-message')).includes('2 séries, 7 tomes'), 'résumé de la sauvegarde en ligne');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => bibliotheque.length === 2);
  egal(await page.textContent('#confirm-ok'), 'Confirmer', 'le bouton de confirmation retrouve son libellé');

  // Toute première configuration : un nouveau code est proposé
  await page.evaluate(() => { localStorage.removeItem('cloud_backup_token'); configurerCodeCloud(); });
  await page.click('#confirm-cancel');
  verifier(/^[0-9a-f]{36}$/.test(await page.inputValue('#form-text-input')), 'nouveau code généré pour une première configuration');
  await page.click('#form-text-cancel');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Mauvaise édition : corriger la série ou en créer une à part', async ({ navigateur, base }) => {
  let livreBnf = 'Dragon Ball. 1 (Perfect edition)';
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base, {
    worker: (req) => req.url().includes('/isbn') ? { body: { trouve: true, source: 'BnF', titre: livreBnf, auteurs: [], editeur: 'Glénat' } } : null
  });
  const dragonBall = () => [{ titre: 'Dragon Ball', auteur: 'Akira Toriyama', tomesParus: 42, tomesParusSource: 'Manga Insight', parution: { nom: 'Dragon ball', dernier: { vol: 42, k: 24000 } }, tomes: tomes(3, 1) }];
  const etat = () => page.evaluate(() => bibliotheque.map(s => [s.titre, s.tomes.map(t => t.numero + (t.lu ? 'L' : '') + (t.isbn ? '#' : '')).join(' '), s.tomesParus ?? null, !!s.parution]));
  const boutons = () => page.$$eval('#choix-boutons button', b => b.map(x => x.textContent));

  // Inventaire, « Corriger » : la série change d'édition, tomes et lectures gardés, parution effacée
  await page.evaluate(() => localStorage.setItem('inventaire_debut', '1'));
  await definirBibliotheque(page, dragonBall());
  await page.evaluate(() => { ouvrirModalSerie(0); verifierTomeScanne('9782344067802', 0); });
  await page.waitForSelector('#choix-modal.active');
  egal(await boutons(), ['✏️ Corriger la série en « Dragon Ball (Perfect) »', '➕ Créer la série « Dragon Ball (Perfect) » à part', 'Ajouter quand même à « Dragon Ball »', 'Annuler'], 'choix proposés');
  await page.click('#choix-boutons button >> nth=0');
  await page.waitForFunction(() => bibliotheque[0].titre === 'Dragon Ball (Perfect)');
  egal(await etat(), [['Dragon Ball (Perfect)', '1L# 2 3', null, false]], 'série corrigée');
  egal(await page.textContent('#modal-title'), 'Dragon Ball (Perfect)', 'fiche mise à jour');

  // Inventaire, « À part » : une nouvelle série, l'ancienne ne bouge pas
  await page.evaluate(() => fermerModal());
  await definirBibliotheque(page, dragonBall());
  await page.evaluate(() => { ouvrirModalSerie(0); verifierTomeScanne('9782344067802', 0); });
  await page.waitForSelector('#choix-modal.active');
  await page.click('#choix-boutons button >> nth=1');
  await page.waitForFunction(() => bibliotheque.length === 2);
  egal(await etat(), [['Dragon Ball', '1L 2 3', 42, true], ['Dragon Ball (Perfect)', '1#', null, false]], 'nouvelle série créée à part');
  egal(await page.evaluate(() => bibliotheque[1].auteur), 'Akira Toriyama', 'auteur repris');

  // « Dragonball » (BnF) et « Dragon ball » (saisi à la main) : même série, même édition → reconnu directement
  await page.evaluate(() => fermerModal());
  livreBnf = 'Dragonball. 01';
  await definirBibliotheque(page, [{ titre: 'Dragon ball', tomes: tomes(1) }]);
  await page.evaluate(() => { ouvrirModalSerie(0); verifierTomeScanne('9782344067802', 0); });
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes("c'est le bon"));
  egal(await page.evaluate(() => [bibliotheque.length, bibliotheque[0].tomes[0].isbn]), [1, '9782344067802'], 'tome reconnu malgré l\u2019espace');

  // Titre vraiment différent : on peut renommer la série
  await page.evaluate(() => fermerModal());
  livreBnf = 'Dr. Slump. 1';
  await definirBibliotheque(page, [{ titre: 'Dragon ball', tomes: tomes(1) }]);
  await page.evaluate(() => { ouvrirModalSerie(0); verifierTomeScanne('9782344067802', 0); });
  await page.waitForSelector('#choix-modal.active');
  egal(await boutons(), ['✏️ Renommer la série en « Dr. Slump »', '➕ Créer la série « Dr. Slump » à part', 'Ajouter quand même à « Dragon ball »', 'Annuler'], 'renommage proposé si le titre diffère');
  await page.click('#choix-boutons button >> text=Annuler');
  livreBnf = 'Dragon Ball. 1 (Perfect edition)';

  // Scan hors inventaire : la série existe dans une autre édition → même choix
  await page.evaluate(() => { fermerModal(); localStorage.removeItem('inventaire_debut'); });
  await definirBibliotheque(page, dragonBall());
  await page.evaluate(() => { afficherLivreIsbn('9782344067802'); });
  await page.click('#isbn-ajouter');
  await page.waitForSelector('#choix-modal.active');
  verifier((await page.textContent('#choix-message')).includes('« Dragon Ball » (édition standard), mais ce livre est l\u2019édition Perfect'.replace('\u2019', "'")), 'message hors inventaire');
  await page.click('#choix-boutons button >> nth=0');
  egal(await page.inputValue('#form-serie-titre'), 'Dragon Ball (Perfect)', 'titre proposé');
  await page.click('#form-serie-ok');
  await page.waitForFunction(() => bibliotheque[0].tomes[0].isbn);
  egal(await etat(), [['Dragon Ball (Perfect)', '1L# 2 3', null, false]], 'série corrigée depuis le scan');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Édition, tomes et jaquette d\u2019une série (Slam Dunk Star Edition)', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  const imagesDemandees = [];
  await page.route('https://covers.openlibrary.org/**', route => { imagesDemandees.push(route.request().url()); route.fulfill({ path: path.join(DONNEES, 'codebarre-berserk-prestige-1.png'), contentType: 'image/png' }); });
  // Amazon renvoie une image de 1 pixel quand il n'a pas la couverture : elle doit être masquée
  await page.route('https://images-na.ssl-images-amazon.com/**', route => route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') }));
  await avecMangaInsight(page, [{ titre: 'Slam Dunk', editeur: 'Kana', tomes: tomes(20, 5) }]);
  const etat = () => page.evaluate(() => { const s = bibliotheque[0]; return [s.titre, s.tomesParus, s.tomesParusSource, s.parution ? s.parution.nom : null, s.tomes[0].isbn || null]; });
  egal(await etat(), ['Slam Dunk', 31, 'Manga Insight', 'Slam dunk', '9782871292296'], 'au départ : édition standard');

  await page.evaluate(() => ouvrirModalSerie(0));
  await page.click('button[aria-label="Plus d\'actions"]');
  await page.click('text=🔄 Édition, tomes et jaquette');
  await page.waitForSelector('#choix-modal.active');
  egal(await page.$$eval('#choix-boutons button', b => b.map(x => x.textContent)), [
    '✓ Édition standard · 31 tomes · Kana · 1999–2004', 'Édition Star · 20 tomes · Kana · 2019–2021', 'Édition Deluxe · 16 tomes · Kana · 2024–2026',
    '✍️ Saisir le nombre de tomes à la main', 'Annuler'
  ], 'éditions proposées');
  await page.click('#choix-boutons button >> text=Édition Star');
  await page.waitForSelector('#jaquettes-modal.active');
  egal(await etat(), ['Slam Dunk (Star)', 20, 'Manga Insight', 'Slam dunk - Star Edition', '9782505076506'], 'édition Star : titre, tomes, sorties et ISBN');
  egal(await page.textContent('#modal-title'), 'Slam Dunk (Star)', 'fiche mise à jour');

  // Jaquettes : seules les vraies images sont proposées
  await page.waitForFunction(() => document.getElementById('jaquettes-statut').textContent.startsWith('Touche'));
  egal(await page.$$eval('.jaquette-choix', imgs => imgs.filter(i => i.style.display !== 'none').length), 2, 'deux jaquettes (tome 1 et dernier tome), image vide masquée');
  await page.click('.jaquette-choix:visible >> nth=0');
  egal(await page.evaluate(() => bibliotheque[0].couverture), 'https://covers.openlibrary.org/b/isbn/9782505076506-L.jpg?default=false', 'jaquette du tome 1 de l\u2019édition Star');

  // L'édition choisie tient après une nouvelle mise à jour automatique
  await page.evaluate(async () => { await majMangaInsightAuDemarrage(); });
  egal((await etat()).slice(1, 4), [20, 'Manga Insight', 'Slam dunk - Star Edition'], 'édition gardée après mise à jour');

  // Nombre de tomes saisi à la main : plus modifié automatiquement
  await page.click('button[aria-label="Plus d\'actions"]');
  await page.click('text=🔄 Édition, tomes et jaquette');
  await page.click('#choix-boutons button >> text=Saisir le nombre');
  await page.fill('#form-text-input', '25');
  await page.click('#form-text-ok');
  await page.waitForSelector('#jaquettes-modal.active');
  await page.click('#jaquettes-garder');
  await page.evaluate(async () => { await majMangaInsightAuDemarrage(); });
  egal((await etat()).slice(1, 4), [25, 'manuel', null], 'nombre de tomes manuel conservé');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Recherche par ISBN (BnF) puis ajout du tome', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base, {
    worker: (req) => req.url().includes('/isbn') ? { body: { trouve: true, source: 'BnF', titre: 'Berserk. 1 (Éd. prestige)', auteurs: ['Kentarō Miura'], editeur: 'Glénat (Grenoble)', date: '2025' } } : null
  });
  await definirBibliotheque(page, [{ titre: 'Berserk (Prestige)', tomes: [] }]);
  await page.evaluate(() => { rechercherIsbn(); });
  await page.fill('#form-text-input', '978-2-344-06780-2');
  await page.click('#form-text-ok');
  await page.waitForSelector('#isbn-modal.active');
  verifier((await page.textContent('#isbn-resultat')).includes('série : Berserk · tome : 1 · édition : Prestige'), 'détection série / tome / édition');
  await page.click('#isbn-ajouter');
  egal(await page.inputValue('#form-serie-titre'), 'Berserk (Prestige)', 'titre proposé');
  await page.click('#form-serie-ok');
  await page.waitForTimeout(200);
  egal(await page.evaluate(() => bibliotheque[0].tomes.map(t => [t.numero, t.isbn])), [[1, '9782344067802']], 'tome ajouté avec son ISBN');
  egal(await page.evaluate(() => bibliotheque[0].editeur), 'Glénat', 'éditeur nettoyé');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Scan du code-barres depuis une photo', async ({ navigateur, base }) => {
  const isbnDemandes = [];
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base, {
    worker: (req) => { if (req.url().includes('/isbn')) { isbnDemandes.push(new URL(req.url()).searchParams.get('isbn')); return { body: { trouve: true, source: 'BnF', titre: 'Berserk. 1 (Éd. prestige)', auteurs: [], editeur: 'Glénat' } }; } return null; }
  });
  await page.evaluate(() => { document.getElementById('scanner-modal').classList.add('active'); scanTermine = false; });
  await page.setInputFiles('#scanner-photo-input', path.join(DONNEES, 'codebarre-berserk-prestige-1.png'));
  await page.waitForSelector('#isbn-modal.active', { timeout: 15000 });
  egal(isbnDemandes, ['9782344067802'], 'ISBN lu sur la photo');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Renommer une série et fusionner avec une série du même nom', async ({ navigateur, base }) => {
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base);
  await definirBibliotheque(page, [
    { titre: 'Berserk', tomesTotal: 41, tomes: [{ numero: 1, possede: true, lu: true }, { numero: 2, possede: true, lu: false }] },
    { titre: 'Berserk (Prestige)', editeur: 'Glénat', tomes: [{ numero: 1, possede: true, lu: false, isbn: '9782344067802' }, { numero: 3, possede: true, lu: false }] }]);
  await page.evaluate(() => ouvrirModalSerie(0));
  await page.click('#modal-title');
  await page.fill('#form-text-input', 'Berserk (Prestige)');
  await page.click('#form-text-ok');
  await page.click('#confirm-ok');
  await page.waitForTimeout(200);
  egal(await page.evaluate(() => bibliotheque.map(s => [s.titre, s.editeur, s.tomesTotal ?? null, s.tomes.map(t => t.numero + (t.lu ? 'L' : '') + (t.isbn ? '#' : '')).join(' ')])),
    [['Berserk (Prestige)', 'Glénat', null, '1L# 2 3']],
    'une seule série, tomes regroupés, nombre de tomes standard effacé');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Compléter la collection (AniList, MyAnimeList, IA)', async ({ navigateur, base }) => {
  const media = (romaji, auteur) => ({ data: { Page: { media: [{ title: { romaji }, genres: ['Action'], tags: [], status: 'FINISHED', volumes: 42, coverImage: { large: 'https://img/' + romaji }, staff: { edges: [{ role: 'Story & Art', node: { name: { full: auteur } } }] } }] } } });
  const { page, erreurs, fermer } = await ouvrirApp(navigateur, base, {
    anilist: (req) => {
      const t = JSON.parse(req.postData()).variables.search;
      if (t === 'Dragon Ball') return { body: media('Dragon Ball', 'Akira Toriyama') };
      if (t === 'Naruto') return { status: 403, body: { errors: [{ message: 'blocked' }] } };
      return { body: { data: { Page: { media: [] } } } };
    },
    jikan: (req) => req.url().includes('Naruto')
      ? { body: { data: [{ title: 'Naruto', type: 'Manga', authors: [{ name: 'Kishimoto, Masashi' }], genres: [{ name: 'Action' }], status: 'Finished', volumes: 72, images: { jpg: { large_image_url: 'https://img/naruto' } } }] } }
      : { body: { data: [] } },
    googleBooks: (req) => ({ body: { items: decodeURIComponent(req.url()).includes('Dragon Ball') ? [{ volumeInfo: { publisher: 'VIZ Media LLC' } }, { volumeInfo: { publisher: 'Éditions Glénat' } }] : [] } }),
    worker: (req) => req.url().includes('/infos') ? { status: 502, body: { erreur: 'Gemini — quota' } } : null
  });
  await definirBibliotheque(page, [
    { titre: 'Dragon Ball', tomes: tomes(1) },
    { titre: 'Naruto', auteur: 'Saisi à la main', tomes: tomes(1) },
    { titre: 'Introuvable', tomes: tomes(1) }]);
  await page.evaluate(() => { completerCollection(); });
  await page.click('#confirm-ok');
  await page.waitForFunction(() => document.getElementById('completion-bouton').textContent === 'Fermer', null, { timeout: 30000 });
  const series = await page.evaluate(() => bibliotheque.map(s => [s.titre, s.auteur || null, s.editeur || null, !!s.couverture]));
  egal(series, [
    ['Dragon Ball', 'Akira Toriyama', 'Glénat', true],
    ['Naruto', 'Saisi à la main', null, true],
    ['Introuvable', null, null, false]
  ], 'champs complétés (auteur saisi conservé, éditeur français choisi)');
  verifier((await page.textContent('#completion-bilan')).includes('• Introuvable'), 'série introuvable dans le bilan');
  egal(erreurs, [], 'erreurs JavaScript');
  await fermer();
});

test('Worker : sauvegarde protégée, ISBN et éditions BnF', async () => {
  const worker = (await import(pathToFileURL(path.join(RACINE, 'worker', 'worker.js')).href)).default;
  const nodeCrypto = require('crypto');
  if (!crypto.subtle.timingSafeEqual) crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const fetchOriginal = globalThis.fetch;
  try {
    // Faux stockage KV de Cloudflare (valeurs + métadonnées, liste triée par nom)
    const kv = new Map();
    const env = { BACKUP_TOKEN: 'secret', MANGA_KV: {
      get: async k => kv.has(k) ? kv.get(k).value : null,
      getWithMetadata: async k => kv.has(k) ? { value: kv.get(k).value, metadata: kv.get(k).metadata ?? null } : { value: null, metadata: null },
      put: async (k, value, options = {}) => { kv.set(k, { value, metadata: options.metadata }); },
      delete: async k => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name, metadata: kv.get(name).metadata })) })
    } };
    const appel = (chemin, init) => worker.fetch(new Request('https://w.dev' + chemin, init), env);
    const series = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ titre: 'S' + i, tomes: [{ numero: 1, possede: true }, { numero: 2, possede: false }] })));
    const envoyer = (n, force) => appel('/backup', { method: 'POST', headers: { 'X-Backup-Token': 'secret', ...(force ? { 'X-Backup-Force': '1' } : {}) }, body: series(n) });
    const versions = async () => (await appel('/backup/versions', { headers: { 'X-Backup-Token': 'secret' } })).json();
    const resume = (v) => v && [v.series, v.tomes];

    egal((await appel('/backup')).status, 401, 'sauvegarde sans code refusée');
    egal((await appel('/backup/versions')).status, 401, 'historique sans code refusé');
    egal((await envoyer(10)).status, 200, 'sauvegarde avec code');
    await envoyer(11);
    let v = await versions();
    egal([resume(v.actuelle), v.versions.length], [[11, 11], 0], 'sauvegarde actuelle (séries, tomes possédés), pas d\u2019historique le même jour');
    verifier(Date.now() - new Date(v.actuelle.date) < 5000, 'date de la sauvegarde');

    kv.get('bibliotheque').metadata.date = '2026-10-07T18:00:00.000Z';
    await envoyer(12);
    v = await versions();
    egal(v.versions.map(x => [x.id, ...resume(x)]), [['2026-10-07T18:00:00.000Z', 11, 11]], 'premier envoi du jour : la version de la veille est archivée');

    egal((await envoyer(2)).status, 409, 'sauvegarde qui viderait le cloud refusée');
    egal((await envoyer(2, true)).status, 200, 'envoi forcé accepté');
    v = await versions();
    egal([resume(v.actuelle), v.versions.map(x => x.series)], [[2, 2], [12, 11]], 'envoi forcé : l\u2019ancienne sauvegarde est archivée');
    const ancienne = await (await appel('/backup?version=' + v.versions[1].id, { headers: { 'X-Backup-Token': 'secret' } })).json();
    egal(ancienne.length, 11, 'lecture d\u2019une version archivée');

    for (let i = 0; i < 35; i++) kv.set('historique:2026-01-' + String(i).padStart(2, '0'), { value: series(1), metadata: { date: null, series: 1, tomes: 1 } });
    await envoyer(3, true);
    v = await versions();
    egal([v.versions.length, v.versions[0].series], [30, 2], 'on garde les 30 versions les plus récentes');

    kv.set('bibliotheque', { value: series(4) });
    v = await versions();
    egal([v.actuelle.date, resume(v.actuelle)], [null, [4, 4]], 'sauvegarde d\u2019avant l\u2019historique (sans date)');

    const notice = (titre, isbn) => `<srw:record><dc:title>${titre}</dc:title><dc:creator>Miura, Kentarō (1966-2021). Auteur du texte</dc:creator><dc:publisher>Glénat (Grenoble)</dc:publisher><dc:identifier>ISBN ${isbn}</dc:identifier></srw:record>`;
    globalThis.fetch = async (url) => new Response(decodeURIComponent(String(url)).includes('bib.isbn')
      ? '<srw:numberOfRecords>1</srw:numberOfRecords>' + notice('Berserk. 1 (Éd. prestige) / Kentaro Miura', '9782344067802')
      : '<srw:numberOfRecords>2</srw:numberOfRecords>' + notice('Berserk. 1 (Éd. prestige)', '9782344067802') + notice('Berserk : 5 (Éd. prestige)', '9782344073957'));
    let rep = await appel('/isbn?isbn=978-2-344-06780-2');
    egal(rep.headers.get('content-type'), 'application/json; charset=utf-8', 'réponse déclarée en UTF-8');
    const livre = await rep.json();
    egal([livre.titre, livre.auteurs, livre.editeur], ['Berserk. 1 (Éd. prestige)', ['Kentarō Miura'], 'Glénat (Grenoble)'], 'notice ISBN nettoyée');
    egal((await appel('/isbn?isbn=abc')).status, 400, 'ISBN invalide refusé');
    const edition = await (await appel('/edition?mots=Berserk%20prestige&editeur=Gl%C3%A9nat')).json();
    egal(edition.notices.map(n => [n.titre, n.isbn]), [['Berserk. 1 (Éd. prestige)', '9782344067802'], ['Berserk : 5 (Éd. prestige)', '9782344073957']], 'notices d’une édition');

    let modeles = [];
    globalThis.fetch = async (url) => {
      const m = String(url).match(/models\/([^:]+):generateContent/);
      modeles.push(m && m[1]);
      return new Response(JSON.stringify({ error: { message: 'introuvable' } }), { status: 404 });
    };
    rep = await worker.fetch(new Request('https://w.dev/infos?titre=Naruto'), { GEMINI_API_KEY: 'k' });
    egal(rep.status, 502, 'Gemini indisponible → erreur 502');
    egal(modeles, ['gemini-flash-latest', 'gemini-flash-lite-latest'], 'les deux modèles Gemini sont essayés');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// --- Lancement -------------------------------------------------------------------------

(async () => {
  const filtre = process.argv[2];
  const serveur = await demarrerServeur();
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const navigateur = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const echecs = [];
  let lances = 0;
  const debut = Date.now();
  for (const { nom, fn } of tests) {
    if (filtre && !nom.toLowerCase().includes(filtre.toLowerCase())) continue;
    lances++;
    try {
      await fn({ navigateur, base });
      console.log('  ✅ ' + nom);
    } catch (e) {
      echecs.push(nom);
      console.log('  ❌ ' + nom + '\n     ' + e.message.split('\n').join('\n  '));
    }
  }
  await navigateur.close();
  serveur.close();
  console.log(`\n${echecs.length ? '❌' : '✅'} ${lances - echecs.length}/${lances} tests réussis, ${verifications} vérifications, en ${Math.round((Date.now() - debut) / 1000)} s`);
  process.exit(echecs.length ? 1 : 0);
})();
