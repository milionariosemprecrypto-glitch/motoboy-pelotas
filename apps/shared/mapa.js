// Mapa claro e suave (estilo apps de corrida): vetorial OpenFreeMap (grátis, sem chave) desenhado com MapLibre GL
// dentro do Leaflet. Se não houver WebGL ou o OpenFreeMap falhar, cai para o OSM raster "suavizado" por CSS.
const ESTILO_URL = "https://tiles.openfreemap.org/styles/positron";
const PALETA = {
  terra: "#eceff3", parque: "#e3ebe4", agua: "#d5e3ee", residencial: "#e7ebf0", predio: "#e0e5eb",
  rua: "#fbfcfd", ruaBorda: "#d7dee6", texto: "#8b95a1", textoForte: "#5c6773", halo: "#f4f6f8"
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
    else if (l.type === "symbol" && /poi|housenum|mountain|airport|rail|oneway|entrance/.test(id)) {
      l.layout = l.layout || {};
      l.layout.visibility = "none";
    } else if (l.type === "symbol" && l.paint && "text-color" in l.paint) {
      pinta(l, "text-color", /city|town|village/.test(id) ? PALETA.textoForte : PALETA.texto);
      pinta(l, "text-halo-color", PALETA.halo);
    }
  }
  return (estiloCache = s);
}

function temWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}


// Rota preta grossa, pontas e emendas arredondadas, para aparecer no mapa apagado.
const ROTA = { color: "#111111", weight: 7, opacity: 1 };

function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function nomeCurto(nome) {
  return escHtml(String(nome || "Pelotas").split("·")[0].trim());
}
function htmlRetirada(nome, eta) {
  const badge = eta ? '<b class="eta-badge">' + escHtml(eta) + " MIN</b>" : "";
  return '<div class="uber-pickup"><div class="uber-balao"><span>' + nomeCurto(nome) + "</span>" + badge +
    '</div><div class="uber-halo"></div><i class="pin-a"></i></div>';
}
function htmlEntrega(nome) {
  return '<div class="uber-drop"><div class="uber-balao"><span>' + nomeCurto(nome) + '</span></div><i class="pin-b"></i></div>';
}
function htmlMoto() {
  return '<div class="seta-moto pin-moto"><span></span></div>';
}
function htmlPontoUsuario() {
  return '<div class="eu-ponto"></div>';
}
function htmlAlvo(coleta) {
  return coleta ? '<div class="uber-pickup"><div class="uber-halo"></div><i class="pin-a"></i></div>'
    : '<div class="uber-drop"><i class="pin-b"></i></div>';
}

// A seta aponta para o norte em 0°. No modo "sentido da moto" o mapa já girou, então a seta fica em pé.
function orientarMarcador(marker, graus, bearingMapa) {
  if (!marker || graus == null || Number.isNaN(graus)) return;
  const el = marker.getElement && marker.getElement();
  const seta = el && el.querySelector(".seta-moto span");
  if (!seta) return;
  const rel = graus - (bearingMapa || 0);
  seta.style.transform = "rotate(" + rel + "deg)";
}

function ajustarMapa(m) {
  if (!m) return;
  if (m.invalidateSize) m.invalidateSize();
  if (m.resize) m.resize();
}

const mapasVivos = new Set();
function ligarWorkerMapa() {
  if (!window.maplibregl || typeof maplibregl.setWorkerUrl !== "function" || window.__ejaWorker) return;
  maplibregl.setWorkerUrl("shared/vendor/maplibre-gl-csp-worker.js");
  window.__ejaWorker = true;
}
function estadoMapa(el, texto) {
  if (!el) return;
  let n = el.querySelector(".mapa-estado");
  if (!texto) { if (n) n.remove(); return; }
  if (!n) {
    n = document.createElement("div");
    n.className = "mapa-estado";
    el.append(n);
  }
  n.textContent = texto;
}
function criarMapa(id, opcoes = {}) {
  ligarWorkerMapa();
  let m;
  try {
    if (window.maplibregl && temWebGL()) m = criarMapaGL(id, opcoes);
  } catch (e) { m = null; }
  if (!m) m = criarMapaLeaflet(id, opcoes);
  mapasVivos.add(m);
  setTimeout(() => ajustarMapa(m), 60);
  return m;
}

