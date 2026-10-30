// Mettre à jour une série : choisir son édition (Manga Insight), le nombre de tomes, puis sa jaquette

const HORS_SERIE_MI = /illustration|artbook|art ?book|guide|fanbook|roman|novel|coffret|coffre|anime ?comics|re:source|sketchbook|quiz|dictionnaire|vivre card|magazine/i;

// Éditions françaises connues pour la série (même titre de base), de la plus ancienne à la plus récente
function editionsMangaInsight(serie) {
  if (!indexMI) return [];
  const cible = normaliserRecherche(decomposerTitreSerie(serie.titre).base);
  const groupes = new Map();
  for (const s of indexMI.get(cible) || []) {
    if (normaliserRecherche(s.base) !== cible || HORS_SERIE_MI.test(s.nom)) continue;
    const cle = s.nom + '|' + s.editeur;
    if (!groupes.has(cle)) groupes.set(cle, { nom: s.nom, suffixe: s.suffixe, editeur: s.editeur, vols: new Set(), isbns: new Set(), debut: Infinity, fin: 0 });
    const g = groupes.get(cle);
    g.vols.add(s.vol);
    if (s.ean) g.isbns.add(s.ean);
    if (s.ean && s.vol === 1) g.isbn1 = s.ean;
    g.debut = Math.min(g.debut, s.k);
    g.fin = Math.max(g.fin, s.k);
  }
  return [...groupes.values()].map(g => ({
    ...g,
    tomes: Math.max(...g.vols),
    // Nom court de l'édition pour le titre : « Star Edition » → « Star », « Edition Deluxe » → « Deluxe »
    edition: editionDepuisSuffixe(g.suffixe)
  })).sort((a, b) => a.debut - b.debut);
}

function texteEdition(e) {
  const annees = Math.floor(e.debut / 12) === Math.floor(e.fin / 12) ? String(Math.floor(e.debut / 12)) : `${Math.floor(e.debut / 12)}–${Math.floor(e.fin / 12)}`;
  // « Édition 1re édition » ou « Édition Edition spéciale » : le mot « édition » n'est pas répété
  const nom = !e.edition ? 'Édition standard' : /[ée]dition/i.test(e.edition) ? e.edition.replace(/^edition/i, 'Édition') : 'Édition ' + e.edition;
  return `${nom} · ${e.tomes} tome${e.tomes > 1 ? 's' : ''} · ${e.editeur || '?'} · ${annees}`;
}

async function majSerieActuelle() {
  if (serieIndexActive === null) return;
  const loader = document.getElementById('loader-ia');
  document.getElementById('loader-status').textContent = 'Recherche des éditions…';
  loader.style.display = 'flex';
  await chargerMangaInsight(false);
  loader.style.display = 'none';

  let index = serieIndexActive;
  const serie = bibliotheque[index];
  const isbnsSerie = new Set(serie.tomes.filter(t => t.isbn && !t.isbnAuto).map(t => t.isbn));
  // Les éditions des tomes scannés d'abord : c'est sûrement la bonne
  const editions = editionsMangaInsight(serie)
    .map(e => ({ ...e, scannee: [...e.isbns].some(i => isbnsSerie.has(i)) }))
    .sort((a, b) => b.scannee - a.scannee);
  const actuelle = serie.parution && serie.parution.nom;
  const choix = editions.map((e, i) => ({
    libelle: (e.nom === actuelle ? '✓ ' : '') + texteEdition(e) + (e.scannee ? ' · 📷 tes tomes scannés' : ''),
    valeur: 'edition:' + i, principal: e.scannee || (e.nom === actuelle && !editions.some(x => x.scannee))
  }));
  choix.push({ libelle: '✍️ Saisir le nombre de tomes à la main', valeur: 'manuel' });
  const message = editions.length
    ? `Quelle édition de « ${decomposerTitreSerie(serie.titre).base} » possèdes-tu ?\n\nLe nombre de tomes, les sorties et la jaquette suivront cette édition.`
    : `Aucune édition trouvée dans les sorties françaises (Manga Insight) pour « ${serie.titre} ».\n\nTu peux saisir le nombre de tomes parus à la main.`;
  const reponse = await choisirAction(message, choix);
  if (!reponse) return;

  let isbnsEdition = [];
  if (reponse === 'manuel') {
    const saisie = await demanderTexte(`Nombre de tomes parus de « ${serie.titre} » (il ne sera plus modifié par les mises à jour automatiques ; laisse vide pour les réactiver) :`, serie.tomesParus ? String(serie.tomesParus) : '');
    if (saisie === null) return;
    const n = parseInt(saisie, 10);
    if (n > 0) {
      delete serie.parution;
      delete serie.miNom;
      serie.tomesParus = n;
      serie.tomesParusSource = 'manuel';
      serie.tomesParusMaj = Date.now();
    } else {
      for (const champ of ['tomesParus', 'tomesParusSource', 'tomesParusMaj', 'miNom']) delete serie[champ];
      appliquerMangaInsight(serie);
    }
  } else {
    const e = editions[Number(reponse.split(':')[1])];
    // Le titre porte l'édition entre parenthèses : « Slam Dunk (Star) »
    const base = decomposerTitreSerie(serie.titre).base;
    const titre = e.edition ? `${base} (${e.edition})` : base;
    if (normaliserTitre(titre) !== normaliserTitre(serie.titre)) {
      const autre = bibliotheque.find((s, i) => i !== index && normaliserTitre(s.titre) === normaliserTitre(titre));
      if (autre && !(await confirmerAction(`La série « ${autre.titre} » existe déjà.\n\nFusionner les deux ? Tous les tomes seront regroupés dans une seule série.`))) return;
      index = changerTitreSerie(index, titre);
    }
    const cible = bibliotheque[index];
    if (cible.tomesParusSource === 'manuel') delete cible.tomesParusSource;
    // ISBN remplis d'après une autre édition : remplacés par ceux de l'édition choisie
    const autresIsbn = new Set(editions.filter(x => x !== e).flatMap(x => [...x.isbns]));
    for (const t of cible.tomes) if (t.isbn && (t.isbnAuto || autresIsbn.has(t.isbn))) { delete t.isbn; delete t.isbnAuto; }
    cible.miNom = e.nom;
    cible.miEditeur = e.editeur;
    appliquerMangaInsight(cible);
    if (e.editeur && !cible.editeur) cible.editeur = editeurFrancais(e.editeur) || e.editeur;
    const mi = infosMangaInsight(cible);
    if (mi) isbnsEdition = [mi.isbnParTome[1], mi.isbnParTome[mi.tomesParus]].filter(Boolean);
  }
  serieIndexActive = index;
  sauvegarder();

  const cible = bibliotheque[index];
  if (!isbnsEdition.length) isbnsEdition = cible.tomes.filter(t => t.possede && t.isbn).map(t => t.isbn).slice(0, 2);
  isbnsEdition = [...new Set(isbnsEdition)];
  if (isbnsEdition.length) await choisirJaquetteParIsbn(index, isbnsEdition);
  else afficherToast(`✓ ${cible.titre} mise à jour`);
}

