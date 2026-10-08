// Onglets et écrans principaux : Pile à lire, Collection, À venir

function changerOnglet(onglet) {
  ongletActif = onglet;
  document.getElementById('tab-pal-btn').classList.toggle('active', onglet === 'pal');
  document.getElementById('tab-col-btn').classList.toggle('active', onglet === 'collection');
  document.getElementById('tab-avenir-btn').classList.toggle('active', onglet === 'avenir');
  document.getElementById('view-avenir').style.display = onglet === 'avenir' ? 'block' : 'none';
  
  document.getElementById('view-pal').style.display = onglet === 'pal' ? 'block' : 'none';
  document.getElementById('view-collection').style.display = onglet === 'collection' ? 'block' : 'none';
  document.getElementById('collection-toolbar').style.display = onglet === 'collection' ? 'flex' : 'none';
  
  rendreVues();
}

function rendreVues() {
  let totalPossedes = 0;
  let elementsPAL = [];

  bibliotheque.forEach((serie, sIndex) => {
    serie.tomes.forEach((tome, tIndex) => {
      if (tome.possede) {
        totalPossedes++;
        if (!tome.lu) {
          elementsPAL.push({ serieIndex: sIndex, tomeIndex: tIndex, titre: serie.titre, numero: tome.numero });
        }
      }
    });
  });

  document.getElementById('total-count').innerText = `${totalPossedes} tome(s)`;
  document.getElementById('pal-count').innerText = elementsPAL.length;

  rendrePileALire();
  rendreAVenir();

  const containerCol = document.getElementById('view-collection');
  containerCol.innerHTML = '';

  let listeAffichee = bibliotheque.map((serie, i) => ({ serie, indexReel: i }));

  if (rechercheTexte.trim()) {
    const recherche = normaliserTitre(rechercheTexte);
    listeAffichee = listeAffichee.filter(item => normaliserTitre(item.serie.titre).includes(recherche));
  }

  if (triActif === 'alpha') {
    listeAffichee.sort((a, b) => a.serie.titre.localeCompare(b.serie.titre, 'fr', { sensitivity: 'base' }));
  } else if (triActif === 'progression') {
    const pourcentageDe = (serie) => {
      const { total, lus } = statsSerie(serie);
      return total > 0 ? lus / total : 0;
    };
    listeAffichee.sort((a, b) => pourcentageDe(b.serie) - pourcentageDe(a.serie));
  } else if (triActif === 'completer') {
    // D'abord les séries où il manque le moins de tomes, puis les complètes, puis les inconnues
    const rang = (serie) => {
      if (serie.misDeCote) return 300000;
      const { manquants } = statsSerie(serie);
      if (manquants.length) return manquants.length;
      return serie.tomesParus ? 100000 : 200000;
    };
    listeAffichee.sort((a, b) => rang(a.serie) - rang(b.serie) || a.serie.titre.localeCompare(b.serie.titre, 'fr', { sensitivity: 'base' }));
  }
  // 'ajout' : on garde l'ordre naturel du tableau (ordre d'ajout), rien à trier

  if (bibliotheque.length === 0) {
    containerCol.innerHTML = `<div class="empty-state">Ta collection est vide.<br>Clique sur ⚙️ pour importer un CSV ou sur ➕ pour ajouter une série.</div>`;
  } else if (listeAffichee.length === 0) {
    containerCol.innerHTML = `<div class="empty-state">Aucune série ne correspond à "${rechercheTexte}".</div>`;
  } else {
    listeAffichee.forEach(({ serie, indexReel }) => {
      const { total, possedes, lus, manquants } = statsSerie(serie);
      const pctPossedes = total ? Math.round(possedes / total * 100) : 0;
      const pctLus = total ? Math.round(lus / total * 100) : 0;
      let etat;
      if (serie.misDeCote) etat = '⏸ mise de côté';
      else if (manquants.length) etat = `<span class="a-acheter">${manquants.length} à acheter</span>`;
      else if (serie.tomesParus) {
        const prochaine = prochaineSortie(serie);
        etat = `<span class="complete">${serie.statut === 'Terminée' ? 'Complète' : 'À jour'} ✓</span>` +
          (prochaine ? ` · 📅 ${prochaine.retard ? 'bientôt' : moisTexte(prochaine.k, true)}` : '');
      }
      else etat = '';
      const compte = serie.tomesParus ? `${possedes} / ${total}` : `${possedes} possédé${possedes > 1 ? 's' : ''}`;
      const meta = [compte, etat, `${lus} lu${lus > 1 ? 's' : ''}`].filter(Boolean).join(' · ');

      const card = document.createElement('div');
      card.className = 'series-card';
      card.onclick = () => ouvrirModalSerie(indexReel);
      card.innerHTML = `
        <img class="cover-thumb" src="${serie.couverture || JAQUETTE_DEFAUT}" alt="Jaquette" onerror="this.onerror=null; this.src=JAQUETTE_DEFAUT">
        <div class="series-details">
          <div class="series-title"></div>
          <div class="series-meta">${meta}</div>
          <div class="progress-bar-bg barre-double">
            <div class="progress-bar-fill possedes" style="width: ${pctPossedes}%;"></div>
            <div class="progress-bar-fill" style="width: ${pctLus}%;"></div>
          </div>
        </div>
        <div class="chevron">›</div>
      `;
      card.querySelector('.series-title').textContent = serie.titre;
      containerCol.appendChild(card);
    });
  }

  rendreInventaire();

  if (serieIndexActive !== null && bibliotheque[serieIndexActive]) {
    remplirModalSerie(serieIndexActive);
  }
}

