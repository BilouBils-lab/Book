// Modèles Gemini essayés dans l'ordre. Pour en changer sans toucher au code, ajoute une variable
// GEMINI_MODELES sur le Worker (ex. "gemini-flash-latest,gemini-flash-lite-latest").
// GET /modeles liste les modèles disponibles avec ta clé.
const MODELES_PAR_DEFAUT = "gemini-flash-latest,gemini-flash-lite-latest";

function modelesGemini(env) {
  return (env.GEMINI_MODELES || MODELES_PAR_DEFAUT).split(",").map(m => m.trim()).filter(Boolean);
}

async function appelGemini(modele, payload, env) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(payload)
  });
  const result = await res.json().catch(() => null);
  return { res, result };
}

// Essaie chaque modèle jusqu'à un succès ; en cas d'échec, renvoie l'erreur de chacun
async function appelGeminiAvecSecours(payload, env) {
  const erreurs = [];
  for (const modele of modelesGemini(env)) {
    const { res, result } = await appelGemini(modele, payload, env);
    if (res.ok && result) return { result };
    const msg = result && result.error && result.error.message ? result.error.message : "";
    erreurs.push(modele + " HTTP " + res.status + (msg ? " : " + msg.slice(0, 120) : ""));
    // Clé invalide ou refusée : inutile d'essayer les autres modèles
    if (res.status === 400 || res.status === 401 || res.status === 403) break;
  }
  return { erreur: "Gemini — " + erreurs.join(" | ") };
}

async function deduireAvecGemini(titre, env) {
  const payload = {
    contents: [{
      parts: [{
        text: `Pour le manga "${titre}", donne l'auteur (mangaka), le genre principal, et la maison d'édition de l'édition française si elle existe. Donne aussi "titre_original" : le titre sous lequel la série est connue internationalement, en romaji ou en anglais (par exemple "Shingeki no Kyojin" pour "L'Attaque des Titans"). Réponds UNIQUEMENT en JSON strict avec les clés "auteur", "genre", "editeur", "titre_original" (chaînes de caractères, en français pour les trois premières, ou null pour un champ si tu n'es pas raisonnablement sûr — ne devine pas au hasard).`
      }]
    }],
    generationConfig: { response_mime_type: "application/json" }
  };

  const { result, erreur } = await appelGeminiAvecSecours(payload, env);
  if (erreur) return { erreur };
  const texte = result.candidates && result.candidates[0] && result.candidates[0].content
    && result.candidates[0].content.parts && result.candidates[0].content.parts[0]
    && result.candidates[0].content.parts[0].text;
  if (!texte) return { erreur: "Réponse IA vide" };
  try {
    const propre = texte.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const o = JSON.parse(propre);
    return { auteur: o.auteur || null, genre: o.genre || null, editeur: o.editeur || null, titre_original: o.titre_original || null };
  } catch (e) {
    return { erreur: "Réponse IA illisible" };
  }
}

// Une sauvegarde qui ferait passer la collection en dessous de cette proportion est refusée
// (sauf envoi forcé), pour éviter qu'un appareil vide n'écrase la vraie bibliothèque.
const RATIO_MIN_SAUVEGARDE = 0.5;

async function codeValide(fourni, attendu) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(fourni || "")),
    crypto.subtle.digest("SHA-256", enc.encode(attendu))
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function nombreSeries(texte) {
  try {
    const data = JSON.parse(texte);
    return Array.isArray(data) ? data.length : null;
  } catch (e) {
    return null;
  }
}

// --- Recherche d'un livre par ISBN dans le catalogue de la BnF (dépôt légal : tout livre publié en France) ---
function decoderXml(t) {
  return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").trim();
}

function champsDublinCore(xml, nom) {
  const motif = new RegExp("<dc:" + nom + "[^>]*>([\\s\\S]*?)</dc:" + nom + ">", "g");
  return [...xml.matchAll(motif)].map(m => decoderXml(m[1]));
}

// « Miura, Kentarō (1966-2021). Auteur du texte » → « Kentarō Miura »
function nettoyerAuteurBnf(nom) {
  const sansRole = nom.replace(/\s*\([^)]*\)/g, "").replace(/\.\s*[^.]*$/, "").trim();
  const [famille, prenom] = sansRole.split(/,\s*/);
  return prenom ? `${prenom} ${famille}` : famille;
}

