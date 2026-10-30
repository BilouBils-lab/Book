// Sagas : une histoire en plusieurs parties qui repartent chacune au tome 1
// (Sword Art Online : Aincrad, Fairy Dance… ; Jungle Juice : saison 1, saison 2).
// Chaque partie reste une série à part (ses tomes, ses sorties, ses ISBN), mais l'app les regroupe :
// une seule carte dans la Collection, et les parties en onglets dans la fiche.
// (Une suite qui CONTINUE la numérotation, comme Solo Leveling Ragnarok, n'est pas une saga :
// c'est une seule série découpée en parties, voir suitesMangaInsight dans mise-a-jour.js.)

function partiesDeSaga(saga) {
  return bibliotheque.map((serie, index) => ({ serie, index })).filter(p => p.serie.saga === saga);
}

function estDansUneSaga(serie) {
  return !!serie.saga && partiesDeSaga(serie.saga).length > 1;
}

// Nom court d'une partie : « Sword Art Online (Fairy Dance) » dans la saga « Sword Art Online » → « Fairy Dance »
function libellePartie(serie, position) {
  let reste = serie.titre;
  if (normaliserTitre(reste.slice(0, serie.saga.length)) === normaliserTitre(serie.saga)) reste = reste.slice(serie.saga.length);
  reste = reste.replace(/^[\s\-–:.,]+/, '').replace(/^\((.*)\)$/, '$1').trim();
  return reste || `Partie ${position + 1}`;
}

// Nom de saga proposé pour une série : son titre sans édition ni sous-titre (« Sword Art Online - Aincrad » → « Sword Art Online »)
function nomDeSagaPropose(serie) {
  return decomposerTitreSerie(serie.titre).base.split(' - ')[0].trim();
}

// Nouvelle série dont le titre correspond à une saga existante : elle la rejoint d'elle-même
function rattacherSagaAuto(serie) {
  if (serie.saga) return;
  const cle = normaliserRecherche(nomDeSagaPropose(serie));
  const autre = bibliotheque.find(s => s !== serie && s.saga && normaliserRecherche(s.saga) === cle);
  if (autre) serie.saga = autre.saga;
}

// --- Collection : une carte pour toute la saga ---

function carteSaga(saga) {
  const parties = partiesDeSaga(saga);
  let total = 0, possedes = 0, lus = 0, manquants = 0;
  for (const { serie } of parties) {
    const stats = statsSerie(serie);
    total += stats.total;
    possedes += stats.possedes;
    lus += stats.lus;
    if (!serie.misDeCote) manquants += stats.manquants.length;
  }
  const etat = parties.every(p => p.serie.misDeCote) ? '⏸ mise de côté'
    : manquants ? `<span class="a-acheter">${manquants} à acheter</span>` : '<span class="complete">À jour ✓</span>';
  const meta = [`${parties.length} parties`, `${possedes} / ${total}`, etat, `${lus} lu${lus > 1 ? 's' : ''}`].join(' · ');
  const couverture = (parties.find(p => p.serie.couverture) || parties[0]).serie.couverture;
  const pct = (n) => total ? Math.round(n / total * 100) : 0;

  const card = document.createElement('div');
  card.className = 'series-card';
  card.onclick = () => ouvrirModalSerie(parties[0].index);
  card.innerHTML = `
    <img class="cover-thumb" src="${couverture || JAQUETTE_DEFAUT}" alt="Jaquette" onerror="this.onerror=null; this.src=JAQUETTE_DEFAUT">
    <div class="series-details">
      <div class="series-title"></div>
      <div class="series-meta">${meta}</div>
      <div class="progress-bar-bg barre-double">
        <div class="progress-bar-fill possedes" style="width: ${pct(possedes)}%;"></div>
        <div class="progress-bar-fill" style="width: ${pct(lus)}%;"></div>
      </div>
    </div>
    <div class="chevron">›</div>
  `;
  card.querySelector('.series-title').textContent = '📚 ' + saga;
  return card;
}

// --- Fiche : les parties de la saga en onglets ---

function afficherPartiesSaga(serie, index) {
  const zone = document.getElementById('fiche-parties');
  zone.innerHTML = '';
  if (!estDansUneSaga(serie)) return;
  const titre = document.createElement('div');
  titre.className = 'fiche-parties-titre';
  titre.textContent = '📚 Saga ' + serie.saga;
  const onglets = document.createElement('div');
  onglets.className = 'selecteur-vue';
  partiesDeSaga(serie.saga).forEach((partie, position) => {
    const bouton = document.createElement('button');
    bouton.textContent = libellePartie(partie.serie, position);
    bouton.className = partie.index === index ? 'actif' : '';
    bouton.onclick = () => ouvrirModalSerie(partie.index);
    onglets.appendChild(bouton);
  });
  zone.append(titre, onglets);
}

