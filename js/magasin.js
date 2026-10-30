// Vérification en magasin : on scanne un livre et l'app dit tout de suite si on l'a déjà,
// s'il manque, ou si c'est une autre édition que celle de la série. Rien n'est modifié dans la collection.
// La reconnaissance du livre est celle du scan en rafale (identifierPourRafale, dans rafale.js).

let modeVerification = false;
let dernierIsbnVerifie = null;
let numeroVerification = 0;

function passerEnModeMagasin() {
  modeVerification = true;
  dernierIsbnVerifie = null;
  afficherModeRafale();
  statutScanner('Vise le code-barres du livre à vérifier');
}

async function verifierEnMagasin(isbn) {
  // La caméra relit le même code plusieurs fois par seconde : un seul verdict par livre
  if (isbn === dernierIsbnVerifie) return;
  dernierIsbnVerifie = isbn;
  if (navigator.vibrate) navigator.vibrate(80);
  const numero = ++numeroVerification;
  afficherVerdict({ icone: '⏳', titre: 'Recherche…', detail: 'ISBN ' + isbn });
  let resultat;
  try {
    resultat = await identifierPourRafale(isbn);
  } catch (e) {
    resultat = { etat: 'inconnu', message: messageErreur(e) };
  }
  // Un autre livre a été scanné entre-temps, ou l'écran a été fermé
  if (numero !== numeroVerification || !modeVerification) return;
  afficherVerdict(verdictMagasin(resultat, isbn));
  statutScanner('Vise un autre livre pour le vérifier');
}

// Tomes d'avant celui-ci qui manquent aussi (5 au plus), pour ne pas en oublier en caisse
function autresManquants(serie, tome) {
  const manquants = [];
  for (let n = 1; n < tome && manquants.length < 6; n++) {
    if (!serie.tomes.some(t => t.numero === n && t.possede)) manquants.push(n);
  }
  if (!manquants.length) return '';
  return ` Il te manque aussi le${manquants.length > 1 ? 's tomes' : ' tome'} ${manquants.slice(0, 5).join(', ')}${manquants.length > 5 ? '…' : ''}.`;
}

function verdictMagasin(r, isbn) {
  const livre = r.titre && r.tome ? `${r.titre} · tome ${r.tome}` : r.titre;
  const serie = r.titre && bibliotheque.find(s => normaliserTitre(s.titre) === normaliserTitre(r.titre));
  if (r.etat === 'deja') {
    return { icone: '✅', titre: 'Tu l’as déjà', detail: livre, classe: 'ok' };
  }
  if (r.etat === 'ajout') {
    return { icone: '🛒', titre: 'Il te manque', detail: livre + '.' + (serie ? autresManquants(serie, r.tome) : ''), classe: 'manque' };
  }
  if (r.etat === 'nouvelle') {
    return { icone: '🆕', titre: 'Pas dans ta collection', classe: 'manque',
      detail: livre + (r.saga ? ` : une nouvelle partie de ta saga « ${r.saga} ».` : ' : une série que tu n’as pas encore.') };
  }
  if (r.autreEdition) {
    return { icone: '⚠️', titre: 'Autre édition !', classe: 'alerte',
      detail: `${r.titre} : édition ${r.autreEdition.livre || 'standard'}. Ta série « ${r.autreEdition.serie} » est en édition ${editionDuTitre(r.autreEdition.serie) || 'standard'}.` };
  }
  return { icone: '❓', titre: 'Livre non reconnu', classe: 'alerte',
    detail: r.titre ? `${r.titre} : numéro du tome introuvable.` : `ISBN ${isbn} : introuvable dans les catalogues (tome tout juste paru ?). Vérifie à l’œil.` };
}

function afficherVerdict({ icone, titre, detail, classe }) {
  const zone = document.getElementById('verdict-magasin');
  zone.className = 'verdict' + (classe ? ' ' + classe : '');
  zone.innerHTML = '<div class="verdict-icone"></div><div><div class="verdict-titre"></div><div class="verdict-detail"></div></div>';
  zone.querySelector('.verdict-icone').textContent = icone;
  zone.querySelector('.verdict-titre').textContent = titre;
  zone.querySelector('.verdict-detail').textContent = detail;
}
