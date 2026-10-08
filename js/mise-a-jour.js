// Compléter la collection, tomes parus (BnF), sorties et estimations (Manga Insight)

// --- Compléter toute la collection ---
const PAUSE_ENTRE_SERIES_MS = 2500; // respecte les limites d'AniList et de Gemini
let completionArretee = false;

function serieIncomplete(s) {
  return !s.auteur || !s.genre || !s.editeur || !s.couverture;
}

// Traite des séries une par une dans la fenêtre de progression (bouton Arrêter, sauvegarde à chaque série).
// `traiter(serie)` renvoie true si la série a été modifiée. Renvoie le nombre de séries traitées.
async function traiterEnLot(titre, cibles, traiter, pauseMs) {
  const modal = document.getElementById('completion-modal');
  const etape = document.getElementById('completion-etape');
  const barre = document.getElementById('completion-barre');
  const bouton = document.getElementById('completion-bouton');
  document.getElementById('completion-titre').textContent = titre;
  document.getElementById('completion-bilan').textContent = '';
  barre.style.width = '0%';
  bouton.textContent = 'Arrêter';
  bouton.onclick = () => { completionArretee = true; bouton.textContent = 'Arrêt après cette série…'; };
  completionArretee = false;
  modal.classList.add('active');

  let traitees = 0;
  for (const serie of cibles) {
    if (completionArretee) break;
    etape.textContent = `${traitees + 1} / ${cibles.length} — ${serie.titre}`;
    try {
      if (await traiter(serie)) sauvegarderLocal();
    } catch (e) {
      console.error('Traitement impossible pour ' + serie.titre, e);
    }
    traitees++;
    barre.style.width = Math.round(traitees / cibles.length * 100) + '%';
    if (traitees < cibles.length && !completionArretee) await pause(pauseMs);
  }
  sauvegarder();
  if (!cibles.length) barre.style.width = '100%';
  etape.textContent = completionArretee ? `Arrêté après ${traitees} série(s) sur ${cibles.length}` : 'Terminé ✅';
  bouton.textContent = 'Fermer';
  bouton.onclick = () => modal.classList.remove('active');
  return traitees;
}

async function completerCollection() {
  const cibles = bibliotheque.filter(serieIncomplete);
  if (!cibles.length) { alert('Toutes tes séries sont déjà complètes 🎉'); return; }
  const minutes = Math.max(1, Math.round(cibles.length * 4 / 60));
  if (!(await confirmerAction(`Compléter ${cibles.length} série(s) incomplète(s) ?\n\nSeuls les champs vides sont remplis, rien n'est écrasé. Compte environ ${minutes} min : garde l'app ouverte.`))) return;
  fermerParametres();

  let completees = 0;
  const incompletes = [];
  await traiterEnLot('✨ Compléter ma collection', cibles, async (serie) => {
    const res = await collecterInfosSerie(serie.titre, champsRenseignes(serie));
    const champs = Object.keys(res.valeurs);
    champs.forEach(c => { serie[c] = res.valeurs[c]; });
    if (champs.length) completees++;
    if (serieIncomplete(serie)) {
      const manquants = ['auteur', 'genre', 'editeur', 'couverture'].filter(c => !serie[c]).map(c => NOMS_CHAMPS[c]);
      incompletes.push(`• ${serie.titre} : ${manquants.join(', ')}`);
    }
    return champs.length > 0;
  }, PAUSE_ENTRE_SERIES_MS);

  let bilan = `${completees} série(s) enrichie(s).`;
  if (incompletes.length) bilan += `\n\nEncore incomplètes (${incompletes.length}) — il manque :\n${incompletes.join('\n')}\n\nOuvre leur fiche (✏️ Infos) pour compléter à la main ou vérifier le titre.`;
  document.getElementById('completion-bilan').textContent = bilan;
}

// --- Tomes parus en France pour une édition (catalogue de la BnF) ---
const DELAI_MAJ_TOMES_PARUS = 7 * 24 * 3600 * 1000; // une vérification par semaine suffit

// « Berserk (Prestige) » → { base: 'Berserk', edition: 'Prestige' }
function decomposerTitreSerie(titre) {
  const m = (titre || '').match(/\(([^)]*)\)/);
  return { base: titreRecherche(titre), edition: m ? m[1].trim() : null };
}

