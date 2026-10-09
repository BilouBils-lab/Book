// Démarrage : chargé en dernier, une fois toutes les fonctions définies

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
