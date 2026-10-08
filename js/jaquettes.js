// Jaquettes : scan IA d'une jaquette, image par défaut, choix et redimensionnement

function declencherScanIA() {
  document.getElementById('ia-file-input').click();
}

function redimensionnerImage(dataUrl, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxDim) { height *= maxDim / width; width = maxDim; }
      } else {
        if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

const JAQUETTE_DEFAUT = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="135" viewBox="0 0 90 135">' +
  '<rect width="90" height="135" fill="#2a2a30"/>' +
  '<text x="45" y="62" font-size="28" text-anchor="middle">📚</text>' +
  '<text x="45" y="90" font-size="11" fill="#9ca3af" text-anchor="middle" font-family="sans-serif">Manga</text>' +
  '</svg>'
);

function normaliserTitre(t) {
  return (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function analyserImageJaquette(event) {
  const file = event.target.files[0];
  if (!file) return;

  const loader = document.getElementById('loader-ia');
  const loaderStatus = document.getElementById('loader-status');
  loaderStatus.textContent = "Analyse de la jaquette par l'IA...";
  loader.style.display = 'flex';

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    // Réduit la photo avant envoi : bien plus rapide en 4G, et suffisant pour lire la jaquette
    let imageEnvoi = dataUrl;
    let mimeEnvoi = file.type || "image/jpeg";
    try {
      imageEnvoi = await redimensionnerImage(dataUrl, 1024);
      mimeEnvoi = "image/jpeg";
    } catch (e) {
      console.error('Réduction de la photo impossible, envoi en taille originale', e);
    }
    const base64Data = imageEnvoi.split(',')[1];

    const response = await fetch('https://manga-gemini-proxy.nabil-chilla.workers.dev', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: mimeEnvoi, data: base64Data })
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error((detail && detail.error) || ('Erreur HTTP ' + response.status));
    }

    const data = await response.json();
    const texteJson = data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      && data.candidates[0].content.parts[0].text;

    if (!texteJson) {
      const raison = data.candidates && data.candidates[0] && data.candidates[0].finishReason;
      throw new Error(raison ? ('analyse bloquée : ' + raison) : 'réponse IA vide');
    }

    const resultat = JSON.parse(texteJson);
    loader.style.display = 'none';

    const saisie = await demanderSerieEtTome(resultat.titre || '', resultat.tome || 1, "L'IA a détecté :");
    if (saisie) {
      await enregistrerSerie(saisie.titre, saisie.tome);

      try {
        const couvertureRedim = await redimensionnerImage(dataUrl, 300);
        const idx = bibliotheque.findIndex(m => normaliserTitre(m.titre) === normaliserTitre(saisie.titre));
        if (idx !== -1) {
          bibliotheque[idx].couverture = couvertureRedim;
          sauvegarder();
        }
      } catch (e) {
        console.error('Redimensionnement jaquette impossible', e);
      }
    }
  } catch (e) {
    console.error('Erreur scan IA', e);
    alert("L'IA n'a pas pu analyser l'image (" + e.message + "). Réessaie ou ajoute la série manuellement.");
  } finally {
    loader.style.display = 'none';
    event.target.value = '';
  }
}

async function ouvrirMenuImage() {
  const choix = await demanderChoixJaquette();
  if (choix === 'isbn') {
    await chercherJaquetteEdition();
  } else if (choix === 'fichier') {
    document.getElementById('cover-file-input').click();
  } else if (choix === 'url') {
    const url = await demanderTexte("Lien de l'image :");
    if (url) {
      bibliotheque[serieIndexActive].couverture = url.trim();
      sauvegarder();
    }
  }
}

function chargerJaquetteFichier(e) {
  const file = e.target.files[0];
  if (!file || serieIndexActive === null) return;

  const reader = new FileReader();
  reader.onload = async function(evt) {
    try {
      const couvertureRedim = await redimensionnerImage(evt.target.result, 300);
      bibliotheque[serieIndexActive].couverture = couvertureRedim;
      sauvegarder();
    } catch (err) {
      alert("Impossible de charger cette image.");
    }
  };
  reader.readAsDataURL(file);
}
