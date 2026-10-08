// Fiche d'une série : progression, tomes, menu ⋯, renommage, ajout de tomes

function ouvrirModalSerie(index) {
  serieIndexActive = index;
  remplirModalSerie(index);
  document.getElementById('detail-modal').classList.add('active');
}

// Chiffres d'une série, partagés par la fiche et la liste : jusqu'au dernier tome paru (BnF)
// ou, à défaut, jusqu'au dernier tome de la liste
function statsSerie(serie) {
  const dernierListe = serie.tomes.reduce((max, t) => Math.max(max, t.numero), 0);
  const total = Math.max(serie.tomesParus || 0, dernierListe);
  const parNumero = new Map(serie.tomes.map((t, i) => [t.numero, i]));
  const manquants = [];
  for (let n = 1; n <= total; n++) {
    const tome = parNumero.has(n) ? serie.tomes[parNumero.get(n)] : null;
    if (!tome || !tome.possede) manquants.push(n);
  }
  return {
    total,
    parNumero,
    possedes: serie.tomes.filter(t => t.possede).length,
    lus: serie.tomes.filter(t => t.lu).length,
    manquants
  };
}

const CLASSES_STATUT = { 'En cours': 'en-cours', 'Terminée': 'terminee', 'En pause': 'en-pause', 'Abandonnée': 'abandonnee' };

function creerPastille(texte, classe) {
  const el = document.createElement('span');
  el.className = 'pastille' + (classe ? ' ' + classe : '');
  el.textContent = texte;
  return el;
}

