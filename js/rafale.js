// Scan en rafale : après un achat, scanner plusieurs tomes à la suite sans fermer la caméra,
// puis valider d'un coup les tomes reconnus (avec « Annuler » au cas où).
// Les cas délicats (autre édition, livre introuvable) sont signalés : on les ajoute un par un avec le scan normal.

let modeRafale = false;
let rafale = []; // un élément par livre scanné : { isbn, etat, titre, tome, message, coche… }

function passerEnModeRafale() {
  modeRafale = true;
  rafale = [];
  afficherModeRafale();
  statutScanner(texteRafale());
}

// Quitte aussi la vérification en magasin (magasin.js) : l'écran de scan revient à la normale
function quitterModeRafale() {
  modeRafale = false;
  modeVerification = false;
  rafale = [];
  afficherModeRafale();
}

function afficherModeRafale() {
  const special = modeRafale || modeVerification;
  document.getElementById('scanner-boutons').style.display = special ? 'none' : 'flex';
  document.getElementById('rafale-boutons').style.display = modeRafale ? 'flex' : 'none';
  document.getElementById('magasin-boutons').style.display = modeVerification ? 'flex' : 'none';
  // Pendant l'inventaire, le scan sert à vérifier une série : pas de rafale ni de magasin
  for (const id of ['scanner-rafale', 'scanner-magasin']) document.getElementById(id).style.display = serieAVerifier === null ? '' : 'none';
  document.getElementById('scanner-titre').textContent = modeRafale ? '📚 Scan en rafale' : modeVerification ? '🏪 Vérifier en magasin' : '📷 Scanner le code-barres';
  if (!modeVerification) document.getElementById('verdict-magasin').innerHTML = '';
  afficherListeRafale();
}

function texteRafale() {
  const n = rafale.length;
  return n ? `${n} livre${n > 1 ? 's' : ''} scanné${n > 1 ? 's' : ''} · vise le suivant` : 'Vise le code-barres du premier livre';
}

function libelleRafale(e) {
  if (e.etat === 'recherche') return ['⏳', `ISBN ${e.isbn} : recherche…`];
  if (e.etat === 'ajout') return ['✅', `${e.titre} · tome ${e.tome}`];
  if (e.etat === 'deja') return ['☑️', `${e.titre} · tome ${e.tome} · déjà dans ta collection`];
  if (e.etat === 'nouvelle') return ['🆕', `${e.titre} · tome ${e.tome} · nouvelle série`];
  return ['⚠️', `${e.titre || 'ISBN ' + e.isbn} : ${e.message}`];
}

// Liste sous la caméra : le dernier livre scanné en haut
function afficherListeRafale() {
  const liste = document.getElementById('rafale-liste');
  liste.innerHTML = '';
  for (const e of [...rafale].reverse()) {
    const ligne = document.createElement('div');
    ligne.className = 'rafale-ligne';
    const [icone, texte] = libelleRafale(e);
    ligne.textContent = icone + ' ' + texte;
    liste.appendChild(ligne);
  }
  const n = rafale.filter(e => e.etat === 'ajout' || e.etat === 'nouvelle').length;
  document.getElementById('rafale-terminer').textContent = n ? `✓ Terminer (${n} à ajouter)` : '✓ Terminer';
}

function ajouterALaRafale(isbn) {
  if (rafale.some(e => e.isbn === isbn)) {
    statutScanner('Déjà scanné : vise le livre suivant');
    return;
  }
  if (navigator.vibrate) navigator.vibrate(80);
  const element = { isbn, etat: 'recherche' };
  rafale.push(element);
  statutScanner(texteRafale());
  element.promesse = identifierPourRafale(isbn)
    .catch(e => ({ etat: 'inconnu', message: messageErreur(e) }))
    .then(resultat => {
      Object.assign(element, resultat, { coche: true });
      afficherListeRafale();
    });
  afficherListeRafale();
}

// Le livre et sa place dans la collection : tome à cocher, déjà là, nouvelle série, ou cas à traiter à part
async function identifierPourRafale(isbn) {
  for (const serie of bibliotheque) {
    const tome = serie.tomes.find(t => t.isbn === isbn);
    if (tome) return { etat: tome.possede ? 'deja' : 'ajout', titre: serie.titre, tome: tome.numero };
  }
  // Manga Insight connaît l'édition exacte de chaque ISBN ; sinon, on interroge la BnF
  const livreMI = livreMangaInsight(isbn);
  let analyse, livre = null;
  if (livreMI) {
    analyse = { serie: livreMI.serie, edition: livreMI.edition, tome: livreMI.tome };
  } else {
    livre = await chercherLivreParIsbn(isbn);
    if (!livre.trouve) return { etat: 'inconnu', message: 'livre introuvable (trop récent ?), ajoute-le seul avec 📷 Scanner : l’app te demandera sa série' };
    analyse = analyserTitreLivre(livre.titre, livre.sousTitre);
    if (!analyse.tome && livre.numero) analyse.tome = livre.numero;
  }
  const titre = titreAvecEdition(analyse);
  if (!analyse.tome) return { etat: 'inconnu', titre, message: 'numéro du tome introuvable, ajoute-le seul avec 📷 Scanner' };

  // Tome d'une suite numérotée à la suite (Solo Leveling Ragnarok 20) : il appartient à la série principale
  let serie = livreMI && bibliotheque.find(s => s.miNom === livreMI.nom || (s.parution && s.parution.noms && s.parution.noms.includes(livreMI.nom)));
  if (!serie) serie = bibliotheque.find(s => normaliserTitre(s.titre) === normaliserTitre(titre));
  if (!serie) serie = bibliotheque.find(s => titreSansEdition(s.titre) === cleTitre(analyse.serie) && editionDuTitre(s.titre) === analyse.edition);
  if (serie) {
    const tome = serie.tomes.find(t => t.numero === analyse.tome);
    return { etat: tome && tome.possede ? 'deja' : 'ajout', titre: serie.titre, tome: analyse.tome };
  }
  // Nouvelle partie d'une saga (Sword Art Online - Alicization) : une nouvelle série, qui rejoindra la saga
  const saga = bibliotheque.find(s => s.saga && normaliserRecherche(s.saga) === normaliserRecherche(analyse.serie.split(' - ')[0]));
  // Même série dans une autre édition : il faut choisir (corriger la série ou en créer une à part)
  const autre = !saga && bibliotheque.find(s => titreSansEdition(s.titre) === cleTitre(analyse.serie));
  if (autre) {
    return { etat: 'inconnu', titre: `${titre} · tome ${analyse.tome}`, autreEdition: { livre: analyse.edition, serie: autre.titre },
      message: `édition ${analyse.edition || 'standard'}, ta série « ${autre.titre} » est en édition ${editionDuTitre(autre.titre) || 'standard'} : ajoute-le seul avec 📷 Scanner` };
  }
  return { etat: 'nouvelle', titre, tome: analyse.tome, livreMI, saga: saga ? saga.saga : null,
    editeur: livreMI ? livreMI.editeur : livre.editeur, couverture: livre && livre.couverture };
}

