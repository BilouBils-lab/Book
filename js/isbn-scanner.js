// Recherche par ISBN (BnF, Google Books) et scan du code-barres (ZXing)

// --- Recherche par ISBN (Google Books, avec la clé enregistrée dans les réglages) ---
function nettoyerIsbn(saisie) {
  return (saisie || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

// Le dernier chiffre d'un ISBN est une clé de contrôle : détecte les fautes de frappe
function isbnValide(isbn) {
  if (/^\d{13}$/.test(isbn)) {
    const somme = [...isbn].reduce((acc, c, i) => acc + Number(c) * (i % 2 ? 3 : 1), 0);
    return somme % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const somme = [...isbn].reduce((acc, c, i) => acc + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    return somme % 11 === 0;
  }
  return false;
}

const EDITIONS = [
  ['Prestige', /prestige/], ['Deluxe', /deluxe/], ['Perfect', /perfect/], ['Ultimate', /ultimate/],
  ['Double', /\bdouble\b|2 en 1|2-en-1/], ['Intégrale', /int[eé]grale/], ['Collector', /collector/],
  ['Star', /\bstar\b/], ['Smash', /\bsmash\b/], ['Kanzenban', /kanzenban/], ['Originale', /[eé]dition originale/]
];

// « Berserk Prestige - Tome 5 » ou « Berserk. 5 (Éd. prestige) » (BnF) → { serie: 'Berserk', tome: 5, edition: 'Prestige' }
function analyserTitreLivre(titre, sousTitre) {
  const texte = (titre || '') + ' ' + (sousTitre || '');
  const edition = (EDITIONS.find(([, motif]) => motif.test(texte.toLowerCase())) || [])[0] || null;
  // Les parenthèses contiennent l'édition ou des précisions : jamais le nom de la série
  let serie = (titre || '').replace(/\s*\([^)]*\)/g, '');
  // Dans l'ordre : « Tome 5 » / « Vol. 5 », puis le format BnF « Série. 5 … » (série avant le point),
  // puis un numéro en fin de titre
  const motifs = [/(?:\btome|\bt\.?|\bvol\.?|\bvolume|n°)\s*0*(\d{1,3})\b/i, /\.\s*0*(\d{1,3})\b.*$/, /\b0*(\d{1,3})\s*$/];
  let tome = null;
  for (const motif of motifs) {
    const m = serie.match(motif) || (sousTitre || '').match(motif);
    if (m) { tome = Number(m[1]); serie = serie.replace(motif, ''); break; }
  }
  if (edition) serie = serie.replace(new RegExp('[\\-–:,]*\\s*([ée]dition\\s+)?' + edition + '(\\s+[ée]dition)?', 'i'), ' ');
  serie = serie.replace(/\s+/g, ' ').replace(/[\s\-–:,.]+$/, '').replace(/^[\s\-–:,.]+/, '').trim();
  return { serie: serie || titre, tome, edition };
}

// Édition d'une série d'après son titre : « Berserk (Prestige) » → 'Prestige', sinon null (standard)
function editionDuTitre(titre) {
  const p = (titre.match(/\(([^)]*)\)\s*$/) || [])[1];
  if (!p) return null;
  return (EDITIONS.find(([, motif]) => motif.test(p.toLowerCase())) || [])[0] || null;
}

function titreSansEdition(titre) {
  return normaliserRecherche(titre.replace(/\s*\([^)]*\)\s*$/, ''));
}

// Titre complet d'un livre analysé : « Dragon Ball (Perfect) », ou « Dragon Ball » en édition standard
function titreAvecEdition(analyse) {
  return analyse.edition ? `${analyse.serie} (${analyse.edition})` : analyse.serie;
}

function ligneInfo(parent, libelle, valeur) {
  if (!valeur) return;
  const div = document.createElement('div');
  div.style.cssText = 'font-size: 13px; margin-bottom: 6px; line-height: 1.35;';
  const b = document.createElement('span');
  b.style.color = 'var(--text-sub)';
  b.textContent = libelle + ' : ';
  div.append(b, String(valeur));
  parent.appendChild(div);
}

