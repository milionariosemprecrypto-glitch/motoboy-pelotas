"""Teste ponta a ponta dos apps web contra o Supabase real.
Cria 3 usuários descartáveis (admin, cliente, motoboy), roda o fluxo completo e apaga tudo no final.
Requer: SUPABASE_ACCESS_TOKEN (Management API) e playwright (pip install playwright; playwright install chromium).
Uso: python3 tests/e2e.py   (a partir da raiz do repo; serve apps/ em http://localhost:8090)
"""
import json, os, re, subprocess, sys, time, urllib.request, uuid
from playwright.sync_api import sync_playwright, expect

REF = "waalgvcywtfnrrpkrhti"; URL = f"https://{REF}.supabase.co"
def api(method, url, body=None, headers=None):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers={"Content-Type": "application/json", "User-Agent": "eja-e2e", **(headers or {})})
    with urllib.request.urlopen(r) as resp: t = resp.read().decode(); return json.loads(t) if t else None
MGMT = {"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"]}
def sql(q): return api("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": q}, MGMT)
SR = next(k["api_key"] for k in api("GET", f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true", None, MGMT) if k["name"] == "service_role")
ADM = {"apikey": SR, "Authorization": "Bearer " + SR}

tag = uuid.uuid4().hex[:6]; senha = "Teste-" + uuid.uuid4().hex[:10]
users = {}
def criar(nome, role):
    email = f"e2e-{nome}-{tag}@teste.local"
    u = api("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": senha, "email_confirm": True,
            "user_metadata": {"role": role, "nome": "E2E " + nome}}, ADM)
    users[nome] = (u["id"], email)
ok = []; 
def passo(nome): print("✔", nome); ok.append(nome)

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8090", "-d", "apps"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    criar("admin", "cliente"); criar("cliente", "cliente"); criar("moto", "motoboy")
    sql(f"update profiles set role='admin' where id='{users['admin'][0]}'")
    open("/tmp/foto.png", "wb").write(bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"))
    with sync_playwright() as p:
        b = p.chromium.launch()
        def ctx(): return b.new_context(geolocation={"latitude": -31.7650, "longitude": -52.3380},
                                        permissions=["geolocation"], locale="pt-BR",
                                        viewport={"width": 360, "height": 640}, device_scale_factor=3)  # 1080x1920
        SHOTS = os.environ.get("SHOTS")   # se definido, salva capturas para a Play Store nessa pasta
        def shot(pg, nome):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.wait_for_timeout(1200); pg.screenshot(path=f"{SHOTS}/{nome}.png")
        def login(pg, app, nome):
            pg.goto(f"http://localhost:8090/{app}")
            pg.fill("#authEmail", users[nome][1]); pg.fill("#authSenha", senha); pg.click("#authBtn")
        cm, cc, ca = ctx(), ctx(), ctx()
        moto, cli, adm = cm.new_page(), cc.new_page(), ca.new_page()
        for pg in (moto, cli, adm): pg.on("dialog", lambda d: d.accept())

        # 1. Motoboy se cadastra com documentos
        moto.goto("http://localhost:8090/motoboy/www/"); expect(moto.locator("#telaAuth")).to_be_visible(timeout=15000); shot(moto, "motoboy-01-login")
        cli.goto("http://localhost:8090/cliente/www/"); expect(cli.locator("#telaAuth")).to_be_visible(timeout=15000); shot(cli, "cliente-01-login")
        login(moto, "motoboy/www/", "moto")
        expect(moto.locator("#telaCadastro")).to_be_visible(timeout=15000)
        shot(moto, "motoboy-02-cadastro")
        moto.fill("#cNome", "E2E Moto"); moto.fill("#cTel", "53999990000"); moto.fill("#cCpf", "52998224725")
        moto.fill("#cCnh", "12345678900"); moto.fill("#cPlaca", "IXA1B23"); moto.fill("#cModelo", "Honda CG 160")
        moto.set_input_files("#cFoto", "/tmp/foto.png"); moto.set_input_files("#cDoc", "/tmp/foto.png")
        moto.click("#cadBtn")
        expect(moto.locator("#telaAguardando")).to_be_visible(timeout=20000); passo("motoboy envia cadastro e fica aguardando aprovação")
        expect(moto.locator("#motoBar")).to_be_hidden(); passo("motoboy pendente não vê botão 'Ficar online'")

        # 2. Admin aprova
        login(adm, "admin/", "admin")
        row = adm.locator("#tbM tr", has_text="E2E Moto")
        expect(row).to_be_visible(timeout=15000); passo("admin vê motoboy pendente")
        with adm.expect_popup() as pop: row.get_by_role("button", name="CNH").click()
        assert "token=" in pop.value.url; pop.value.close(); passo("admin abre documento (URL assinada do bucket privado)")
        shot(adm, "admin-motoboys")
        row.get_by_role("button", name="Aprovar").click()
        expect(adm.locator("#tbM tr", has_text="E2E Moto").locator(".st-aprovado")).to_be_visible(timeout=10000); passo("admin aprova motoboy")

        # 3. Cliente comum não acessa admin
        cli.goto("http://localhost:8090/admin/"); cli.fill("#authEmail", users["cliente"][1]); cli.fill("#authSenha", senha); cli.click("#authBtn")
        expect(cli.locator("#semAcesso")).to_be_visible(timeout=15000); passo("cliente não acessa o painel admin")
        cli.click("#sair"); cli.wait_for_timeout(800)

        # 4. Motoboy aprovado fica online
        moto.reload(); expect(moto.locator("#telaTrabalho")).to_be_visible(timeout=15000)
        moto.click("#disponivel"); expect(moto.locator("#motoStatus")).to_contain_text("online"); passo("motoboy aprovado fica online")
        shot(moto, "motoboy-03-online")

        # 5. Cliente pede com autocomplete + rota
        login(cli, "cliente/www/", "cliente")
        expect(cli.locator("#formCard")).to_be_visible(timeout=15000)
        cli.fill("#origem", "Rua Quinze de Novembro"); cli.locator("#sugOrigem .sugestao").first.click(timeout=20000)
        cli.fill("#destino", "Avenida Bento Gonçalves"); cli.locator("#sugDestino .sugestao").first.click(timeout=20000)
        expect(cli.locator("#valor")).to_contain_text("R$", timeout=20000)
        cli.evaluate("window.scrollTo(0, 120)"); shot(cli, "cliente-02-cotacao")
        print("   cotação:", cli.inner_text("#valor"), "|", cli.inner_text("#km")); passo("autocomplete Pelotas + rota + preço do servidor")
        cli.click("#deliveryForm button[type=submit]")
        expect(cli.locator("#pedido")).to_be_visible(timeout=15000); passo("cliente cria pedido")

        # 6. Motoboy recebe e aceita
        expect(moto.locator("#oferta")).to_be_visible(timeout=20000); passo("motoboy recebe oferta")
        shot(moto, "motoboy-04-oferta")
        moto.click("#oferta button.primary")
        expect(moto.locator("#corrida")).to_be_visible(timeout=15000)
        expect(cli.locator("#estado")).to_contain_text("aceitou", timeout=20000); passo("cliente vê aceite (tempo real)")
        codigo = re.search(r"(\d{4})", cli.inner_text("#estado")).group(1)
        expect(cli.locator("#mapaPedido .leaflet-marker-icon")).to_be_visible(timeout=25000); passo("cliente vê o motoboy no mapa (rastreio ao vivo)")
        cli.locator("#pedido").scroll_into_view_if_needed(); shot(cli, "cliente-03-rastreio"); shot(moto, "motoboy-05-corrida")
        cm.set_geolocation({"latitude": -31.7700, "longitude": -52.3420}); moto.wait_for_timeout(12000)
        n = sql(f"select count(*) c from posicoes po join pedidos p on p.id=po.pedido_id where p.cliente_id='{users['cliente'][0]}' and abs(po.lat+31.77)<0.0005")[0]["c"]
        assert n == 1, "posição não atualizou"; passo("posição do motoboy atualiza (~10 s)")

        # 7. Coleta e entrega com código
        moto.click("#corridaBtn"); expect(cli.locator("#estado")).to_contain_text("coletou", timeout=20000); passo("coleta")
        moto.fill("#codigoEntrega", "0000" if codigo != "0000" else "1111"); moto.click("#corridaBtn")
        expect(moto.locator("#corrida")).to_be_visible(); passo("código errado recusado")
        moto.fill("#codigoEntrega", codigo); moto.click("#corridaBtn")
        expect(cli.locator("#estado")).to_contain_text("concluída", timeout=20000); passo("entrega concluída com código")
        shot(cli, "cliente-04-concluida")
        moto.click("#segGanhos"); expect(moto.locator("#ganhosLista .corrida-item")).to_have_count(1, timeout=10000); passo("ganhos do motoboy")
        shot(moto, "motoboy-06-ganhos")

        # 8. Admin vê pedido
        adm.click("#abaP"); adm.click("#secP button.link")
        expect(adm.locator("#tbP tr", has_text="entregue").first).to_be_visible(timeout=10000); passo("admin vê pedidos")
        shot(adm, "admin-pedidos")
        b.close()
    print(f"\nTODOS OS {len(ok)} PASSOS OK")
finally:
    srv.terminate()
    ids = ",".join(f"'{u[0]}'" for u in users.values())
    if ids:
        sql(f"delete from pedidos where cliente_id in ({ids}) or motoboy_id in ({ids})")
        for uid, _ in users.values():
            try:
                objs = api("POST", f"{URL}/storage/v1/object/list/motoboy-docs", {"prefix": uid}, ADM) or []
                if objs: api("DELETE", f"{URL}/storage/v1/object/motoboy-docs", {"prefixes": [f"{uid}/{o['name']}" for o in objs]}, ADM)
            except Exception as e: print("storage cleanup:", e)
            api("DELETE", f"{URL}/auth/v1/admin/users/{uid}", None, ADM)
        print("limpeza:", sql(f"select (select count(*) from auth.users where id in ({ids})) usuarios, (select count(*) from storage.objects where bucket_id='motoboy-docs') arquivos, (select count(*) from pedidos) pedidos"))
