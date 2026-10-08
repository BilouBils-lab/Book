// État de l'app, fenêtres de dialogue (confirmation, saisie), appels réseau

let bibliotheque = [];
let ongletActif = 'collection';
let rechercheTexte = '';
let triActif = 'alpha';
let serieIndexActive = null;
let longPressTimer = null;
let db = null;

function confirmerAction(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-message').textContent = message;
    modal.classList.add('active');

    const btnOk = document.getElementById('confirm-ok');
    const btnCancel = document.getElementById('confirm-cancel');

    function nettoyer(resultat) {
      modal.classList.remove('active');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(resultat);
    }
    function onOk() { nettoyer(true); }
    function onCancel() { nettoyer(false); }

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

function demanderSerieEtTome(titreParDefaut, tomeParDefaut, entete) {
  return new Promise((resolve) => {
    const modal = document.getElementById('form-serie-modal');
    const champTitre = document.getElementById('form-serie-titre');
    const champTome = document.getElementById('form-serie-tome');
    document.getElementById('form-serie-heading').textContent = entete || 'Ajouter une série';
    champTitre.value = titreParDefaut || '';
    champTome.value = tomeParDefaut || 1;
    modal.classList.add('active');
    setTimeout(() => champTitre.focus(), 50);

    const btnOk = document.getElementById('form-serie-ok');
    const btnCancel = document.getElementById('form-serie-cancel');

    function nettoyer(resultat) {
      modal.classList.remove('active');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(resultat);
    }
    function onOk() {
      const titre = champTitre.value.trim();
      if (!titre) { champTitre.focus(); return; }
      const tome = parseInt(champTome.value, 10) || 1;
      nettoyer({ titre, tome });
    }
    function onCancel() { nettoyer(null); }

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

function demanderTexte(entete, valeurParDefaut) {
  return new Promise((resolve) => {
    const modal = document.getElementById('form-text-modal');
    const champ = document.getElementById('form-text-input');
    document.getElementById('form-text-heading').textContent = entete;
    champ.value = valeurParDefaut || '';
    modal.classList.add('active');
    setTimeout(() => champ.focus(), 50);

    const btnOk = document.getElementById('form-text-ok');
    const btnCancel = document.getElementById('form-text-cancel');

    function nettoyer(resultat) {
      modal.classList.remove('active');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(resultat);
    }
    function onOk() {
      const valeur = champ.value.trim();
      nettoyer(valeur);
    }
    function onCancel() { nettoyer(null); }

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

function demanderChoixJaquette() {
  return new Promise((resolve) => {
    const modal = document.getElementById('cover-choice-modal');
    modal.classList.add('active');

    const btnFile = document.getElementById('cover-choice-file');
    const btnUrl = document.getElementById('cover-choice-url');
    const btnCancel = document.getElementById('cover-choice-cancel');

    function nettoyer(resultat) {
      modal.classList.remove('active');
      btnFile.removeEventListener('click', onFile);
      btnUrl.removeEventListener('click', onUrl);
      btnCancel.removeEventListener('click', onCancel);
      resolve(resultat);
    }
    function onFile() { nettoyer('fichier'); }
    function onUrl() { nettoyer('url'); }
    function onCancel() { nettoyer(null); }

    btnFile.addEventListener('click', onFile);
    btnUrl.addEventListener('click', onUrl);
    btnCancel.addEventListener('click', onCancel);
  });
}

async function configurerCleBooks() {
  const cleActuelle = localStorage.getItem('google_books_api_key') || '';
  const nouvelleCle = await demanderTexte("Clé API Google Books (laisse vide pour l'anonyme) :", cleActuelle);
  if (nouvelleCle !== null) {
    if (nouvelleCle) {
      localStorage.setItem('google_books_api_key', nouvelleCle);
    } else {
      localStorage.removeItem('google_books_api_key');
    }
  }
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAvecReessai(url) {
  const delais = [1000];
  for (let tentative = 0; tentative <= delais.length; tentative++) {
    try {
      const r = await fetchAvecTimeout(url, {}, 6000);
      if (r.ok) {
        return { ok: true, status: r.status, body: await r.json().catch(() => null) };
      }
      if (tentative < delais.length && (r.status === 429 || r.status >= 500)) {
        await pause(delais[tentative]);
        continue;
      }
      return { ok: false, status: r.status, body: null };
    } catch (e) {
      if (tentative < delais.length) {
        await pause(delais[tentative]);
        continue;
      }
      throw e;
    }
  }
}

function fetchAvecTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

const WORKER_URL = 'https://manga-gemini-proxy.nabil-chilla.workers.dev';
let jetonRecherche = 0;
