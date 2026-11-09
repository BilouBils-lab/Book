// Découverte par éditeur : depuis « Infos de la série », toutes les séries françaises d'un éditeur (Manga Insight),
// ses prochaines sorties, et celles qu'on a déjà. Un « ＋ » ouvre l'ajout de la série, éditions proposées.

const MAX_SORTIES_EDITEUR = 15;
const PAGE_SERIES_EDITEUR = 30;
const RECHERCHE_EDITEUR_DES = 12; // champ de recherche à partir de ce nombre de séries
const ACTIVE_DEPUIS_MOIS = 12; // « en cours » : un tome paru dans l'année ou annoncé

// Une partie du nom Manga Insight qui désigne une édition (« Collector », « Edition spéciale »…), pas la série
const PARTIE_EDITION = /[ée]dition|collector|coffret|deluxe|prestige|perfect|ultimate|int[ée]grale|kanzenban|\bstar\b|\bsmash\b|\bdouble\b|full ?colou?r|wide/i;

let editeurAffiche = null; // { nom, series, filtre, recherche, limite }

// « Ao Ashi - Playmaker - Collector » → « Ao Ashi - Playmaker » (la série, sans l'édition)
function serieSansEdition(nom) {
  const parties = nom.split(' - ');
  while (parties.length > 1 && PARTIE_EDITION.test(parties[parties.length - 1])) parties.pop();
  return parties.join(' - ');
}

function memeEditeur(a, b) {
  const x = normaliserRecherche(a), y = normaliserRecherche(b);
  return !!x && !!y && (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' '));
}

// Les séries de cet éditeur, regroupées (éditions spéciales sous la série), les plus actives d'abord
function seriesEditeur(editeur) {
  return groupesMangaInsight(s => memeEditeur(s.editeur, editeur));
}

// Séries françaises de Manga Insight (celles que `garder` retient), regroupées : éditions spéciales sous la série
function groupesMangaInsight(garder) {
  if (!indexMI) return [];
  const maintenant = moisActuel();
  const groupes = new Map();
  for (const entrees of indexMI.values()) {
    for (const s of entrees) {
      if (!garder(s) || HORS_SERIE_MI.test(s.nom)) continue;
      const titre = serieSansEdition(s.nom);
      const cle = normaliserRecherche(titre);
      if (!groupes.has(cle)) groupes.set(cle, { titre, base: s.base, entrees: [] });
      groupes.get(cle).entrees.push(s);
    }
  }
  return [...groupes.values()].map(({ titre, base, entrees }) => {
    // Tomes et sorties : ceux de l'édition principale (sans suffixe d'édition) quand elle existe
    const principale = entrees.filter(s => s.nom === titre);
    const retenues = principale.length ? principale : entrees;
    let dernier = 0, prochaine = null, editeur = retenues[0].editeur, kEditeur = -1;
    for (const s of retenues) {
      if (s.k > kEditeur) { kEditeur = s.k; editeur = s.editeur; } // éditeur de la sortie la plus récente
      if (s.k <= maintenant) dernier = Math.max(dernier, s.k);
      else if (!prochaine || s.k < prochaine.k || (s.k === prochaine.k && s.vol < prochaine.vol)) prochaine = { vol: s.vol, k: s.k };
    }
    return {
      titre, base, editeur, dernier, prochaine,
      tomes: Math.max(0, ...retenues.filter(s => s.k <= maintenant).map(s => s.vol)) || Math.max(...retenues.map(s => s.vol)),
      active: !!prochaine || maintenant - dernier <= ACTIVE_DEPUIS_MOIS,
      possedee: indexSeriePossedee(titre) !== -1
    };
  }).sort((a, b) => (b.prochaine ? 1 : 0) - (a.prochaine ? 1 : 0) || b.dernier - a.dernier || a.titre.localeCompare(b.titre));
}

