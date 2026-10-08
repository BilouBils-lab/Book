# Tests automatiques

Ces tests ouvrent l'app dans un vrai navigateur (Chromium, piloté par Playwright) et vérifient
les fonctions principales : pile à lire, collection, fiche, À venir, ISBN, scan, renommage,
complétion, Manga Insight, ainsi que le Worker Cloudflare.

Les services extérieurs (Worker, AniList, Google Books, BnF…) sont **simulés** : pas besoin
d'internet ni de clé API, et les résultats sont toujours les mêmes. La date est figée au
8 octobre 2026 pour que les estimations de sortie ne bougent pas.

## Lancer les tests

Il faut [Node.js](https://nodejs.org) (version 18 ou plus). Dans un terminal :

```bash
cd tests
npm install                    # une seule fois : installe Playwright et le lecteur de code-barres
npx playwright install chromium   # une seule fois : télécharge le navigateur de test
npm test
```

Résultat attendu : une ligne ✅ par test, puis `✅ 14/14 tests réussis`.
Un ❌ indique ce qui ne va pas (valeur attendue / valeur obtenue).

Pour lancer un seul test, donne un morceau de son nom : `node app.test.js isbn`.

Pour utiliser un Chromium déjà installé : `CHROMIUM_PATH=/chemin/vers/chromium npm test`.

## Fichiers

- `app.test.js` : les tests.
- `donnees/` : un extrait des données Manga Insight (licence CC BY 4.0) et une photo de code-barres.

## Tests automatiques sur GitHub

Le fichier `.github/workflows/tests.yml` demande à GitHub (GitHub Actions) de lancer ces tests
à chaque pull request et à chaque envoi sur `main`. Le résultat apparaît dans la PR
(✅ / ❌) et dans l'onglet **Actions** du dépôt, où l'on peut lire le détail d'un échec.