// Titre BnF sans la mention de responsabilité ni le nom des auteurs
function nettoyerTitreBnf(titreBrut, auteurs) {
  let titre = (titreBrut || "").split(" / ")[0];
  const sansAccents = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const a of auteurs) {
    if (sansAccents(titre).endsWith(" " + sansAccents(a))) titre = titre.slice(0, titre.length - a.length).trim();
  }
  return titre;
}

function auteursBnf(xml) {
  // Sans doublon, accents ignorés (« Kentaro Miura » et « Kentarō Miura »)
  const auteurs = [];
  const sansAccents = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const a of champsDublinCore(xml, "creator").map(nettoyerAuteurBnf).filter(Boolean)) {
    if (!auteurs.some(x => sansAccents(x) === sansAccents(a))) auteurs.push(a);
  }
  return auteurs;
}

async function interrogerBnf(requete, maximum) {
  const url = "https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&recordSchema=dublincore&maximumRecords=" + maximum + "&query=" + encodeURIComponent(requete);
  const res = await fetch(url, { headers: { "Accept": "application/xml" } });
  if (!res.ok) return { erreur: "BnF HTTP " + res.status };
  const xml = await res.text();
  return { xml, total: Number((xml.match(/numberOfRecords>(\d+)</) || [])[1] || 0) };
}

async function chercherIsbnBnf(isbn) {
  const { xml, total, erreur } = await interrogerBnf(`bib.isbn adj "${isbn}"`, 1);
  if (erreur) return { erreur };
  if (!total) return { trouve: false };
  const auteurs = auteursBnf(xml);
  return {
    trouve: true,
    source: "BnF",
    titre: nettoyerTitreBnf(champsDublinCore(xml, "title")[0], auteurs) || null,
    auteurs,
    editeur: champsDublinCore(xml, "publisher")[0] || null,
    date: champsDublinCore(xml, "date")[0] || null,
    description: champsDublinCore(xml, "description")[0] || champsDublinCore(xml, "format")[0] || null,
    langue: champsDublinCore(xml, "language")[0] || null
  };
}