// BnF (via le Worker) d'abord : c'est la référence des livres publiés en France.
// Google Books en secours (clé nécessaire) : il apporte souvent la couverture.
async function chercherLivreParIsbn(isbn) {
  const erreurs = [];
  try {
    const r = await fetchAvecTimeout(WORKER_URL + '/isbn?isbn=' + isbn, {}, 15000);
    const d = await r.json().catch(() => null);
    if (d && d.trouve) {
      return { trouve: true, source: 'BnF', titre: d.titre, auteurs: d.auteurs || [],
        editeur: (d.editeur || '').replace(/\s*\([^)]*\)/, ''), date: d.date, description: d.description, erreurs };
    }
    erreurs.push('BnF : ' + ((d && d.erreur) || (d && d.trouve === false ? 'inconnu' : 'HTTP ' + r.status)));
  } catch (e) {
    erreurs.push('BnF : ' + messageErreur(e));
  }

  const cle = localStorage.getItem('google_books_api_key');
  if (!cle) { erreurs.push('Google Books : pas de clé configurée'); return { trouve: false, erreurs }; }
  try {
    const r = await fetchAvecTimeout('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&key=' + encodeURIComponent(cle), {}, 10000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.totalItems && d.items) {
      const vi = d.items[0].volumeInfo || {};
      const img = vi.imageLinks && (vi.imageLinks.thumbnail || vi.imageLinks.smallThumbnail);
      return { trouve: true, source: 'Google Books', titre: vi.title, sousTitre: vi.subtitle, auteurs: vi.authors || [],
        editeur: vi.publisher, date: vi.publishedDate, description: vi.pageCount ? vi.pageCount + ' pages' : null,
        numero: vi.seriesInfo && Number(vi.seriesInfo.bookDisplayNumber),
        couverture: img ? img.replace(/^http:/, 'https:') : null, erreurs };
    }
    const msg = (d && d.error && d.error.message) || (r.ok ? 'inconnu' : 'HTTP ' + r.status);
    erreurs.push('Google Books : ' + msg + (/referer/i.test(msg) ? " (ajoute https://biloubils-lab.github.io/* aux sites autorisés de ta clé)" : ''));
  } catch (e) {
    erreurs.push('Google Books : ' + messageErreur(e));
  }
  return { trouve: false, erreurs };
}

// sIndex : série à vérifier (inventaire), sinon recherche normale
async function rechercherIsbn(sIndex) {
  const saisie = await demanderTexte("ISBN (les 13 chiffres sous le code-barres) :", '');
  if (saisie === null) return;
  const isbn = nettoyerIsbn(saisie);
  if (!isbnValide(isbn)) {
    alert("Cet ISBN n'est pas valide (" + (isbn.length || 0) + " caractères). Vérifie les chiffres : il en faut 13 (ou 10 pour un livre ancien).");
    return;
  }
  fermerParametres();
  if (sIndex != null) await verifierTomeScanne(isbn, sIndex);
  else await afficherLivreIsbn(isbn);
}

// Cherche le livre puis affiche sa fiche ; propose le scan de jaquette s'il est introuvable
async function afficherLivreIsbn(isbn) {
  const loader = document.getElementById('loader-ia');
  document.getElementById('loader-status').textContent = 'Recherche du livre…';
  loader.style.display = 'flex';
  const livre = await chercherLivreParIsbn(isbn);
  loader.style.display = 'none';
  if (!livre.trouve) {
    if (await confirmerAction("Livre introuvable pour l'ISBN " + isbn + '.\n\n' + livre.erreurs.join('\n') + "\n\nScanner plutôt la jaquette avec l'IA ?")) {
      declencherScanIA();
    }
    return;
  }
  const analyse = analyserTitreLivre(livre.titre, livre.sousTitre);
  if (!analyse.tome && livre.numero) analyse.tome = livre.numero;
  const couvertureHttps = livre.couverture;
  const vi = { publisher: livre.editeur };

  const zone = document.getElementById('isbn-resultat');
  zone.innerHTML = '';
  if (couvertureHttps) {
    const img = document.createElement('img');
    img.src = couvertureHttps;
    img.alt = 'Couverture';
    img.style.cssText = 'width: 90px; border-radius: 6px; float: right; margin: 0 0 8px 10px;';
    zone.appendChild(img);
  }
  ligneInfo(zone, 'Source', livre.source);
  ligneInfo(zone, 'Titre', livre.titre);
  ligneInfo(zone, 'Sous-titre', livre.sousTitre);
  ligneInfo(zone, 'Auteur(s)', livre.auteurs.join(', '));
  ligneInfo(zone, 'Éditeur', livre.editeur);
  ligneInfo(zone, 'Parution', livre.date);
  ligneInfo(zone, 'Description', livre.description);
  ligneInfo(zone, 'ISBN', isbn);
  const detecte = document.createElement('div');
  detecte.style.cssText = 'clear: both; font-size: 13px; margin-top: 10px; padding: 8px; border-radius: 8px; background: #2a2a30;';
  detecte.textContent = `Détecté → série : ${analyse.serie} · tome : ${analyse.tome || '?'} · édition : ${analyse.edition || 'standard'}`;
  zone.appendChild(detecte);

  const modal = document.getElementById('isbn-modal');
  modal.classList.add('active');
  document.getElementById('isbn-fermer').onclick = () => modal.classList.remove('active');
  document.getElementById('isbn-ajouter').onclick = async () => {
    modal.classList.remove('active');
    let titrePropose = titreAvecEdition(analyse);
    // La même série existe dans une autre édition : corriger la série, ou en créer une à part ?
    const exacte = bibliotheque.some(s => normaliserTitre(s.titre) === normaliserTitre(titrePropose));
    const autreIndex = exacte ? -1 : bibliotheque.findIndex(s => titreSansEdition(s.titre) === normaliserRecherche(analyse.serie) && editionDuTitre(s.titre) !== analyse.edition);
    if (autreIndex !== -1) {
      const autre = bibliotheque[autreIndex];
      const action = await choisirAction(`Ta collection contient « ${autre.titre} » (édition ${editionDuTitre(autre.titre) || 'standard'}), mais ce livre est l'édition ${analyse.edition || 'standard'}.\n\n✏️ Corriger : toute la série devient « ${titrePropose} », tes tomes et tes lectures sont gardés.`, [
        { libelle: `✏️ Corriger la série en « ${titrePropose} »`, valeur: 'corriger', principal: true },
        { libelle: `➕ Créer la série « ${titrePropose} » à part`, valeur: 'creer' },
        { libelle: `Ajouter quand même à « ${autre.titre} »`, valeur: 'ici' }
      ]);
      if (!action) return;
      if (action === 'corriger') changerTitreSerie(autreIndex, titrePropose);
      if (action === 'ici') titrePropose = autre.titre;
    }
    const choix = await demanderSerieEtTome(titrePropose, analyse.tome || 1, 'Ajouter ce tome');
    if (!choix) return;
    await enregistrerSerie(choix.titre, choix.tome);
    const serie = bibliotheque.find(m => normaliserTitre(m.titre) === normaliserTitre(choix.titre));
    if (!serie) return;
    const tome = serie.tomes.find(t => t.numero === choix.tome);
    if (tome) tome.isbn = isbn;
    if (!serie.editeur) serie.editeur = editeurFrancais(vi.publisher) || vi.publisher || '';
    if (!serie.couverture && couvertureHttps) serie.couverture = couvertureHttps;
    sauvegarder();
  };
}

