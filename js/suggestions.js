// Suggestions « Pour toi », sur la page d'un éditeur et dans la rubrique « ✨ Pour toi » (onglet À venir).
// AniList donne, pour tes séries et d'autres : les genres, les auteurs, les séries liées (suites, spin-off)
// et les recommandations des lecteurs ; Manga Insight dit si une série est publiée en France.
// Chaque suggestion affiche sa raison. Les réponses AniList sont gardées 30 jours sur l'appareil.

const MAX_POUR_TOI = 4;
const CANDIDATS_POUR_TOI = 40; // séries de l'éditeur examinées (les plus actives)
const PAR_REQUETE_ANILIST = 10; // séries demandées en une seule requête…
const PAR_REQUETE_AVEC_LECTEURS = 5; // …moitié moins avec les recommandations (limite de taille des requêtes AniList)
const DUREE_CACHE_ANILIST = 30 * 24 * 3600 * 1000;
const SCORE_MIN_POUR_TOI = 4;
const RELATIONS_UNIVERS = ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'PARENT', 'ALTERNATIVE'];
// Poids de chaque raison : un même univers compte plus qu'un même auteur, puis l'avis des lecteurs, puis les genres
const RAISONS = {
  univers: { poids: 10, icone: '🔗', texte: (nom) => `Même univers que ${nom}` },
  auteur: { poids: 6, icone: '✍️', texte: (nom) => `Du même auteur que ${nom}` },
  lecteurs: { poids: 5, icone: '👥', texte: (nom) => `Les lecteurs de ${nom} l’ont aimé` }
};

let cacheAniList = null;

async function lireCacheAniList() {
  if (!cacheAniList) {
    try { cacheAniList = (db && await dbGet('anilist-suggestions')) || {}; } catch { cacheAniList = {}; }
  }
  return cacheAniList;
}

function rechercheAniList(titre) {
  return titreRecherche(titre).replace(/\s+-\s+/g, ' ');
}

function cleAniList(titre, avecLecteurs) {
  return (avecLecteurs ? 'l2:' : '') + normaliserRecherche(rechercheAniList(titre));
}

// Titres d'une fiche AniList (romaji, anglais, autres noms) : pour la retrouver dans Manga Insight
function titresMedia(m) {
  return [m.title && m.title.romaji, m.title && m.title.english, ...(m.synonyms || [])].filter(Boolean);
}

// Ce qu'on garde d'une fiche AniList
function resumerMedia(m) {
  const auteurs = [], auteursIds = [];
  for (const e of (m.staff && m.staff.edges) || []) {
    const nom = e.node && e.node.name && e.node.name.full;
    if (/story|art/i.test(e.role || '') && nom && !auteurs.includes(nom)) {
      auteurs.push(nom);
      if (e.node.id) auteursIds.push(e.node.id);
    }
  }
  // Titres des séries liées et recommandées (quand AniList les donne)
  const titres = {};
  for (const e of (m.relations && m.relations.edges) || []) if (e.node && e.node.title) titres[e.node.id] = titresMedia(e.node);
  for (const n of (m.recommendations && m.recommendations.nodes) || []) if (n.mediaRecommendation && n.mediaRecommendation.title) titres[n.mediaRecommendation.id] = titresMedia(n.mediaRecommendation);
  return {
    id: m.id,
    genres: m.genres || [],
    auteurs,
    auteursIds,
    titres,
    lies: ((m.relations && m.relations.edges) || []).filter(e => RELATIONS_UNIVERS.includes(e.relationType) && e.node && (!e.node.type || e.node.type === 'MANGA')).map(e => e.node.id),
    lecteurs: ((m.recommendations && m.recommendations.nodes) || []).filter(n => n.mediaRecommendation && (n.rating || 0) > 0).map(n => n.mediaRecommendation.id)
  };
}

