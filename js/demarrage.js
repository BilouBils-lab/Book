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