// Toutes les notices dont le titre contient ces mots (ex. « Berserk prestige »), chez cet éditeur si connu
async function chercherEditionBnf(mots, editeur) {
  let requete = `bib.title all "${mots.replace(/"/g, "")}"`;
  if (editeur) requete += ` and bib.publisher all "${editeur.replace(/"/g, "")}"`;
  const { xml, total, erreur } = await interrogerBnf(requete, 1000);
  if (erreur) return { erreur };
  const notices = xml.split(/<srw:record>/).slice(1).map(bloc => {
    const auteurs = auteursBnf(bloc);
    const isbn = (champsDublinCore(bloc, "identifier").join(" ").match(/97[89]\d{10}/) || [])[0] || null;
    return {
      titre: nettoyerTitreBnf(champsDublinCore(bloc, "title")[0], auteurs),
      editeur: champsDublinCore(bloc, "publisher")[0] || null,
      date: champsDublinCore(bloc, "date")[0] || null,
      isbn
    };
  });
  return { total, notices };
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://biloubils-lab.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Backup-Token, X-Backup-Force",
    };
    const json = (corps, status = 200) => new Response(JSON.stringify(corps), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
    });

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // --- Sauvegarde / restauration de la bibliothèque ---
    if (pathname === "/backup") {
      try {
        if (!env.MANGA_KV) {
          throw new Error("Binding KV 'MANGA_KV' introuvable — vérifie Settings > Bindings sur le Worker.");
        }
        if (!env.BACKUP_TOKEN) {
          throw new Error("Secret 'BACKUP_TOKEN' manquant — ajoute-le dans Settings > Variables and Secrets sur le Worker.");
        }
        if (!(await codeValide(request.headers.get("X-Backup-Token"), env.BACKUP_TOKEN))) {
          return json({ error: "Code de sauvegarde incorrect" }, 401);
        }
        if (request.method === "POST") {
          const body = await request.text();
          const nouveau = nombreSeries(body);
          if (nouveau === null) {
            return json({ error: "Sauvegarde invalide" }, 400);
          }
          const ancienTexte = await env.MANGA_KV.get("bibliotheque");
          const ancien = ancienTexte ? nombreSeries(ancienTexte) : 0;
          const force = request.headers.get("X-Backup-Force") === "1";
          if (!force && ancien > 0 && nouveau < ancien * RATIO_MIN_SAUVEGARDE) {
            return json({ error: "Sauvegarde refusée : elle ferait passer le cloud de " + ancien + " à " + nouveau + " séries.", ancien, nouveau }, 409);
          }
          if (ancienTexte) {
            await env.MANGA_KV.put("bibliotheque_precedente", ancienTexte);
          }
          await env.MANGA_KV.put("bibliotheque", body);
          return json({ ok: true });
        }
        if (request.method === "GET") {
          const data = await env.MANGA_KV.get("bibliotheque");
          return new Response(data || "null", {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response("Method not allowed", { status: 405, headers: corsHeaders });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // --- Livre par ISBN (GET /isbn?isbn=978...) ---
    if (pathname === "/isbn") {
      const isbn = (url.searchParams.get("isbn") || "").replace(/[^0-9Xx]/g, "").toUpperCase();
      if (!/^(\d{13}|\d{9}[\dX])$/.test(isbn)) return json({ erreur: "ISBN invalide" }, 400);
      try {
        const resultat = await chercherIsbnBnf(isbn);
        return json(resultat, resultat.erreur ? 502 : 200);
      } catch (e) {
        return json({ erreur: "BnF : " + e.message }, 502);
      }
    }

    // --- Données de parution Manga Insight (CC BY 4.0), relayées telles quelles avec CORS ---
    // L'app les garde en mémoire une semaine ; Cloudflare en garde une copie 24 h.
    if (pathname === "/mangainsight/core" || pathname === "/mangainsight/rows") {
      const fichier = pathname.endsWith("core") ? "core" : "rows";
      const res = await fetch(`https://mangainsight.fr/data/dashboard/${fichier}.json`, { cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!res.ok) return json({ erreur: "Manga Insight HTTP " + res.status }, 502);
      return new Response(res.body, {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400" }
      });
    }

    // --- Notices BnF d'une édition (GET /edition?mots=Berserk prestige&editeur=Glénat) ---
    if (pathname === "/edition") {
      const mots = (url.searchParams.get("mots") || "").trim();
      if (!mots) return json({ erreur: "Mots manquants" }, 400);
      try {
        const resultat = await chercherEditionBnf(mots, (url.searchParams.get("editeur") || "").trim());
        return json(resultat, resultat.erreur ? 502 : 200);
      } catch (e) {
        return json({ erreur: "BnF : " + e.message }, 502);
      }
    }

    // --- Modèles Gemini disponibles avec la clé (diagnostic, à ouvrir dans un navigateur) ---
    if (pathname === "/modeles") {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        headers: { "x-goog-api-key": env.GEMINI_API_KEY }
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return json({ erreur: "HTTP " + res.status }, 502);
      const modeles = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => m.name.replace("models/", ""));
      return json({ utilises: modelesGemini(env), disponibles: modeles });
    }

    // --- Infos série via Gemini (GET ?titre=... pour tester dans un navigateur, ou POST {titre}) ---
    if (pathname === "/infos") {
      try {
        let titre = null;
        if (request.method === "GET") {
          titre = url.searchParams.get("titre");
        } else if (request.method === "POST") {
          const corps = await request.json().catch(() => ({}));
          titre = corps.titre;
        } else {
          return new Response("Method not allowed", { status: 405, headers: corsHeaders });
        }
        if (!titre) return json({ erreur: "Titre manquant" }, 400);

        const resultat = await deduireAvecGemini(titre, env);
        return json(resultat, resultat.erreur ? 502 : 200);
      } catch (e) {
        return json({ erreur: e.message }, 500);
      }
    }

    // --- Scan IA de jaquette ---
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
      const { mimeType, data } = await request.json();
      if (!data) {
        return json({ error: "Image manquante" }, 400);
      }

      const payload = {
        contents: [{
          parts: [
            { text: "Analyse cette jaquette de manga. Réponds UNIQUEMENT sous forme d'un objet JSON strict avec deux clés exactes : 'titre' (le nom de la série en string) et 'tome' (le numéro du tome en entier, mets 1 si introuvable)." },
            { inline_data: { mime_type: mimeType || "image/jpeg", data } }
          ]
        }],
        generationConfig: { response_mime_type: "application/json" }
      };

      const { result, erreur } = await appelGeminiAvecSecours(payload, env);
      if (erreur) return json({ error: erreur }, 502);
      return json(result);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};
