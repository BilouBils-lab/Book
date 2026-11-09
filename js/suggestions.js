// Suggestions « Pour toi » sur la page d'un éditeur. AniList donne, pour tes séries et celles de l'éditeur :
// les genres, les auteurs, les séries liées (suites, spin-off) et les recommandations des lecteurs.
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
  return (avecLecteurs ? 'l:' : '') + normaliserRecherche(rechercheAniList(titre));
}

// Ce qu'on garde d'une fiche AniList
function resumerMedia(m) {
  const auteurs = [];
  for (const e of (m.staff && m.staff.edges) || []) {
    const nom = e.node && e.node.name && e.node.name.full;
    if (/story|art/i.test(e.role || '') && nom && !auteurs.includes(nom)) auteurs.push(nom);
  }
  return {
    id: m.id,
    genres: m.genres || [],
    auteurs,
    lies: ((m.relations && m.relations.edges) || []).filter(e => RELATIONS_UNIVERS.includes(e.relationType) && e.node).map(e => e.node.id),
    lecteurs: ((m.recommendations && m.recommendations.nodes) || []).filter(n => n.mediaRecommendation && (n.rating || 0) > 0).map(n => n.mediaRecommendation.id)
  };
}

// Une requête AniList pour un lot de séries → la fiche brute de chacune (null si introuvable).
// Chaque série passe par une recherche (Page) : une série introuvable donne une liste vide, pas une erreur.
// Requête refusée (trop « complexe » pour AniList) : on la coupe en deux. Trop de requêtes : on attend un peu.
async function demanderLotAniList(lot, champs, essai = 0) {
  const query = 'query {\n' + lot.map((t, j) =>
    `m${j}: Page(perPage: 1) { media(search: ${JSON.stringify(rechercheAniList(t))}, type: MANGA, format_in: [MANGA, ONE_SHOT], sort: [SEARCH_MATCH]) { ${champs} } }`).join('\n') + '\n}';
  const r = await fetchAvecTimeout('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query })
  }, 15000);
  if (r.status === 429 && essai < 2) {
    await pause(Math.min(parseInt(r.headers.get('Retry-After'), 10) || 5, 20) * 1000);
    return demanderLotAniList(lot, champs, essai + 1);
  }
  const json = await r.json().catch(() => null);
  if (json && json.data) return lot.map((t, j) => { const p = json.data['m' + j]; return (p && p.media && p.media[0]) || null; });
  if (lot.length > 1) {
    const moitie = Math.ceil(lot.length / 2);
    return [...await demanderLotAniList(lot.slice(0, moitie), champs), ...await demanderLotAniList(lot.slice(moitie), champs)];
  }
  const detail = json && json.errors ? json.errors.map(e => e.message).join(' ; ') : '';
  throw new Error('AniList : HTTP ' + r.status + (detail ? ' — ' + detail : ''));
}

// Fiches AniList de plusieurs séries (null si introuvable) : d'abord le cache, sinon par lots
async function fichesAniList(titres, avecLecteurs) {
  const cache = await lireCacheAniList();
  const maintenant = Date.now();
  const aDemander = [...new Set(titres)].filter(t => {
    const c = cache[cleAniList(t, avecLecteurs)];
    return !c || maintenant - c.t > DUREE_CACHE_ANILIST;
  });
  const champs = `id genres staff(perPage: 6) { edges { role node { name { full } } } }
    relations { edges { relationType node { id } } }` +
    (avecLecteurs ? ' recommendations(perPage: 10, sort: RATING_DESC) { nodes { rating mediaRecommendation { id } } }' : '');
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
