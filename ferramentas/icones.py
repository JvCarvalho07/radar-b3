"""Gera os ícones do app: versão recortável (maskable, fundo inteiro) e versão com cantos arredondados."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

PASTA = Path(sys.argv[1])
G = 2048  # desenha grande e reduz, para bordas suaves


def degrade(tam):
    """Diagonal âmbar -> laranja -> brasa, como o --fogo do app."""
    img = Image.new("RGB", (tam, tam))
    px = img.load()
    a, b, c = (255, 176, 87), (255, 122, 31), (255, 77, 46)
    for y in range(tam):
        for x in range(tam):
            t = (x + y) / (2 * (tam - 1))
            if t < .5:
                k = t / .5; c0, c1 = a, b
            else:
                k = (t - .5) / .5; c0, c1 = b, c
            px[x, y] = tuple(round(c0[i] + (c1[i] - c0[i]) * k) for i in range(3))
    return img


def glifo(d, cx, cy, s, cor=(29, 11, 2)):
    """Radar: três arcos, o centro e o ponteiro. s = raio do arco maior."""
    w = round(s * .16)
    for r in (s, s * .68, s * .36):
        caixa = [cx - r, cy - r, cx + r, cy + r]
        d.arc(caixa, start=200, end=340, fill=cor, width=w)
    rp = s * .17
    d.ellipse([cx - rp, cy - rp, cx + rp, cy + rp], fill=cor)
    d.line([cx, cy, cx + s * .78, cy + s * .66], fill=cor, width=round(w * .8))
    re = w * .4  # ponta arredondada
    ex, ey = cx + s * .78, cy + s * .66
    d.ellipse([ex - re, ey - re, ex + re, ey + re], fill=cor)


fundo = degrade(256).resize((G, G), Image.BICUBIC)

# Maskable: fundo inteiro; o desenho cabe no círculo seguro do meio (80%)
m = fundo.copy()
glifo(ImageDraw.Draw(m), G * .5, G * .54, G * .27)
m.resize((512, 512), Image.LANCZOS).save(PASTA / "icone-maskable-512.png")
m.resize((192, 192), Image.LANCZOS).save(PASTA / "icone-maskable-192.png")
m.resize((180, 180), Image.LANCZOS).save(PASTA / "icone-180.png")   # o iPhone arredonda sozinho

# Comum: quadrado de cantos arredondados sobre fundo transparente
q = Image.new("RGBA", (G, G), (0, 0, 0, 0))
mascara = Image.new("L", (G, G), 0)
marg = round(G * .06)
ImageDraw.Draw(mascara).rounded_rectangle([marg, marg, G - marg, G - marg], radius=round(G * .22), fill=255)
q.paste(fundo, (0, 0), mascara)
glifo(ImageDraw.Draw(q), G * .5, G * .54, G * .32)
q.resize((512, 512), Image.LANCZOS).save(PASTA / "icone-512.png")
q.resize((192, 192), Image.LANCZOS).save(PASTA / "icone-192.png")
print("ok")
