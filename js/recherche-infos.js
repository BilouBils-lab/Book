// Infos d'une série : AniList, MyAnimeList (Jikan), Google Books, IA (Gemini) ; fenêtre ✏️ Infos

// --- Infos série : AniList puis Jikan (MyAnimeList), appelés directement depuis le navigateur ---
// (AniList bloque les requêtes venant des Workers Cloudflare)
const GENRES_FR = {
  'Action': 'Action', 'Adventure': 'Aventure', 'Comedy': 'Comédie', 'Drama': 'Drame',
  'Ecchi': 'Ecchi', 'Fantasy': 'Fantasy', 'Horror': 'Horreur', 'Mahou Shoujo': 'Magical girl',
  'Mecha': 'Mecha', 'Music': 'Musique', 'Mystery': 'Mystère', 'Psychological': 'Psychologique',
  'Romance': 'Romance', 'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie',
  'Sports': 'Sport', 'Supernatural': 'Surnaturel', 'Thriller': 'Thriller', 'Suspense': 'Suspense',
  'Gourmet': 'Gastronomie', 'Award Winning': null
};
const DEMOGRAPHIES = ['Shounen', 'Seinen', 'Shoujo', 'Josei', 'Kids'];
const STATUTS_ANILIST = { FINISHED: 'Terminée', RELEASING: 'En cours', HIATUS: 'En pause', CANCELLED: 'Abandonnée', NOT_YET_RELEASED: 'En cours' };
const STATUTS_JIKAN = { 'Finished': 'Terminée', 'Publishing': 'En cours', 'On Hiatus': 'En pause', 'Discontinued': 'Abandonnée', 'Not yet published': 'En cours' };

function normaliserRecherche(t) {
  return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function genresFr(demographie, genres) {
  const liste = [demographie, ...genres.slice(0, 3).map(g => g in GENRES_FR ? GENRES_FR[g] : g)].filter(Boolean);
  return liste.length ? liste.join(', ') : null;
}

// Parmi les résultats, préfère un titre identique (le plus populaire), sinon le premier
function choisirResultat(liste, titre, nomsDe, popularite) {
  const cible = normaliserRecherche(titre);
  const exacts = liste.filter(m => nomsDe(m).map(normaliserRecherche).includes(cible));
  return exacts.length ? exacts.sort((a, b) => popularite(b) - popularite(a))[0] : liste[0];
}

// Google Books renvoie souvent l'éditeur américain (VIZ Media…) même pour une édition française :
// on n'accepte que les éditeurs de manga présents en France, sous leur nom usuel.
const EDITEURS_FR = [
  ['Glénat', /gl[eé]nat/], ['Kana', /\bkana\b/], ['Pika', /\bpika\b/], ['Ki-oon', /ki-?oon/],
  ['Kurokawa', /kurokawa/], ['Tonkam', /tonkam/], ['Delcourt', /delcourt/], ['Kazé', /kaz[eé]/],
  ['Crunchyroll', /crunchyroll/], ['Panini Manga', /panini/], ['Soleil Manga', /soleil/], ['Akata', /akata/],
  ['Doki-Doki', /doki/], ['Casterman', /casterman/], ['Sakka', /sakka/], ['Ototo', /ototo/],
  ['Vega-Dupuis', /\bvega\b/], ['Dupuis', /dupuis/], ['Mangetsu', /mangetsu/], ['Meian', /meian/],
  ['Noeve Grafx', /noeve/], ['Michel Lafon', /michel lafon/], ['Nobi Nobi', /nobi/], ['Taifu', /taifu/],
  ['Black Box', /black box/], ['IMHO', /\bimho\b/], ['Le Lézard Noir', /l[eé]zard noir/],
  ['Komikku', /komikku/], ['Naban', /naban/], ['Ankama', /ankama/], ['Kotoji', /kotoji/],
  ['Omaké Books', /omak[eé]/], ['Hachette', /hachette/], ['Bamboo', /bamboo/], ['Dargaud', /dargaud/],
  ['Shiba', /\bshiba\b/], ['H2T', /\bh2t\b/],
  ['KBooks', /\bk ?books\b/], ['Webtoon Factory', /webtoon factory/], ['Delitoon', /delitoon/], ['Verytoon', /verytoon/]
];
function editeurFrancais(nom) {
  const n = (nom || '').toLowerCase();
  const trouve = EDITEURS_FR.find(([, motif]) => motif.test(n));
  return trouve ? trouve[0] : null;
}

// « Haikyu!! (Smash) » → « Haikyu!! » : l'édition entre parenthèses fait échouer les recherches
function titreRecherche(titre) {
  return (titre || '').replace(/\s*\([^)]*\)/g, '').trim() || titre;
}

