const ANILIST_URL = "https://graphql.anilist.co";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

const STATUTS = {
  FINISHED: "Terminée",
  RELEASING: "En cours",
  HIATUS: "En pause",
  CANCELLED: "Abandonnée",
  NOT_YET_RELEASED: "En cours"
};

const GENRES_FR = {
  "Action": "Action", "Adventure": "Aventure", "Comedy": "Comédie", "Drama": "Drame",
  "Ecchi": "Ecchi", "Fantasy": "Fantasy", "Horror": "Horreur", "Mahou Shoujo": "Magical girl",
  "Mecha": "Mecha", "Music": "Musique", "Mystery": "Mystère", "Psychological": "Psychologique",
  "Romance": "Romance", "Sci-Fi": "Science-fiction", "Slice of Life": "Tranche de vie",
  "Sports": "Sport", "Supernatural": "Surnaturel", "Thriller": "Thriller"
};

function normaliser(t) {
  return (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function construireResultat(m) {
  const edges = (m.staff && m.staff.edges) || [];
  const noms = [];
  edges.filter(e => /story|art/i.test(e.role || "")).forEach(e => {
    const nom = e.node && e.node.name && e.node.name.full;
    if (nom && !noms.includes(nom)) noms.push(nom);
  });
  if (!noms.length && edges[0] && edges[0].node && edges[0].node.name) {
    noms.push(edges[0].node.name.full);
  }
  const demo = ((m.tags || []).find(t => t.category === "Demographic") || {}).name;
  const genres = (m.genres || []).slice(0, 3).map(g => GENRES_FR[g] || g);
  const genreListe = [demo, ...genres].filter(Boolean);
  return {
    trouve: true,
    anilistId: m.id,
    titreMatch: (m.title && (m.title.romaji || m.title.english)) || null,
    auteur: noms.length ? noms.join(", ") : null,
    genre: genreListe.length ? genreListe.join(", ") : null,
    statut: STATUTS[m.status] || null,
    volumes: m.volumes || null,
    couverture: (m.coverImage && m.coverImage.large) || null,
    score: m.averageScore || null
  };
}

async function appelAniList(query, search) {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "MangaTracker/1.0" },
    body: JSON.stringify({ query, variables: { search } })
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function chercherAniList(titre) {
  const requeteRiche = `query ($search: String) {
    Page(perPage: 8) {
      media(search: $search, type: MANGA, format_in: [MANGA, ONE_SHOT], sort: [SEARCH_MATCH]) {
        id
        title { romaji english native }
        synonyms
        genres
        tags { name category }
        status
        volumes
        popularity
        averageScore
        coverImage { large }
        staff(perPage: 6) { edges { role node { name { full } } } }
      }
    }
  }`;

  const requeteSimple = `query ($search: String) {
    Media(search: $search, type: MANGA) {
      id
      title { romaji english }
      genres
      status
      volumes
      coverImage { large }
      staff(perPage: 6) { edges { role node { name { full } } } }
    }
  }`;

  let { res, json } = await appelAniList(requeteRiche, titre);
  let liste = null;

  if (res.ok && json && !json.errors) {
    liste = (json.data && json.data.Page && json.data.Page.media) || [];
  } else {
    // Requête de secours plus simple si la riche est refusée
    const essai = await appelAniList(requeteSimple, titre);
    if (essai.res.ok && essai.json && !essai.json.errors) {
      const m = essai.json.data && essai.json.data.Media;
      liste = m ? [m] : [];
    } else {
      const messages = (essai.json && essai.json.errors ? essai.json.errors : (json && json.errors) || [])
        .map(e => e.message).join("; ");
      return { erreur: "AniList HTTP " + essai.res.status + (messages ? " : " + messages : "") };
    }
  }

  if (!liste.length) return { trouve: false };

  const cible = normaliser(titre);
  const exacts = liste.filter(m => {
    const t = m.title || {};
    const noms = [t.romaji, t.english, t.native, ...(m.synonyms || [])].map(normaliser);
    return noms.includes(cible);
  });
  const choisi = exacts.length
    ? exacts.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0]
    : liste[0];

  return construireResultat(choisi);
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

async function deduireAvecGemini(titre, env) {
  const payload = {
    contents: [{
      parts: [{
        text: `Pour le manga "${titre}", donne l'auteur (mangaka), le genre principal, et la maison d'édition de l'édition française si elle existe. Réponds UNIQUEMENT en JSON strict avec les clés "auteur", "genre", "editeur" (chaînes de caractères en français, ou null pour un champ si tu n'es pas raisonnablement sûr — ne devine pas au hasard).`
      }]
    }],
    generationConfig: { response_mime_type: "application/json" }
  };

  const modeles = ["gemini-flash-latest", "gemini-2.5-flash"];
  let res, result, dernierMsg = "";

  for (const modele of modeles) {
    ({ res, result } = await appelGemini(modele, payload, env));
    if (res.ok && result) break;
    const msg = result && result.error && result.error.message ? result.error.message : "";
    dernierMsg = "Gemini (" + modele + ") HTTP " + res.status + (msg ? " : " + msg.slice(0, 120) : "");
    if (res.status !== 503 && res.status !== 429) break; // surcharge ou quota : on tente un autre modèle
  }

  if (!res.ok || !result) {
    return { erreur: dernierMsg };
  }
  const texte = result.candidates && result.candidates[0] && result.candidates[0].content
    && result.candidates[0].content.parts && result.candidates[0].content.parts[0]
    && result.candidates[0].content.parts[0].text;
  if (!texte) return { erreur: "Réponse IA vide" };
  try {
    const propre = texte.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const o = JSON.parse(propre);
    return { auteur: o.auteur || null, genre: o.genre || null, editeur: o.editeur || null };
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

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://biloubils-lab.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Backup-Token, X-Backup-Force",
    };
    const json = (corps, status = 200) => new Response(JSON.stringify(corps), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
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

    // --- Infos série via AniList (GET ?titre=... pour tester dans un navigateur, ou POST {titre}) ---
    if (pathname === "/anilist" || pathname === "/infos") {
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

        const resultat = pathname === "/anilist"
          ? await chercherAniList(titre)
          : await deduireAvecGemini(titre, env);
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

      const geminiRes = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(payload)
      });

      const result = await geminiRes.json();
      return json(result, geminiRes.status);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};