function redimensionarMapas() {
  mapasVivos.forEach(m => ajustarMapa(m));
}
// O teclado fica por cima da WebView (adjustNothing). Estas variáveis servem
// folhas e chat. A tela Planeje sua entrega não as usa: a caixa tem altura fixa.
let alturaCheia = 0;
function lerPxVar(nome) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nome));
  return Number.isFinite(v) ? v : 0;
}
function medirTeclado() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const ime = lerPxVar("--eja-ime");
  const topo = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
  const alturaVv = vv ? Math.max(0, Math.round(vv.height)) : window.innerHeight;
  if (window.innerHeight >= alturaCheia) alturaCheia = window.innerHeight;
  const encolheu = Math.max(0, alturaCheia - window.innerHeight);
  const sobrepoe = Math.max(0, Math.round(window.innerHeight - alturaVv - topo));
  const imeAinda = Math.max(0, Math.round(ime - encolheu - sobrepoe));
  const teclado = Math.max(sobrepoe, imeAinda);
  const alturaPainel = Math.max(0, alturaVv - imeAinda);
  root.style.setProperty("--teclado", teclado + "px");
  root.style.setProperty("--vv-topo", topo + "px");
  root.style.setProperty("--vv-altura", alturaPainel + "px");
  root.classList.toggle("teclado-aberto", teclado > 0);
  return teclado;
}
function aoMudarViewport() {
  medirTeclado();
  redimensionarMapas();
  const el = document.activeElement;
  if (!el || !el.matches || !el.matches("input, textarea, select")) return;
  if (el.closest && el.closest("#telaPlano") && typeof window.encaixarBusca === "function") {
    window.encaixarBusca(el);
    return;
  }
  setTimeout(() => {
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
  }, 60);
}
window.addEventListener("resize", aoMudarViewport);
window.addEventListener("orientationchange", () => { alturaCheia = 0; setTimeout(aoMudarViewport, 180); });
window.addEventListener("eja-insets", aoMudarViewport);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", aoMudarViewport);
  window.visualViewport.addEventListener("scroll", medirTeclado);
}
document.addEventListener("focusin", ev => {
  const el = ev.target;
  if (!el || !el.matches || !el.matches("input, textarea, select")) return;
  if (el.closest && el.closest("#telaPlano") && typeof window.encaixarBusca === "function") window.encaixarBusca(el);
  setTimeout(aoMudarViewport, 280);
});
medirTeclado();

function ouvintes(alvo) {
  const mapa = {};
  alvo.on = function (ev, fn) {
    (mapa[ev] = mapa[ev] || []).push(fn);
    return alvo;
  };
  alvo._emitir = function (ev) {
    (mapa[ev] || []).forEach(fn => { try { fn(); } catch (e) {} });
  };
  return alvo;
}

function caixaDe(pts) {
  let s = 90, n = -90, o = 180, l = -180;
  (pts || []).forEach(p => {
    const lat = Array.isArray(p) ? +p[0] : +p.lat;
    const lng = Array.isArray(p) ? +p[1] : +p.lng;
    if (!isFinite(lat) || !isFinite(lng)) return;
    s = Math.min(s, lat); n = Math.max(n, lat); o = Math.min(o, lng); l = Math.max(l, lng);
  });
  const caixa = {
    s, n, o, l,
    pad(f) {
      const dy = (n - s) * f, dx = (l - o) * f;
      return caixaDe([[s - dy, o - dx], [n + dy, l + dx]]);
    },
    contains(ll) {
      const lat = Array.isArray(ll) ? +ll[0] : +ll.lat;
      const lng = Array.isArray(ll) ? +ll[1] : +ll.lng;
      return lat >= s && lat <= n && lng >= o && lng <= l;
    }
  };
  return caixa;
}