// Fin de la rafale : on attend les dernières recherches, puis on montre le résumé à valider
async function terminerRafale() {
  scanTermine = true;
  arreterCamera();
  document.getElementById('scanner-modal').classList.remove('active');
  if (!rafale.length) { quitterModeRafale(); return; }
  if (rafale.some(e => e.etat === 'recherche')) {
    const loader = document.getElementById('loader-ia');
    document.getElementById('loader-status').textContent = 'Recherche des derniers livres…';
    loader.style.display = 'flex';
    await Promise.all(rafale.map(e => e.promesse));
    loader.style.display = 'none';
  }
  ouvrirResumeRafale();
}

function annulerRafale() {
  quitterModeRafale();
  fermerScanner();
}

function ouvrirResumeRafale() {
  const contenu = document.getElementById('rafale-resume');
  contenu.innerHTML = '';
  for (const e of rafale) {
    const ligne = document.createElement('label');
    ligne.className = 'rafale-ligne';
    const [icone, texte] = libelleRafale(e);
    if (e.etat === 'ajout' || e.etat === 'nouvelle') {
      const case_ = document.createElement('input');
      case_.type = 'checkbox';
      case_.checked = e.coche;
      case_.onchange = () => { e.coche = case_.checked; majBoutonRafale(); };
      ligne.appendChild(case_);
      ligne.append(' ' + texte);
      if (e.etat === 'nouvelle' && e.tome > 1) {
        const note = document.createElement('div');
        note.className = 'rafale-note';
        note.textContent = 'Les tomes d’avant seront à cocher dans sa fiche.';
        ligne.appendChild(note);
      }
    } else {
      ligne.classList.add('rafale-info');
      ligne.textContent = icone + ' ' + texte;
    }
    contenu.appendChild(ligne);
  }
  majBoutonRafale();
  document.getElementById('rafale-modal').classList.add('active');
}

function aAjouterRafale() {
  return rafale.filter(e => e.coche && (e.etat === 'ajout' || e.etat === 'nouvelle'));
}

function majBoutonRafale() {
  const n = aAjouterRafale().length;
  const bouton = document.getElementById('rafale-valider');
  bouton.disabled = !n;
  bouton.textContent = n ? `📚 Ajouter ${n} tome${n > 1 ? 's' : ''}` : 'Rien à ajouter';
}

function fermerResumeRafale() {
  document.getElementById('rafale-modal').classList.remove('active');
  quitterModeRafale();
}

function validerRafale() {
  const choisis = aAjouterRafale();
  if (!choisis.length) return;
  const avant = JSON.stringify(bibliotheque);
  const nouvelles = [];
  for (const e of choisis) {
    let serie = bibliotheque.find(s => normaliserTitre(s.titre) === normaliserTitre(e.titre));
    if (!serie) {
      serie = { titre: e.titre, auteur: '', genre: '', editeur: editeurFrancais(e.editeur) || e.editeur || '',
        statut: 'En cours', couverture: e.couverture || '', tomes: [] };
      bibliotheque.push(serie);
      nouvelles.push([serie, e.livreMI]);
    }
    // Les numéros manquants avant ce tome sont créés « non possédés » (comme pour une saisie)
    for (let n = 1; n <= e.tome; n++) {
      if (!serie.tomes.some(t => t.numero === n)) serie.tomes.push({ numero: n, possede: false, lu: false });
    }
    Object.assign(serie.tomes.find(t => t.numero === e.tome), { possede: true, isbn: e.isbn, isbnAuto: false });
    serie.tomes.sort((a, b) => a.numero - b.numero);
  }
  for (const [serie, livreMI] of nouvelles) { rattacherSagaAuto(serie); epinglerEditionMI(serie, livreMI); }
  document.getElementById('rafale-modal').classList.remove('active');
  quitterModeRafale();
  sauvegarder();
  const n = choisis.length;
  afficherToast(`📚 ${n} tome${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} à ta collection`, () => {
    bibliotheque = JSON.parse(avant);
    sauvegarder();
  });
}
