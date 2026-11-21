// Démarrage : chargé en dernier, une fois toutes les fonctions définies

// Toucher le fond sombre autour d'une fenêtre la ferme, comme sa croix ou son bouton « Annuler »
const FERMETURE_PAR_FOND = {
  'detail-modal': () => fermerModal(),
  'nouveautes-modal': () => fermerNouveautes(),
  'settings-modal': () => fermerParametres(),
  'inventaire-modal': () => fermerInventaire(),
  'menu-serie-modal': () => fermerMenuSerie(),
  'versions-modal': () => fermerVersions(),
  'scanner-modal': () => fermerScanner(),
  'rafale-modal': '#rafale-annuler',
  'isbn-modal': '#isbn-fermer',
  'jaquettes-modal': '#jaquettes-garder',
  'cover-choice-modal': '#cover-choice-cancel',
  'confirm-modal': '#confirm-cancel',
  'form-text-modal': '#form-text-cancel',
  'form-serie-modal': '#form-serie-cancel',
  'form-infos-modal': '#infos-cancel',
  'choix-modal': '#choix-boutons button:last-child',
  // Bilan d'une mise à jour : seulement une fois terminée (pas pendant le traitement)
  'completion-modal': () => { const b = document.getElementById('completion-bouton'); if (b.textContent === 'Fermer') b.click(); }
};
for (const [id, fermer] of Object.entries(FERMETURE_PAR_FOND)) {
  const fond = document.getElementById(id);
  let appuiSurFond = false;
  // L'appui doit commencer ET finir sur le fond : glisser depuis la fenêtre ne la ferme pas
  fond.addEventListener('pointerdown', (e) => { appuiSurFond = e.target === fond; });
  fond.addEventListener('click', (e) => {
    if (e.target !== fond || !appuiSurFond) return;
    if (typeof fermer === 'function') fermer();
    else document.querySelector('#' + id + ' ' + fermer).click();
  });
}

// Mode hors-ligne : le service worker garde une copie de l'app (uniquement sur un vrai site, pas en file://)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.error('Mode hors-ligne indisponible', e));
  // Notification touchée alors que l'app était déjà ouverte : le service worker dit quoi afficher
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.ouvrir) ouvrirDepuisNotification(e.data.ouvrir); });

  // Nouvelle version de l'app : le service worker l'installe en arrière-plan et prend la main ;
  // un bouton « Mettre à jour » recharge alors l'app (plus besoin de la fermer et de la rouvrir).
  // La toute première installation, elle, ne compte pas.
  let dejaControlee = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (dejaControlee) proposerMiseAJour();
    dejaControlee = true;
  });
  // Sur iPhone, l'app installée reste ouverte en arrière-plan : on cherche une nouvelle version à chaque retour
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') chercherMiseAJour(); });
}

const ECART_VERIFICATIONS_MAJ = 60 * 1000; // une vérification par minute au plus
let derniereVerificationMaj = 0;
function chercherMiseAJour() {
  if (Date.now() - derniereVerificationMaj < ECART_VERIFICATIONS_MAJ) return;
  derniereVerificationMaj = Date.now();
  navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => { /* hors ligne : on réessaiera */ });
}

function proposerMiseAJour() {
  document.getElementById('bouton-maj').hidden = false;
}

// Badge « hors ligne » et envoi de la sauvegarde en attente quand le réseau revient
function majEtatReseau() {
  document.getElementById('badge-hors-ligne').hidden = navigator.onLine;
  if (navigator.onLine) envoyerSauvegardeEnAttente();
}

// La bibliothèque est lue avant tout envoi en attente (sinon on enverrait une liste vide)
initialiserBibliotheque().then(() => {
  window.addEventListener('online', majEtatReseau);
  window.addEventListener('offline', majEtatReseau);
  majEtatReseau();
});
