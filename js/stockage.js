// Stockage sur l'appareil (IndexedDB), sauvegarde cloud, Paramètres

function ouvrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('MangaTrackerDB', 1);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('kv')) {
        database.createObjectStore('kv');
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbGet(cle) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(cle);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbSet(cle, valeur) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').put(valeur, cle);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function initialiserBibliotheque() {
  try {
    db = await ouvrirDB();
    let data = await dbGet('bibliotheque');
    if (!data) {
      const ancien = localStorage.getItem('mangas_db');
      if (ancien) {
        try {
          data = JSON.parse(ancien);
          await dbSet('bibliotheque', data);
          localStorage.removeItem('mangas_db');
        } catch (e) {
          console.error('Migration depuis localStorage impossible', e);
        }
      }
    }
    bibliotheque = data || [];
  } catch (e) {
    console.error('IndexedDB indisponible, dernier recours localStorage', e);
    bibliotheque = JSON.parse(localStorage.getItem('mangas_db')) || [];
  }
  rendreVues();
  majMangaInsightAuDemarrage();
}

const BACKUP_URL = 'https://manga-gemini-proxy.nabil-chilla.workers.dev/backup';
let cloudBackupTimer = null;
let alerteCloudAffichee = false;

function codeCloud() {
  return localStorage.getItem('cloud_backup_token') || '';
}

function genererCodeCloud() {
  const octets = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(octets, o => o.toString(16).padStart(2, '0')).join('');
}

async function configurerCodeCloud() {
  const code = await demanderTexte("Code de sauvegarde cloud (le même que BACKUP_TOKEN sur le Worker, et sur tous tes appareils) :", codeCloud() || genererCodeCloud());
  if (code !== null) {
    if (code) {
      localStorage.setItem('cloud_backup_token', code);
    } else {
      localStorage.removeItem('cloud_backup_token');
    }
  }
}

function signalerProblemeCloud(message) {
  // Une seule alerte par session, pour ne pas harceler à chaque modification
  if (alerteCloudAffichee) return;
  alerteCloudAffichee = true;
  alert(message);
}

async function envoyerVersCloud(forcer) {
  const code = codeCloud();
  if (!code) return { statut: 'sans-code' };
  const entetes = { 'Content-Type': 'application/json', 'X-Backup-Token': code };
  if (forcer) entetes['X-Backup-Force'] = '1';
  const res = await fetch(BACKUP_URL, { method: 'POST', headers: entetes, body: JSON.stringify(bibliotheque) });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    localStorage.setItem('cloud_dernier_envoi', new Date().toISOString());
    return { statut: 'ok' };
  }
  if (res.status === 401) return { statut: 'code-incorrect' };
  if (res.status === 409) return { statut: 'refuse', ancien: data.ancien, nouveau: data.nouveau };
  return { statut: 'erreur', message: data.error || ('HTTP ' + res.status) };
}

function sauvegarderLocal() {
  if (db) {
    dbSet('bibliotheque', bibliotheque).catch(e => console.error('Sauvegarde locale impossible', e));
  } else {
    localStorage.setItem('mangas_db', JSON.stringify(bibliotheque));
  }
  rendreVues();
}

function sauvegarder() {
  sauvegarderLocal();
  clearTimeout(cloudBackupTimer);
  cloudBackupTimer = setTimeout(async () => {
    try {
      const r = await envoyerVersCloud(false);
      if (r.statut === 'code-incorrect') {
        signalerProblemeCloud("Sauvegarde cloud impossible : le code de sauvegarde est incorrect (Paramètres → 🔑 Code de sauvegarde cloud).");
      } else if (r.statut === 'refuse') {
        signalerProblemeCloud(`Sauvegarde cloud bloquée : le cloud contient ${r.ancien} séries et cet appareil seulement ${r.nouveau}.\n\nSi c'est un nouvel appareil, utilise « Restaurer depuis le cloud ». Si tu as vraiment supprimé ces séries, utilise « Forcer l'envoi vers le cloud ».`);
      } else if (r.statut === 'erreur') {
        console.error('Sauvegarde cloud impossible', r.message);
      }
    } catch (e) {
      console.error('Sauvegarde cloud impossible', e);
    }
  }, 2000);
}