// Index dans la collection de cette série d'éditeur (-1 si on ne l'a pas) : même série Manga Insight,
// ou même titre (sans édition entre parenthèses) quand l'édition n'a pas été choisie
function indexSeriePossedee(titre) {
  const cle = normaliserRecherche(titre);
  return bibliotheque.findIndex(s => s.miNom
    ? normaliserRecherche(serieSansEdition(s.miNom)) === cle
    : normaliserRecherche(decomposerTitreSerie(s.titre).base) === cle);
}

// L'édition principale de la série, pour sa jaquette (tome 1)
function editionPourJaquette(g) {
  const editions = editionsMangaInsight({ titre: g.base });
  return editions.find(e => e.nom === g.titre) || editions.find(e => serieSansEdition(e.nom) === g.titre) || editions[0] || null;
}

function jaquetteSerieEditeur(g, classe) {
  const e = editionPourJaquette(g);
  if (e) {
    const img = vignetteEdition(e);
    img.className = classe;
    img.loading = 'lazy';
    return img;
  }
  const img = document.createElement('img');
  img.className = classe;
  img.alt = '';
  img.src = JAQUETTE_DEFAUT;
  return img;
}

// La page de l'éditeur s'ouvre dans la fenêtre de la fiche, à la place de la page actuelle
async function ouvrirEditeur(nom) {
  document.getElementById('editeur-titre').textContent = nom;
  document.getElementById('editeur-resume').textContent = 'Chargement…';
  document.getElementById('editeur-sorties-titre').hidden = true;
  document.getElementById('editeur-sorties').innerHTML = '';
  document.getElementById('editeur-filtres').innerHTML = '';
  document.getElementById('editeur-recherche').hidden = true;
  document.getElementById('editeur-liste').innerHTML = '';
  document.getElementById('editeur-pour-toi').hidden = true;
  allerPage('editeur');
  if (!indexMI) await chargerMangaInsight(false);
  editeurAffiche = { nom, series: seriesEditeur(nom), filtre: 'toutes', recherche: '', limite: PAGE_SERIES_EDITEUR };
  rendreEditeur();
  afficherPourToi();
}

function rendreEditeur() {
  const { series } = editeurAffiche;
  const possedees = series.filter(g => g.possedee).length;
  document.getElementById('editeur-resume').textContent = series.length
    ? `Éditeur · ${series.length} série${series.length > 1 ? 's' : ''} en France · ${possedees} dans ta collection`
    : 'Aucune série de cet éditeur dans les sorties françaises connues (Manga Insight).';

  // Prochaines sorties : rangée de jaquettes, la plus proche d'abord
  const zoneSorties = document.getElementById('editeur-sorties');
  zoneSorties.innerHTML = '';
  const aVenir = series.filter(g => g.prochaine).sort((a, b) => a.prochaine.k - b.prochaine.k).slice(0, MAX_SORTIES_EDITEUR);
  document.getElementById('editeur-sorties-titre').hidden = !aVenir.length;
  for (const g of aVenir) {
    const carte = document.createElement('button');
    carte.className = 'editeur-sortie';
    carte.onclick = () => choisirSerieEditeur(g);
    const nomSerie = document.createElement('span');
    nomSerie.className = 'editeur-sortie-titre';
    nomSerie.textContent = g.titre;
    const detail = document.createElement('span');
    detail.className = 'editeur-sortie-detail';
    detail.textContent = `Tome ${g.prochaine.vol}`;
    const date = document.createElement('span');
    date.className = 'editeur-sortie-detail';
    date.textContent = moisTexte(g.prochaine.k, true);
    carte.append(jaquetteSerieEditeur(g, 'editeur-sortie-jaquette'), nomSerie, detail, date);
    zoneSorties.appendChild(carte);
  }

  // Filtres et recherche
  const actives = series.filter(g => g.active).length;
  const filtres = [['toutes', 'Toutes', series.length], ['actives', 'En cours', actives], ['anciennes', 'Plus de sortie', series.length - actives]];
  const zoneFiltres = document.getElementById('editeur-filtres');
  zoneFiltres.innerHTML = '';
  zoneFiltres.hidden = !series.length;
  for (const [cle, libelle, nombre] of filtres) {
    const bouton = document.createElement('button');
    bouton.className = editeurAffiche.filtre === cle ? 'active' : '';
    bouton.innerHTML = `${libelle} <span class="compteur">${nombre}</span>`;
    bouton.onclick = () => { editeurAffiche.filtre = cle; editeurAffiche.limite = PAGE_SERIES_EDITEUR; rendreEditeur(); };
    zoneFiltres.appendChild(bouton);
  }
  const champ = document.getElementById('editeur-recherche');
  champ.hidden = series.length < RECHERCHE_EDITEUR_DES;
  champ.value = editeurAffiche.recherche;
  rendreListeEditeur();
}