// Notices BnF de cette série et de cette édition → numéros de tome, regroupés par éditeur
async function noticesEdition(base, edition, editeur) {
  const mots = (base + ' ' + (edition || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let url = WORKER_URL + '/edition?mots=' + encodeURIComponent(mots);
  if (editeur) url += '&editeur=' + encodeURIComponent(editeur);
  const r = await fetchAvecTimeout(url, {}, 20000);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.erreur) throw new Error((d && d.erreur) || 'HTTP ' + r.status);

  const parEditeur = new Map();
  for (const notice of d.notices || []) {
    const a = analyserTitreLivre(notice.titre);
    // « Ao Ashi : brother foot. 1 » : le sous-titre français après « : » est ignoré
    const nomsPossibles = [a.serie, a.serie.split(/\s+:\s+/)[0]].map(normaliserRecherche);
    if (!a.tome || !nomsPossibles.includes(normaliserRecherche(base))) continue;
    // Même édition : le mot de l'édition doit figurer dans le titre ; édition standard : aucune édition détectée
    if (edition ? !normaliserRecherche(notice.titre).includes(normaliserRecherche(edition)) : a.edition) continue;
    const nom = editeurFrancais(notice.editeur) || (notice.editeur || '').replace(/\s*\([^)]*\)/, '') || '?';
    if (!parEditeur.has(nom)) parEditeur.set(nom, new Set());
    parEditeur.get(nom).add(a.tome);
  }
  // Pour le diagnostic : des titres qui contiennent vraiment le nom de la série
  const cle = normaliserRecherche(base);
  const exemples = (d.notices || []).map(n => n.titre).filter(t => normaliserRecherche(t).includes(cle));
  return { parEditeur, nbNotices: (d.notices || []).length, exemples: (exemples.length ? exemples : (d.notices || []).map(n => n.titre)).slice(0, 3) };
}

// Nombre de tomes parus : plus grand numéro trouvé chez l'éditeur de la série.
// Si rien chez cet éditeur (éditeur vide, faux ou écrit autrement), nouvel essai sans éditeur :
// on retient alors l'éditeur qui a le plus de tomes.
async function chercherTomesParus(serie) {
  const { base, edition } = decomposerTitreSerie(serie.titre);
  const editeurSerie = editeurFrancais(serie.editeur);
  const essais = serie.editeur ? [serie.editeur, null] : [null];
  let diagnostic = null;
  for (const editeur of essais) {
    const res = await noticesEdition(base, edition, editeur);
    let numeros = null;
    if (editeur && editeurSerie) numeros = res.parEditeur.get(editeurSerie);
    if (!numeros) {
      for (const [, tomes] of res.parEditeur) if (!numeros || tomes.size > numeros.size) numeros = tomes;
    }
    if (numeros && numeros.size) {
      // Trouvé seulement sans éditeur : l'éditeur de la série était faux ou absent, on prend celui de la BnF
      let editeurBnf = null;
      for (const [nom, tomes] of res.parEditeur) if (tomes === numeros) editeurBnf = nom;
      return { parus: Math.max(...numeros), editeurBnf: !editeur && editeurBnf !== '?' ? editeurBnf : null };
    }
    if (!diagnostic || res.nbNotices) diagnostic = res.nbNotices
      ? `${res.nbNotices} notice(s) BnF, aucune retenue (ex. ${res.exemples.map(t => '« ' + t + ' »').join(', ')})`
      : 'aucune notice à la BnF';
  }
  return { parus: null, diagnostic };
}

// Renvoie la correction d'éditeur faite (« PUQ → Mangetsu »), sinon null
async function majTomesParus(serie) {
  const { parus, diagnostic, editeurBnf } = await chercherTomesParus(serie);
  serie.tomesParusMaj = Date.now();
  serie.tomesParusDiagnostic = diagnostic || null;
  if (parus) serie.tomesParus = parus;
  if (editeurBnf && editeurFrancais(serie.editeur) !== editeurBnf) {
    const correction = `${serie.editeur || 'vide'} → ${editeurBnf}`;
    serie.editeur = editeurBnf;
    return correction;
  }
  return null;
}

// --- Données de parution Manga Insight (CC BY 4.0) : sorties en France, au mois près ---
// Deux fichiers alignés ligne à ligne : rows (titre « Série - Édition Vol.N », EAN) et core (année, mois, éditeur)
const DELAI_MANGA_INSIGHT = 7 * 24 * 3600 * 1000;
// Suffixes qui ne sont pas l'édition standard d'une série
const VARIANTES_MI = /collector|coffret|coffre|prestige|deluxe|perfect|ultimate|double|int[ée]grale|light novel|roman|novel|artbook|art ?book|guide|fanbook|anime ?comics|vivre card|[ée]dition|kanzenban|anthologie|spin|best of/i;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
let indexMI = null;
let dateMI = null;

function compacterMangaInsight(core, rows) {
  const col = core.col, editeurs = core.dict.editor, sorties = [];
  for (let i = 0; i < rows.title.length; i++) {
    const m = (rows.title[i] || '').match(/^(.*?)\s+Vol\.\s*(\d+)\s*$/);
    if (!m || !col.year[i]) continue;
    sorties.push([m[1], Number(m[2]), col.year[i], col.month[i], col.editor[i] >= 0 ? editeurs[col.editor[i]] : '', rows.ean[i] || '']);
  }
  return sorties;
}