function remplirModalSerie(index) {
  const serie = bibliotheque[index];
  document.getElementById('modal-title').innerText = serie.titre;
  document.getElementById('modal-author').innerText = [serie.auteur || 'Auteur inconnu', serie.editeur].filter(Boolean).join(' · ');
  document.getElementById('modal-cover').src = serie.couverture || JAQUETTE_DEFAUT;

  // Pastilles : statut coloré puis genres
  const pastilles = document.getElementById('modal-pastilles');
  pastilles.innerHTML = '';
  const statut = serie.statut || 'En cours';
  pastilles.appendChild(creerPastille(statut, 'statut ' + (CLASSES_STATUT[statut] || '')));
  (serie.genre || '').split(/\s*,\s*/).filter(Boolean).slice(0, 3).forEach(g => pastilles.appendChild(creerPastille(g)));
  remplirBarreInventaire(serie);

  // Vérification discrète à la BnF si l'info manque ou date de plus d'une semaine
  if (serie.tomesParusSource !== 'Manga Insight' && serie.tomesParusSource !== 'manuel' && (!serie.tomesParusMaj || Date.now() - serie.tomesParusMaj > DELAI_MAJ_TOMES_PARUS)) {
    const avant = serie.tomesParus;
    majTomesParus(serie).then((correction) => {
      sauvegarderLocal();
      if ((correction || serie.tomesParus !== avant) && serieIndexActive === index && bibliotheque[index] === serie) remplirModalSerie(index);
    }).catch(e => console.error('Tomes parus indisponibles', e));
  }

  // Progression
  const { total, parNumero, possedes, lus, manquants } = statsSerie(serie);

  document.getElementById('fiche-compteur').innerHTML = serie.tomesParus
    ? `${possedes} / ${total} possédés <span>· ${lus} lu${lus > 1 ? 's' : ''}</span>`
    : `${possedes} possédé${possedes > 1 ? 's' : ''} <span>· ${lus} lu${lus > 1 ? 's' : ''}</span>`;

  const frise = document.getElementById('fiche-frise');
  frise.innerHTML = '';
  frise.classList.toggle('dense', total > 40);
  for (let n = 1; n <= total; n++) {
    const tome = parNumero.has(n) ? serie.tomes[parNumero.get(n)] : null;
    const seg = document.createElement('i');
    if (tome && tome.lu) seg.className = 'lu';
    else if (tome && tome.possede) seg.className = 'possede';
    frise.appendChild(seg);
  }

  const prochain = document.getElementById('fiche-prochain');
  if (serie.misDeCote) {
    prochain.textContent = '⏸ Série mise de côté : plus dans tes achats ni tes prochaines sorties';
  } else if (manquants.length) {
    prochain.innerHTML = `Prochain à acheter : <b>tome ${manquants[0]}</b>` +
      (manquants.length > 1 ? ` · ${manquants.length} manquants` : '');
  } else if (serie.tomesParus) {
    prochain.textContent = statut === 'Terminée' ? 'Série complète 🎉' : 'À jour : tu as tous les tomes parus ✓';
  } else {
    prochain.textContent = 'Nombre de tomes parus inconnu';
  }

  // Parution (Manga Insight) : prochaine sortie estimée, sinon dernière sortie connue
  const sortie = document.getElementById('fiche-sortie');
  const prochaine = prochaineSortie(serie);
  if (prochaine) {
    sortie.innerHTML = `📅 Tome ${prochaine.vol} ${prochaine.retard ? 'attendu prochainement' : 'attendu vers <b>' + moisTexte(prochaine.k) + '</b>'} <span>· environ tous les ${serie.parution.rythme > 1 ? serie.parution.rythme + ' mois' : 'mois'}</span>`;
  } else if (serie.parution) {
    sortie.textContent = `📅 Dernier tome paru : n° ${serie.parution.dernier.vol} en ${moisTexte(serie.parution.dernier.k)}`;
  } else {
    sortie.textContent = '';
  }

  // Grille : chaque tome jusqu'au dernier paru ; au-delà de 30 tomes, regroupée par tranches de 10
  const grid = document.getElementById('modal-volumes-grid');
  grid.innerHTML = '';
  const etatTome = (n) => parNumero.has(n) ? serie.tomes[parNumero.get(n)] : null;
  if (total <= SEUIL_TRANCHES) {
    grid.className = 'volumes-grid';
    for (let n = 1; n <= total; n++) grid.appendChild(creerCaseTome(index, n, parNumero));
    return;
  }

  grid.className = '';
  if (!tranchesOuvertes.has(serie)) {
    // Par défaut : la tranche du prochain tome à acheter (ou la dernière si tout est possédé)
    const cible = manquants.length ? manquants[0] : total;
    tranchesOuvertes.set(serie, new Set([Math.floor((cible - 1) / 10) * 10 + 1]));
  }
  const ouvertes = tranchesOuvertes.get(serie);
  for (let debut = 1; debut <= total; debut += 10) {
    const fin = Math.min(debut + 9, total);
    const tranche = document.createElement('div');
    tranche.className = 'tranche' + (ouvertes.has(debut) ? ' ouverte' : '');

    const entete = document.createElement('button');
    entete.className = 'tranche-entete';
    const barre = document.createElement('span');
    barre.className = 'tranche-barre';
    let possedesTranche = 0;
    for (let n = debut; n <= fin; n++) {
      const tome = etatTome(n);
      const seg = document.createElement('i');
      if (tome && tome.possede) { possedesTranche++; seg.className = tome.lu ? 'lu' : 'possede'; }
      barre.appendChild(seg);
    }
    const taille = fin - debut + 1;
    const complete = possedesTranche === taille;
    entete.innerHTML = `<span class="tranche-fleche">›</span><span class="tranche-nom">Tomes ${debut}–${fin}</span>`;
    entete.appendChild(barre);
    const compte = document.createElement('span');
    compte.className = 'tranche-compte' + (complete ? ' complete' : '');
    compte.textContent = `${possedesTranche}/${taille}${complete ? ' ✓' : ''}`;
    entete.appendChild(compte);
    entete.onclick = () => {
      if (ouvertes.has(debut)) ouvertes.delete(debut); else ouvertes.add(debut);
      tranche.classList.toggle('ouverte');
    };

    const cases = document.createElement('div');
    cases.className = 'volumes-grid';
    for (let n = debut; n <= fin; n++) cases.appendChild(creerCaseTome(index, n, parNumero));
    tranche.append(entete, cases);
    grid.appendChild(tranche);
  }
}

const SEUIL_TRANCHES = 30;
// Tranches dépliées par série, gardées tant que l'app est ouverte
const tranchesOuvertes = new WeakMap();

function creerCaseTome(index, n, parNumero) {
  const serie = bibliotheque[index];
  const tIndex = parNumero.has(n) ? parNumero.get(n) : -1;
  const tome = tIndex >= 0 ? serie.tomes[tIndex] : null;
  const box = document.createElement('div');
  box.className = 'tome-box' + (tome && tome.lu ? ' read' : tome && tome.possede ? ' owned' : '');
  box.innerText = n;

  if (!tome) {
    box.onclick = () => ajouterTomeNumero(index, n);
    return box;
  }

  let suppressionDeclenchee = false;
  box.onclick = () => {
    if (suppressionDeclenchee) {
      suppressionDeclenchee = false;
      return;
    }
    toggleTomeState(index, tIndex);
  };
  box.oncontextmenu = (e) => {
    e.preventDefault();
    supprimerTomeUnique(index, tIndex);
  };
  box.ontouchstart = () => {
    suppressionDeclenchee = false;
    longPressTimer = setTimeout(() => {
      suppressionDeclenchee = true;
      supprimerTomeUnique(index, tIndex);
    }, 600);
  };
  box.ontouchend = (e) => {
    clearTimeout(longPressTimer);
    if (suppressionDeclenchee) e.preventDefault();
  };
  box.ontouchmove = () => clearTimeout(longPressTimer);
  return box;
}