function criarMapaGL(id, opcoes) {
  const el = typeof id === "string" ? document.getElementById(id) : id;
  if (!el) return null;
  el.classList.add("eja-mapa");
  const pitch = opcoes.pitch || 0;
  const rotacao = opcoes.rotacao != null ? !!opcoes.rotacao : pitch > 0;
  const faixa = faixaDoMapa(opcoes);
  const limite = faixa ? faixa.caixa : null;
  const folga = faixa ? faixa.folga : 0;
  const gl = new maplibregl.Map({
    container: el,
    style: { version: 8, sources: {}, layers: [{ id: "fundo", type: "background", paint: { "background-color": PALETA.terra } }] },
    center: [PELOTAS[1], PELOTAS[0]],
    zoom: opcoes.zoom || 14,
    pitch, bearing: 0, maxPitch: rotacao ? 65 : 0,
    attributionControl: true,
    dragPan: true, dragRotate: rotacao, touchZoomRotate: true, touchPitch: pitch > 0 && rotacao,
    pitchWithRotate: false, doubleClickZoom: true, scrollZoom: true, cooperativeGestures: false,
    maxBounds: limite ? [[limite[0] - folga, limite[1] - folga], [limite[2] + folga, limite[3] + folga]] : undefined
  });
  if (!rotacao && gl.touchZoomRotate && gl.touchZoomRotate.disableRotation) gl.touchZoomRotate.disableRotation();
  if (!rotacao && gl.dragRotate && gl.dragRotate.disable) gl.dragRotate.disable();
  const fila = [];
  let estiloPronto = false;
  let geracaoEstilo = 0;
  function quandoPronto(fn) { if (estiloPronto) fn(); else fila.push(fn); }
  // No MapLibre 4, setStyle não dispara style.load de novo, e isStyleLoaded fica
  // falso até o idle. A rota entra quando o estilo já tem camadas.
  function aplicarEstilo(style) {
    const minha = ++geracaoEstilo;
    let aplicado = false;
    const drenar = () => {
      if (!aplicado || minha !== geracaoEstilo || estiloPronto) return;
      const st = gl.getStyle();
      if (!st || !(st.layers || []).length) return;
      const pendente = fila.splice(0);
      const falhou = [];
      pendente.forEach(fn => { try { fn(); } catch (e) { falhou.push(fn); } });
      if (falhou.length) { fila.unshift(...falhou); return; }
      estiloPronto = true;
      gl.off("styledata", drenar);
      gl.off("idle", drenar);
    };
    gl.on("styledata", drenar);
    gl.on("idle", drenar);
    try { gl.setStyle(style, { diff: false }); }
    catch (e) { gl.setStyle(style); }
    aplicado = true;
    drenar();
  }
  estadoMapa(el, "Carregando ruas…");
  const avisoMapa = setTimeout(() => {
    const st = gl.getStyle && gl.getStyle();
    const ruas = st && (st.layers || []).some(l => l.type !== "background");
    if (!ruas) estadoMapa(el, "O mapa não carregou as ruas. Verifique a internet.");
  }, 8000);
  function ruasVisiveis() {
    const st = gl.getStyle && gl.getStyle();
    return !!(st && (st.layers || []).some(l => l.type !== "background"));
  }
  gl.on("idle", () => { if (ruasVisiveis()) { clearTimeout(avisoMapa); estadoMapa(el, ""); } });
  gl.on("error", ev => {
    const msg = ev && ev.error && ev.error.message || "";
    if (/sprite|glyph|image|AJAXError/i.test(msg) && ruasVisiveis()) return;
    estadoMapa(el, "O mapa não carregou as ruas." + (msg ? " " + msg : ""));
  });
  estiloSuave().then(aplicarEstilo).catch(() => aplicarEstilo({
    version: 8,
    sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  }));
  const api = ouvintes({
    gl, _eja: "gl",
    getContainer: () => el,
    getZoom: () => gl.getZoom(),
    getPitch: () => gl.getPitch(),
    getBearing: () => gl.getBearing(),
    getCenter: () => { const c = gl.getCenter(); return { lat: c.lat, lng: c.lng }; },
    getBounds: () => { const b = gl.getBounds(); return caixaDe([[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]); },
    resize() { gl.resize(); },
    invalidateSize() { gl.resize(); },
    setView(ll, zoom, opcoes) {
      const o = opcoes || {};
      const cam = {
        center: [ll[1], ll[0]],
        zoom: zoom == null ? gl.getZoom() : zoom,
        pitch: o.pitch == null ? gl.getPitch() : o.pitch,
        bearing: o.bearing == null ? gl.getBearing() : o.bearing
      };
      if (o.padding) cam.padding = o.padding;
      if (o.duration) gl.easeTo(Object.assign({ duration: o.duration }, cam));
      else gl.jumpTo(cam);
      return api;
    },
    panTo(ll) { gl.easeTo({ center: [ll[1], ll[0]], duration: 500 }); return api; },
    easePara(o) {
      const alvo = {
        center: [o.lng, o.lat],
        zoom: o.zoom == null ? gl.getZoom() : o.zoom,
        bearing: o.bearing == null ? gl.getBearing() : o.bearing,
        pitch: o.pitch == null ? gl.getPitch() : o.pitch,
        duration: o.duration == null ? 700 : o.duration,
        essential: false
      };
      if (o.padding) alvo.padding = o.padding;
      gl.easeTo(alvo);
    },
    project(ll) { return gl.project([ll[1], ll[0]]); },
    containerPointToLatLng(pt) { const p = gl.unproject(pt); return { lat: p.lat, lng: p.lng }; },
    enquadrar(pts, pad, duracao) {
      if (!pts || pts.length < 2) {
        if (pts && pts[0]) api.setView(pts[0], Math.min(16, gl.getZoom() || 15));
        return;
      }
      const b = caixaDe(pts);
      gl.fitBounds([[b.o, b.s], [b.l, b.n]], {
        padding: pad, maxZoom: 16, duration: duracao == null ? 650 : duracao, linear: false,
        pitch: gl.getPitch(), bearing: gl.getBearing()
      });
    },
    marcador(ll, html) {
      const node = document.createElement("div");
      node.className = "eja-marcador";
      node.innerHTML = html;
      const mk = new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([ll[1], ll[0]]).addTo(gl);
      return {
        addTo() { return this; },
        remove() { mk.remove(); },
        getElement() { return node; },
        setLatLng(p) { mk.setLngLat([p[1], p[0]]); }
      };
    },
    linha(pts, estilo) {
      const id = "rota-" + Math.random().toString(36).slice(2, 8);
      const dados = () => ({ type: "Feature", geometry: { type: "LineString", coordinates: (pts || []).map(p => [p[1], p[0]]) } });
      const por = () => {
        if (!gl.getStyle()) return;
        if (gl.getSource(id)) { gl.getSource(id).setData(dados()); return; }
        gl.addSource(id, { type: "geojson", data: dados() });
        const paint = {
          "line-color": (estilo && estilo.color) || "#111111",
          "line-width": (estilo && estilo.weight) || 7,
          "line-opacity": estilo && estilo.opacity != null ? estilo.opacity : 1
        };
        if (estilo && estilo.tracejada) paint["line-dasharray"] = [1.4, 1.6];
        gl.addLayer({
          id, type: "line", source: id,
          layout: { "line-cap": "round", "line-join": "round" },
          paint
        });
      };
      quandoPronto(por);
      return { remove() { quandoPronto(() => { if (gl.getLayer(id)) gl.removeLayer(id); if (gl.getSource(id)) gl.removeSource(id); }); } };
    }
  });
  // Só um gesto de verdade solta o "seguir". easeTo/fitBounds também disparam rotatestart.
  const gesto = ev => { if (ev && ev.originalEvent) api._emitir("dragstart"); };
  const solta = ev => { if (ev && ev.originalEvent) api._emitir("dragend"); };
  gl.on("dragstart", gesto);
  gl.on("dragend", solta);
  gl.on("rotatestart", gesto);
  gl.on("zoomstart", gesto);
  gl.on("pitchstart", gesto);
  gl.on("move", () => api._emitir("move"));
  gl.on("moveend", () => api._emitir("moveend"));
  return api;
}

// limite (bbox da busca) deixa o pino sair de Pelotas para mostrar "fora da área".
// Sem ele, limiteCidade continua no retângulo da entrega.
function faixaDoMapa(opcoes) {
  opcoes = opcoes || {};
  if (opcoes.limite && opcoes.limite.length === 4) return { caixa: opcoes.limite, folga: 0.05 };
  if (opcoes.limiteCidade && typeof PELOTAS_BBOX !== "undefined") return { caixa: PELOTAS_BBOX, folga: 0.06 };
  return null;
}
function criarMapaLeaflet(id, opcoes) {
  const m = L.map(id, {
    zoomControl: false, attributionControl: true,
    dragging: true, touchZoom: true, scrollWheelZoom: true, doubleClickZoom: true, boxZoom: true
  }).setView(PELOTAS, opcoes.zoom || 14);
  const faixa = faixaDoMapa(opcoes);
  if (faixa && window.L) {
    const c = faixa.caixa, f = faixa.folga;
    m.setMaxBounds(L.latLngBounds([c[1] - f, c[0] - f], [c[3] + f, c[2] + f]));
  }
  m.attributionControl.setPrefix(false);
  m.getContainer().classList.add("eja-mapa");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "tiles-suaves", attribution: "© OpenStreetMap" }).addTo(m);
  const baseOn = m.on.bind(m);
  m.on = function (ev, fn) { baseOn(ev, fn); return m; };
  m.getPitch = () => 0;
  m.getBearing = () => 0;
  m.easePara = o => { m.setView([o.lat, o.lng], o.zoom == null ? m.getZoom() : o.zoom, { duration: o.duration == null ? 500 : o.duration, padding: o.padding, bearing: o.bearing }); };
  m.enquadrar = (pts, pad) => {
    if (!pts || !pts.length) return;
    if (pts.length === 1) { m.setView(pts[0], 15); return; }
    m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom], maxZoom: 16, animate: true });
  };
  m.marcador = (ll, html) => L.marker(ll, {
    icon: L.divIcon({ className: "eja-marcador", html, iconSize: [22, 22], iconAnchor: [11, 11] })
  }).addTo(m);
  m.linha = (pts, estilo) => L.polyline(pts, Object.assign({
    color: "#111", weight: 7, opacity: 1, lineCap: "round", lineJoin: "round",
    dashArray: estilo && estilo.tracejada ? "2 10" : null
  }, estilo || {})).addTo(m);
  const ver = m.setView.bind(m);
  m.setView = (ll, zoom, opcoes) => {
    ver(ll, zoom, { animate: !!(opcoes && (opcoes.duration || opcoes.animate)) });
    if (opcoes && opcoes.padding) {
      const p = opcoes.padding;
      m.panBy([-((p.left || 0) - (p.right || 0)) / 2, -((p.top || 0) - (p.bottom || 0)) / 2], { animate: false });
    }
    if (opcoes && opcoes.bearing != null && m.setBearing) m.setBearing(opcoes.bearing);
    return m;
  };
  m._eja = "leaflet";
  return m;
}

