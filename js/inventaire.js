// Inventaire : vérifier série par série que les tomes enregistrés correspondent à l'étagère

// Début de l'inventaire en cours (ms), ou null. Une série est vérifiée si serie.verifieLe >= ce début.
function debutInventaire() {
  const v = Number(localStorage.getItem('inventaire_debut'));
  return v > 0 ? v : null;
}

function serieVerifiee(serie) {
  const debut = debutInventaire();
  return !!(debut && serie.verifieLe && serie.verifieLe >= debut);
}

// Tomes possédés en plages : [1,2,3,5,7,8] → « 1–3, 5, 7–8 »
function plagesTomes(serie) {
  const nums = serie.tomes.filter(t => t.possede).map(t => t.numero).sort((a, b) => a - b);
  const plages = [];
  for (const n of nums) {
    const derniere = plages[plages.length - 1];
    if (derniere && n === derniere[1] + 1) derniere[1] = n;
    else plages.push([n, n]);
  }
  return plages.map(([a, b]) => a === b ? String(a) : `${a}–${b}`).join(', ');
}

function resumeTomesPossedes(serie) {
  const n = serie.tomes.filter(t => t.possede).length;
  if (!n) return 'aucun tome possédé';
  return `${n} tome${n > 1 ? 's' : ''} : ${plagesTomes(serie)}`;
}

function avancementInventaire() {
  const faites = bibliotheque.filter(serieVerifiee).length;
  return { faites, total: bibliotheque.length };
}

async function ouvrirInventaire() {
  if (!bibliotheque.length) { alert("Ta collection est vide : rien à vérifier pour l'instant."); return; }
  if (!debutInventaire()) {
    if (!(await confirmerAction("Commencer l'inventaire ?\n\nPour chaque série, compare les tomes de l'app avec ton étagère, corrige si besoin, puis valide. Tu peux t'arrêter et reprendre quand tu veux."))) return;
    localStorage.setItem('inventaire_debut', String(Date.now()));
  }
  fermerParametres();
  document.getElementById('inventaire-modal').classList.add('active');
  rendreInventaire();
}

function fermerInventaire() {
  document.getElementById('inventaire-modal').classList.remove('active');
  rendreVues();
}

async function terminerInventaire() {
  const { faites, total } = avancementInventaire();
  if (faites < total && !(await confirmerAction(`Terminer l'inventaire ? ${total - faites} série${total - faites > 1 ? 's' : ''} n'${total - faites > 1 ? 'ont' : 'a'} pas été vérifiée${total - faites > 1 ? 's' : ''}.`))) return;
  localStorage.removeItem('inventaire_debut');
  fermerInventaire();
  afficherToast(faites === total ? '🎉 Inventaire terminé : toute ta collection est vérifiée !' : `Inventaire terminé (${faites} / ${total} séries vérifiées)`);
}

function ligneInventaire(serie, index) {
  const ligne = document.createElement('button');
  ligne.className = 'inventaire-ligne' + (serieVerifiee(serie) ? ' verifiee' : '');
  const img = document.createElement('img');
  img.src = serie.couverture || JAQUETTE_DEFAUT;
  img.alt = '';
  img.onerror = () => { img.onerror = null; img.src = JAQUETTE_DEFAUT; };
  const texte = document.createElement('div');
  const titre = document.createElement('div');
  titre.className = 'inventaire-titre';
  titre.textContent = serie.titre;
  const detail = document.createElement('div');
  detail.className = 'inventaire-detail';
  detail.textContent = resumeTomesPossedes(serie);
  texte.append(titre, detail);
  const marque = document.createElement('span');
  marque.className = 'inventaire-marque';
  marque.textContent = serieVerifiee(serie) ? '✓' : '›';
  ligne.append(img, texte, marque);
  ligne.onclick = () => ouvrirModalSerie(index);
  return ligne;
}