// Une requête AniList groupée : `fragment(x)` décrit ce qu'on demande pour chaque élément du lot,
// `extraire(réponse)` en tire le résultat. Requête refusée (trop « complexe » pour AniList) : on la coupe
// en deux. Trop de requêtes : on attend un peu et on réessaie.
async function requeteGroupeeAniList(lot, fragment, extraire, essai = 0) {
  const query = 'query {\n' + lot.map((x, j) => `m${j}: ${fragment(x)}`).join('\n') + '\n}';
  const r = await fetchAvecTimeout('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query })
  }, 15000);
  if (r.status === 429 && essai < 2) {
    await pause(Math.min(parseInt(r.headers.get('Retry-After'), 10) || 5, 20) * 1000);
    return requeteGroupeeAniList(lot, fragment, extraire, essai + 1);
  }
  const json = await r.json().catch(() => null);
  if (json && json.data) return lot.map((x, j) => extraire(json.data['m' + j]));
  if (lot.length > 1) {
    const moitie = Math.ceil(lot.length / 2);
    return [...await requeteGroupeeAniList(lot.slice(0, moitie), fragment, extraire), ...await requeteGroupeeAniList(lot.slice(moitie), fragment, extraire)];
  }
  const detail = json && json.errors ? json.errors.map(e => e.message).join(' ; ') : '';
  throw new Error('AniList : HTTP ' + r.status + (detail ? ' — ' + detail : ''));
}

// Chaque série passe par une recherche (Page) : une série introuvable donne une liste vide, pas une erreur
function demanderLotAniList(lot, champs) {
  return requeteGroupeeAniList(lot,
    t => `Page(perPage: 1) { media(search: ${JSON.stringify(rechercheAniList(t))}, type: MANGA, format_in: [MANGA, ONE_SHOT], sort: [SEARCH_MATCH]) { ${champs} } }`,
    p => (p && p.media && p.media[0]) || null);
}

// Fiches AniList de plusieurs séries (null si introuvable) : d'abord le cache, sinon par lots
async function fichesAniList(titres, avecLecteurs) {
  const cache = await lireCacheAniList();
  const maintenant = Date.now();
  const aDemander = [...new Set(titres)].filter(t => {
    const c = cache[cleAniList(t, avecLecteurs)];
    return !c || maintenant - c.t > DUREE_CACHE_ANILIST;
  });
  // Pour tes séries (avecLecteurs) : aussi les titres des séries liées et recommandées, et l'identifiant des auteurs
  const champs = avecLecteurs
    ? `id genres staff(perPage: 6) { edges { role node { id name { full } } } }
      relations { edges { relationType node { id type title { romaji english } synonyms } } }
      recommendations(perPage: 10, sort: RATING_DESC) { nodes { rating mediaRecommendation { id title { romaji english } synonyms } } }`
    : `id genres staff(perPage: 6) { edges { role node { name { full } } } }
      relations { edges { relationType node { id } } }`;
  const parLot = avecLecteurs ? PAR_REQUETE_AVEC_LECTEURS : PAR_REQUETE_ANILIST;
  try {
    for (let i = 0; i < aDemander.length; i += parLot) {
      const lot = aDemander.slice(i, i + parLot);
      const medias = await demanderLotAniList(lot, champs);
      lot.forEach((t, j) => { cache[cleAniList(t, avecLecteurs)] = { t: maintenant, d: medias[j] ? resumerMedia(medias[j]) : null }; });
    }
  } finally {
    // Les réponses déjà reçues sont gardées, même si une requête suivante échoue
    if (aDemander.length && db) dbSet('anilist-suggestions', cache).catch(() => {});
  }
  return titres.map(t => cache[cleAniList(t, avecLecteurs)].d);
}

function genreFr(g) {
  return g in GENRES_FR ? GENRES_FR[g] : g;
}

// Les genres les plus présents dans ta collection
function genresPreferes(fiches) {
  const compte = new Map();
  for (const f of fiches) for (const g of f.genres) if (genreFr(g)) compte.set(g, (compte.get(g) || 0) + 1);
  return [...compte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => genreFr(g));
}

