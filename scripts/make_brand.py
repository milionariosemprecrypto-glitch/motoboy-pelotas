"""Gera a marca É-Já em SVG (vetor puro, texto convertido em curvas) e os PNGs dos apps.
Uso: python3 scripts/make_brand.py   (precisa de fonttools e rsvg-convert)"""
import os, subprocess
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = "/usr/share/fonts/truetype/sand-box/google/Poppins/Poppins-BlackItalic.ttf"
FONT_SLOGAN = "/usr/share/fonts/truetype/sand-box/google/Poppins/Poppins-BoldItalic.ttf"
ORANGE, ORANGE2, BLACK, WHITE, GREY = "#FF6A00", "#FF8A1F", "#0B0B0B", "#F5F5F5", "#9A9A9A"
OUT = os.path.join(os.path.dirname(__file__), "..", "brand")
os.makedirs(OUT, exist_ok=True)

class Font:
    def __init__(self, path):
        self.f = TTFont(path); self.gs = self.f.getGlyphSet(); self.cmap = self.f.getBestCmap()
        self.upm = self.f["head"].unitsPerEm
    def text(self, s, x, y, size, spacing=0.0):
        """Retorna (path_d, largura). y = linha de base."""
        k = size / self.upm; d = []; cx = x
        for ch in s:
            g = self.cmap[ord(ch)]
            pen = SVGPathPen(self.gs)
            self.gs[g].draw(TransformPen(pen, (k, 0, 0, -k, cx, y)))
            d.append(pen.getCommands()); cx += self.gs[g].width * k + spacing * size
        return " ".join(d), cx - x

F, FS = Font(FONT), Font(FONT_SLOGAN)
GRAD = f'''<linearGradient id="og" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{ORANGE2}"/><stop offset="1" stop-color="{ORANGE}"/></linearGradient>'''

def linhas(x_dir, y, h, comps, gap, skew=0.32):
    """Linhas de velocidade: paralelogramos inclinados terminando em x_dir."""
    out = []
    for i, L in enumerate(comps):
        yy = y + i * (h + gap); s = h * skew
        x1 = x_dir - L
        out.append(f'<path d="M{x1+s:.1f},{yy:.1f} L{x_dir+s:.1f},{yy:.1f} L{x_dir:.1f},{yy+h:.1f} L{x1:.1f},{yy+h:.1f} Z" fill="url(#og)"/>')
    return "".join(out)

def wordmark(x, y, size):
    """'É-Já' com linhas de velocidade. Retorna (svg, largura total, x inicial das linhas)."""
    dE, wE = F.text("É", x, y, size)
    dH, wH = F.text("-", x + wE - size*0.04, y, size)
    dJ, wJ = F.text("Já", x + wE + wH - size*0.10, y, size, spacing=-0.02)
    cap = size * 0.70  # altura das maiúsculas
    sp = linhas(x + size*0.06, y - cap*0.95, cap*0.13, [size*0.95, size*0.75, size*0.55], cap*0.11)
    svg = sp + f'<path d="{dE}" fill="url(#og)"/><path d="{dH}" fill="url(#og)"/><path d="{dJ}" fill="{WHITE}"/>'
    return svg, wE + wH + wJ - size*0.10, x - size*0.95

def slogan(cx, y, size):
    a, wa = FS.text("PEDIU. ", 0, 0, size, spacing=0.12)
    b, wb = FS.text("PARTIU.", 0, 0, size, spacing=0.12)
    x0 = cx - (wa + wb) / 2
    a, _ = FS.text("PEDIU. ", x0, y, size, spacing=0.12); b, _ = FS.text("PARTIU.", x0 + wa, y, size, spacing=0.12)
    return f'<path d="{a}" fill="{WHITE}"/><path d="{b}" fill="{ORANGE}"/>'

def icon_e(cx, cy, size):
    """Só o 'É' laranja com linhas, centrado."""
    dE, wE = F.text("É", 0, 0, size)
    x = cx - wE/2 + size*0.12; y = cy + size*0.30
    dE, _ = F.text("É", x, y, size)
    cap = size*0.70
    sp = linhas(x + size*0.10, y - cap*0.80, cap*0.12, [size*0.55, size*0.42, size*0.30], cap*0.12)
    return sp + f'<path d="{dE}" fill="url(#og)"/>'

def save(name, w, h, body, bg=None):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"><defs>{GRAD}</defs>{rect}{body}</svg>'
    open(os.path.join(OUT, name), "w").write(s); return os.path.join(OUT, name)

def tag_motoboy(cx, y, size):
    d, w = FS.text("MOTOBOY", 0, 0, size, spacing=0.14)
    d, _ = FS.text("MOTOBOY", cx - w/2, y, size, spacing=0.14)
    pad = size*0.45
    return (f'<path d="M{cx-w/2-pad+size*0.2:.1f},{y-size*0.95:.1f} h{w+2*pad:.1f} l{-size*0.25:.1f},{size*1.35:.1f} h{-(w+2*pad):.1f} Z" fill="{ORANGE}"/>'
            f'<path d="{d}" fill="{BLACK}"/>')

