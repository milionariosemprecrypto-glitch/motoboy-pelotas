"""Testa a página pública de exclusão de conta (Play Store) e as páginas legais do eja-site.
Uso: python3 tests/site_exclusao.py  (requer SUPABASE_ACCESS_TOKEN e playwright)"""
import json, os, urllib.request, uuid
from playwright.sync_api import sync_playwright, expect
REF = "waalgvcywtfnrrpkrhti"; URL = f"https://{REF}.supabase.co"; SITE = os.environ.get("SITE", "https://eja-site.pages.dev")
def api(method, url, body=None, headers=None):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers={"Content-Type": "application/json", "User-Agent": "eja-teste", **(headers or {})})
    with urllib.request.urlopen(r) as resp: t = resp.read().decode(); return json.loads(t) if t else None
MGMT = {"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"]}
sql = lambda q: api("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, MGMT)
SR = next(k["api_key"] for k in api("GET", f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true", None, MGMT) if k["name"] == "service_role")
ADM = {"apikey": SR, "Authorization": "Bearer " + SR}
email, senha = f"site-del-{uuid.uuid4().hex[:6]}@teste.local", "Teste-" + uuid.uuid4().hex[:10]
uid = api("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": senha, "email_confirm": True, "user_metadata": {"role": "motoboy", "nome": "Site Del"}}, ADM)["id"]
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        for slug, texto in [("termos", "intermediação"), ("termos-motoboy", "vínculo empregatício"), ("privacidade", "Art. 11"), ("excluir-conta", "Excluir minha conta")]:
            pg.goto(f"{SITE}/{slug}/"); expect(pg.locator("main")).to_contain_text(texto); print("✔ página", slug)
        pg.fill("#em", email); pg.fill("#se", "errada"); pg.click("#entrar"); expect(pg.locator("#m1")).to_contain_text("incorretos"); print("✔ senha errada recusada")
        pg.fill("#se", senha); pg.click("#entrar"); expect(pg.locator("#passo2")).to_be_visible(timeout=15000)
        assert pg.is_disabled("#excluir"); pg.fill("#conf", "EXCLUIR"); pg.click("#excluir")
        expect(pg.locator("#m2")).to_contain_text("excluída", timeout=20000); print("✔ exclusão pela web")
        b.close()
    r = sql(f"select (select count(*) from auth.users where id='{uid}') u, (select count(*) from motoboys where id='{uid}') m, (select count(*) from solicitacoes_exclusao where origem='web' and concluido_em is not null and user_hash=encode(extensions.digest('{uid}','sha256'),'hex')) reg")[0]
    assert r == {"u": 0, "m": 0, "reg": 1}, r; print("✔ usuário apagado e solicitação registrada"); uid = None
finally:
    if uid: api("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, ADM)
