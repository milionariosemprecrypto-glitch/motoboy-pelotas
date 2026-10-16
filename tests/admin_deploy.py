"""Verifica o painel admin publicado: admin vê clientes/motoboys/pedidos, aprova/bloqueia, abre documento; não-admin é negado.
Usa usuários descartáveis e apaga tudo no final. Uso: ADMIN_URL=https://eja-admin.pages.dev python3 tests/admin_deploy.py"""
import json, os, sys, uuid, urllib.request
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0, os.path.dirname(__file__))
REF = "waalgvcywtfnrrpkrhti"; URL = f"https://{REF}.supabase.co"; ADMIN_URL = os.environ.get("ADMIN_URL", "https://eja-admin.pages.dev")
def api(m, u, b=None, h=None, raw=None, ct="application/json"):
    r = urllib.request.Request(u, method=m, data=raw if raw is not None else (json.dumps(b).encode() if b is not None else None),
        headers={"Content-Type": ct, "User-Agent": "eja", **(h or {})})
    with urllib.request.urlopen(r) as x: t = x.read().decode(); return json.loads(t) if t else None
MG = {"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"]}
sql = lambda q: api("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, MG)
keys = api("GET", f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true", None, MG)
SR = next(k["api_key"] for k in keys if k["name"] == "service_role")
ANON = next(k["api_key"] for k in keys if k["name"] == "anon")
AD = {"apikey": SR, "Authorization": "Bearer " + SR}
tag = uuid.uuid4().hex[:6]; pw = "T-" + uuid.uuid4().hex[:12]; U = {}
def novo(n, role):
    e = f"adm-{n}-{tag}@teste.local"
    U[n] = (api("POST", f"{URL}/auth/v1/admin/users", {"email": e, "password": pw, "email_confirm": True, "user_metadata": {"role": role, "nome": f"Teste {n} {tag}"}}, AD)["id"], e)
SH = os.environ.get("SHOTS", "/workspace/eja-admin-shots"); os.makedirs(SH, exist_ok=True)
try:
    novo("admin", "cliente"); novo("cliente", "cliente"); novo("moto", "motoboy")
    sql(f"update profiles set role='admin' where id='{U['admin'][0]}'")
    mid = U["moto"][0]; png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
    for n in ("foto", "cnh"): api("POST", f"{URL}/storage/v1/object/motoboy-docs/{mid}/{n}.png", None, AD, raw=png, ct="image/png")
    sql(f"update motoboys set cpf='52998224725', cnh='123', placa='IXA1B23', modelo='Honda CG 160', foto_path='{mid}/foto.png', doc_path='{mid}/cnh.png', enviado_em=now() where id='{mid}'")
    # não-admin chamando RPC admin direto pela API: deve falhar
    tok = api("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": U["cliente"][1], "password": pw}, {"apikey": ANON})["access_token"]
    try: api("POST", f"{URL}/rest/v1/rpc/admin_clientes", {}, {"apikey": ANON, "Authorization": "Bearer " + tok}); print("✘ cliente leu admin_clientes!"); sys.exit(1)
    except urllib.error.HTTPError as e: print("✔ API: não-admin recebe erro", e.code, "em admin_clientes")
    n = api("POST", f"{URL}/rest/v1/rpc/admin_motoboys", {}, {"apikey": ANON}) if False else None
    try: api("POST", f"{URL}/rest/v1/rpc/admin_pedidos", {}, {"apikey": ANON}); print("✘ anon leu!"); sys.exit(1)
    except urllib.error.HTTPError as e: print("✔ API: anônimo recebe erro", e.code, "em admin_pedidos")
    with sync_playwright() as p:
        b = p.chromium.launch()
        def entrar(nome, w=1280, h=800):
            pg = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1.5).new_page(); pg.on("dialog", lambda d: d.accept())
            pg.goto(ADMIN_URL); pg.fill("#authEmail", U[nome][1]); pg.fill("#authSenha", pw); pg.click("#authBtn"); return pg
        c = entrar("cliente"); expect(c.locator("#semAcesso")).to_be_visible(timeout=15000); c.screenshot(path=f"{SH}/admin-negado.png"); print("✔ não-admin: 'Sem acesso'")
        a = entrar("admin")
        row = a.locator("#tbM tr", has_text=f"Teste moto {tag}"); expect(row).to_be_visible(timeout=15000); print("✔ admin lista motoboys")
        a.screenshot(path=f"{SH}/admin-motoboys.png")
        with a.expect_popup() as pop: row.get_by_role("button", name="CNH").click()
        assert "token=" in pop.value.url; pop.value.close(); print("✔ admin abre documento (link assinado)")
        row.get_by_role("button", name="Aprovar").click(); expect(a.locator("#tbM tr", has_text=f"Teste moto {tag}").locator(".st-aprovado")).to_be_visible(timeout=10000); print("✔ aprovar")
        a.locator("#tbM tr", has_text=f"Teste moto {tag}").get_by_role("button", name="Bloquear").click()
        expect(a.locator("#tbM tr", has_text=f"Teste moto {tag}").locator(".st-bloqueado")).to_be_visible(timeout=10000); print("✔ bloquear")
        a.click("#abaC"); expect(a.locator("#tbC tr", has_text=U["cliente"][1])).to_be_visible(timeout=10000); a.screenshot(path=f"{SH}/admin-clientes.png"); print("✔ admin lista clientes")
        a.click("#abaP"); expect(a.locator("#tbP tr").first).to_be_visible(timeout=10000); print("✔ admin lista pedidos")
        b.close()
    print("TUDO OK")
finally:
    for uid, _ in U.values():
        try:
            o = api("POST", f"{URL}/storage/v1/object/list/motoboy-docs", {"prefix": uid}, AD) or []
            if o: api("DELETE", f"{URL}/storage/v1/object/motoboy-docs", {"prefixes": [f"{uid}/{x['name']}" for x in o]}, AD)
        except Exception as e: print("storage:", e)
        api("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, AD)
    ids = ",".join(f"'{u[0]}'" for u in U.values()) or "null"
    print("limpeza:", sql(f"select count(*) restantes from auth.users where id in ({ids})"))