// --- Jaquette d'une édition précise, retrouvée grâce à l'ISBN d'un de ses tomes ---

function isbn13Vers10(isbn) {
  if (!/^978\d{10}$/.test(isbn)) return null;
  const corps = isbn.slice(3, 12);
  let somme = 0;
  for (let i = 0; i < 9; i++) somme += Number(corps[i]) * (10 - i);
  const cle = (11 - (somme % 11)) % 11;
  return corps + (cle === 10 ? 'X' : String(cle));
}

// Liens d'images possibles pour un ISBN (certains n'existent pas : ils seront masqués à l'affichage)
async function jaquettesPourIsbn(isbn) {
  const liens = [];
  const cle = localStorage.getItem('google_books_api_key');
  if (cle) {
    try {
      const r = await fetchAvecTimeout('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&key=' + encodeURIComponent(cle), {}, 10000);
      const d = await r.json();
      const img = d.items && d.items[0].volumeInfo.imageLinks;
      if (img && (img.thumbnail || img.smallThumbnail)) liens.push((img.thumbnail || img.smallThumbnail).replace(/^http:/, 'https:'));
    } catch (e) { /* source indisponible : on passe aux suivantes */ }
  }
  liens.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`);
  const isbn10 = isbn13Vers10(isbn);
  if (isbn10) liens.push(`https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01.LZZZZZZZ.jpg`);
  return liens;
}

async function choisirJaquetteParIsbn(index, isbns) {
  const serie = bibliotheque[index];
  const modal = document.getElementById('jaquettes-modal');
  const grille = document.getElementById('jaquettes-grille');
  const statut = document.getElementById('jaquettes-statut');
  grille.innerHTML = '';
  statut.textContent = 'Recherche des jaquettes…';
  modal.classList.add('active');
  document.getElementById('jaquettes-garder').onclick = () => modal.classList.remove('active');

  const liens = [...new Set((await Promise.all(isbns.map(jaquettesPourIsbn))).flat())];
  let enAttente = liens.length;
  let trouvees = 0;
  const fin = () => {
    if (--enAttente > 0) return;
    statut.textContent = trouvees
      ? 'Touche la jaquette de ton édition :'
      : 'Aucune jaquette trouvée pour cette édition. Tu peux en prendre une en photo avec ⋯ → 🖼️ Changer la jaquette.';
  };
  for (const lien of liens) {
    const img = document.createElement('img');
    img.className = 'jaquette-choix';
    img.alt = 'Jaquette';
    img.style.display = 'none';
    // Les sources renvoient parfois une image vide de 1 pixel quand elles n'ont rien
    img.onload = () => { if (img.naturalWidth > 20) { img.style.display = ''; trouvees++; } fin(); };
    img.onerror = fin;
    img.onclick = () => {
      serie.couverture = lien;
      modal.classList.remove('active');
      sauvegarder();
      afficherToast(`✓ Jaquette de ${serie.titre} mise à jour`);
    };
    img.src = lien;
    grille.appendChild(img);
  }
  if (!liens.length) { enAttente = 1; fin(); }
}

// Depuis « 🖼️ Changer la jaquette » : jaquette d'après l'ISBN d'un tome possédé
async function chercherJaquetteEdition() {
  if (serieIndexActive === null) return;
  const serie = bibliotheque[serieIndexActive];
  const isbns = [...new Set(serie.tomes.filter(t => t.isbn).sort((a, b) => a.numero - b.numero).map(t => t.isbn))].slice(0, 2);
  if (!isbns.length) {
    alert("Aucun tome de cette série n'a encore d'ISBN : scanne un tome (📷), puis réessaie.");
    return;
  }
  await choisirJaquetteParIsbn(serieIndexActive, isbns);
}

// --- Jaquettes manquantes : pour toutes les séries sans jaquette (ou dont l'image ne s'affiche plus) ---

// L'image s'affiche-t-elle ? 'ok', 'erreur' (lien mort), ou 'delai' (réseau trop lent : on ne conclut rien)
function testerImage(lien, delai = 10000) {
  return new Promise((resolve) => {
    const img = new Image();
    const minuteur = setTimeout(() => { img.src = ''; resolve('delai'); }, delai);
    const fin = (etat) => { clearTimeout(minuteur); resolve(etat); };
    // Une image de 1 pixel veut dire « pas de jaquette » (Amazon)
    img.onload = () => fin(img.naturalWidth > 20 ? 'ok' : 'erreur');
    img.onerror = () => fin('erreur');
    img.src = lien;
  });
}

// ISBN qui désignent la bonne édition : tome 1 d'après Manga Insight, puis les tomes possédés
function isbnsPourJaquette(serie) {
  const mi = infosMangaInsight(serie);
  const isbns = [mi && mi.isbnParTome[1], ...serie.tomes.filter(t => t.isbn).sort((a, b) => a.numero - b.numero).map(t => t.isbn)];
  if (mi) isbns.push(...Object.keys(mi.isbnParTome).map(Number).sort((a, b) => a - b).map(v => mi.isbnParTome[v]));
  return [...new Set(isbns.filter(Boolean))].slice(0, 3);
}

async function trouverJaquette(serie) {
  for (const isbn of isbnsPourJaquette(serie)) {
    for (const lien of await jaquettesPourIsbn(isbn)) {
      if (await testerImage(lien) === 'ok') return lien;
    }
  }
  return null;
}

// Traite la liste par petits groupes (pas des dizaines de téléchargements à la fois)
async function parGroupes(liste, taille, traiter) {
  let suivant = 0;
  await Promise.all(Array.from({ length: Math.min(taille, liste.length) }, async () => {
    while (suivant < liste.length) await traiter(liste[suivant++]);
  }));
}

async function trouverJaquettesManquantes() {
  if (!navigator.onLine) { alert('Pas de réseau : réessaie quand tu seras connecté.'); return; }
  fermerParametres();
  const loader = document.getElementById('loader-ia');
  const statut = document.getElementById('loader-status');
  statut.textContent = 'Vérification des jaquettes…';
  loader.style.display = 'flex';
  await chargerMangaInsight(false);

  const manquantes = [];
  await parGroupes(bibliotheque, 6, async (serie) => {
    if (!serie.couverture || serie.couverture === JAQUETTE_DEFAUT || await testerImage(serie.couverture) === 'erreur') manquantes.push(serie);
  });
  if (!manquantes.length) {
    loader.style.display = 'none';
    afficherToast('✓ Toutes tes séries ont une jaquette');
    return;
  }

  const anciennes = new Map(), introuvables = [];
  let faites = 0;
  statut.textContent = `Recherche des jaquettes… 0 / ${manquantes.length}`;
  await parGroupes(manquantes, 4, async (serie) => {
    const lien = await trouverJaquette(serie);
    if (lien) { anciennes.set(serie, serie.couverture); serie.couverture = lien; }
    else introuvables.push(serie.titre);
    statut.textContent = `Recherche des jaquettes… ${++faites} / ${manquantes.length}`;
  });
  loader.style.display = 'none';
  if (anciennes.size) sauvegarder();

  const trie = (l) => l.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  const bilan = (anciennes.size ? `✓ ${anciennes.size} jaquette${anciennes.size > 1 ? 's' : ''} trouvée${anciennes.size > 1 ? 's' : ''} : ${trie([...anciennes.keys()].map(s => s.titre)).join(', ')}.` : 'Aucune jaquette trouvée.')
    + (introuvables.length ? `\n\nToujours sans jaquette (${introuvables.length}) : ${trie(introuvables).join(', ')}.\nPour celles-ci : fiche → ⋯ → 🔄 Édition, tomes et jaquette, ou une photo.` : '');
  if (!anciennes.size) { alert(bilan); return; }
  // « Annuler » remet les jaquettes d'avant
  const choix = await choisirAction(bilan, [{ libelle: '✓ Garder les jaquettes trouvées', valeur: 'garder', principal: true }]);
  if (choix !== 'garder') {
    for (const [serie, ancienne] of anciennes) serie.couverture = ancienne;
    sauvegarder();
    afficherToast('Jaquettes remises comme avant');
  }
}