function indexerMangaInsight(sorties) {
  const index = new Map();
  for (const [nom, vol, annee, mois, editeur, ean] of sorties) {
    const morceaux = nom.split(' - ');
    const entree = { nom, base: morceaux[0], suffixe: morceaux.slice(1).join(' - '), vol, k: annee * 12 + mois - 1, editeur, ean };
    const cle = normaliserRecherche(entree.base);
    if (!index.has(cle)) index.set(cle, []);
    index.get(cle).push(entree);
  }
  return index;
}

// Charge les données (cache de 7 jours sur l'appareil, sinon téléchargement via le Worker)
async function chargerMangaInsight(forcer) {
  let cache = null;
  if (db) cache = await dbGet('mangainsight').catch(() => null);
  if (!cache || forcer || Date.now() - cache.recupere > DELAI_MANGA_INSIGHT) {
    try {
      const [core, rows] = await Promise.all(['core', 'rows'].map(f =>
        fetchAvecTimeout(WORKER_URL + '/mangainsight/' + f, {}, 30000).then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })));
      if (core.n !== rows.n) throw new Error('fichiers désalignés');
      cache = { genere: core.generated_at, recupere: Date.now(), sorties: compacterMangaInsight(core, rows) };
      if (db) await dbSet('mangainsight', cache);
    } catch (e) {
      console.error('Manga Insight indisponible', e);
      if (!cache) return false;
    }
  }
  indexMI = indexerMangaInsight(cache.sorties);
  dateMI = cache.genere;
  return true;
}

// Retrouve la série et son édition dans les sorties françaises, puis calcule rythme et estimation
function infosMangaInsight(serie) {
  if (!indexMI) return null;
  const { base, edition } = decomposerTitreSerie(serie.titre);
  const cible = normaliserRecherche(base);
  const editionN = edition ? normaliserRecherche(edition) : null;
  const groupes = new Map();
  for (const cle of new Set([cible, normaliserRecherche(base.split(' - ')[0])])) {
    for (const s of indexMI.get(cle) || []) {
      const nomN = normaliserRecherche(s.nom);
      const baseOk = normaliserRecherche(s.base) === cible || nomN.startsWith(cible);
      const ok = editionN
        ? baseOk && nomN.includes(editionN)
        : nomN === cible || (normaliserRecherche(s.base) === cible && !VARIANTES_MI.test(s.suffixe));
      if (!ok) continue;
      const cleGroupe = s.nom + '|' + s.editeur;
      if (!groupes.has(cleGroupe)) groupes.set(cleGroupe, []);
      groupes.get(cleGroupe).push(s);
    }
  }
  let liste = [...groupes.values()];
  // Préférences : nom exact (« Ao Ashi - Playmaker » pour « Ao Ashi » sinon), puis même éditeur, puis le plus de tomes
  const exacts = liste.filter(g => normaliserRecherche(g[0].nom) === cible);
  if (exacts.length) liste = exacts;
  const editeurSerie = editeurFrancais(serie.editeur);
  const memeEditeur = liste.filter(g => editeurSerie && editeurFrancais(g[0].editeur) === editeurSerie);
  if (memeEditeur.length) liste = memeEditeur;
  if (!liste.length) return null;
  const nbTomes = (g) => new Set(g.map(s => s.vol)).size;
  liste.sort((a, b) => nbTomes(b) - nbTomes(a));

  // Une sortie par numéro (la plus ancienne en cas de réédition)
  const parVol = new Map();
  for (const s of liste[0]) if (!parVol.has(s.vol) || s.k < parVol.get(s.vol).k) parVol.set(s.vol, s);
  const volumes = [...parVol.values()].sort((a, b) => a.vol - b.vol);
  const dernier = volumes.reduce((a, b) => (b.k > a.k || (b.k === a.k && b.vol > a.vol) ? b : a));

  // Rythme : médiane des écarts (en mois) entre les derniers tomes parus
  const recents = volumes.filter(v => v.vol <= dernier.vol).slice(-7);
  const ecarts = [];
  for (let i = 1; i < recents.length; i++) ecarts.push(recents[i].k - recents[i - 1].k);
  ecarts.sort((a, b) => a - b);
  const rythme = ecarts.length >= 2 ? Math.max(1, ecarts[Math.floor(ecarts.length / 2)]) : null;

  return {
    nom: liste[0][0].nom,
    editeur: liste[0][0].editeur,
    tomesParus: volumes[volumes.length - 1].vol,
    isbnParTome: Object.fromEntries(volumes.filter(v => v.ean).map(v => [v.vol, v.ean])),
    dernier: { vol: dernier.vol, k: dernier.k },
    rythme
  };
}

