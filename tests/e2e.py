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
def criar(nome, role, aceite=True):
    email = f"e2e-{nome}-{tag}@teste.local"
    meta = {"role": role, "nome": "E2E " + nome}
    if aceite: meta.update(aceite_termos="true", user_agent="e2e")
    u = api("POST", f"{URL}/auth/v1/admin/users", {"email": email, "password": senha, "email_confirm": True,
            "user_metadata": meta}, ADM)
    users[nome] = (u["id"], email)
ok = []; 
def passo(nome): print("✔", nome); ok.append(nome)

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8090", "-d", "apps"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    criar("admin", "cliente"); criar("cliente", "cliente", aceite=False); criar("moto", "motoboy")
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
        resposta = {"txt": ""}   # texto digitado nos prompt() (motivo, EXCLUIR…)
        for pg in (moto, cli, adm): pg.on("dialog", lambda d: d.accept(resposta["txt"]) if d.type == "prompt" else d.accept())

        # 1. Motoboy se cadastra com documentos
        moto.goto("http://localhost:8090/motoboy/www/"); expect(moto.locator("#telaAuth")).to_be_visible(timeout=15000); shot(moto, "motoboy-01-login")
        cli.goto("http://localhost:8090/cliente/www/"); expect(cli.locator("#telaOnboarding")).to_be_visible(timeout=15000); shot(cli, "cliente-00-boasvindas")
        cli.click("#obPular"); expect(cli.locator("#telaAuth")).to_be_visible(timeout=15000); shot(cli, "cliente-01-login")
        # Aceite (clickwrap): checkbox não marcado bloqueia o cadastro
        cli.click("#authTroca"); expect(cli.locator("#campoAceite")).to_be_visible()
        assert not cli.is_checked("#aceiteTermos") and cli.is_disabled("#authBtn")
        assert cli.get_attribute("#campoAceite a >> nth=0", "href").endswith("/termos/") and cli.get_attribute("#campoAceite a >> nth=1", "href").endswith("/privacidade/")
        cli.check("#aceiteTermos"); assert cli.is_enabled("#authBtn"); shot(cli, "cliente-00b-cadastro-aceite")
        cli.uncheck("#aceiteTermos"); assert cli.is_disabled("#authBtn"); cli.click("#authTroca")
        passo("cadastro exige checkbox de aceite (links separados Termos/Política)")
        login(moto, "motoboy/www/", "moto")
        expect(moto.locator("#telaCadastro")).to_be_visible(timeout=15000)
        shot(moto, "motoboy-02-cadastro")
        moto.fill("#cNome", "E2E Moto"); moto.fill("#cTel", "53999990000"); moto.fill("#cCpf", "52998224725")
        moto.fill("#cCnh", "12345678900"); moto.fill("#cPlaca", "IXA1B23"); moto.fill("#cModelo", "Honda CG 160")
        moto.fill("#cNasc", "2008-01-01"); moto.select_option("#cCat", "A"); moto.fill("#cPrimHab", "2015-03-10"); moto.fill("#cValidade", "2030-01-01")
        moto.set_input_files("#cFoto", "/tmp/foto.png"); moto.set_input_files("#cDoc", "/tmp/foto.png"); moto.set_input_files("#cCurso", "/tmp/foto.png")
        moto.click("#cadBtn"); expect(moto.locator("#cadMsg")).to_contain_text("21 anos"); passo("cadastro recusa menor de 21 anos")
        moto.fill("#cNasc", "1990-05-20"); moto.fill("#cPrimHab", "2025-06-01")
        moto.click("#cadBtn"); expect(moto.locator("#cadMsg")).to_contain_text("2 anos"); passo("cadastro recusa CNH A com menos de 2 anos")
        moto.fill("#cPrimHab", "2015-03-10"); moto.set_input_files("#cAnt", "/tmp/foto.png")
        moto.click("#cadBtn"); expect(moto.locator("#cadMsg")).to_contain_text("autorização"); passo("certidão de antecedentes exige consentimento")
        moto.check("#cAntConsent")
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
        for nome in ("Curso", "Antecedentes"): expect(row.get_by_role("button", name=nome)).to_be_visible()
        expect(row).to_contain_text("(A)"); passo("admin vê curso, antecedentes, categoria e datas da CNH")
        resposta["txt"] = "Documentos conferidos"
        row.get_by_role("button", name="Aprovar").click()
        expect(adm.locator("#tbM tr", has_text="E2E Moto").locator(".st-aprovado")).to_be_visible(timeout=10000); passo("admin aprova motoboy (com motivo)")

        # 2b. Suspensão com motivo + contestação (devido processo)
        resposta["txt"] = ""
        adm.locator("#tbM tr", has_text="E2E Moto").get_by_role("button", name="Suspender").click(); adm.wait_for_timeout(1500)
        expect(adm.locator("#tbM tr", has_text="E2E Moto").locator(".st-aprovado")).to_be_visible(); passo("suspensão sem motivo é recusada")
        resposta["txt"] = "Placa da moto não confere com o documento enviado"
        adm.locator("#tbM tr", has_text="E2E Moto").get_by_role("button", name="Suspender").click()
        expect(adm.locator("#tbM tr", has_text="E2E Moto").locator(".st-bloqueado")).to_be_visible(timeout=10000); passo("admin suspende com motivo")
        moto.reload(); expect(moto.locator("#telaBloqueado")).to_be_visible(timeout=15000)
        expect(moto.locator("#bloqMotivo")).to_contain_text("Placa da moto"); passo("motoboy vê o motivo da suspensão")
        moto.fill("#contestarTexto", "A placa foi trocada, envio o CRLV novo em anexo."); shot(moto, "motoboy-07-suspenso-contestar")
        moto.click("#btnContestar"); expect(moto.locator("#contestacaoInfo")).to_contain_text("em análise", timeout=10000); passo("motoboy contesta (fica registrado)")
        adm.click("#abaR"); adm.click("#secR button.link")
        crow = adm.locator("#tbR tr", has_text="E2E Moto"); expect(crow).to_contain_text("CRLV novo", timeout=10000); passo("admin vê a contestação")
        shot(adm, "admin-contestacoes")
        adm.click("#abaM"); adm.locator("#tbM tr", has_text="E2E Moto").get_by_role("button", name="Histórico").click()
        expect(adm.locator("#tbH tr")).to_have_count(2, timeout=10000); passo("admin vê o histórico de status com motivos")
        adm.click("#abaR")
        resposta["txt"] = "CRLV conferido, placa correta"
        crow.get_by_role("button", name="Deferir", exact=True).click()
        expect(adm.locator("#tbR tr", has_text="E2E Moto")).to_contain_text("deferida", timeout=10000); passo("admin defere a contestação e reaprova")
        adm.click("#abaM")

        # 3. Cliente comum não acessa admin
        cli.goto("http://localhost:8090/admin/"); cli.fill("#authEmail", users["cliente"][1]); cli.fill("#authSenha", senha); cli.click("#authBtn")
        expect(cli.locator("#semAcesso")).to_be_visible(timeout=15000); passo("cliente não acessa o painel admin")
        cli.click("#sair"); cli.wait_for_timeout(800)

        # 4. Motoboy aprovado fica online
        moto.reload(); expect(moto.locator("#telaTrabalho")).to_be_visible(timeout=15000)
        shot(moto, "motoboy-03a-offline")
        moto.click("#disponivel"); expect(moto.locator("#motoStatus")).to_contain_text("online"); passo("motoboy aprovado fica online")
        shot(moto, "motoboy-03-online")

        # 5. Cliente pede com autocomplete + rota
        login(cli, "cliente/www/", "cliente")
        expect(cli.locator("#modalAceite")).to_be_visible(timeout=15000); assert cli.is_disabled("#aceiteOk")
        cli.check("#aceiteNovo"); cli.click("#aceiteOk"); expect(cli.locator("#modalAceite")).to_be_hidden(timeout=10000)
        ac = sql(f"select count(*) c, count(ip) ips, count(user_agent) uas from aceites_termos where user_id='{users['cliente'][0]}'")[0]
        assert ac["c"] == 2 and ac["uas"] == 2, ac; print("   aceites:", ac); passo("pede aceite pendente no login e grava (versão, data, UA, IP)")
        expect(cli.locator("#home")).to_be_visible(timeout=15000); shot(cli, "cliente-01b-inicio"); passo("cliente vê a tela inicial")
        cli.click("#pillParaOnde"); expect(cli.locator("#telaPlano")).to_be_visible(); shot(cli, "cliente-01c-plano")
        cli.fill("#origem", "Rua Quinze de Novembro"); cli.locator("#sugOrigem .sugestao").first.click(timeout=20000)
        cli.fill("#destino", "Avenida Bento Gonçalves"); cli.locator("#sugDestino .sugestao").first.click(timeout=20000)
        expect(cli.locator("#valor")).to_contain_text("R$", timeout=20000)
        expect(cli.locator("#telaConfirmar")).to_be_visible(); cli.wait_for_timeout(3000); shot(cli, "cliente-02-cotacao")
        print("   cotação:", cli.inner_text("#valor"), "|", cli.inner_text("#km")); passo("autocomplete Pelotas + rota + preço do servidor")
        cli.click("#deliveryForm button[type=submit]")
        expect(cli.locator("#pedido")).to_be_visible(timeout=15000); passo("cliente cria pedido")

        # 6. Motoboy recebe e aceita
        expect(moto.locator("#oferta")).to_be_visible(timeout=20000); passo("motoboy recebe oferta")
        shot(moto, "motoboy-04-oferta")
        moto.click("#oferta button.primary")
        expect(moto.locator("#corrida")).to_be_visible(timeout=15000)
        expect(cli.locator("#estado")).to_contain_text("aceitou", timeout=20000); passo("cliente vê aceite (tempo real)")
        codigo = cli.inner_text("#codigoTxt").strip(); assert re.fullmatch(r"\d{4}", codigo)
        expect(cli.locator("#mapaPedido .pin-moto")).to_be_visible(timeout=25000); passo("cliente vê o motoboy no mapa (rastreio ao vivo)")
        shot(cli, "cliente-03-rastreio"); shot(moto, "motoboy-05-corrida")
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
        cli.locator("#estrelas button").nth(4).click(); expect(cli.locator("#avaliarMsg")).to_contain_text("Obrigado", timeout=10000); passo("cliente avalia o motoboy")
        cli.click("#btnNovo"); cli.click("#navAtividade"); expect(cli.locator("#listaAtividade .item-lista")).to_have_count(1, timeout=10000); shot(cli, "cliente-05-atividade"); passo("atividade mostra o histórico")
        moto.click("#segGanhos"); expect(moto.locator("#ganhosLista .corrida-item")).to_have_count(1, timeout=10000); passo("ganhos do motoboy")
        shot(moto, "motoboy-06-ganhos")

        # 8. Admin vê pedido
        adm.click("#abaP"); adm.click("#secP button.link")
        expect(adm.locator("#tbP tr", has_text="entregue").first).to_be_visible(timeout=10000); passo("admin vê pedidos")
        shot(adm, "admin-pedidos")

        # 9. Cliente exclui a conta pelo app (pedido fica anonimizado)
        cli.click("#navConta"); expect(cli.locator("#btnExcluirConta")).to_be_visible(); shot(cli, "cliente-06-conta-excluir")
        resposta["txt"] = "EXCLUIR"; cli.click("#btnExcluirConta")
        expect(cli.locator("#telaAuth, #telaOnboarding").first).to_be_visible(timeout=20000)
        cid = users.pop("cliente")[0]
        r = sql(f"select (select count(*) from auth.users where id='{cid}') u, (select count(*) from profiles where id='{cid}') p, (select count(*) from pedidos where cliente_id is null and motoboy_id='{users['moto'][0]}' and retirada like '%removido%' and status='entregue') ped")[0]
        assert r == {"u": 0, "p": 0, "ped": 1}, r; passo("cliente exclui a conta: login e perfil apagados, pedido anonimizado mantido")
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
