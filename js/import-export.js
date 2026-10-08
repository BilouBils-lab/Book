// Import CSV et import / export de la sauvegarde JSON

function parseCSVLine(text) {
  let p = '', c = '', r = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    c = text[i];
    if (c === '"') {
      q = !q;
    } else if (c === ',' && !q) {
      r.push(p.trim());
      p = '';
    } else {
      p += c;
    }
  }
  r.push(p.trim());
  return r;
}

function importerCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const lignes = e.target.result.split(/\r?\n/);
    let ajouts = 0;

    lignes.forEach((ligne, index) => {
      if (!ligne.trim() || index === 0) return;
      
      const cols = parseCSVLine(ligne);
      if (cols.length < 2) return;

      const titre = cols[1] ? cols[1].replace(/^"|"$/g, '').trim() : '';
      const brutTomesPossedes = cols[2] ? cols[2].replace(/^"|"$/g, '').trim() : '';
      const tomesLusVal = cols[3] ? parseInt(cols[3].trim()) || 0 : 0;

      if (titre && titre.toLowerCase() !== 'série') {
        importerMangaDepuisCSV(titre, brutTomesPossedes, tomesLusVal);
        ajouts++;
      }
    });

    fermerParametres();
    alert(`${ajouts} série(s) importée(s) avec succès !`);
  };
  reader.readAsText(file);
}

function importerMangaDepuisCSV(titreSerie, stringTomes, nbTomesLus) {
  let setPossedes = new Set();
  const matches = stringTomes.match(/\d+/g);
  if (matches) {
    if (stringTomes.includes(',') || stringTomes.includes(';')) {
      matches.forEach(num => setPossedes.add(parseInt(num)));
    } else {
      const max = parseInt(matches[0]);
      for (let i = 1; i <= max; i++) setPossedes.add(i);
    }
  }

  const maxTomeCount = setPossedes.size > 0 ? Math.max(...Array.from(setPossedes), nbTomesLus) : (nbTomesLus || 1);

  let initialTomes = [];
  for (let i = 1; i <= maxTomeCount; i++) {
    const estPossede = setPossedes.has(i) || (matches && matches.length === 1 && i <= parseInt(matches[0]));
    const estLu = i <= nbTomesLus;
    initialTomes.push({
      numero: i,
      possede: estPossede || estLu,
      lu: estLu
    });
  }

  let mangaIndex = bibliotheque.findIndex(m => normaliserTitre(m.titre) === normaliserTitre(titreSerie));

  if (mangaIndex === -1) {
    bibliotheque.push({
      titre: titreSerie,
      auteur: '',
      couverture: '',
      tomes: initialTomes
    });
  } else {
    bibliotheque[mangaIndex].tomes = initialTomes;
  }

  sauvegarder();
}

function exporterSauvegarde() {
  if (bibliotheque.length === 0) {
    alert("Ta bibliothèque est vide, rien à exporter.");
    return;
  }
  const blob = new Blob([JSON.stringify(bibliotheque, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = `mangas_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bibliothequeValide(data) {
  return Array.isArray(data) && data.every(item =>
    item && typeof item.titre === 'string' && Array.isArray(item.tomes) &&
    item.tomes.every(t => typeof t.numero === 'number')
  );
}

function importerSauvegarde(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const importedData = JSON.parse(e.target.result);
      if (bibliothequeValide(importedData)) {
        if (await confirmerAction("Remplacer la bibliothèque actuelle par cette sauvegarde ?")) {
          bibliotheque = importedData;
          sauvegarder();
          fermerParametres();
          alert("Bibliothèque restaurée avec succès !");
        }
      } else {
        alert("Fichier invalide : ce n'est pas une sauvegarde reconnue de cette application.");
      }
    } catch (err) {
      alert("Erreur lors de la lecture du fichier JSON.");
    }
  };
  reader.readAsText(file);
}