// Note chaque série de l'éditeur par rapport à ta collection ; renvoie les meilleures avec leur raison
function noterSuggestions(candidats, ficheCandidats, possedees) {
  const idsPossedes = new Set(possedees.map(p => p.fiche.id));
  const resultats = [];
  candidats.forEach((g, i) => {
    const c = ficheCandidats[i];
    if (!c || idsPossedes.has(c.id)) return;
    const meilleures = {}; // par type de raison : { score, nom, texte }
    const garder = (type, score, texte) => { if (!meilleures[type] || score > meilleures[type].score) meilleures[type] = { score, texte }; };
    for (const { serie, fiche: o } of possedees) {
      if (c.lies.includes(o.id) || o.lies.includes(c.id)) garder('univers', RAISONS.univers.poids, RAISONS.univers.icone + ' ' + RAISONS.univers.texte(serie.titre));
      if (c.auteurs.some(a => o.auteurs.includes(a))) garder('auteur', RAISONS.auteur.poids, RAISONS.auteur.icone + ' ' + RAISONS.auteur.texte(serie.titre));
      if (o.lecteurs.includes(c.id)) garder('lecteurs', RAISONS.lecteurs.poids, RAISONS.lecteurs.icone + ' ' + RAISONS.lecteurs.texte(serie.titre));
      const communs = c.genres.filter(x => o.genres.includes(x) && genreFr(x));
      if (communs.length >= 2) garder('genres', 2 * communs.length, `🎯 ${communs.slice(0, 2).map(genreFr).join(' · ')}, comme ${serie.titre}`);
    }
    const raisons = Object.values(meilleures).sort((a, b) => b.score - a.score);
    const score = raisons.reduce((s, r) => s + r.score, 0);
    if (score >= SCORE_MIN_POUR_TOI) resultats.push({ serie: g, score, raison: raisons[0].texte });
  });
  return resultats.sort((a, b) => b.score - a.score).slice(0, MAX_POUR_TOI);
}

// Section « Pour toi » de la page de l'éditeur : les suggestions, ou un message qui dit pourquoi il n'y en a pas
async function afficherPourToi() {
  const affiche = editeurAffiche;
  const section = document.getElementById('editeur-pour-toi');
  const liste = document.getElementById('pour-toi-liste');
  const profil = document.getElementById('pour-toi-profil');
  const candidats = affiche.series.filter(g => !g.possedee).slice(0, CANDIDATS_POUR_TOI);
  section.hidden = !candidats.length || !bibliotheque.length;
  if (section.hidden) return;
  liste.innerHTML = '';
  profil.textContent = 'Recherche de suggestions…';
  try {
    const titresPossedes = bibliotheque.map(s => s.titre);
    const fichesPossedees = await fichesAniList(titresPossedes, true);
    const possedees = bibliotheque.map((serie, i) => ({ serie, fiche: fichesPossedees[i] })).filter(p => p.fiche);
    const ficheCandidats = await fichesAniList(candidats.map(g => g.titre), false);
    if (editeurAffiche !== affiche) return; // on a changé de page entre-temps
    const suggestions = noterSuggestions(candidats, ficheCandidats, possedees);
    if (!suggestions.length) { profil.textContent = 'Pas de suggestion chez cet éditeur d’après ta collection.'; return; }
    const genres = genresPreferes(possedees.map(p => p.fiche));
    profil.textContent = genres.length ? 'D’après tes séries : ' + genres.join(', ') : 'D’après tes séries';
    for (const s of suggestions) liste.appendChild(cartePourToi(s));
  } catch (e) {
    console.error('Suggestions indisponibles', e);
    if (editeurAffiche === affiche) profil.textContent = 'Suggestions indisponibles pour l’instant (' + messageErreur(e) + ').';
  }
}

function cartePourToi({ serie: g, raison }) {
  const carte = document.createElement('div');
  carte.className = 'pour-toi-carte';
  const infos = document.createElement('div');
  infos.className = 'editeur-serie-infos';
  const titre = document.createElement('div');
  titre.className = 'editeur-serie-titre';
  titre.textContent = g.titre;
  const detail = document.createElement('div');
  detail.className = 'editeur-serie-detail';
  detail.textContent = `${g.tomes} tome${g.tomes > 1 ? 's' : ''}`;
  const pourquoi = document.createElement('div');
  pourquoi.className = 'pour-toi-raison';
  pourquoi.textContent = raison;
  infos.append(titre, detail, pourquoi);
  const ajouter = document.createElement('button');
  ajouter.className = 'editeur-ajouter';
  ajouter.setAttribute('aria-label', 'Ajouter ' + g.titre);
  ajouter.textContent = '＋';
  ajouter.onclick = () => choisirSerieEditeur(g);
  carte.append(jaquetteSerieEditeur(g, 'editeur-serie-jaquette'), infos, ajouter);
  return carte;
}

