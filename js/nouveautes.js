// Nouveautés : tomes sortis depuis la dernière visite (Manga Insight) et sorties attendues ce mois-ci.
// La page s'ouvre au lancement seulement s'il y a du nouveau, et chaque nouveauté n'est annoncée qu'une fois.

const DUREE_NOUVEAUTE_MS = 30 * 24 * 3600 * 1000; // une sortie reste 30 jours dans « À venir »

function moisActuel() {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
}

// Appelée à chaque mise à jour Manga Insight d'une série, avec son état d'avant :
// si le dernier tome paru a augmenté (même édition), c'est une vraie sortie
function noterNouveaute(serie, avant, mi) {
  if (!avant || avant.nom !== mi.nom || !avant.tomesParus || mi.tomesParus <= avant.tomesParus || serie.misDeCote) return;
  const deja = serie.nouveaute && !serie.nouveaute.vu ? serie.nouveaute.debut : Infinity;
  serie.nouveaute = { debut: Math.min(deja, avant.tomesParus + 1), fin: mi.tomesParus, k: mi.dernier.k, depuis: Date.now(), vu: false };
}

function sortiesRecentes() {
  return bibliotheque.map((serie, sIndex) => ({ serie, sIndex }))
    .filter(({ serie }) => serie.nouveaute && (!serie.nouveaute.vu || Date.now() - serie.nouveaute.depuis < DUREE_NOUVEAUTE_MS))
    .sort((a, b) => b.serie.nouveaute.depuis - a.serie.nouveaute.depuis);
}

// Sorties estimées ce mois-ci, ou dont la date estimée est passée
function attendusCeMois() {
  return bibliotheque.map((serie, sIndex) => ({ serie, sIndex, prochaine: prochaineSortie(serie) }))
    .filter(({ prochaine }) => prochaine && (prochaine.retard || prochaine.k === moisActuel()))
    .sort((a, b) => a.serie.titre.localeCompare(b.serie.titre, 'fr', { sensitivity: 'base' }));
}

function texteSortie(n) {
  return n.debut === n.fin ? `Tome ${n.fin} sorti` : `Tomes ${n.debut} à ${n.fin} sortis`;
}

// Ligne cliquable : jaquette, titre, détail ; un appui ouvre la fiche de la série
function ligneNouveaute(serie, sIndex, [principal, secondaire], etat, avantOuverture) {
  const ligne = document.createElement('div');
  ligne.className = 'avenir-item';
  ligne.innerHTML = `
    <img class="avenir-jaquette" src="${serie.couverture || JAQUETTE_DEFAUT}" alt="" onerror="this.onerror=null; this.src=JAQUETTE_DEFAUT">
    <div class="avenir-infos">
      <div class="pal-title"></div>
      <div class="pal-tome"></div>
      ${etat ? '<div class="nouveaute-etat"></div>' : ''}
    </div>`;
  ligne.querySelector('.pal-title').textContent = serie.titre;
  const tome = ligne.querySelector('.pal-tome');
  tome.textContent = principal + ' ';
  const date = document.createElement('span');
  date.textContent = '· ' + secondaire;
  tome.appendChild(date);
  if (etat) {
    ligne.querySelector('.nouveaute-etat').textContent = etat.texte;
    ligne.querySelector('.nouveaute-etat').classList.add(etat.classe);
  }
  ligne.onclick = () => { if (avantOuverture) avantOuverture(); ouvrirModalSerie(sIndex); };
  return ligne;
}

function etatAchat(serie, n) {
  for (let v = n.debut; v <= n.fin; v++) {
    if (!serie.tomes.some(t => t.numero === v && t.possede)) return { texte: '🛒 à acheter', classe: 'a-acheter' };
  }
  return { texte: '✓ déjà dans ta collection', classe: 'complete' };
}

function ligneSortieRecente({ serie, sIndex }, avantOuverture) {
  const n = serie.nouveaute;
  return ligneNouveaute(serie, sIndex, [texteSortie(n), moisTexte(n.k)], etatAchat(serie, n), avantOuverture);
}

function ligneAttendu({ serie, sIndex, prochaine }, avantOuverture) {
  return ligneNouveaute(serie, sIndex, [`Tome ${prochaine.vol}`, prochaine.retard ? 'sortie imminente' : 'estimé ce mois-ci'], null, avantOuverture);
}

// Au lancement : on ouvre la page seulement s'il y a une sortie pas encore annoncée,
// ou des sorties attendues ce mois-ci qu'on n'a pas encore montrées ce mois-là
function verifierNouveautes() {
  let nettoye = false;
  for (const s of bibliotheque) {
    if (s.nouveaute && s.nouveaute.vu && Date.now() - s.nouveaute.depuis > DUREE_NOUVEAUTE_MS) { delete s.nouveaute; nettoye = true; }
  }
  if (nettoye) sauvegarderLocal();
  if (document.querySelector('.modal-overlay.active')) return; // ne pas interrompre une autre fenêtre
  const nouvelles = bibliotheque.some(s => s.nouveaute && !s.nouveaute.vu);
  const moisDejaMontre = Number(localStorage.getItem('nouveautes_mois_vu')) === moisActuel();
  if (nouvelles || (attendusCeMois().length && !moisDejaMontre)) ouvrirNouveautes();
}

function ouvrirNouveautes() {
  const contenu = document.getElementById('nouveautes-contenu');
  contenu.innerHTML = '';
  const section = (titre) => {
    const s = document.createElement('div');
    s.className = 'pal-section';
    s.innerHTML = titre;
    contenu.appendChild(s);
  };
  const nouvelles = sortiesRecentes().filter(({ serie }) => !serie.nouveaute.vu);
  if (nouvelles.length) {
    section('🆕 Depuis ta dernière visite');
    for (const item of nouvelles) contenu.appendChild(ligneSortieRecente(item, fermerNouveautes));
  }
  const attendus = attendusCeMois();
  if (attendus.length) {
    section('📅 Attendus ce mois-ci');
    for (const item of attendus) contenu.appendChild(ligneAttendu(item, fermerNouveautes));
  }
  document.getElementById('nouveautes-modal').classList.add('active');
}

// Fermer = tout est vu : rien ne sera réannoncé (les sorties restent 30 jours dans « À venir »)
function fermerNouveautes() {
  document.getElementById('nouveautes-modal').classList.remove('active');
  let modifie = false;
  for (const s of bibliotheque) if (s.nouveaute && !s.nouveaute.vu) { s.nouveaute.vu = true; modifie = true; }
  localStorage.setItem('nouveautes_mois_vu', String(moisActuel()));
  if (modifie) sauvegarder();
}

function voirAVenir() {
  fermerNouveautes();
  vueAVenir = 'sorties';
  changerOnglet('avenir');
}