// --- Scan du code-barres (bibliothèque ZXing, chargée seulement à la première utilisation) ---
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.23.0/umd/index.min.js';
let zxingPromesse = null;
let lecteurCodeBarres = null;
let scanTermine = false;

function chargerZxing() {
  if (!zxingPromesse) {
    zxingPromesse = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ZXING_URL;
      script.onload = () => resolve(window.ZXing);
      script.onerror = () => { zxingPromesse = null; reject(new Error('bibliothèque de scan injoignable')); };
      document.head.appendChild(script);
    });
  }
  return zxingPromesse;
}

function creerLecteur(ZXing) {
  const indices = new Map();
  // Les livres utilisent des codes EAN-13 (ISBN 978/979…)
  indices.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]);
  indices.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return new ZXing.BrowserMultiFormatReader(indices);
}

function statutScanner(texte) {
  document.getElementById('scanner-statut').textContent = texte;
}

async function ouvrirScanner() {
  scanTermine = false;
  document.getElementById('scanner-modal').classList.add('active');
  statutScanner('Ouverture de la caméra…');
  try {
    const ZXing = await chargerZxing();
    if (scanTermine) return;
    lecteurCodeBarres = creerLecteur(ZXing);
    await lecteurCodeBarres.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      document.getElementById('scanner-video'),
      (resultat) => { if (resultat) codeBarresLu(resultat.getText()); }
    );
    if (!scanTermine) statutScanner('Vise le code-barres au dos du livre');
  } catch (e) {
    const refus = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    statutScanner(refus
      ? "Accès à la caméra refusé : autorise-le dans les réglages de l'iPhone, ou prends une photo du code-barres."
      : 'Caméra indisponible (' + messageErreur(e) + ') : prends une photo du code-barres.');
  }
}

function arreterCamera() {
  if (lecteurCodeBarres) { lecteurCodeBarres.reset(); lecteurCodeBarres = null; }
}

function fermerScanner() {
  scanTermine = true;
  serieAVerifier = null;
  arreterCamera();
  document.getElementById('scanner-modal').classList.remove('active');
}

async function codeBarresLu(texte) {
  if (scanTermine) return;
  const isbn = nettoyerIsbn(texte);
  // Un EAN-13 qui n'est pas un ISBN (ex. code-barres de prix) est ignoré : on continue de viser
  if (!/^97[89]/.test(isbn) || !isbnValide(isbn)) {
    statutScanner('Code ' + texte + " lu, mais ce n'est pas un ISBN : vise le code-barres du livre.");
    return;
  }
  if (navigator.vibrate) navigator.vibrate(80);
  const sIndex = serieAVerifier;
  fermerScanner();
  if (sIndex !== null) await verifierTomeScanne(isbn, sIndex);
  else await afficherLivreIsbn(isbn);
}

function scannerDepuisPhoto() {
  document.getElementById('scanner-photo-input').click();
}

async function decoderPhotoCodeBarres(event) {
  const fichier = event.target.files[0];
  event.target.value = '';
  if (!fichier) return;
  statutScanner('Lecture de la photo…');
  const url = URL.createObjectURL(fichier);
  try {
    const ZXing = await chargerZxing();
    arreterCamera();
    const resultat = await creerLecteur(ZXing).decodeFromImageUrl(url);
    scanTermine = false;
    await codeBarresLu(resultat.getText());
  } catch (e) {
    statutScanner("Aucun code-barres lisible sur la photo : rapproche-toi, évite les reflets, ou saisis l'ISBN.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scannerSaisieManuelle() {
  const sIndex = serieAVerifier;
  fermerScanner();
  rechercherIsbn(sIndex);
}

function scannerJaquetteIA() {
  fermerScanner();
  declencherScanIA();
}