// --- Menu ⋯ : rejoindre / créer / quitter une saga ---

async function gererSaga() {
  const index = serieIndexActive;
  const serie = bibliotheque[index];
  if (!serie) return;
  const propose = nomDeSagaPropose(serie);
  const existantes = [...new Set(bibliotheque.map(s => s.saga).filter(Boolean))];
  const choix = [];
  for (const saga of existantes) if (saga !== serie.saga) choix.push({ libelle: `📚 Rejoindre « ${saga} »`, valeur: 'saga:' + saga, principal: normaliserRecherche(saga) === normaliserRecherche(propose) });
  if (!existantes.some(s => normaliserRecherche(s) === normaliserRecherche(propose))) choix.push({ libelle: `➕ Créer la saga « ${propose} »`, valeur: 'saga:' + propose, principal: true });
  choix.push({ libelle: '✍️ Autre nom de saga…', valeur: 'autre' });
  if (serie.saga) choix.push({ libelle: `Retirer de la saga « ${serie.saga} »`, valeur: 'retirer' });
  const reponse = await choisirAction(`Une saga regroupe les parties d'une même histoire qui repartent chacune au tome 1 (ex. Sword Art Online : Aincrad, Fairy Dance). Chaque partie garde ses tomes et ses sorties.\n\n« ${serie.titre} »${serie.saga ? ' est dans la saga « ' + serie.saga + ' »' : ''} :`, choix);
  if (!reponse) return;
  if (reponse === 'retirer') {
    delete serie.saga;
    sauvegarder();
    afficherToast(`✓ ${serie.titre} retirée de la saga`);
    return;
  }
  let nom = reponse.startsWith('saga:') ? reponse.slice(5) : await demanderTexte('Nom de la saga :', propose);
  if (!nom || !nom.trim()) return;
  nom = nom.trim();
  serie.saga = nom;
  // Les autres parties de la même histoire, pas encore rangées : on propose de les ajouter d'un coup
  const autres = bibliotheque.filter(s => s !== serie && !s.saga && normaliserRecherche(nomDeSagaPropose(s)) === normaliserRecherche(nom));
  if (autres.length && await confirmerAction(`Ajouter aussi à la saga « ${nom} » :\n${autres.map(s => '• ' + s.titre).join('\n')} ?`)) {
    for (const s of autres) s.saga = nom;
  }
  sauvegarder();
  afficherToast(`✓ Saga « ${nom} » : ${partiesDeSaga(nom).length} partie${partiesDeSaga(nom).length > 1 ? 's' : ''}`);
}

// --- Menu ⋯ : une suite qui repart au tome 1 rangée par erreur dans la même série (ex. saison 2 notée « tome 7 ») ---

async function nouvellePartieSaga() {
  const index = serieIndexActive;
  const serie = bibliotheque[index];
  if (!serie) return;
  const dernier = Math.max(0, ...serie.tomes.map(t => t.numero));
  const propose = serie.tomesParus && dernier > serie.tomesParus ? String(serie.tomesParus + 1) : '';
  const saisie = await demanderTexte(`Une nouvelle partie repart au tome 1 (ex. une saison 2).\n\nÀ partir de quel tome de « ${serie.titre} » commence-t-elle ? Ces tomes seront renumérotés à partir de 1, lectures comprises.`, propose);
  if (saisie === null) return;
  const debut = parseInt(saisie, 10);
  if (!(debut > 1) || !serie.tomes.some(t => t.numero >= debut)) {
    alert(`Il faut un numéro de tome entre 2 et ${dernier}.`);
    return;
  }
  const saga = serie.saga || nomDeSagaPropose(serie);
  const nomNouvelle = (await demanderTexte('Nom de la nouvelle partie :', `${saga} (Saison 2)`) || '').trim();
  if (!nomNouvelle) return;
  if (bibliotheque.some(s => normaliserTitre(s.titre) === normaliserTitre(nomNouvelle))) {
    alert(`La série « ${nomNouvelle} » existe déjà : choisis un autre nom.`);
    return;
  }
  const nomActuelle = (await demanderTexte('Et le nom de cette partie-ci :', normaliserTitre(serie.titre) === normaliserTitre(saga) ? `${saga} (Saison 1)` : serie.titre) || '').trim();
  if (!nomActuelle) return;

  const avant = JSON.stringify(bibliotheque);
  const { nouvelle, deplaces } = separerPartie(index, debut, nomNouvelle, nomActuelle);
  sauvegarder();
  ouvrirModalSerie(bibliotheque.indexOf(nouvelle));
  afficherToast(`✓ ${deplaces.length} tome${deplaces.length > 1 ? 's' : ''} rangé${deplaces.length > 1 ? 's' : ''} dans « ${nomNouvelle} »`, () => {
    bibliotheque = JSON.parse(avant);
    fermerModal();
    sauvegarder();
  });
}