function colocarMarcador(mapa, lat, lng, html) {
  if (mapa && mapa.marcador) return mapa.marcador([lat, lng], html);
  return null;
}
function colocarLinha(mapa, pts, estilo) {
  if (mapa && mapa.linha) return mapa.linha(pts, estilo || ROTA);
  return null;
}

// Enquadra a rota na faixa visível acima da folha. O padding de baixo é a altura atual da folha.
function paddingRota(m, baixo) {
  const el = m && m.getContainer ? m.getContainer() : null;
  const H = (el && el.clientHeight) || window.innerHeight || 700;
  const W = (el && el.clientWidth) || window.innerWidth || 360;
  let top = Math.min(120, Math.round(H * 0.14));
  let bottom = Math.max(0, baixo || 0) + 18;
  const lado = Math.min(56, Math.round(W * 0.1));
  if (top + bottom > H - 72) {
    const escala = (H - 72) / (top + bottom);
    top = Math.round(top * escala);
    bottom = Math.round(bottom * escala);
  }
  return { top, bottom, left: lado, right: lado };
}
function enquadrarMapa(m, pts, baixo, duracao) {
  if (!m || !pts || !pts.length) return;
  ajustarMapa(m);
  if (m.enquadrar) m.enquadrar(pts, paddingRota(m, baixo), duracao);
  if (duracao !== 0) setTimeout(() => ajustarMapa(m), 280);
}

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
    if (typeof opts.colapsada === "function") {
      const v = opts.colapsada(vh);
      if (v) return v;
    }
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
  let ultimoAviso = 0;
  alca.addEventListener("pointermove", ev => {
    if (!arrastando || ev.pointerId !== ponteiro) return;
    aplicar(h0 + (y0 - ev.clientY), false);
    const agora = Date.now();
    if (agora - ultimoAviso > 70) {
      ultimoAviso = agora;
      window.dispatchEvent(new CustomEvent("eja-folha", { detail: { folha, arrastando: true } }));
    }
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
