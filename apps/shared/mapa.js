// Mapa claro e suave (estilo apps de corrida): vetorial OpenFreeMap (grátis, sem chave) desenhado com MapLibre GL
// dentro do Leaflet. Se não houver WebGL ou o OpenFreeMap falhar, cai para o OSM raster "suavizado" por CSS.
const ESTILO_URL = "https://tiles.openfreemap.org/styles/positron";
const PALETA = {
  terra: "#e9eef3", parque: "#dde9df", agua: "#c6dbec", residencial: "#e5eaf0", predio: "#dce3ea",
  rua: "#ffffff", ruaBorda: "#d4dce5", texto: "#6b7785", textoForte: "#4a5563", halo: "#f4f7fa"
};
let estiloCache = null;

async function estiloSuave() {
  if (estiloCache) return estiloCache;
  const s = await (await fetch(ESTILO_URL)).json();
  const pinta = (l, k, v) => { l.paint = l.paint || {}; l.paint[k] = v; };
  for (const l of s.layers) {
    const id = l.id;
    if (l.type === "background") pinta(l, "background-color", PALETA.terra);
    else if (id === "water") pinta(l, "fill-color", PALETA.agua);
    else if (id === "waterway") pinta(l, "line-color", PALETA.agua);
    else if (id === "park" || id === "landcover_wood") pinta(l, "fill-color", PALETA.parque);
    else if (id === "landuse_residential") pinta(l, "fill-color", PALETA.residencial);
    else if (id === "building") { pinta(l, "fill-color", PALETA.predio); pinta(l, "fill-outline-color", PALETA.predio); }
    else if (l.type === "line" && /casing/.test(id)) pinta(l, "line-color", PALETA.ruaBorda);
    else if (l.type === "line" && /highway|road|tunnel/.test(id)) { pinta(l, "line-color", PALETA.rua); pinta(l, "line-opacity", 1); }
    else if (l.type === "line" && /railway/.test(id)) pinta(l, "line-color", "#d9e0e8");
    else if (l.type === "line" && /boundary/.test(id)) pinta(l, "line-color", "#c5ced8");
    else if (l.type === "symbol" && l.paint && "text-color" in l.paint) {
      pinta(l, "text-color", /city|town|village/.test(id) ? PALETA.textoForte : PALETA.texto);
      pinta(l, "text-halo-color", PALETA.halo);
    }
  }
  return (estiloCache = s);
}

function temWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}


// Marcadores no estilo do app
const icone = {
  moto: () => L.divIcon({ className: "", html: '<div class="pin-moto">➤</div>', iconSize: [40, 40], iconAnchor: [20, 20] }),
  retirada: () => L.divIcon({ className: "", html: '<div class="pin pin-a">A</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
  entrega: () => L.divIcon({ className: "", html: '<div class="pin pin-b">B</div>', iconSize: [30, 30], iconAnchor: [15, 15] })
};
const ROTA = { color: "#111111", weight: 5, opacity: .9 };

// Recalcula o tamanho do mapa (use depois de mostrar uma tela que estava escondida).
// Graus no sentido horário a partir do norte. O ícone ➤ aponta para a direita, então subtrai 90.
function orientarMarcador(marker, graus) {
  if (!marker || graus == null || Number.isNaN(graus)) return;
  const el = marker.getElement && marker.getElement();
  const pin = el && el.querySelector(".pin-moto");
  if (pin) pin.style.transform = "rotate(" + (graus - 90) + "deg)";
}

function ajustarMapa(m) {
  if (!m) return;
  m.invalidateSize();
  if (m._gl) { try { m._gl.getMaplibreMap().resize(); m._gl._update(); } catch (e) {} }
}

const mapasVivos = new Set();
function criarMapa(id, opcoes = {}) {
  const m = L.map(id, { zoomControl: false, attributionControl: true, ...opcoes }).setView(PELOTAS, 14);
  m.attributionControl.setPrefix(false);
  const raster = () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, className: "tiles-suaves", attribution: "© OpenStreetMap" }).addTo(m);
  if (window.maplibregl && L.maplibreGL && temWebGL()) {
    estiloSuave()
      .then(style => { m._gl = L.maplibreGL({ style, attribution: '© <a href="https://openfreemap.org">OpenFreeMap</a> © OpenStreetMap' }).addTo(m); })
      .catch(raster);
  } else raster();
  mapasVivos.add(m);
  setTimeout(() => ajustarMapa(m), 80);
  return m;
}

function redimensionarMapas() {
  mapasVivos.forEach(m => ajustarMapa(m));
}
window.addEventListener("resize", redimensionarMapas);
window.addEventListener("orientationchange", () => setTimeout(redimensionarMapas, 180));
window.addEventListener("eja-insets", redimensionarMapas);
if (window.visualViewport) window.visualViewport.addEventListener("resize", redimensionarMapas);