// Liste de l'inventaire (si ouverte) et bandeau « Inventaire en cours » de la collection
function rendreInventaire() {
  const debut = debutInventaire();
  const { faites, total } = avancementInventaire();

  const vueCollection = document.getElementById('view-collection');
  if (debut && vueCollection && bibliotheque.length) {
    const bandeau = document.createElement('button');
    bandeau.className = 'bandeau-inventaire';
    bandeau.innerHTML = `<span>📋 Inventaire en cours · <b>${faites} / ${total}</b></span><span>Continuer ›</span>`;
    bandeau.onclick = ouvrirInventaire;
    vueCollection.prepend(bandeau);
  }

  if (!document.getElementById('inventaire-modal').classList.contains('active')) return;
  document.getElementById('inventaire-compteur').textContent = `${faites} / ${total} série${total > 1 ? 's' : ''} vérifiée${total > 1 ? 's' : ''}`;
  document.getElementById('inventaire-barre').style.width = (total ? Math.round(faites / total * 100) : 0) + '%';

  const liste = document.getElementById('inventaire-liste');
  liste.innerHTML = '';
  const tri = (a, b) => a.serie.titre.localeCompare(b.serie.titre, 'fr', { sensitivity: 'base' });
  const items = bibliotheque.map((serie, index) => ({ serie, index }));
  const aVerifier = items.filter(x => !serieVerifiee(x.serie)).sort(tri);
  const verifiees = items.filter(x => serieVerifiee(x.serie)).sort(tri);
  const section = (texte) => {
    const s = document.createElement('div');
    s.className = 'pal-section';
    s.textContent = texte;
    liste.appendChild(s);
  };
  if (aVerifier.length) {
    section(`À vérifier (${aVerifier.length})`);
    aVerifier.forEach(x => liste.appendChild(ligneInventaire(x.serie, x.index)));
  } else {
    const bravo = document.createElement('div');
    bravo.className = 'inventaire-bravo';
    bravo.textContent = '🎉 Toutes tes séries sont vérifiées ! Touche « Terminer l’inventaire ».';
    liste.appendChild(bravo);
  }
  if (verifiees.length) {
    section(`Vérifiées (${verifiees.length})`);
    verifiees.forEach(x => liste.appendChild(ligneInventaire(x.serie, x.index)));
  }
}

// Barre d'inventaire en bas de la fiche (seulement pendant un inventaire)
function remplirBarreInventaire(serie) {
  const barre = document.getElementById('fiche-inventaire');
  barre.style.display = debutInventaire() ? '' : 'none';
  if (!debutInventaire()) return;
  document.getElementById('fiche-inventaire-tomes').textContent = 'Dans l’app : ' + resumeTomesPossedes(serie);
  document.getElementById('fiche-inventaire-valider').textContent = serieVerifiee(serie) ? '✓ Vérifiée — revérifier plus tard' : '✅ C’est bon, série vérifiée';
}

function validerSerieInventaire() {
  const serie = bibliotheque[serieIndexActive];
  if (!serie) return;
  if (serieVerifiee(serie)) delete serie.verifieLe;
  else serie.verifieLe = Date.now();
  const verifiee = serieVerifiee(serie);
  fermerModal();
  sauvegarder();
  const { faites, total } = avancementInventaire();
  if (verifiee) afficherToast(`✓ ${serie.titre} vérifiée · ${faites} / ${total}`);
}

// --- Vérification d'un tome par son code-barres ---

// Série à vérifier pendant le scan (index dans la bibliothèque), ou null pour un scan normal
let serieAVerifier = null;

function verifierTomeParScan() {
  if (serieIndexActive === null) return;
  serieAVerifier = serieIndexActive;
  ouvrirScanner();
}