// --- À venir : prochains tomes estimés, regroupés par mois ---
let vueAVenir = 'sorties';
function rendreAVenir() {
  const container = document.getElementById('view-avenir');
  container.innerHTML = '';
  const maintenant = new Date().getFullYear() * 12 + new Date().getMonth();
  const parMois = new Map();
  const imminents = [];
  let sansEstimation = 0;
  bibliotheque.forEach((serie, sIndex) => {
    const prochaine = prochaineSortie(serie);
    if (!prochaine) { sansEstimation++; return; }
    const item = { serie, sIndex, prochaine };
    if (prochaine.retard) { imminents.push(item); return; }
    if (!parMois.has(prochaine.k)) parMois.set(prochaine.k, []);
    parMois.get(prochaine.k).push(item);
  });

  // Sélecteur : prochaines sorties (par défaut) ou tomes déjà sortis à acheter
  const achats = bibliotheque.map((serie, sIndex) => ({ serie, sIndex, manquants: statsSerie(serie).manquants }))
    .filter(a => a.manquants.length && !a.serie.misDeCote && a.serie.tomesParus)
    .sort((a, b) => a.manquants.length - b.manquants.length || a.serie.titre.localeCompare(b.serie.titre, 'fr', { sensitivity: 'base' }));
  const nbTomesAAcheter = achats.reduce((total, a) => total + a.manquants.length, 0);
  const selecteur = document.createElement('div');
  selecteur.className = 'selecteur-vue';
  for (const [cle, libelle] of [['sorties', '📅 Prochaines sorties'], ['achats', `🛒 À acheter${nbTomesAAcheter ? ' (' + nbTomesAAcheter + ')' : ''}`]]) {
    const bouton = document.createElement('button');
    bouton.textContent = libelle;
    bouton.className = vueAVenir === cle ? 'actif' : '';
    bouton.onclick = () => { vueAVenir = cle; rendreAVenir(); };
    selecteur.appendChild(bouton);
  }
  container.appendChild(selecteur);

  if (vueAVenir === 'achats') {
    if (!achats.length) {
      container.insertAdjacentHTML('beforeend', `<div class="empty-state">Rien à acheter : tu as tous les tomes parus de tes séries. 🎉</div>`);
      return;
    }
    const aide = document.createElement('div');
    aide.className = 'avenir-intro';
    aide.textContent = 'Tomes déjà sortis que tu n’as pas. En magasin, touche un numéro acheté : il rejoint ta collection.';
    container.appendChild(aide);
    for (const achat of achats) container.appendChild(carteAchat(achat));
    return;
  }

  const intro = document.createElement('div');
  intro.className = 'avenir-intro';
  intro.textContent = "Estimations d'après le rythme de parution des tomes en France (Manga Insight). Un éditeur peut toujours décaler une sortie.";
  container.appendChild(intro);

  if (!imminents.length && !parMois.size) {
    const vide = document.createElement('div');
    vide.className = 'empty-state';
    vide.innerHTML = bibliotheque.some(s => s.parution)
      ? 'Aucune sortie estimée pour tes séries en cours.'
      : 'Pas encore de données de parution.<br>Lance ⚙️ → 🔄 Mettre à jour mes séries.';
    container.appendChild(vide);
    return;
  }

  const parTitre = (a, b) => a.serie.titre.localeCompare(b.serie.titre, 'fr', { sensitivity: 'base' });
  const groupe = (titre, items) => {
    const entete = document.createElement('div');
    entete.className = 'pal-section';
    entete.innerHTML = titre;
    container.appendChild(entete);
    for (const item of items.sort(parTitre)) container.appendChild(carteAVenir(item));
  };

  if (imminents.length) groupe('⏳ Imminent <small>la date estimée est passée</small>', imminents);
  for (const k of [...parMois.keys()].sort((a, b) => a - b)) {
    const nom = moisTexte(k);
    const titre = nom.charAt(0).toUpperCase() + nom.slice(1);
    groupe(k === maintenant ? `📅 ${titre} <small>ce mois-ci</small>` : k === maintenant + 1 ? `📅 ${titre} <small>le mois prochain</small>` : `📅 ${titre}`, parMois.get(k));
  }

  if (sansEstimation) {
    const pied = document.createElement('div');
    pied.className = 'avenir-intro';
    pied.style.marginTop = '16px';
    pied.textContent = `${sansEstimation} série(s) sans estimation : terminées, en pause ou pas assez de tomes parus pour connaître le rythme.`;
    container.appendChild(pied);
  }
}