// Folha inferior com três paradas: colapsada, meio, cheia.
// O arraste começa só na alça (toque ou mouse), para o mapa continuar recebendo o pan.
function ligarFolha(folha, opts) {
  if (!folha || folha.dataset.folha) return;
  opts = opts || {};
  folha.dataset.folha = "1";
  folha.classList.add("folha-viva");
  const alca = folha.querySelector(".alca");
  if (!alca) return;
  alca.style.touchAction = "none";
  let arrastando = false, ponteiro = null, y0 = 0, h0 = 0, colCache = 0;

  function vhAgora() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }
  function medirColapsada(vh) {
    if (typeof opts.colapsada === "number") return opts.colapsada;
    if (colCache && arrastando) return colCache;
    const snap = folha.dataset.snap;
    const h0s = folha.style.height, m0s = folha.style.maxHeight, t0s = folha.style.transition;
    folha.dataset.snap = "colapsada";
    folha.style.transition = "none";
    folha.style.height = "auto";
    folha.style.maxHeight = "none";
    const h = folha.scrollHeight;
    folha.style.height = h0s;
    folha.style.maxHeight = m0s;
    folha.style.transition = t0s;
    if (snap) folha.dataset.snap = snap;
    colCache = Math.max(150, Math.min(h || 220, Math.round(vh * 0.46)));
    return colCache;
  }
  function alturas() {
    const vh = vhAgora();
    const col = medirColapsada(vh);
    const meio = Math.round(vh * 0.52);
    const cheia = Math.round(Math.min(vh * 0.88, vh - 24));
    const a = col, b = Math.max(a + 36, meio), c = Math.max(b + 36, cheia);
    return [a, b, c];
  }
  function publicar(h) {
    if (!folha.getClientRects().length) return;
    document.documentElement.style.setProperty("--folha-altura", h + "px");
  }
  function aplicar(h, animar) {
    const alts = alturas();
    h = Math.max(alts[0], Math.min(alts[2], h));
    folha.style.transition = animar ? "height .22s ease" : "none";
    folha.style.height = h + "px";
    folha.style.maxHeight = h + "px";
    const nome = h <= (alts[0] + alts[1]) / 2 ? "colapsada" : h <= (alts[1] + alts[2]) / 2 ? "meio" : "cheia";
    folha.dataset.snap = nome;
    publicar(h);
    return h;
  }
  function avisar() {
    window.dispatchEvent(new CustomEvent("eja-folha", { detail: { folha } }));
    setTimeout(redimensionarMapas, 240);
  }
  function soltar(h) {
    const alts = alturas();
    let melhor = alts[0], dist = Infinity;
    alts.forEach(a => { const d = Math.abs(a - h); if (d < dist) { dist = d; melhor = a; } });
    aplicar(melhor, true);
    avisar();
  }
  folha._ejaIr = function (indice) {
    const alts = alturas();
    aplicar(alts[Math.max(0, Math.min(alts.length - 1, indice | 0))], true);
    avisar();
  };
  alca.addEventListener("pointerdown", ev => {
    if (ev.button != null && ev.button !== 0) return;
    arrastando = true;
    ponteiro = ev.pointerId;
    y0 = ev.clientY;
    h0 = parseFloat(folha.style.height) || folha.getBoundingClientRect().height;
    try { alca.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
    ev.stopPropagation();
  });
  alca.addEventListener("pointermove", ev => {
    if (!arrastando || ev.pointerId !== ponteiro) return;
    aplicar(h0 + (y0 - ev.clientY), false);
    ev.preventDefault();
    ev.stopPropagation();
  });
  function fim(ev) {
    if (!arrastando || (ev && ev.pointerId != null && ev.pointerId !== ponteiro)) return;
    arrastando = false;
    const dy = y0 - (ev && ev.clientY != null ? ev.clientY : y0);
    if (ev && ev.type !== "pointercancel" && Math.abs(dy) < 12) {
      const ordem = ["colapsada", "meio", "cheia"];
      const i = Math.max(0, ordem.indexOf(folha.dataset.snap));
      folha._ejaIr((i + 1) % 3);
      return;
    }
    soltar(parseFloat(folha.style.height) || folha.getBoundingClientRect().height);
  }
  alca.addEventListener("pointerup", fim);
  alca.addEventListener("pointercancel", fim);
  const inicial = opts.inicial == null ? 0 : opts.inicial;
  aplicar(alturas()[inicial], false);
  window.addEventListener("resize", () => {
    if (!folha.dataset.snap) return;
    colCache = 0;
    folha._ejaIr(folha.dataset.snap === "cheia" ? 2 : folha.dataset.snap === "meio" ? 1 : 0);
  });
}

function folhaIr(folha, indice) {
  if (folha && folha._ejaIr) folha._ejaIr(indice);
}