// Compare le livre scanné à la série : même série ? même édition ? quel tome ?
async function verifierTomeScanne(isbn, sIndex) {
  const serie = bibliotheque[sIndex];
  if (!serie) return;
  const connu = serie.tomes.find(t => t.isbn === isbn);
  if (connu) {
    if (!connu.possede) { connu.possede = true; sauvegarder(); }
    afficherToast(`✅ Tome ${connu.numero} : c'est bien celui de cette série`);
    return;
  }
  const ailleurs = bibliotheque.find((s, i) => i !== sIndex && s.tomes.some(t => t.isbn === isbn));
  if (ailleurs) {
    const t = ailleurs.tomes.find(x => x.isbn === isbn);
    alert(`⚠️ Ce livre est enregistré dans « ${ailleurs.titre} » (tome ${t.numero}), pas dans « ${serie.titre} ».`);
    return;
  }

  const loader = document.getElementById('loader-ia');
  document.getElementById('loader-status').textContent = 'Vérification du tome…';
  loader.style.display = 'flex';
  const livre = await chercherLivreParIsbn(isbn);
  loader.style.display = 'none';
  if (!livre.trouve) {
    alert(`Livre introuvable pour l'ISBN ${isbn} : vérifie ce tome à l'œil.`);
    return;
  }
  const analyse = analyserTitreLivre(livre.titre, livre.sousTitre);
  if (!analyse.tome && livre.numero) analyse.tome = livre.numero;
  const nomLivre = livre.titre + (analyse.edition ? '' : ' (édition standard)');

  const attendue = editionDuTitre(serie.titre);
  const memeSerie = (() => {
    const a = titreSansEdition(serie.titre), b = cleTitre(analyse.serie);
    return !!a && !!b && (a.includes(b) || b.includes(a));
  })();
  const problemes = [];
  if (!memeSerie) problemes.push(`le titre ne correspond pas à « ${serie.titre} »`);
  if (analyse.edition !== attendue) {
    problemes.push(`c'est l'édition ${analyse.edition || 'standard'}, la série est en édition ${attendue || 'standard'}`);
  }

  // Livre différent de la série : la corriger, ranger le livre ailleurs, ou l'ajouter quand même
  let action = 'ici';
  const titreLivre = titreAvecEdition(analyse);
  const autre = bibliotheque.find((s, i) => i !== sIndex && normaliserTitre(s.titre) === normaliserTitre(titreLivre));
  if (problemes.length) {
    const choix = [];
    // Même série dans une autre édition : on propose d'abord de la corriger.
    // Titre différent : on peut aussi la renommer, si c'est le nom de la série qui était mal saisi.
    choix.push({ libelle: (memeSerie ? '✏️ Corriger la série en « ' : '✏️ Renommer la série en « ') + titreLivre + ' »' + (autre ? ' (fusion)' : ''), valeur: 'corriger', principal: memeSerie });
    choix.push({ libelle: autre ? `➕ Ranger ce tome dans « ${autre.titre} »` : `➕ Créer la série « ${titreLivre} » à part`, valeur: 'autre' });
    choix.push({ libelle: `Ajouter quand même à « ${serie.titre} »`, valeur: 'ici' });
    const explication = `\n\n✏️ ${memeSerie ? 'Corriger' : 'Renommer'} : toute la série devient « ${titreLivre} », tes tomes et tes lectures sont gardés.\n➕ À part : la série actuelle ne change pas (tu pourras la supprimer avec ⋯).`;
    action = await choisirAction(`⚠️ Livre scanné : ${nomLivre}\n\nAttention : ${problemes.join(' ; ')}.${explication}`, choix);
    if (!action) return;
  }

  let numero = analyse.tome;
  if (!numero) {
    const saisie = await demanderTexte(`Livre scanné : ${livre.titre}\n\nNuméro du tome ?`, '');
    numero = Number(saisie);
    if (!numero) return;
  }

  if (action === 'corriger') {
    const index = changerTitreSerie(sIndex, titreLivre);
    if (serieIndexActive !== null) serieIndexActive = index;
    ajouterTomeScanne(bibliotheque[index], numero, isbn);
    sauvegarder();
    afficherToast(`✏️ Série corrigée : « ${titreLivre} » · tome ${numero} enregistré`);
    return;
  }
  if (action === 'autre') {
    let cible = autre;
    if (!cible) {
      cible = { titre: titreLivre, auteur: serie.auteur || '', genre: serie.genre || '', editeur: serie.editeur || '', statut: 'En cours', couverture: '', tomes: [] };
      bibliotheque.push(cible);
    }
    ajouterTomeScanne(cible, numero, isbn);
    sauvegarder();
    afficherToast(`➕ Tome ${numero} rangé dans « ${cible.titre} »`);
    return;
  }

  const etaitPossede = ajouterTomeScanne(serie, numero, isbn);
  sauvegarder();
  if (!problemes.length) {
    afficherToast(`✅ Tome ${numero}${attendue ? ' · édition ' + attendue : ''} : c'est le bon` + (etaitPossede ? '' : ' (ajouté)'));
  } else {
    afficherToast(`Tome ${numero} enregistré dans ${serie.titre}`);
  }
}
