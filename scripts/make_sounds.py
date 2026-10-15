"""Gera os sons originais do É-Já (síntese própria, sem áudio de terceiros).
corrida: toque de chamada forte e marcante (~2,4 s, feito para tocar em loop).
aceito: "plim" curto de confirmação para o cliente."""
import numpy as np, wave, os
SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "shared", "sons")

def tom(freq, dur, vol=1.0, harm=(1, .5, .25, .12)):
    t = np.arange(int(SR * dur)) / SR
    s = sum(a * np.sin(2 * np.pi * freq * (i + 1) * t) for i, a in enumerate(harm))
    env = np.minimum(1, t / 0.006) * np.exp(-t * 7)          # ataque rápido, decaimento tipo sino
    return vol * s * env

def silencio(d): return np.zeros(int(SR * d))

def salvar(nome, x):
    x = x / np.max(np.abs(x)) * 0.97
    x = np.tanh(x * 1.6) / np.tanh(1.6)                        # leve saturação = mais "presença"/volume
    with wave.open(os.path.join(OUT, nome), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())

# Corrida: arpejo ascendente em Mi maior (E5-G#5-B5-E6) duas vezes, rápido e insistente, + pausa
frase = np.concatenate([np.pad(tom(f, .16), (0, 0)) for f in (659.3, 830.6, 987.8, 1318.5)])
batida = np.concatenate([frase, silencio(.08), frase, silencio(.08), tom(1318.5, .5, 1.1), silencio(.45)])
salvar("eja_corrida.wav", batida)
# Aceito: duas notas ascendentes suaves
salvar("eja_aceito.wav", np.concatenate([tom(880, .14, .8), tom(1318.5, .45, .9), silencio(.05)]))
print("ok")