async function forcerEnvoiCloud() {
  if (!codeCloud()) { alert("Configure d'abord le code de sauvegarde cloud."); return; }
  if (!(await confirmerAction(`Remplacer la sauvegarde en ligne par la bibliothèque de cet appareil (${bibliotheque.length} séries) ?`))) return;
  try {
    const r = await envoyerVersCloud(true);
    if (r.statut === 'ok') alert("Sauvegarde en ligne remplacée.");
    else if (r.statut === 'code-incorrect') alert("Code de sauvegarde incorrect.");
    else alert("Échec de l'envoi : " + (r.message || r.statut));
  } catch (e) {
    alert("Impossible de contacter la sauvegarde en ligne.");
  }
}

// Nombre de séries et de tomes possédés (même calcul que le Worker)
function resumeBibliotheque(series) {
  return { series: series.length, tomes: series.reduce((n, s) => n + s.tomes.filter(t => t.possede !== false).length, 0) };
}

function texteResume(r) {
  return `${r.series} série${r.series > 1 ? 's' : ''}, ${r.tomes} tome${r.tomes > 1 ? 's' : ''}`;
}

// « aujourd'hui à 14:32 », « hier à 09:05 », « le 3 octobre à 18:40 »
function texteDate(iso) {
  if (!iso) return "avant la mise en place de l'historique";
  const d = new Date(iso);
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const jour = (x) => x.toDateString();
  const hier = new Date(); hier.setDate(hier.getDate() - 1);
  if (jour(d) === jour(new Date())) return "aujourd'hui à " + heure;
  if (jour(d) === jour(hier)) return 'hier à ' + heure;
  const options = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return 'le ' + d.toLocaleDateString('fr-FR', options) + ' à ' + heure;
}

async function lireVersionsCloud() {
  const res = await fetchAvecTimeout(BACKUP_URL + '/versions', { headers: { 'X-Backup-Token': codeCloud() } }, 10000);
  if (res.status === 401) return { statut: 'code-incorrect' };
  if (res.status === 404) return { statut: 'ancien-worker' };
  if (!res.ok) return { statut: 'erreur' };
  return { statut: 'ok', ...(await res.json()) };
}

// Encadré « Sauvegarde » des Paramètres
async function afficherEtatSauvegarde() {
  const zone = document.getElementById('etat-sauvegarde');
  const ici = resumeBibliotheque(bibliotheque);
  const afficher = (alerte, texte, detail) => {
    zone.className = 'etat-sauvegarde' + (alerte ? ' alerte' : '');
    zone.innerHTML = '';
    zone.append(texte);
    if (detail) { const s = document.createElement('small'); s.textContent = detail; zone.append(s); }
  };
  if (!codeCloud()) {
    afficher(true, "⚠️ Sauvegarde en ligne non configurée", "Ta collection n'existe que sur cet appareil. Ajoute un code de sauvegarde ci-dessous.");
    return;
  }
  afficher(false, '☁️ Vérification de la sauvegarde en ligne…');
  let r;
  try { r = await lireVersionsCloud(); } catch (e) { r = { statut: 'hors-ligne' }; }
  const dernierEnvoi = localStorage.getItem('cloud_dernier_envoi');
  if (r.statut === 'ok' && r.actuelle) {
    const identique = r.actuelle.series === ici.series && r.actuelle.tomes === ici.tomes;
    afficher(!identique, (identique ? '✅ Sauvegardée en ligne ' : '⚠️ Dernière sauvegarde en ligne ') + texteDate(r.actuelle.date),
      identique ? texteResume(ici) + (r.versions.length ? ` · ${r.versions.length} version${r.versions.length > 1 ? 's' : ''} précédente${r.versions.length > 1 ? 's' : ''}` : '')
        : `En ligne : ${texteResume(r.actuelle)} · sur cet appareil : ${texteResume(ici)}`);
  } else if (r.statut === 'ok') {
    afficher(true, '⚠️ Aucune sauvegarde en ligne pour l\u2019instant', 'Elle sera faite à la prochaine modification.');
  } else if (r.statut === 'code-incorrect') {
    afficher(true, '⚠️ Code de sauvegarde incorrect', 'Les sauvegardes en ligne ne passent pas. Vérifie le code ci-dessous.');
  } else if (r.statut === 'ancien-worker') {
    afficher(false, '☁️ Dernier envoi depuis cet appareil : ' + (dernierEnvoi ? texteDate(dernierEnvoi) : 'inconnu'), "Mets à jour le Worker pour voir l'état complet et l'historique.");
  } else {
    afficher(true, '⚠️ Sauvegarde en ligne injoignable', 'Dernier envoi réussi depuis cet appareil : ' + (dernierEnvoi ? texteDate(dernierEnvoi) : 'inconnu'));
  }
}

