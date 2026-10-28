// Configuração compartilhada pelos dois apps É-Já.
// A chave "publishable" é pública: pode ficar no app. A segurança vem do RLS no Supabase.
const SUPABASE_URL = "https://waalgvcywtfnrrpkrhti.supabase.co";
const SUPABASE_KEY = "sb_publishable_WyS8WAbEYuFRreO-1G32qA_ppERhliT";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const PELOTAS = [-31.7719, -52.3426];
// Área em que a entrega pode ser confirmada. Mude só este valor.
// bbox: oeste, sul, leste, norte (município de Pelotas, aproximado).
// A busca também lista vizinhos (Turuçu, Capão do Leão, Morro Redondo, Rio Grande),
// mas esses ficam marcados e não confirmam.
const AREA_ENTREGA = {
  nome: "Pelotas",
  bbox: [-52.60, -31.96, -52.02, -31.50]
};
const $ = id => document.getElementById(id);
const money = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const show = (id, on) => $(id).classList.toggle("hidden", !on);
function erroMsg(e) {
  const m = (e && e.message) || String(e);
  if (m.includes("Invalid login")) return "E-mail ou senha incorretos.";
  if (m.includes("already registered")) return "Este e-mail já tem cadastro. Faça login.";
  if (m.includes("Email not confirmed")) return "Confirme seu e-mail pelo link que enviamos.";
  return m;
}
// Mude para true DEPOIS de colocar o google-services.json do Firebase em android/app/ (senão o app pode fechar).
const FIREBASE_PRONTO = false;
// Mapa: tiles padrão do OpenStreetMap, escurecidos por CSS (style.css .leaflet-tile-pane) — grátis, sem chave.
// Respeite a política de uso do OSM (https://operations.osmfoundation.org/policies/tiles/); com volume alto, use um provedor pago.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILES_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const COR = { laranja: "#ff6a00", branco: "#f5f5f5", verde: "#2ecc71" };
// Site público com os documentos legais e a página de exclusão de conta
const SITE = "https://eja-site.pages.dev";
const APP_VERSAO = "1.13";
const LINK_DOC = { termos_cliente: SITE + "/termos/", termos_motoboy: SITE + "/termos-motoboy/", privacidade: SITE + "/privacidade/" };
const NOME_DOC = { termos_cliente: "Termos de Uso", termos_motoboy: "Termos do Motoboy Parceiro", privacidade: "Política de Privacidade" };
