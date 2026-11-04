// Proxy verso la banca dati "Uffici" della Regione Toscana.
// Accetta solo ?cmu=<cifre> per non diventare un open proxy.
const BASE = "https://www301.regione.toscana.it/bancadati/uffici/Strutture.xml?cmu=";

export default async (req) => {
  const cmu = new URL(req.url).searchParams.get("cmu") || "";
  if (!/^\d{1,8}$/.test(cmu)) {
    return new Response("Parametro cmu non valido", { status: 400 });
  }
  try {
    const r = await fetch(BASE + cmu, {
      headers: { "User-Agent": "organigramma-rt/1.0", Accept: "application/xml" },
    });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return new Response("Errore upstream: " + e.message, { status: 502 });
  }
};

export const config = { path: "/api/strutture" };