const TOMES_AFFICHES_ACHAT = 3;

function carteAchat({ serie, sIndex, manquants }) {
  const carte = document.createElement('div');
  carte.className = 'achat-item';
  const titre = document.createElement('div');
  titre.className = 'pal-title';
  titre.textContent = serie.titre;
  titre.onclick = () => ouvrirModalSerie(sIndex);
  const tomes = document.createElement('div');
  tomes.className = 'achat-tomes';
  for (const n of manquants.slice(0, TOMES_AFFICHES_ACHAT)) {
    const pastille = document.createElement('button');
    pastille.className = 'achat-tome';
    pastille.textContent = n;
    pastille.setAttribute('aria-label', `Tome ${n} acheté`);
    pastille.onclick = () => marquerPossede(sIndex, n);
    tomes.appendChild(pastille);
  }
  if (manquants.length > TOMES_AFFICHES_ACHAT) {
    const reste = document.createElement('span');
    reste.className = 'achat-reste';
    reste.textContent = `+${manquants.length - TOMES_AFFICHES_ACHAT}`;
    tomes.appendChild(reste);
  }
  carte.append(titre, tomes);
  return carte;
}

function carteAVenir(item) {
  const { serie, prochaine } = item;
  const { manquants } = statsSerie(serie);
  const carte = document.createElement('div');
  carte.className = 'avenir-item';
  carte.onclick = () => ouvrirModalSerie(item.sIndex);
  carte.innerHTML = `
    <img class="avenir-jaquette" src="${serie.couverture || JAQUETTE_DEFAUT}" alt="" onerror="this.onerror=null; this.src=JAQUETTE_DEFAUT">
    <div class="avenir-infos">
      <div class="pal-title"></div>
      <div class="pal-tome">Tome ${prochaine.vol} <span>· environ tous les ${serie.parution.rythme > 1 ? serie.parution.rythme + ' mois' : 'mois'}</span></div>
      ${manquants.length ? `<div class="avenir-retard">+ ${manquants.length} déjà sorti${manquants.length > 1 ? 's' : ''} à acheter</div>` : ''}
    </div>
  `;
  carte.querySelector('.pal-title').textContent = serie.titre;
  return carte;
}

// --- Pile à lire : une carte par série, rangée par intention de lecture ---
const SEUIL_ENCORE_UN_EFFORT = 3;

// Groupes de la pile : en cours, presque finies (« encore un effort »), pas encore commencées
const GROUPES_PILE = [
  { cle: 'enCours', onglet: 'En cours', intro: '▶ La dernière série lue en haut.',
    vide: 'Aucune série en cours : choisis-en une dans « À commencer » !', reste: (n) => `encore ${n} à lire` },
  { cle: 'effort', onglet: 'Effort', intro: '💪 Encore un effort ! La ligne d\u2019arrivée est en vue.',
    vide: 'Aucune série presque finie pour l\u2019instant.', reste: (n) => n === 1 ? 'le dernier, courage !' : `plus que ${n} !` },
  { cle: 'aCommencer', onglet: 'À commencer', intro: '📚 Pour quand tu auras fini le reste…',
    vide: 'Rien à commencer : toutes tes séries sont entamées.', reste: (n) => `${n} tome${n > 1 ? 's' : ''} à lire` }
];
let vuePile = null; // null : premier groupe non vide