function rechercherDansEditeur(texte) {
  editeurAffiche.recherche = texte;
  editeurAffiche.limite = PAGE_SERIES_EDITEUR;
  rendreListeEditeur();
}

function rendreListeEditeur() {
  const { series, filtre, recherche, limite } = editeurAffiche;
  const q = normaliserRecherche(recherche);
  const visibles = series.filter(g => (filtre === 'toutes' || (filtre === 'actives') === g.active) && (!q || normaliserRecherche(g.titre).includes(q)));
  const liste = document.getElementById('editeur-liste');
  liste.innerHTML = '';
  for (const g of visibles.slice(0, limite)) liste.appendChild(ligneSerieEditeur(g));
  if (visibles.length > limite) {
    const plus = document.createElement('button');
    plus.className = 'btn btn-secondary editeur-plus';
    plus.textContent = `Voir plus (${visibles.length - limite})`;
    plus.onclick = () => { editeurAffiche.limite += PAGE_SERIES_EDITEUR; rendreListeEditeur(); };
    liste.appendChild(plus);
  }
  if (!visibles.length && series.length) {
    const vide = document.createElement('div');
    vide.className = 'editeur-vide';
    vide.textContent = 'Aucune série ne correspond.';
    liste.appendChild(vide);
  }
}

function ligneSerieEditeur(g) {
  const ligne = document.createElement('div');
  ligne.className = 'editeur-serie';
  const infos = document.createElement('div');
  infos.className = 'editeur-serie-infos';
  const titre = document.createElement('div');
  titre.className = 'editeur-serie-titre';
  titre.textContent = g.titre;
  const detail = document.createElement('div');
  detail.className = 'editeur-serie-detail';
  const etat = g.prochaine ? `tome ${g.prochaine.vol} en ${moisTexte(g.prochaine.k, true)}` : g.active ? 'en cours' : `dernier tome en ${Math.floor(g.dernier / 12)}`;
  detail.textContent = `${g.tomes} tome${g.tomes > 1 ? 's' : ''} · ${etat}`;
  infos.append(titre, detail);
  ligne.append(jaquetteSerieEditeur(g, 'editeur-serie-jaquette'), infos);
  if (g.possedee) {
    const deja = document.createElement('span');
    deja.className = 'editeur-deja';
    deja.textContent = '✓ Dans ta collection';
    ligne.appendChild(deja);
  } else {
    const ajouter = document.createElement('button');
    ajouter.className = 'editeur-ajouter';
    ajouter.setAttribute('aria-label', 'Ajouter ' + g.titre);
    ajouter.textContent = '＋';
    ajouter.onclick = () => choisirSerieEditeur(g);
    ligne.appendChild(ajouter);
  }
  return ligne;
}

// Une série touchée : déjà possédée → sa fiche ; sinon l'ajout, titre rempli et éditions proposées
function choisirSerieEditeur(g) {
  if (g.possedee) {
    const index = indexSeriePossedee(g.titre);
    if (index !== -1) ouvrirModalSerie(index);
    return;
  }
  fermerModal();
  ajouterManuel(g.base);
}
