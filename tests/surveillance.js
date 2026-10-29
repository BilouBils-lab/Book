// Surveillance des sources externes (lancée chaque semaine par GitHub Actions, voir .github/workflows/surveillance.yml).
// Interroge les VRAIS services, à travers le Worker quand l'app passe par lui, et vérifie que les réponses ont
// toujours la forme attendue. Un service qui change son format ferait sinon disparaître une fonction en silence.
// Lancement : `node tests/surveillance.js` (sans dépendance). Code de sortie 1 si une vérification échoue.

const WORKER = process.env.SURVEILLANCE_WORKER || 'https://manga-gemini-proxy.nabil-chilla.workers.dev';
const ANILIST = process.env.SURVEILLANCE_ANILIST || 'https://graphql.anilist.co';
const JIKAN = process.env.SURVEILLANCE_JIKAN || 'https://api.jikan.moe/v4';

// Une source peut avoir un raté passager : un second essai 5 secondes plus tard avant de la déclarer en panne
async function lireJson(url, options = {}, essai = 1) {
  let r;
  try {
    r = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  } catch (e) {
    if (essai < 2) { await new Promise(ok => setTimeout(ok, 5000)); return lireJson(url, options, essai + 1); }
    // « fetch failed » seul ne dit rien : la cause (DNS, connexion refusée, délai…) est dans e.cause
    throw new Error('connexion impossible : ' + ((e.cause && (e.cause.code || e.cause.message)) || e.message));
  }
  if (r.status >= 500 && essai < 2) { await new Promise(ok => setTimeout(ok, 5000)); return lireJson(url, options, essai + 1); }
  const texte = await r.text();
  let corps = null;
  try { corps = JSON.parse(texte); } catch (e) { /* pas du JSON */ }
  if (!r.ok) throw new Error(`HTTP ${r.status} : ${texte.slice(0, 200)}`);
  if (corps === null) throw new Error('réponse qui n\'est pas du JSON : ' + texte.slice(0, 200));
  return corps;
}

function exiger(condition, message) {
  if (!condition) throw new Error(message);
}

const verifications = [
  ['Manga Insight (sorties en France, via le Worker)', 'Onglet À venir, nouveautés, nombre de tomes', async () => {
    const [core, rows] = await Promise.all([lireJson(WORKER + '/mangainsight/core'), lireJson(WORKER + '/mangainsight/rows')]);
    exiger(core.col && Array.isArray(core.col.year) && Array.isArray(core.col.month) && Array.isArray(core.col.editor), 'core.json : colonnes year / month / editor absentes');
    exiger(core.dict && Array.isArray(core.dict.editor), 'core.json : liste des éditeurs (dict.editor) absente');
    exiger(Array.isArray(rows.title) && Array.isArray(rows.ean), 'rows.json : colonnes title / ean absentes');
    exiger(core.n === rows.n && rows.title.length === rows.n, `fichiers désalignés (core ${core.n}, rows ${rows.n})`);
    exiger(rows.n > 10000, `trop peu de sorties (${rows.n})`);
    const avecTome = rows.title.filter(t => /\sVol\.\s*\d+\s*$/.test(t || '')).length;
    exiger(avecTome > rows.n * 0.5, `le format « Titre Vol.N » a changé (${avecTome} / ${rows.n})`);
    exiger(rows.title.some(t => /^One Piece Vol\./i.test(t || '')), 'One Piece introuvable');
    const age = (Date.now() - new Date(core.generated_at)) / 86400000;
    exiger(!(age > 45), `données plus mises à jour depuis ${Math.round(age)} jours (${core.generated_at})`);
    return `${rows.n} sorties, données du ${new Date(core.generated_at).toLocaleDateString('fr-FR')}`;
  }],

  ['BnF : livre par ISBN (via le Worker)', 'Recherche ISBN, scan du code-barres', async () => {
    const d = await lireJson(WORKER + '/isbn?isbn=9782723467698');
    exiger(d.trouve === true, 'ISBN connu non trouvé : ' + JSON.stringify(d).slice(0, 200));
    exiger(/dragon ?ball/i.test(d.titre || ''), 'titre inattendu : ' + d.titre);
    return d.titre;
  }],

  ['BnF : tomes d\'une édition (via le Worker)', 'Nombre de tomes parus quand Manga Insight ne connaît pas la série', async () => {
    const d = await lireJson(WORKER + '/edition?mots=' + encodeURIComponent('Berserk prestige') + '&editeur=' + encodeURIComponent('Glénat'));
    exiger(Array.isArray(d.notices) && d.notices.length > 0, 'aucune notice : ' + JSON.stringify(d).slice(0, 200));
    exiger(d.notices.some(n => /berserk/i.test(n.titre || '') && /^97[89]\d{10}$/.test(n.isbn || '')), 'notices sans titre ou sans ISBN exploitable');
    return `${d.notices.length} notices`;
  }],

  ['Gemini : modèles d\'IA (via le Worker)', 'Compléter les infos manquantes', async () => {
    const d = await lireJson(WORKER + '/modeles');
    exiger(Array.isArray(d.utilises) && Array.isArray(d.disponibles), 'réponse inattendue : ' + JSON.stringify(d).slice(0, 200));
    const retires = d.utilises.filter(m => !d.disponibles.includes(m));
    exiger(retires.length < d.utilises.length, `aucun des modèles utilisés n'existe plus (${d.utilises.join(', ')}) : changer GEMINI_MODELES`);
    return retires.length ? `⚠️ modèle(s) retiré(s) : ${retires.join(', ')}` : d.utilises.join(', ');
  }],

  ['AniList (infos et jaquettes)', 'Compléter les infos manquantes', async () => {
    const query = 'query ($search: String) { Page(perPage: 1) { media(search: $search, type: MANGA) { title { romaji } coverImage { large } staff { edges { role node { name { full } } } } } } }';
    const d = await lireJson(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables: { search: 'One Piece' } }) });
    const media = d.data && d.data.Page && d.data.Page.media && d.data.Page.media[0];
    exiger(media && media.title && media.title.romaji, 'aucun résultat : ' + JSON.stringify(d).slice(0, 200));
    exiger(media.coverImage && /^https:/.test(media.coverImage.large || ''), 'jaquette absente');
    return media.title.romaji;
  }],

  ['Jikan / MyAnimeList (secours d\'AniList)', 'Compléter les infos manquantes', async () => {
    const d = await lireJson(JIKAN + '/manga?q=naruto&limit=1');
    exiger(Array.isArray(d.data) && d.data[0] && d.data[0].title, 'aucun résultat : ' + JSON.stringify(d).slice(0, 200));
    return d.data[0].title;
  }]
];

(async () => {
  const echecs = [];
  for (const [nom, fonction, verifier] of verifications) {
    try {
      const detail = await verifier();
      console.log(`✅ ${nom} — ${detail}`);
    } catch (e) {
      echecs.push(nom);
      console.log(`❌ ${nom}\n   Fonction touchée : ${fonction}\n   ${e.message}`);
    }
  }
  console.log(echecs.length ? `\n❌ ${echecs.length} source(s) en panne ou modifiée(s) : ${echecs.join(' · ')}` : '\n✅ Toutes les sources répondent normalement');
  // Résumé affiché sur la page du lancement dans GitHub Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, echecs.length
      ? `## ❌ ${echecs.length} source(s) à vérifier\n\n${echecs.map(n => '- ' + n).join('\n')}\n`
      : '## ✅ Toutes les sources répondent normalement\n');
  }
  process.exit(echecs.length ? 1 : 0);
})();
