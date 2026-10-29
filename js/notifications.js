// Notifications des sorties : abonne cet appareil auprès du Worker (Web Push).
// Les notifications sont calculées et envoyées chaque jour par GitHub Actions (dépôt privé mangatheque-sauvegarde).
// Sur iPhone : iOS 16.4 ou plus, et seulement dans l'app installée sur l'écran d'accueil.

function notificationsPossibles() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function appInstallee() {
  return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function notificationsActives() {
  return localStorage.getItem('notifications') === '1' && notificationsPossibles() && Notification.permission === 'granted';
}

function majBoutonNotifications() {
  const bouton = document.getElementById('bouton-notifications');
  bouton.innerHTML = notificationsActives()
    ? '<span>🔕</span>Désactiver les notifications<i>›</i>'
    : '<span>🔔</span>Activer les notifications des sorties<i>›</i>';
}

function basculerNotifications() {
  if (notificationsActives()) desactiverNotifications();
  else activerNotifications();
}

function octetsDepuisBase64url(texte) {
  const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - texte.length % 4) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function memesOctets(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function appelPush(chemin, options = {}) {
  const r = await fetchAvecTimeout(WORKER_URL + chemin, { ...options, headers: { 'X-Backup-Token': codeCloud(), 'Content-Type': 'application/json' } }, 15000);
  const d = await r.json().catch(() => null);
  if (r.status === 401) throw new Error('code de sauvegarde incorrect');
  if (!r.ok || !d) throw new Error((d && d.error) || 'HTTP ' + r.status);
  return d;
}

async function activerNotifications() {
  if (!notificationsPossibles()) {
    alert(appInstallee()
      ? "Cette installation de l'app ne permet pas les notifications.\n\nIl faut iOS 16.4 ou plus récent, et réinstaller l'app : supprime l'icône de l'écran d'accueil, puis dans Safari : Partager → Sur l'écran d'accueil. (Ta collection se récupère ensuite avec ton code de sauvegarde.)"
      : "Les notifications ne marchent que dans l'app installée sur l'écran d'accueil : dans Safari, Partager → Sur l'écran d'accueil, puis ouvre l'app depuis son icône.");
    return;
  }
  if (!codeCloud()) {
    alert("Configure d'abord ton code de sauvegarde (Réglages avancés → 🔑) : il protège aussi les notifications.");
    return;
  }
  // La demande d'autorisation doit partir directement de l'appui sur le bouton (exigence de l'iPhone)
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert("Notifications refusées.\n\nPour changer d'avis : Réglages de l'iPhone → Notifications → MangaThèque.");
    return;
  }
  const loader = document.getElementById('loader-ia');
  document.getElementById('loader-status').textContent = 'Activation des notifications…';
  loader.style.display = 'flex';
  try {
    const { publique } = await appelPush('/push/cle');
    const cle = octetsDepuisBase64url(publique);
    const enregistrement = await navigator.serviceWorker.ready;
    let abonnement = await enregistrement.pushManager.getSubscription();
    // Abonnement fait avec une autre clé : on le refait
    if (abonnement && !(abonnement.options.applicationServerKey && memesOctets(abonnement.options.applicationServerKey, cle))) {
      await abonnement.unsubscribe();
      abonnement = null;
    }
    if (!abonnement) abonnement = await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
    await appelPush('/push/abonnement', { method: 'POST', body: JSON.stringify(abonnement.toJSON()) });
    localStorage.setItem('notifications', '1');
    await enregistrement.showNotification('🔔 Notifications activées', {
      body: 'Tu seras prévenu quand un tome de tes séries est annoncé ou sort.', icon: 'icones/icone-192.png'
    });
    afficherToast('🔔 Notifications activées');
  } catch (e) {
    alert('Activation impossible : ' + messageErreur(e));
  } finally {
    loader.style.display = 'none';
    majBoutonNotifications();
  }
}

async function desactiverNotifications() {
  try {
    const enregistrement = await navigator.serviceWorker.ready;
    const abonnement = await enregistrement.pushManager.getSubscription();
    if (abonnement) {
      await appelPush('/push/desabonnement', { method: 'POST', body: JSON.stringify({ endpoint: abonnement.endpoint }) }).catch(() => {});
      await abonnement.unsubscribe();
    }
  } catch (e) {
    console.error('Désabonnement incomplet', e);
  }
  localStorage.removeItem('notifications');
  majBoutonNotifications();
  afficherToast('🔕 Notifications désactivées');
}

// --- Toucher une notification : ouvrir l'endroit qu'elle concerne ---
// La notification porte { onglet, vue, serie } : l'onglet À venir (vue « achats » ou « sorties »),
// et la fiche de la série quand il n'y en a qu'une.

function ouvrirDepuisNotification(cible) {
  if (!cible) return;
  if (document.getElementById('scanner-modal').classList.contains('active')) fermerScanner(); // coupe aussi la caméra
  for (const fenetre of document.querySelectorAll('.modal-overlay.active')) fenetre.classList.remove('active');
  if (cible.vue) vueAVenir = cible.vue;
  changerOnglet(cible.onglet || 'avenir');
  const index = cible.serie ? bibliotheque.findIndex(s => s.titre === cible.serie) : -1;
  if (index !== -1) ouvrirModalSerie(index);
}

// App lancée par une notification : l'endroit à ouvrir est dans l'adresse (?onglet=…&vue=…&serie=…)
function cibleDeLancement() {
  const p = new URLSearchParams(location.search);
  if (!p.has('onglet')) return null;
  history.replaceState(null, '', location.pathname); // un rechargement ne la rouvrira pas
  return { onglet: p.get('onglet'), vue: p.get('vue'), serie: p.get('serie') };
}