# --- Ícones (1024) ---
R = 1024
bg_round = f'<rect width="{R}" height="{R}" rx="230" fill="{BLACK}"/><rect x="6" y="6" width="{R-12}" height="{R-12}" rx="226" fill="none" stroke="#222" stroke-width="6"/>'
save("eja-icon.svg", R, R, bg_round + icon_e(R/2, R/2, 620))
save("eja-icon-motoboy.svg", R, R, bg_round + icon_e(R/2, R/2 - 60, 540) + tag_motoboy(R/2, 860, 70))
# adaptativo Android: só o símbolo dentro da zona segura (66%)
save("eja-icon-foreground.svg", R, R, icon_e(R/2, R/2, 400))
save("eja-icon-foreground-motoboy.svg", R, R, icon_e(R/2, R/2 - 40, 360) + tag_motoboy(R/2, 700, 48))
save("eja-icon-square.svg", R, R, f'<rect width="{R}" height="{R}" fill="{BLACK}"/>' + icon_e(R/2, R/2, 620))
save("eja-icon-square-motoboy.svg", R, R, f'<rect width="{R}" height="{R}" fill="{BLACK}"/>' + icon_e(R/2, R/2 - 60, 540) + tag_motoboy(R/2, 860, 70))

# --- Logos ---
wm, w, x0 = wordmark(0, 0, 100)
W, H = 1000, 450; s = 300; wm, w, xl = wordmark(0, 0, s)
total = w + s*0.95; x = (W - total)/2 + s*0.95
wm, _, _ = wordmark(x, 320, s)
save("eja-logo.svg", W, H, wm + slogan(W/2, 415, 46))
save("eja-wordmark.svg", W, 350, wordmark(x, 320, s)[0])

# --- Splash 2732 ---
S = 2732; s = 640; wm, w, _ = wordmark(0, 0, s); x = (S - (w + s*0.95))/2 + s*0.95
glow = f'<radialGradient id="gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{ORANGE}" stop-opacity=".18"/><stop offset="1" stop-color="{ORANGE}" stop-opacity="0"/></radialGradient>'
def splash(extra=""):
    return (f'<defs>{glow}</defs><rect width="{S}" height="{S}" fill="{BLACK}"/><ellipse cx="{S/2}" cy="{S/2}" rx="1300" ry="800" fill="url(#gl)"/>'
            + wordmark(x, S/2 + 160, s)[0] + slogan(S/2, S/2 + 380, 110) + extra)
save("eja-splash.svg", S, S, splash())
save("eja-splash-motoboy.svg", S, S, splash(tag_motoboy(S/2, S/2 + 620, 100)))

# --- Imagens de destaque Play Store 1024x500 ---
def destaque(nome, sub, extra=""):
    Wd, Hd = 1024, 500; s = 210; wm, w, _ = wordmark(0, 0, s); x = 120 + s*0.95
    faixas = (f'<path d="M640,0 L1024,0 L1024,500 L420,500 Z" fill="#141414"/>'
              f'<path d="M760,0 L800,0 L580,500 L540,500 Z" fill="{ORANGE}" opacity=".9"/>'
              f'<path d="M830,0 L850,0 L630,500 L610,500 Z" fill="{ORANGE}" opacity=".5"/>'
              f'<path d="M0,470 L1024,430 L1024,445 L0,485 Z" fill="{ORANGE}" opacity=".35"/>')
    d, ws = FS.text(sub, 0, 0, 30, spacing=0.06)
    d, _ = FS.text(sub, 128, 395, 30, spacing=0.06)
    body = f'<rect width="{Wd}" height="{Hd}" fill="{BLACK}"/>' + faixas + wordmark(x, 250, s)[0] + slogan(0, 0, 1)[:0]
    sa, wa = FS.text("PEDIU. ", 128, 320, 40, spacing=0.12); sb, _ = FS.text("PARTIU.", 128 + wa, 320, 40, spacing=0.12)
    body += f'<path d="{sa}" fill="{WHITE}"/><path d="{sb}" fill="{ORANGE}"/><path d="{d}" fill="{GREY}"/>' + extra
    return save(nome, Wd, Hd, body)
destaque("destaque-cliente.svg", "Entregas por motoboy em Pelotas-RS")
destaque("destaque-motoboy.svg", "Corridas e ganhos na palma da mão", tag_motoboy(850, 330, 34))

def png(svg, out, w, h=None):
    subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h or w), "-o", out, os.path.join(OUT, svg)], check=True)

if __name__ == "__main__":
    print("SVGs gerados em", os.path.abspath(OUT))
