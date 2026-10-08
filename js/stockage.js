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
  if (res.ok) return { statut: 'ok' };
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

async function restaurerDepuisCloud() {
  if (!codeCloud()) { alert("Configure d'abord le code de sauvegarde cloud."); return; }
  if (!(await confirmerAction("Récupérer la dernière sauvegarde en ligne et remplacer la bibliothèque actuelle sur cet appareil ?"))) return;
  try {
    const res = await fetch(BACKUP_URL, { headers: { 'X-Backup-Token': codeCloud() } });
    if (res.status === 401) { alert("Code de sauvegarde incorrect."); return; }
    const data = await res.json();
    if (bibliothequeValide(data)) {
      bibliotheque = data;
      sauvegarder();
      fermerParametres();
      alert("Bibliothèque restaurée depuis le cloud !");
    } else {
      alert("Aucune sauvegarde en ligne trouvée pour l'instant.");
    }
  } catch (e) {
    alert("Impossible de contacter la sauvegarde en ligne.");
  }
}

function ouvrirParametres() {
  document.getElementById('settings-modal').classList.add('active');
}

function fermerParametres() {
  document.getElementById('settings-modal').classList.remove('active');
}
