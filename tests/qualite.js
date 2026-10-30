// Qualité du code : ESLint relit tout le code et signale les erreurs courantes (nom mal écrit, variable
// jamais utilisée, code inatteignable, comparaison douteuse…), avant même que les tests ne tournent.
// Lancement : `node tests/qualite.js` (aussi lancé par app.test.js à chaque PR).
//
// Particularité de l'app : ses fichiers js/ ne sont pas des modules, ils partagent leurs fonctions
// (une fonction de fiche.js est utilisée dans vues.js…). Chaque fichier reçoit donc comme « connues »
// les fonctions et variables déclarées par les AUTRES fichiers : un nom mal écrit reste détecté.

const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');
const js = require('@eslint/js');
const globals = require('globals');

const RACINE = path.join(__dirname, '..');
const FICHIERS_APP = fs.readdirSync(path.join(RACINE, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

// Noms déclarés au niveau principal d'un fichier (function, let, const, var)
function declarations(fichier) {
  const code = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
  return [...code.matchAll(/^(?:async\s+)?function\s+([\w$]+)|^(?:let|const|var)\s+([\w$]+)/gm)].map(m => m[1] || m[2]);
}

const parFichier = Object.fromEntries(FICHIERS_APP.map(f => [f, declarations(f)]));

// Un même nom déclaré dans deux fichiers : le second écraserait le premier sans prévenir
function doublons() {
  const vus = new Map(), problemes = [];
  for (const [fichier, noms] of Object.entries(parFichier)) {
    for (const nom of noms) {
      if (vus.has(nom) && vus.get(nom) !== fichier) problemes.push(`« ${nom} » est déclaré dans ${vus.get(nom)} et dans ${fichier}`);
      else vus.set(nom, fichier);
    }
  }
  return problemes;
}

// Fonctions appelées depuis index.html (onclick="…") : elles doivent exister dans js/
function appelsDepuisLaPage() {
  const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
  const connus = new Set(Object.values(parFichier).flat());
  const appeles = new Set([...html.matchAll(/on(?:click|change|input)="([^"]*)"/g)]
    .flatMap(m => [...m[1].matchAll(/(?:^|[^.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)].map(x => x[1])));
  return [...appeles].filter(nom => !connus.has(nom) && !(nom in globalThis) && !['document'].includes(nom))
    .map(nom => `index.html appelle « ${nom}() », qui n'existe pas dans js/`);
}

const REGLES = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  'eqeqeq': ['error', 'smart'],
  'no-var': 'error',
  'no-implicit-globals': 'off'
};

function configuration() {
  const tousLesNoms = Object.values(parFichier).flat();
  return [
    // L'app : scripts du navigateur qui partagent leurs fonctions
    ...FICHIERS_APP.map(fichier => ({
      files: [fichier],
      languageOptions: {
        ecmaVersion: 2024, sourceType: 'script',
        globals: { ...globals.browser, ZXing: 'readonly',
          ...Object.fromEntries(tousLesNoms.filter(n => !parFichier[fichier].includes(n)).map(n => [n, 'writable'])) }
      },
      rules: REGLES
    })),
    { files: ['sw.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.serviceworker }, rules: REGLES },
    { files: ['worker/worker.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.serviceworker } }, rules: REGLES },
    // Tests et surveillance (Node) : le code envoyé dans la page (page.evaluate) utilise les noms de l'app
    { files: ['tests/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
      rules: { ...REGLES, 'no-undef': 'off' } }
  ];
}

async function verifierQualite() {
  const eslint = new ESLint({ cwd: RACINE, overrideConfigFile: true, overrideConfig: configuration() });
  const resultats = await eslint.lintFiles([...FICHIERS_APP, 'sw.js', 'worker/worker.js', 'tests/*.js']);
  const problemes = resultats.flatMap(r => r.messages.map(m =>
    `${path.relative(RACINE, r.filePath)}:${m.line} ${m.message} (${m.ruleId || 'syntaxe'})`));
  return [...problemes, ...doublons(), ...appelsDepuisLaPage()];
}

if (require.main === module) {
  verifierQualite().then(problemes => {
    console.log(problemes.length ? problemes.join('\n') + `\n\n❌ ${problemes.length} problème(s)` : '✅ Aucun problème de qualité détecté');
    process.exit(problemes.length ? 1 : 0);
  });
}

module.exports = { verifierQualite };