// Tome affiché comme manquant (pas encore dans la liste) : un appui l'ajoute comme possédé
function ajouterTomeNumero(sIndex, numero) {
  const serie = bibliotheque[sIndex];
  serie.tomes.push({ numero, possede: true, lu: false });
  serie.tomes.sort((a, b) => a.numero - b.numero);
  sauvegarder();
}

function ouvrirMenuSerie() {
  const serie = bibliotheque[serieIndexActive];
  document.getElementById('menu-mise-de-cote').textContent = serie && serie.misDeCote
    ? '▶ Reprendre la série' : '⏸ Mettre de côté (je ne la suis plus)';
  document.getElementById('menu-serie-modal').classList.add('active');
}

// Série mise de côté : plus dans les achats ni les estimations, mais gardée dans la collection
function basculerMiseDeCote() {
  const serie = bibliotheque[serieIndexActive];
  if (!serie) return;
  if (serie.misDeCote) delete serie.misDeCote; else serie.misDeCote = true;
  sauvegarder();
}

// Marque un tome comme possédé (l'ajoute à la liste s'il n'y est pas), avec possibilité d'annuler
function marquerPossede(sIndex, numero) {
  const serie = bibliotheque[sIndex];
  const existant = serie.tomes.find(t => t.numero === numero);
  const avant = existant ? { ...existant } : null;
  if (existant) existant.possede = true;
  else {
    serie.tomes.push({ numero, possede: true, lu: false });
    serie.tomes.sort((a, b) => a.numero - b.numero);
  }
  sauvegarder();
  afficherToast(`✓ ${serie.titre} — tome ${numero} ajouté`, () => {
    if (avant) Object.assign(serie.tomes.find(t => t.numero === numero), avant);
    else serie.tomes = serie.tomes.filter(t => t.numero !== numero);
    sauvegarder();
  });
}

let toastMinuteur = null;
function afficherToast(texte, annuler) {
  const toast = document.getElementById('toast');
  toast.querySelector('span').textContent = texte;
  const bouton = toast.querySelector('button');
  bouton.style.display = annuler ? '' : 'none';
  bouton.onclick = () => { toast.classList.remove('visible'); annuler(); };
  toast.classList.add('visible');
  clearTimeout(toastMinuteur);
  toastMinuteur = setTimeout(() => toast.classList.remove('visible'), 4000);
}

function fermerMenuSerie() {
  document.getElementById('menu-serie-modal').classList.remove('active');
}

function actionMenuSerie(action) {
  fermerMenuSerie();
  action();
}

function toggleTomeState(sIndex, tIndex) {
  const tome = bibliotheque[sIndex].tomes[tIndex];
  if (!tome.possede) {
    tome.possede = true;
    tome.lu = false;
  } else if (tome.possede && !tome.lu) {
    tome.lu = true;
    tome.luLe = Date.now();
  } else {
    tome.possede = false;
    tome.lu = false;
    delete tome.luLe;
  }
  sauvegarder();
}

async function supprimerTomeUnique(sIndex, tIndex) {
  const tome = bibliotheque[sIndex].tomes[tIndex];
  if (await confirmerAction(`Supprimer le tome ${tome.numero} de la liste ?`)) {
    bibliotheque[sIndex].tomes.splice(tIndex, 1);
    sauvegarder();
  }
}

function ajouterNouveauTomeModal() {
  if (serieIndexActive === null) return;
  const serie = bibliotheque[serieIndexActive];
  const maxNum = serie.tomes.length > 0 ? serie.tomes[serie.tomes.length - 1].numero : 0;
  serie.tomes.push({ numero: maxNum + 1, possede: true, lu: false });
  sauvegarder();
}

// Regroupe les tomes et les infos de `source` dans `cible` (sans rien perdre)
function fusionnerSeries(cible, source) {
  for (const tome of source.tomes) {
    const existant = cible.tomes.find(t => t.numero === tome.numero);
    if (existant) {
      existant.possede = existant.possede || tome.possede;
      existant.lu = existant.lu || tome.lu;
      if (!existant.isbn && tome.isbn) existant.isbn = tome.isbn;
    } else {
      cible.tomes.push({ ...tome });
    }
  }
  cible.tomes.sort((a, b) => a.numero - b.numero);
  for (const champ of ['auteur', 'genre', 'editeur', 'couverture', 'tomesTotal']) {
    if (!cible[champ] && source[champ]) cible[champ] = source[champ];
  }
  if ((!cible.statut || cible.statut === 'En cours') && source.statut) cible.statut = source.statut;
}

