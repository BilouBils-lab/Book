// Ajouter une série : pendant la saisie du titre, propose les éditions françaises connues (Manga Insight)
// avec l'éditeur, le nombre de tomes et la jaquette. Un appui remplit tout : titre, édition, tomes parus, jaquette.

const MAX_SUGGESTIONS = 8;

// Éditions dont le titre contient le texte saisi ; d'abord les titres qui commencent par lui, puis les plus longues séries
function rechercherEditions(texte) {
  const q = normaliserRecherche(texte);
  if (!indexMI || q.length < 2) return [];
  const resultats = [];
  for (const [cle, entrees] of indexMI) {
    const rang = cle.startsWith(q) ? 0 : (' ' + cle).includes(' ' + q) ? 1 : cle.includes(q) ? 2 : -1;
    if (rang === -1) continue;
    const base = entrees[0].base;
    for (const e of editionsMangaInsight({ titre: base })) resultats.push({ ...e, base, rang });
  }
  return resultats.sort((a, b) => a.rang - b.rang || b.tomes - a.tomes).slice(0, MAX_SUGGESTIONS);
}

// « Slam Dunk (Star) », ou « Slam Dunk » pour l'édition standard
function titreDeEdition(e) {
  return e.edition ? `${e.base} (${e.edition})` : e.base;
}

// Vignette de la jaquette du tome 1 : Open Library, sinon Amazon, sinon l'image par défaut.
// L'adresse qui marche est retenue dans e.couverture, pour devenir la jaquette de la série.
function vignetteEdition(e) {
  const img = document.createElement('img');
  img.className = 'suggestion-jaquette';
  img.alt = '';
  const isbn = e.isbn1 || [...e.isbns][0];
  const isbn10 = isbn && isbn13Vers10(isbn);
  const liens = isbn ? [`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`] : [];
  if (isbn10) liens.push(`https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01.MZZZZZZZ.jpg`);
  const suivant = () => {
    const lien = liens.shift();
    if (lien) img.src = lien;
    else { img.onerror = null; img.onload = null; img.src = JAQUETTE_DEFAUT; delete e.couverture; }
  };
  img.onerror = suivant;
  // Amazon répond par une image de 1 pixel quand il n'a pas la jaquette
  img.onload = () => { if (img.naturalWidth < 10) suivant(); else if (img.src !== JAQUETTE_DEFAUT) e.couverture = img.src; };
  suivant();
  return img;
}

function ligneSuggestion(e, choisir) {
  const ligne = document.createElement('button');
  ligne.type = 'button';
  ligne.className = 'suggestion';
  ligne.appendChild(vignetteEdition(e));
  const infos = document.createElement('div');
  infos.className = 'suggestion-infos';
  const titre = document.createElement('div');
  titre.className = 'suggestion-titre';
  titre.textContent = titreDeEdition(e);
  const detail = document.createElement('div');
  detail.className = 'suggestion-detail';
  const deja = bibliotheque.some(s => normaliserTitre(s.titre) === normaliserTitre(titreDeEdition(e)));
  detail.textContent = texteEdition(e) + (deja ? ' · déjà dans ta collection' : '');
  infos.append(titre, detail);
  ligne.appendChild(infos);
  ligne.onclick = () => choisir(e);
  return ligne;
}

// Branche les suggestions sur le champ titre ; choisir(e) est appelé quand on touche une édition
function brancherSuggestions(champTitre, choisir) {
  const zone = document.getElementById('form-serie-suggestions');
  let minuteur = null;
  // Données pas encore chargées (premier lancement) : on les charge sans bloquer la saisie
  if (!indexMI) chargerMangaInsight(false).then(() => { if (champTitre.value) champTitre.oninput(); });
  champTitre.oninput = () => {
    choisir(null);
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      zone.innerHTML = '';
      for (const e of rechercherEditions(champTitre.value)) zone.appendChild(ligneSuggestion(e, choisir));
    }, 150);
  };
}

function afficherEditionChoisie(e) {
  const zone = document.getElementById('form-serie-edition');
  zone.textContent = e ? '✓ ' + texteEdition(e) : '';
}

// Après l'ajout : la série suit l'édition choisie (tomes parus, sorties), avec son éditeur et sa jaquette
function appliquerEditionChoisie(titre, e) {
  const serie = bibliotheque.find(s => normaliserTitre(s.titre) === normaliserTitre(titre));
  if (!serie || serie.miNom) return;
  serie.miNom = e.nom;
  serie.miEditeur = e.editeur;
  if (!serie.editeur && e.editeur) serie.editeur = editeurFrancais(e.editeur) || e.editeur;
  if (!serie.couverture && e.couverture) serie.couverture = e.couverture;
  appliquerMangaInsight(serie);
  sauvegarder();
  afficherToast(`✓ ${serie.titre} ajoutée · ${texteEdition(e)}`);
}
