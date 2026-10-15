// Configuração compartilhada pelos dois apps É-Já.
// A chave "publishable" é pública: pode ficar no app. A segurança vem do RLS no Supabase.
const SUPABASE_URL = "https://waalgvcywtfnrrpkrhti.supabase.co";
const SUPABASE_KEY = "sb_publishable_WyS8WAbEYuFRreO-1G32qA_ppERhliT";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const PELOTAS = [-31.7719, -52.3426];
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