function boutonVersion(titre, detail, actuelle, onclick) {
  const b = document.createElement('button');
  b.className = 'version-item' + (actuelle ? ' actuelle' : '');
  b.textContent = titre;
  const s = document.createElement('small');
  s.textContent = detail;
  b.append(s);
  b.onclick = onclick;
  return b;
}

async function ouvrirVersions() {
  if (!codeCloud()) { alert("Configure d'abord le code de sauvegarde cloud."); return; }
  const liste = document.getElementById('versions-liste');
  liste.textContent = 'Chargement…';
  document.getElementById('versions-modal').classList.add('active');
  let r;
  try { r = await lireVersionsCloud(); } catch (e) { r = { statut: 'hors-ligne' }; }
  liste.textContent = '';
  if (r.statut === 'code-incorrect') { liste.textContent = 'Code de sauvegarde incorrect.'; return; }
  if (r.statut === 'ancien-worker') {
    liste.append(boutonVersion('Dernière sauvegarde', "Mets à jour le Worker pour voir l'historique.", true, () => restaurerVersion(null, 'la dernière sauvegarde en ligne')));
    return;
  }
  if (r.statut !== 'ok') { liste.textContent = 'Impossible de contacter la sauvegarde en ligne.'; return; }
  if (!r.actuelle) { liste.textContent = 'Aucune sauvegarde en ligne pour l\u2019instant.'; return; }
  const nom = (v) => 'la sauvegarde ' + (v.date ? 'du ' + texteDate(v.date).replace(/^le /, '') : texteDate(null));
  liste.append(boutonVersion('Dernière sauvegarde · ' + texteDate(r.actuelle.date), texteResume(r.actuelle), true,
    () => restaurerVersion(null, 'la dernière sauvegarde en ligne', r.actuelle)));
  for (const v of r.versions) {
    const titre = texteDate(v.date);
    liste.append(boutonVersion(titre.charAt(0).toUpperCase() + titre.slice(1), v.series != null ? texteResume(v) : '', false, () => restaurerVersion(v.id, nom(v), v)));
  }
}

function fermerVersions() {
  document.getElementById('versions-modal').classList.remove('active');
}

// id null = dernière sauvegarde ; sinon une version de l'historique
async function restaurerVersion(id, nom, resume) {
  const enLigne = resume && resume.series != null ? ` (${texteResume(resume)})` : '';
  const message = `Remplacer la bibliothèque de cet appareil (${texteResume(resumeBibliotheque(bibliotheque))}) par ${nom}${enLigne} ?`
    + (id ? "\n\nL'état actuel en ligne sera gardé dans l'historique." : '');
  if (!(await confirmerAction(message))) return;
  try {
    const res = await fetch(BACKUP_URL + (id ? '?version=' + encodeURIComponent(id) : ''), { headers: { 'X-Backup-Token': codeCloud() } });
    if (res.status === 401) { alert("Code de sauvegarde incorrect."); return; }
    const data = await res.json();
    if (!bibliothequeValide(data)) { alert("Cette sauvegarde est introuvable ou illisible."); return; }
    clearTimeout(cloudBackupTimer);
    bibliotheque = data;
    sauvegarderLocal();
    // Une ancienne version devient la sauvegarde en ligne (l'actuelle part dans l'historique)
    if (id) await envoyerVersCloud(true);
    fermerVersions();
    fermerParametres();
    afficherToast('✅ Bibliothèque restaurée');
  } catch (e) {
    alert("Impossible de contacter la sauvegarde en ligne.");
  }
}

function ouvrirParametres() {
  document.getElementById('settings-modal').classList.add('active');
  afficherEtatSauvegarde();
}

function fermerParametres() {
  document.getElementById('settings-modal').classList.remove('active');
}