// --- Rubrique « ✨ Pour toi » (onglet À venir) : des rangées, à travers tous les éditeurs français ---
const RANGEES_LECTEURS_MAX = 6;
const PAR_RANGEE_MAX = 10;
const AUTEURS_MAX = 15;

// Autres œuvres de chaque auteur (identifiants AniList), gardées 30 jours
async function oeuvresAuteurs(ids) {
  const cache = await lireCacheAniList();
  const maintenant = Date.now();
  const aDemander = [...new Set(ids)].filter(id => {
    const c = cache['auteur:' + id];
    return !c || maintenant - c.t > DUREE_CACHE_ANILIST;
  });
  try {
    for (let i = 0; i < aDemander.length; i += PAR_REQUETE_ANILIST) {
      const lot = aDemander.slice(i, i + PAR_REQUETE_ANILIST);
      const oeuvres = await requeteGroupeeAniList(lot,
        id => `Staff(id: ${Number(id)}) { staffMedia(type: MANGA, perPage: 15, sort: [POPULARITY_DESC]) { nodes { id format title { romaji english } synonyms } } }`,
        st => (st && st.staffMedia && st.staffMedia.nodes) || []);
      lot.forEach((id, j) => {
        cache['auteur:' + id] = { t: maintenant, d: oeuvres[j].filter(m => m.format !== 'NOVEL').map(m => ({ id: m.id, titres: titresMedia(m) })) };
      });
    }
  } finally {
    if (aDemander.length && db) dbSet('anilist-suggestions', cache).catch(() => {});
  }
  return ids.map(id => cache['auteur:' + id].d);
}

// Séries publiées en France (Manga Insight), retrouvées par leur titre
function normaliserTitreFrance(t) {
  return normaliserRecherche((t || '').replace(/×/g, ' x '));
}
let indexFrance = null, dateIndexFrance = null;
function serieEnFrance(titres) {
  if (!indexFrance || dateIndexFrance !== dateMI) {
    indexFrance = new Map();
    for (const g of groupesMangaInsight(() => true)) {
      for (const cle of new Set([normaliserTitreFrance(g.titre), normaliserTitreFrance(g.titre.replace(/ - /g, ' '))])) {
        const deja = indexFrance.get(cle);
        if (!deja || g.tomes > deja.tomes) indexFrance.set(cle, g);
      }
    }
    dateIndexFrance = dateMI;
  }
  for (const t of titres || []) {
    const g = indexFrance.get(normaliserTitreFrance(t));
    if (g) return g;
  }
  return null;
}

// Les rangées de la rubrique : même univers, « parce que tu lis … », mêmes auteurs.
// Une série n'apparaît qu'une fois, seulement si elle est publiée en France et qu'on ne l'a pas.
async function rangeesPourToi() {
  if (!indexMI) await chargerMangaInsight(false);
  if (!indexMI || !bibliotheque.length) return [];
  const fiches = await fichesAniList(bibliotheque.map(s => s.titre), true);
  const possedees = bibliotheque.map((serie, i) => ({ serie, fiche: fiches[i] })).filter(p => p.fiche);
  const idsPossedes = new Set(possedees.map(p => p.fiche.id));
  const montrees = new Set();
  const candidate = (id, titres) => {
    if (idsPossedes.has(id)) return null;
    const g = serieEnFrance(titres);
    return g && indexSeriePossedee(g.titre) === -1 ? g : null;
  };
  const garder = (liste) => {
    const items = [];
    for (const it of liste) {
      if (items.length >= PAR_RANGEE_MAX || montrees.has(it.serie.titre)) continue;
      montrees.add(it.serie.titre);
      items.push(it);
    }
    return items;
  };
  const rangees = [];

  const univers = [];
  for (const { serie, fiche } of possedees) {
    for (const id of fiche.lies) { const g = candidate(id, fiche.titres[id]); if (g) univers.push({ serie: g, comme: serie.titre }); }
  }
  const itemsUnivers = garder(univers);
  if (itemsUnivers.length) rangees.push({ titre: '🔗 Dans le même univers', sous: 'Suites et séries dérivées de tes séries', items: itemsUnivers });

  // « Parce que tu lis … » : d'abord les séries qui ont le plus de recommandations publiées en France
  const parSerie = possedees.map(({ serie, fiche }) => ({
    serie,
    items: fiche.lecteurs.map(id => candidate(id, fiche.titres[id])).filter(Boolean).map(g => ({ serie: g }))
  })).filter(r => r.items.length).sort((a, b) => b.items.length - a.items.length);
  for (const { serie, items } of parSerie) {
    if (rangees.filter(r => r.lecteurs).length >= RANGEES_LECTEURS_MAX) break;
    const gardes = garder(items);
    if (gardes.length) rangees.push({ titre: '👥 Parce que tu lis ' + serie.titre, sous: 'Recommandées par ses lecteurs', items: gardes, lecteurs: true });
  }

  const auteurs = new Map(); // identifiant AniList de l'auteur → une de tes séries
  for (const { serie, fiche } of possedees) for (const id of fiche.auteursIds || []) if (!auteurs.has(id)) auteurs.set(id, serie.titre);
  const ids = [...auteurs.keys()].slice(0, AUTEURS_MAX);
  if (ids.length) {
    const oeuvres = await oeuvresAuteurs(ids);
    const memesAuteurs = [];
    ids.forEach((id, i) => {
      for (const o of oeuvres[i] || []) { const g = candidate(o.id, o.titres); if (g) memesAuteurs.push({ serie: g, comme: auteurs.get(id) }); }
    });
    const itemsAuteurs = garder(memesAuteurs);
    if (itemsAuteurs.length) rangees.push({ titre: '✍️ Des mêmes auteurs', sous: 'D’autres œuvres des auteurs de tes séries', items: itemsAuteurs });
  }
  return rangees;
}