function groupePile(serie) {
  const aLire = serie.tomes.filter(t => t.possede && !t.lu).length;
  if (!aLire) return null;
  if (!serie.tomes.some(t => t.lu)) return 'aCommencer';
  return aLire <= SEUIL_ENCORE_UN_EFFORT ? 'effort' : 'enCours';
}

function rendrePileALire() {
  const container = document.getElementById('view-pal');
  container.innerHTML = '';
  const groupes = { enCours: [], effort: [], aCommencer: [] };
  bibliotheque.forEach((serie, sIndex) => {
    const groupe = groupePile(serie);
    if (!groupe) return;
    const aLire = serie.tomes.filter(t => t.possede && !t.lu).sort((a, b) => a.numero - b.numero);
    const derniereLecture = Math.max(0, ...serie.tomes.filter(t => t.lu).map(t => t.luLe || 0));
    groupes[groupe].push({ serie, sIndex, aLire, derniereLecture });
  });

  if (!groupes.enCours.length && !groupes.effort.length && !groupes.aCommencer.length) {
    container.innerHTML = `<div class="empty-state">Pile à lire vide : tu es à jour ! 🎉<br>Il est peut-être temps de passer en librairie…</div>`;
    return;
  }

  const parTitre = (a, b) => a.serie.titre.localeCompare(b.serie.titre, 'fr', { sensitivity: 'base' });
  groupes.enCours.sort((a, b) => b.derniereLecture - a.derniereLecture || parTitre(a, b));
  groupes.effort.sort((a, b) => a.aLire.length - b.aLire.length || parTitre(a, b));
  groupes.aCommencer.sort(parTitre);

  // Sélecteur, comme dans « À venir » : un seul groupe affiché à la fois
  const actif = GROUPES_PILE.find(g => g.cle === vuePile) || GROUPES_PILE.find(g => groupes[g.cle].length);
  const selecteur = document.createElement('div');
  selecteur.className = 'selecteur-vue';
  for (const g of GROUPES_PILE) {
    const bouton = document.createElement('button');
    bouton.textContent = g.onglet;
    const compte = document.createElement('span');
    compte.className = 'selecteur-compte';
    compte.textContent = groupes[g.cle].length;
    bouton.appendChild(compte);
    bouton.className = g === actif ? 'actif' : '';
    bouton.onclick = () => { vuePile = g.cle; rendrePileALire(); };
    selecteur.appendChild(bouton);
  }
  container.appendChild(selecteur);

  const items = groupes[actif.cle];
  if (!items.length) {
    container.insertAdjacentHTML('beforeend', `<div class="empty-state">${actif.vide}</div>`);
    return;
  }
  const intro = document.createElement('div');
  intro.className = 'avenir-intro';
  intro.textContent = actif.intro;
  container.appendChild(intro);
  for (const item of items) container.appendChild(cartePileALire(item, actif.reste(item.aLire.length)));
}

function cartePileALire(item, texteReste) {
  const prochain = item.aLire[0];
  const tIndex = item.serie.tomes.indexOf(prochain);
  const carte = document.createElement('div');
  carte.className = 'pal-item';
  carte.onclick = () => ouvrirModalSerie(item.sIndex);
  carte.innerHTML = `
    <div class="pal-info">
      <div class="pal-title"></div>
      <div class="pal-tome">Tome ${prochain.numero} <span>· ${texteReste}</span></div>
    </div>
    <button class="btn-read-action">Lu ✓</button>
  `;
  carte.querySelector('.pal-title').textContent = item.serie.titre;
  carte.querySelector('button').onclick = (e) => {
    e.stopPropagation(); // ne pas ouvrir la fiche
    marquerCommeLu(item.sIndex, tIndex);
  };
  return carte;
}

function onRechercheInput(valeur) {
  rechercheTexte = valeur;
  rendreVues();
}

function onTriChange(valeur) {
  triActif = valeur;
  rendreVues();
}

function marquerCommeLu(sIndex, tIndex) {
  const serie = bibliotheque[sIndex];
  const avant = groupePile(serie);
  serie.tomes[tIndex].lu = true;
  serie.tomes[tIndex].luLe = Date.now();
  sauvegarder();
  // La série change de sous-onglet : on le signale, puisqu'elle disparaît de l'écran
  const apres = groupePile(serie);
  if (apres === avant) return;
  if (!apres) afficherToast(`🎉 ${serie.titre} : plus rien à lire, bravo !`);
  else afficherToast(`${serie.titre} passe dans « ${GROUPES_PILE.find(g => g.cle === apres).onglet} »`);
}