// Déplace les tomes à partir de « debut » dans une nouvelle partie (renumérotés à partir de 1), dans une saga
function separerPartie(index, debut, nomNouvelle, nomActuelle) {
  const serie = bibliotheque[index];
  const saga = serie.saga || nomDeSagaPropose(serie);
  const deplaces = serie.tomes.filter(t => t.numero >= debut);
  serie.tomes = serie.tomes.filter(t => t.numero < debut);
  const nouvelle = {
    titre: nomNouvelle, auteur: serie.auteur || '', genre: serie.genre || '', editeur: serie.editeur || '',
    statut: 'En cours', couverture: '', saga,
    tomes: deplaces.map(t => {
      const tome = { ...t, numero: t.numero - debut + 1 };
      if (tome.isbnAuto) { delete tome.isbn; delete tome.isbnAuto; } // ISBN déduit : celui de l'ancien numéro, faux
      return tome;
    })
  };
  serie.saga = saga;
  bibliotheque.splice(index + 1, 0, nouvelle);
  const indexActuelle = nomActuelle !== serie.titre ? changerTitreSerie(index, nomActuelle) : index;
  for (const s of [bibliotheque[indexActuelle], nouvelle]) if (s.tomesParusSource !== 'manuel') appliquerMangaInsight(s);
  return { nouvelle, deplaces };
}

// --- Au lancement : saison suivante rangée par erreur dans la même série ---
// Ex. « Jungle Juice » suit « Jungle Juice - Saison 1 » (6 tomes) mais contient un tome 7 : c'est la saison 2, tome 1.
function saisonARanger() {
  for (let index = 0; index < bibliotheque.length; index++) {
    const serie = bibliotheque[index];
    const saison = serie.parution && !serie.saisonsVerifiees && serie.parution.nom.match(/^(.*?)\s*-\s*Saison\s*(\d+)$/i);
    if (saison && serie.tomesParus && serie.tomes.some(t => t.possede && t.numero > serie.tomesParus)) {
      return { index, serie, base: saison[1].trim(), numero: Number(saison[2]) };
    }
  }
  return null;
}

// Renvoie true si une proposition a été faite (la page « Quoi de neuf ? » attendra le prochain lancement)
async function proposerRangementSaisons() {
  const a = saisonARanger();
  if (!a || document.querySelector('.modal-overlay.active')) return false;
  const { index, serie, base, numero } = a;
  const debut = serie.tomesParus + 1;
  const deplaces = serie.tomes.filter(t => t.numero >= debut).map(t => t.numero);
  const nomNouvelle = `${base} (Saison ${numero + 1})`;
  const nomActuelle = normaliserTitre(serie.titre) === normaliserTitre(base) ? `${base} (Saison ${numero})` : serie.titre;
  const reponse = await choisirAction(`${serie.titre} : d'après les sorties, la saison ${numero} compte ${serie.tomesParus} tomes. Ton${deplaces.length > 1 ? 's tomes' : ' tome'} ${deplaces.join(', ')} ${deplaces.length > 1 ? 'appartiennent' : 'appartient'} sans doute à la saison ${numero + 1}, qui repart au tome 1.\n\nRanger en deux saisons, dans une saga « ${serie.saga || base} » ? Tes lectures sont gardées.`, [
    { libelle: `✓ Ranger : « ${nomActuelle} » et « ${nomNouvelle} »`, valeur: 'ranger', principal: true },
    { libelle: 'Non, c\u2019est bien la même série', valeur: 'non' }
  ]);
  if (reponse === 'non') { serie.saisonsVerifiees = true; sauvegarder(); }
  if (reponse !== 'ranger') return true;
  if (bibliotheque.some(s => normaliserTitre(s.titre) === normaliserTitre(nomNouvelle))) {
    alert(`La série « ${nomNouvelle} » existe déjà : range les tomes avec ⋯ → ✂️ Séparer une nouvelle partie.`);
    return true;
  }
  const avant = JSON.stringify(bibliotheque);
  const { nouvelle } = separerPartie(index, debut, nomNouvelle, nomActuelle);
  sauvegarder();
  ouvrirModalSerie(bibliotheque.indexOf(nouvelle));
  afficherToast(`✓ Saisons rangées : « ${nomNouvelle} » créée`, () => {
    bibliotheque = JSON.parse(avant);
    fermerModal();
    sauvegarder();
  });
  return true;
}