async function afficherRubriquePourToi(zone) {
  zone.innerHTML = '';
  const message = document.createElement('div');
  message.className = 'avenir-intro';
  message.textContent = 'Recherche de suggestions…';
  zone.appendChild(message);
  try {
    const rangees = await rangeesPourToi();
    if (!zone.isConnected) return; // on a changé de vue entre-temps
    if (!rangees.length) {
      message.textContent = bibliotheque.length ? 'Pas encore de suggestion d’après ta collection.' : 'Ajoute des séries à ta collection pour recevoir des suggestions.';
      return;
    }
    message.remove();
    for (const r of rangees) zone.appendChild(rangeePourToi(r));
  } catch (e) {
    console.error('Rubrique Pour toi indisponible', e);
    if (zone.isConnected) message.textContent = 'Suggestions indisponibles pour l’instant (' + messageErreur(e) + ').';
  }
}

function rangeePourToi({ titre, sous, items }) {
  const rangee = document.createElement('section');
  rangee.className = 'pt-rangee';
  const h = document.createElement('h2');
  h.className = 'pt-rangee-titre';
  h.textContent = titre;
  const p = document.createElement('div');
  p.className = 'pt-rangee-sous';
  p.textContent = sous;
  const defile = document.createElement('div');
  defile.className = 'pt-defile';
  for (const it of items) defile.appendChild(cartePourToiRubrique(it));
  rangee.append(h, p, defile);
  return rangee;
}

function cartePourToiRubrique({ serie: g, comme }) {
  const carte = document.createElement('div');
  carte.className = 'pt-carte';
  const visuel = document.createElement('div');
  visuel.className = 'pt-visuel';
  const ajouter = document.createElement('button');
  ajouter.className = 'pt-ajouter';
  ajouter.setAttribute('aria-label', 'Ajouter ' + g.titre);
  ajouter.textContent = '＋';
  ajouter.onclick = () => choisirSerieEditeur({ ...g, possedee: false });
  visuel.append(jaquetteSerieEditeur(g, 'pt-jaquette'), ajouter);
  const titre = document.createElement('div');
  titre.className = 'pt-titre';
  titre.textContent = g.titre;
  const detail = document.createElement('div');
  detail.className = 'pt-detail';
  detail.textContent = `${editeurFrancais(g.editeur) || g.editeur} · ${g.tomes} t.`;
  carte.append(visuel, titre, detail);
  if (comme) {
    const lien = document.createElement('div');
    lien.className = 'pt-detail pt-comme';
    lien.textContent = 'comme ' + comme;
    carte.appendChild(lien);
  }
  return carte;
}
