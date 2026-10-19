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

// Cria um mapa Leaflet com o fundo suave. Marcadores, rotas e fitBounds continuam sendo do Leaflet.
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
  setTimeout(() => m.invalidateSize(), 100);
  return m;
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
  m.invalidateSize();
  if (m._gl) { try { m._gl.getMaplibreMap().resize(); m._gl._update(); } catch {} }
}