async function chercherAniList(titre) {
  const query = `query ($search: String) {
    Page(perPage: 8) {
      media(search: $search, type: MANGA, format_in: [MANGA, ONE_SHOT], sort: [SEARCH_MATCH]) {
        id title { romaji english native } synonyms genres tags { name category }
        status volumes popularity coverImage { large }
        staff(perPage: 6) { edges { role node { name { full } } } }
      }
    }
  }`;
  const r = await fetchAvecTimeout('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { search: titre } })
  }, 10000);
  const json = await r.json().catch(() => null);
  if (!r.ok || !json || json.errors) {
    const msg = json && json.errors ? json.errors.map(e => e.message).join('; ') : '';
    throw new Error('HTTP ' + r.status + (msg ? ' : ' + msg : ''));
  }
  const liste = (json.data && json.data.Page && json.data.Page.media) || [];
  if (!liste.length) return { trouve: false };

  const m = choisirResultat(liste, titre,
    m => [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms || [])], m => m.popularity || 0);
  const edges = (m.staff && m.staff.edges) || [];
  const noms = [];
  edges.filter(e => /story|art/i.test(e.role || '')).forEach(e => {
    const nom = e.node && e.node.name && e.node.name.full;
    if (nom && !noms.includes(nom)) noms.push(nom);
  });
  const demo = ((m.tags || []).find(t => t.category === 'Demographic') || {}).name;
  return {
    trouve: true,
    source: 'AniList',
    titreMatch: m.title.romaji || m.title.english,
    auteur: noms.length ? noms.join(', ') : null,
    genre: genresFr(demo, m.genres || []),
    statut: STATUTS_ANILIST[m.status] || null,
    volumes: m.volumes || null,
    couverture: (m.coverImage && m.coverImage.large) || null
  };
}

async function chercherJikan(titre) {
  const r = await fetchAvecTimeout('https://api.jikan.moe/v4/manga?limit=8&q=' + encodeURIComponent(titre), {}, 10000);
  const json = await r.json().catch(() => null);
  if (!r.ok || !json) throw new Error('HTTP ' + r.status);
  const liste = (json.data || []).filter(m => !/novel/i.test(m.type || ''));
  if (!liste.length) return { trouve: false };

  const m = choisirResultat(liste, titre,
    m => [m.title, m.title_english, m.title_japanese, ...(m.titles || []).map(t => t.title)], m => m.members || 0);
  // MyAnimeList écrit les noms « Nom, Prénom »
  const auteurs = (m.authors || []).map(a => a.name.split(', ').reverse().join(' '));
  const demo = ((m.demographics || [])[0] || {}).name;
  return {
    trouve: true,
    source: 'MyAnimeList',
    titreMatch: m.title,
    auteur: auteurs.length ? auteurs.join(', ') : null,
    genre: genresFr(DEMOGRAPHIES.includes(demo) ? demo : null, (m.genres || []).map(g => g.name)),
    statut: STATUTS_JIKAN[m.status] || null,
    volumes: m.volumes || null,
    couverture: (m.images && m.images.jpg && m.images.jpg.large_image_url) || null
  };
}

// Essaie AniList, puis Jikan si AniList échoue ou ne trouve rien
async function chercherInfosSerie(titre) {
  const erreurs = [];
  for (const [nom, chercher] of [['AniList', chercherAniList], ['MyAnimeList', chercherJikan]]) {
    try {
      const res = await chercher(titre);
      if (res.trouve) return { ...res, erreurs };
      erreurs.push(nom + ' : titre introuvable');
    } catch (e) {
      erreurs.push(nom + ' : ' + messageErreur(e));
    }
  }
  return { trouve: false, erreurs };
}
let infosSuggerees = {};

function messageErreur(e) {
  return e && e.name === 'AbortError' ? 'délai dépassé' : (e && e.message) || 'erreur inconnue';
}