// Met à jour une série avec Manga Insight. Renvoie true si quelque chose a changé.
function appliquerMangaInsight(serie) {
  const mi = infosMangaInsight(serie);
  if (!mi) return false;
  const avant = JSON.stringify([serie.tomesParus, serie.editeur, serie.parution, serie.tomes]);
  serie.tomesParus = mi.tomesParus;
  serie.tomesParusSource = 'Manga Insight';
  serie.tomesParusMaj = Date.now();
  serie.parution = { nom: mi.nom, dernier: mi.dernier, rythme: mi.rythme };
  if (!serie.editeur && mi.editeur) serie.editeur = editeurFrancais(mi.editeur) || mi.editeur;
  for (const tome of serie.tomes) if (tome.possede && !tome.isbn && mi.isbnParTome[tome.numero]) tome.isbn = mi.isbnParTome[tome.numero];
  return JSON.stringify([serie.tomesParus, serie.editeur, serie.parution, serie.tomes]) !== avant;
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// k = année × 12 + mois (0 à 11) → « novembre 2026 » ou, en court, « nov. 26 »
function moisTexte(k, court) {
  const annee = Math.floor(k / 12);
  return court ? `${MOIS_COURTS[k % 12]} ${String(annee).slice(2)}` : `${MOIS[k % 12]} ${annee}`;
}

// Prochaine sortie estimée d'après le rythme : { vol, k, retard } ou null (série terminée ou en pause)
function prochaineSortie(serie) {
  const p = serie.parution;
  if (!p || !p.rythme || serie.misDeCote || serie.statut === 'Terminée' || serie.statut === 'Abandonnée') return null;
  const maintenant = new Date().getFullYear() * 12 + new Date().getMonth();
  // Rien depuis bien plus longtemps que d'habitude : on ne devine pas
  if (maintenant - p.dernier.k > Math.max(3 * p.rythme, 12)) return null;
  const k = p.dernier.k + p.rythme;
  return { vol: p.dernier.vol + 1, k: Math.max(k, maintenant), retard: k < maintenant };
}

// Au démarrage : met à jour discrètement toutes les séries si les données sont disponibles
async function majMangaInsightAuDemarrage() {
  if (!(await chargerMangaInsight(false))) return;
  let modifie = false;
  for (const serie of bibliotheque) if (appliquerMangaInsight(serie)) modifie = true;
  if (modifie) sauvegarderLocal();
}

async function majTomesParusCollection() {
  if (!bibliotheque.length) return;
  if (!(await confirmerAction(`Mettre à jour tes ${bibliotheque.length} séries ?\n\nTomes parus en France, dernière sortie et prochaine sortie estimée (Manga Insight), puis la BnF pour les séries introuvables.`))) return;
  fermerParametres();
  document.getElementById('loader-status').textContent = 'Téléchargement des sorties (Manga Insight)…';
  document.getElementById('loader-ia').style.display = 'flex';
  const miOk = await chargerMangaInsight(true);
  document.getElementById('loader-ia').style.display = 'none';

  const viaMI = [];
  const restantes = [];
  for (const serie of bibliotheque) {
    if (miOk && infosMangaInsight(serie)) { appliquerMangaInsight(serie); viaMI.push(serie); }
    else restantes.push(serie);
  }
  sauvegarderLocal();

  let viaBnf = 0;
  const introuvables = [];
  const corrections = [];
  if (restantes.length) {
    await traiterEnLot('🔄 Mise à jour des séries', restantes, async (serie) => {
      const correction = await majTomesParus(serie);
      if (correction) corrections.push(`• ${serie.titre} : ${correction}`);
      if (serie.tomesParus) viaBnf++;
      else introuvables.push(`• ${serie.titre} (${serie.editeur || 'éditeur inconnu'}) : ${serie.tomesParusDiagnostic || 'erreur de recherche'}`);
      return true;
    }, 1000);
  } else {
    await traiterEnLot('🔄 Mise à jour des séries', [], async () => false, 0);
  }

  let bilan = miOk
    ? `${viaMI.length} série(s) mises à jour avec Manga Insight (données du ${new Date(dateMI).toLocaleDateString('fr-FR')}).`
    : `Manga Insight injoignable : recherche à la BnF uniquement.`;
  if (restantes.length) bilan += `\n${viaBnf} série(s) trouvée(s) à la BnF.`;
  if (corrections.length) bilan += `\n\nÉditeur corrigé d'après la BnF (${corrections.length}) :\n${corrections.join('\n')}`;
  if (introuvables.length) bilan += `\n\nIntrouvables (${introuvables.length}) :\n${introuvables.join('\n')}\n\nVérifie le titre de ces séries : une édition spéciale se note entre parenthèses, ex. « Berserk (Prestige) ».`;
  document.getElementById('completion-bilan').textContent = bilan;
}
