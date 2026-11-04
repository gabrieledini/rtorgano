// Scarica l'organigramma della Giunta regionale toscana partendo da 50112
// e scrive data/organigramma.json. Uso: node scripts/crawl.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BASE = "https://www301.regione.toscana.it/bancadati/uffici/Strutture.xml?cmu=";
const ROOT = "50112";
const OUT = "data/organigramma.json";
const CONCURRENCY = 4;

const decode = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map(m => m[1]);
const f = (b, tag) => decode((b.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || "").replace(/\s+/g, " ").trim();

async function fetchXml(cmu) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(BASE + cmu, { headers: { "User-Agent": "organigramma-rt/1.0" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return (await r.text()).replace(/<meta-info>[\s\S]*?<\/meta-info>/, "");
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function getStruttura(cmu) {
  let xml = await fetchXml(cmu);
  if (!blocks(xml, "struttura").length && /^0/.test(cmu)) xml = await fetchXml(String(parseInt(cmu, 10)));
  const s = blocks(xml, "struttura")[0] || "";
  let incaricati = blocks(xml, "incaricato").map(i => ({
    ruolo: f(i, "DESCRIZIONE"), nome: f(i, "NOME"), cognome: f(i, "COGNOME"), codice: f(i, "CODICE"), atto: f(i, "ATTO_DESCR")
  }));
  if (!incaricati.length) incaricati = blocks(xml, "incaricato_realtime").map(i => ({
    ruolo: "", nome: f(i, "NOME"), cognome: f(i, "COGNOME"), codice: f(i, "CODICE"), atto: f(i, "PROVENIENZA_ATTO_DESCR")
  }));
  return {
    id: cmu,
    nome: f(s, "NOME"),
    tipo: f(s, "TIPOLOGIA") || f(s, "TIPO"),
    sottotipo: f(s, "TIPO"),
    descrizione: f(s, "DESCRIZIONE"),
    incaricati: incaricati.filter(i => i.cognome || i.nome),
    contatti: blocks(xml, "incaricato_extra").map(e => ({
      competenze: f(e, "COMPETENZE"), telefono: f(e, "TELEFONO"), email: f(e, "EMAIL"), pec: f(e, "PEC"), indirizzo: f(e, "INDIRIZZO")
    })).filter(c => c.telefono || c.email || c.pec || c.indirizzo),
    figli: blocks(xml, "strutturafiglio").map(x => ({ id: f(x, "CODICE"), nome: f(x, "NOME"), tipo: f(x, "TIPO"), livello: +f(x, "LIVELLO") || null }))
  };
}

const store = new Map(), hint = new Map(), errori = [];
const queue = [ROOT], seen = new Set(queue);
let active = 0;

async function worker() {
  for (;;) {
    const id = queue.shift();
    if (id === undefined) { if (active === 0) return; await new Promise(r => setTimeout(r, 50)); continue; }
    active++;
    try {
      const n = await getStruttura(id);
      const h = hint.get(id);
      if (h) { n.nome ||= h.nome; n.tipo ||= h.tipo; n.livello = h.livello; }
      store.set(id, n);
      for (const c of n.figli) {
        hint.set(c.id, c);
        if (c.id && !seen.has(c.id)) { seen.add(c.id); queue.push(c.id); }
      }
    } catch (e) {
      const h = hint.get(id) || {};
      store.set(id, { id, nome: h.nome || id, tipo: h.tipo || "", livello: h.livello, descrizione: "", incaricati: [], contatti: [], figli: [], errore: e.message });
      errori.push(id);
    } finally {
      active--;
      if (store.size % 25 === 0) console.log(`${store.size}/${seen.size}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (!store.get(ROOT) || store.get(ROOT).errore) { console.error("Radice non letta, esco senza scrivere."); process.exit(1); }
if (errori.length > store.size * 0.1) { console.error(`Troppi errori (${errori.length}/${store.size}), esco senza scrivere.`); process.exit(1); }

const nodi = [...store.values()].sort((a, b) => a.id.localeCompare(b.id));

// Se i dati non sono cambiati non riscrive il file (niente commit inutili)
try {
  const old = JSON.parse(await readFile(OUT, "utf8"));
  if (JSON.stringify(old.nodi) === JSON.stringify(nodi)) { console.log("Nessuna variazione."); process.exit(0); }
} catch {}

await mkdir("data", { recursive: true });
await writeFile(OUT, JSON.stringify({ generato: new Date().toISOString(), radice: ROOT, nodi }, null, 1) + "\n");
console.log(`Scritte ${nodi.length} strutture, errori: ${errori.length}`);
