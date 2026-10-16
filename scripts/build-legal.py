#!/usr/bin/env python3
"""Gera as páginas legais do site (eja-site) a partir de docs/*.md. Uso: python3 scripts/build-legal.py /workspace/eja-site"""
import sys, pathlib, markdown, html
ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/eja-site")
PAGINAS = [("termos-de-uso.md", "termos", "Termos de Uso — Clientes"),
           ("termos-motoboy.md", "termos-motoboy", "Termos do Motoboy Parceiro"),
           ("politica-de-privacidade.md", "privacidade", "Política de Privacidade")]
CSS = """:root{--o:#FF6A00;--b:#0B0B0B}*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#1b1b1b;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.65}
nav{background:var(--b);border-bottom:3px solid var(--o)}nav .w{display:flex;align-items:center;justify-content:space-between;height:62px}nav img{height:34px;display:block}nav a.l{color:#ddd;text-decoration:none;margin-left:18px;font-weight:600;font-size:14px}nav a.l:hover{color:var(--o)}
.w{max-width:860px;margin:0 auto;padding:0 20px}main{padding:34px 20px 60px}h1{font-size:30px;line-height:1.2;margin:.2em 0 .4em}h2{font-size:21px;margin-top:2em;border-left:4px solid var(--o);padding-left:10px}
blockquote{margin:16px 0;background:#fff4eb;border:1px solid #ffd2b0;border-radius:10px;padding:10px 16px;color:#5a2b00}table{border-collapse:collapse;width:100%;font-size:14px;margin:12px 0;display:block;overflow-x:auto}th,td{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}th{background:#111;color:#fff}
a{color:#c24f00}.btn{display:inline-block;background:var(--o);color:#0b0b0b;font-weight:800;padding:12px 20px;border-radius:10px;text-decoration:none;border:0;font-size:15px;cursor:pointer}.btn.p{background:#111;color:#fff}.btn:disabled{opacity:.45}
.box{background:#fff;border:1px solid #e6e6e6;border-radius:14px;padding:20px;margin:18px 0}input{width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;font-size:16px;margin:6px 0 12px}label{font-weight:600;font-size:14px}
footer{background:var(--b);color:#999;font-size:13px;padding:24px 0}footer a{color:#ddd;margin-right:14px}.ok{color:#087443;font-weight:700}.erro{color:#c0281b;font-weight:700}
@media(max-width:640px){nav a.l{display:none}h1{font-size:25px}}"""
def pagina(titulo, corpo, slug, desc):
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(titulo)} | É-Já</title><meta name="description" content="{html.escape(desc)}"><link rel="canonical" href="https://eja-site.pages.dev/{slug}/">
<meta name="theme-color" content="#0B0B0B"><link rel="icon" href="/img/eja-icon-square.svg"><style>{CSS}</style></head><body>
<nav><div class="w"><a href="/"><img src="/img/eja-logo.svg" alt="É-Já"></a><div><a class="l" href="/termos/">Termos</a><a class="l" href="/termos-motoboy/">Motoboy</a><a class="l" href="/privacidade/">Privacidade</a><a class="l" href="/excluir-conta/">Excluir conta</a></div></div></nav>
<main class="w">{corpo}</main>
<footer><div class="w"><a href="/termos/">Termos de Uso</a><a href="/termos-motoboy/">Termos do Motoboy</a><a href="/privacidade/">Política de Privacidade</a><a href="/excluir-conta/">Excluir minha conta</a><br><br>© 2026 É-Já · [NOME/RAZÃO SOCIAL] · CNPJ [CNPJ] · Pelotas-RS</div></footer></body></html>"""
for md, slug, titulo in PAGINAS:
    corpo = markdown.markdown((ROOT / "docs" / md).read_text(), extensions=["tables"])
    d = SITE / slug; d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(pagina(titulo, corpo, slug, f"{titulo} do É-Já, app de entregas por motoboy em Pelotas-RS."))
    print("ok", slug)
corpo = (ROOT / "scripts" / "excluir-conta.html").read_text()
(SITE / "excluir-conta").mkdir(exist_ok=True)
(SITE / "excluir-conta" / "index.html").write_text(pagina("Excluir minha conta", corpo, "excluir-conta", "Como excluir sua conta do É-Já e quais dados são apagados ou mantidos."))
print("ok excluir-conta")