// Renomme la série d'index `index` (fusion avec une série déjà nommée ainsi). Si l'édition change,
// les infos de parution (propres à une édition) sont effacées : elles seront retrouvées à la
// prochaine mise à jour. Renvoie l'index de la série obtenue.
function changerTitreSerie(index, nouveau) {
  const serie = bibliotheque[index];
  const ancienneEdition = editionDuTitre(serie.titre);
  let cible = serie;
  const autreIndex = bibliotheque.findIndex((m, i) => i !== index && normaliserTitre(m.titre) === normaliserTitre(nouveau));
  if (autreIndex !== -1) {
    cible = bibliotheque[autreIndex];
    fusionnerSeries(cible, serie);
    bibliotheque.splice(index, 1);
  }
  cible.titre = nouveau;
  // Édition spéciale : le nombre de tomes trouvé automatiquement est celui de l'édition standard
  if (titreRecherche(nouveau) !== nouveau) delete cible.tomesTotal;
  if (editionDuTitre(nouveau) !== ancienneEdition) {
    for (const champ of ['tomesTotal', 'tomesParus', 'tomesParusSource', 'tomesParusMaj', 'tomesParusDiagnostic', 'parution', 'miNom', 'miEditeur']) delete cible[champ];
  }
  return bibliotheque.indexOf(cible);
}

// Marque un tome scanné comme possédé avec son ISBN ; renvoie true s'il était déjà possédé
function ajouterTomeScanne(serie, numero, isbn) {
  const existant = serie.tomes.find(t => t.numero === numero);
  const etaitPossede = !!(existant && existant.possede);
  if (existant) existant.possede = true;
  else {
    serie.tomes.push({ numero, possede: true, lu: false });
    serie.tomes.sort((a, b) => a.numero - b.numero);
  }
  serie.tomes.find(t => t.numero === numero).isbn = isbn;
  return etaitPossede;
}

async function renommerSerieActuelle() {
  if (serieIndexActive === null) return;
  const serie = bibliotheque[serieIndexActive];
  const saisie = await demanderTexte("Nom de la série — précise une édition spéciale entre parenthèses, ex. « Berserk (Prestige) » :", serie.titre);
  const nouveau = (saisie || '').trim();
  if (!nouveau || nouveau === serie.titre) return;

  const autre = bibliotheque.find((m, i) => i !== serieIndexActive && normaliserTitre(m.titre) === normaliserTitre(nouveau));
  if (autre && !(await confirmerAction(`La série « ${autre.titre} » existe déjà.\n\nFusionner les deux ? Tous les tomes seront regroupés dans une seule série.`))) return;
  serieIndexActive = changerTitreSerie(serieIndexActive, nouveau);
  sauvegarder();
  remplirModalSerie(serieIndexActive);
}

async function supprimerSerieActuelle() {
  if (serieIndexActive === null) return;
  if (await confirmerAction(`Supprimer complètement "${bibliotheque[serieIndexActive].titre}" de ta collection ?`)) {
    bibliotheque.splice(serieIndexActive, 1);
    fermerModal();
    sauvegarder();
  }
}

function fermerModal() {
  document.getElementById('detail-modal').classList.remove('active');
  serieIndexActive = null;
}

async function enregistrerSerie(titre, tomeNum) {
  let mangaIndex = bibliotheque.findIndex(m => normaliserTitre(m.titre) === normaliserTitre(titre));
  let inclurePrecedents = false;

  if (tomeNum > 1) {
    inclurePrecedents = await confirmerAction(`Tu ajoutes le tome ${tomeNum} de "${titre}".\n\nPossèdes-tu aussi tous les tomes de 1 à ${tomeNum - 1} ?`);
  }

  if (mangaIndex !== -1) {
    let manga = bibliotheque[mangaIndex];
    for (let i = 1; i <= tomeNum; i++) {
      if ((i === tomeNum) || inclurePrecedents) {
        let tomeExist = manga.tomes.find(t => t.numero === i);
        if (tomeExist) {
          tomeExist.possede = true;
        } else {
          manga.tomes.push({ numero: i, possede: true, lu: false });
        }
      }
    }
    manga.tomes.sort((a, b) => a.numero - b.numero);
  } else {
    let initialTomes = [];
    for (let i = 1; i <= tomeNum; i++) {
      const estPossede = (i === tomeNum) || inclurePrecedents;
      initialTomes.push({ numero: i, possede: estPossede, lu: false });
    }
    bibliotheque.push({
      titre: titre,
      auteur: '',
      genre: '',
      editeur: '',
      statut: 'En cours',
      couverture: '',
      tomes: initialTomes
    });
  }

  sauvegarder();
}

async function ajouterManuel() {
  const saisie = await demanderSerieEtTome('', 1, 'Ajouter une série');
  if (!saisie) return;
  await enregistrerSerie(saisie.titre, saisie.tome);
}