// Gemini via le Worker, avec une nouvelle tentative
async function demanderIA(titre) {
  for (let tentative = 0; tentative <= 1; tentative++) {
    try {
      const r = await fetchAvecTimeout(WORKER_URL + '/infos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titre })
      }, 20000);
      const data = await r.json().catch(() => ({ erreur: 'réponse illisible' }));
      if (r.ok || tentative === 1) return data;
      // Limite de requêtes par minute atteinte : on laisse le quota se recharger
      if (/429/.test(data.erreur || '')) { await pause(15000); continue; }
    } catch (e) {
      if (tentative === 1) return { erreur: messageErreur(e) };
    }
    await pause(3000);
  }
}

async function chercherEditeurGoogleBooks(titre) {
  const cleBooks = localStorage.getItem('google_books_api_key');
  const cleParam = cleBooks ? '&key=' + encodeURIComponent(cleBooks) : '';
  let erreur = null;
  for (const q of ['intitle:' + titre, titre + ' manga']) {
    try {
      // langRestrict=fr : uniquement les éditions françaises
      const r = await fetchAvecReessai('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(q) + '&langRestrict=fr&printType=books&maxResults=5' + cleParam);
      if (!r.ok) { erreur = 'HTTP ' + r.status; continue; }
      for (const it of (r.body && r.body.items) || []) {
        const editeur = editeurFrancais(it.volumeInfo && it.volumeInfo.publisher);
        if (editeur) return { editeur };
      }
    } catch (e) {
      erreur = messageErreur(e);
    }
  }
  return { erreur };
}

// Cherche les infos d'une série sans rien modifier. `deja` indique les champs déjà renseignés :
// ils ne sont jamais remplacés. Ordre : AniList / MyAnimeList, Google Books (éditeur), puis l'IA
// seulement pour ce qui manque encore (quota limité).
async function collecterInfosSerie(titre, deja) {
  const res = { valeurs: {}, sources: {}, base: null, erreurs: [] };
  const poser = (champ, valeur, source) => {
    if (valeur && !deja[champ] && !res.valeurs[champ]) { res.valeurs[champ] = valeur; res.sources[champ] = source; }
  };

  const titreR = titreRecherche(titre);
  const appliquerBase = (base) => {
    res.base = { source: base.source, titreMatch: base.titreMatch };
    poser('auteur', base.auteur, base.source);
    poser('genre', base.genre, base.source);
    poser('statut', base.statut, base.source);
    poser('couverture', base.couverture, base.source);
    // Le nombre de tomes d'AniList est celui de l'édition standard : inutilisable pour une édition spéciale
    if (titreR === titre) poser('tomesTotal', base.volumes, base.source);
  };

  const [base, livres] = await Promise.all([
    chercherInfosSerie(titreR),
    deja.editeur ? null : chercherEditeurGoogleBooks(titreR)
  ]);
  res.erreurs.push(...base.erreurs);
  if (base.trouve) appliquerBase(base);
  if (livres && livres.editeur) poser('editeur', livres.editeur, 'Google Books');
  else if (livres && livres.erreur) res.erreurs.push('Google Books : ' + livres.erreur);

  const manque = ['auteur', 'genre', 'editeur'].filter(c => !deja[c] && !res.valeurs[c]);
  if (manque.length) {
    const ia = await demanderIA(titreR);
    if (ia.erreur) {
      res.erreurs.push('IA : ' + ia.erreur);
    } else {
      // Titre français inconnu d'AniList : on réessaie avec le titre original donné par l'IA
      if (!base.trouve && ia.titre_original && normaliserRecherche(ia.titre_original) !== normaliserRecherche(titreR)) {
        const base2 = await chercherInfosSerie(ia.titre_original);
        if (base2.trouve) appliquerBase(base2);
        else res.erreurs.push(...base2.erreurs.map(e => e + ' (« ' + ia.titre_original + ' »)'));
      }
      manque.forEach(c => poser(c, ia[c], 'IA'));
    }
  }
  return res;
}

// Champs « déjà renseignés » d'une série (le statut par défaut « En cours » peut être corrigé)
function champsRenseignes(serie, valeurs) {
  const v = valeurs || serie;
  return {
    auteur: !!v.auteur, genre: !!v.genre, editeur: !!v.editeur,
    statut: !!v.statut && v.statut !== 'En cours',
    couverture: !!serie.couverture, tomesTotal: !!serie.tomesTotal
  };
}

const NOMS_CHAMPS = { auteur: 'auteur', genre: 'genre', editeur: 'éditeur', statut: 'statut', couverture: 'jaquette', tomesTotal: 'nombre de tomes' };

// Ligne de résumé : qui a rempli quoi, et pourquoi des champs restent vides
function resumerRecherche(res, vides) {
  const parSource = {};
  for (const [champ, source] of Object.entries(res.sources)) (parSource[source] = parSource[source] || []).push(NOMS_CHAMPS[champ]);
  const parties = [];
  if (res.base) parties.push(`${res.base.source} (« ${res.base.titreMatch} ») : ${(parSource[res.base.source] || []).join(', ') || 'rien de nouveau'}`);
  if (parSource['Google Books']) parties.push('Google Books : ' + parSource['Google Books'].join(', '));
  if (parSource['IA']) parties.push('IA (à vérifier) : ' + parSource['IA'].join(', '));
  let texte = parties.join(' · ');
  // Toujours signaler l'échec d'AniList / MyAnimeList, même si l'IA a pris le relais
  const echecsBase = res.base ? [] : res.erreurs.filter(e => /^(AniList|MyAnimeList)/.test(e));
  if (echecsBase.length) texte += (texte ? ' — ' : '') + echecsBase.join(' | ');
  if (vides.length) {
    texte += (texte ? ' — ' : '') + 'Toujours vide : ' + vides.map(c => NOMS_CHAMPS[c]).join(', ');
    const autres = res.erreurs.filter(e => !echecsBase.includes(e));
    if (autres.length) texte += ' [' + autres.join(' | ') + ']';
  }
  return texte;
}

async function rechercherInfosAuto() {
  if (serieIndexActive === null) return;
  const jeton = ++jetonRecherche;
  const serie = bibliotheque[serieIndexActive];
  const champ = (id) => document.getElementById(id);
  const statusEl = champ('infos-recherche-status');
  statusEl.textContent = 'Recherche en cours…';

  const saisie = {
    auteur: champ('infos-auteur').value.trim(), genre: champ('infos-genre').value.trim(),
    editeur: champ('infos-editeur').value.trim(), statut: champ('infos-statut').value
  };
  const res = await collecterInfosSerie(serie.titre, champsRenseignes(serie, saisie));
  if (jeton !== jetonRecherche) return;

  const v = res.valeurs;
  if (v.auteur) champ('infos-auteur').value = v.auteur;
  if (v.genre) champ('infos-genre').value = v.genre;
  if (v.editeur) champ('infos-editeur').value = v.editeur;
  if (v.statut) champ('infos-statut').value = v.statut;
  infosSuggerees = { couverture: v.couverture, tomesTotal: v.tomesTotal };

  const vides = ['auteur', 'genre', 'editeur'].filter(c => !champ('infos-' + c).value);
  statusEl.textContent = resumerRecherche(res, vides);
}

function ouvrirInfosSerie() {
  if (serieIndexActive === null) return;
  const serie = bibliotheque[serieIndexActive];
  document.getElementById('infos-auteur').value = serie.auteur || '';
  document.getElementById('infos-genre').value = serie.genre || '';
  document.getElementById('infos-editeur').value = serie.editeur || '';
  document.getElementById('infos-statut').value = serie.statut || 'En cours';
  document.getElementById('infos-recherche-status').textContent = '';
  infosSuggerees = {};
  document.getElementById('form-infos-modal').classList.add('active');

  if (!serie.auteur && !serie.genre) {
    rechercherInfosAuto();
  }
}

document.getElementById('infos-cancel').addEventListener('click', () => {
  document.getElementById('form-infos-modal').classList.remove('active');
});

document.getElementById('infos-ok').addEventListener('click', () => {
  if (serieIndexActive === null) return;
  const serie = bibliotheque[serieIndexActive];
  serie.auteur = document.getElementById('infos-auteur').value.trim();
  serie.genre = document.getElementById('infos-genre').value.trim();
  serie.editeur = document.getElementById('infos-editeur').value.trim();
  serie.statut = document.getElementById('infos-statut').value;
  if (infosSuggerees.couverture && !serie.couverture) serie.couverture = infosSuggerees.couverture;
  if (infosSuggerees.tomesTotal && !serie.tomesTotal) serie.tomesTotal = infosSuggerees.tomesTotal;
  infosSuggerees = {};
  document.getElementById('form-infos-modal').classList.remove('active');
  sauvegarder();
});
