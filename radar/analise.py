"""Leitura de cada ação: preço justo, faixas de preço e sinais, com a conta à mostra.

Tudo aqui é cálculo a partir de dados públicos, explicado no app. Não é recomendação.
"""

import math

import numpy as np
import pandas as pd

TAXA_BAZIN = 0.06       # dividendo mínimo desejado por Bazin: 6% ao ano
FATOR_GRAHAM = 22.5     # P/L 15 × P/VP 1,5, os limites de Graham para ação "defensiva"
DIAS_MES = 21           # pregões num mês


def _ok(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


def preco_justo(preco, pl, pvp, dy) -> dict:
    """Graham: √(22,5 × LPA × VPA). Bazin: dividendo por ação ÷ 6%."""
    r = {}
    if _ok(preco) and _ok(pl) and _ok(pvp) and pl > 0 and pvp > 0:
        lpa, vpa = preco / pl, preco / pvp
        r["lpa"], r["vpa"] = round(lpa, 4), round(vpa, 4)
        r["graham"] = round(math.sqrt(FATOR_GRAHAM * lpa * vpa), 2)
    if _ok(preco) and _ok(dy) and dy > 0:
        dpa = preco * dy / 100
        r["dpa"] = round(dpa, 4)
        r["bazin"] = round(dpa / TAXA_BAZIN, 2)
    return r


def faixas(hist: pd.DataFrame) -> dict:
    """Mínima/máxima de 52 semanas e a faixa provável de 1 mês pela volatilidade."""
    fech = hist["Close"].dropna()
    ret = np.log(fech / fech.shift(1)).dropna().iloc[-126:]   # ~6 meses de retornos diários
    sigma = float(ret.std()) if len(ret) > 20 else float("nan")
    ultimo = float(fech.iloc[-1])
    r = {"min_52s": round(float(hist["Low"].min()), 2), "max_52s": round(float(hist["High"].max()), 2)}
    if _ok(sigma):
        mov = sigma * math.sqrt(DIAS_MES)
        r["vol_anual"] = round(sigma * math.sqrt(252) * 100, 1)
        r["faixa_1m"] = [round(ultimo * math.exp(-mov), 2), round(ultimo * math.exp(mov), 2)]
    return r


def sinais(u: dict, n_estrategias: int) -> tuple[list[dict], list[dict]]:
    """Separa o que joga a favor e o que pede atenção, cada um com a explicação."""
    a_favor, atencao = [], []
    preco = u.get("preco") or u.get("cotacao")

    def pct(x):
        return f"{x:+.0f}%"

    if not u.get("financeira") and _ok(u.get("graham")) and preco:   # Graham não se aplica a bancos
        dif = (u["graham"] / preco - 1) * 100
        if dif >= 10:
            a_favor.append({"t": "Abaixo do preço justo de Graham", "d": f"O preço justo calculado é R$ {u['graham']:.2f}, {pct(dif)} acima do preço atual."})
        elif dif <= -30:
            atencao.append({"t": "Bem acima do preço justo de Graham", "d": f"O preço justo calculado é R$ {u['graham']:.2f}; o preço atual está {(preco / u['graham'] - 1) * 100:.0f}% acima dele."})
    if _ok(u.get("bazin")) and preco:
        dif = (u["bazin"] / preco - 1) * 100
        if dif >= 0:
            a_favor.append({"t": "Abaixo do preço-teto de Bazin", "d": f"Pagando o dividendo atual, renderia {u['dy']:.1f}% ao ano, acima dos 6% de Bazin (teto R$ {u['bazin']:.2f})."})
    if _ok(u.get("pl")) and u["pl"] < 0:
        atencao.append({"t": "Empresa com prejuízo", "d": "O P/L negativo indica prejuízo nos últimos 12 meses."})
    if _ok(u.get("roe")) and u["roe"] >= 15:
        a_favor.append({"t": "Rentabilidade alta", "d": f"ROE de {u['roe']:.1f}%: lucra bem sobre o próprio patrimônio (referência: acima de 15%)."})
    elif _ok(u.get("roe")) and 0 <= u["roe"] < 8:
        atencao.append({"t": "Rentabilidade baixa", "d": f"ROE de {u['roe']:.1f}%, abaixo de 8% ao ano."})
    if not u.get("financeira") and _ok(u.get("div_liq_patrim")):
        if u["div_liq_patrim"] > 2:
            atencao.append({"t": "Endividamento alto", "d": f"Dívida líquida de {u['div_liq_patrim']:.2f}× o patrimônio (referência: até 1×)."})
        elif u["div_liq_patrim"] <= 0.5:
            a_favor.append({"t": "Dívida baixa", "d": f"Dívida líquida de {u['div_liq_patrim']:.2f}× o patrimônio."})
    if _ok(u.get("var_30d")) and u["var_30d"] <= -15:
        atencao.append({"t": "Em queda forte no mês", "d": f"Caiu {abs(u['var_30d']):.0f}% em 30 dias. Queda pode continuar; vale entender o motivo."})
    if _ok(u.get("alvo_medio")) and preco and (u.get("analistas") or 0) >= 3:
        dif = (u["alvo_medio"] / preco - 1) * 100
        alvo = {"t": f"Analistas veem {'alta' if dif > 0 else 'queda'}", "d": f"Alvo médio de {u['analistas']} analistas: R$ {u['alvo_medio']:.2f} ({pct(dif)})."}
        if dif >= 10:
            a_favor.append(alvo)
        elif dif <= -5:
            atencao.append(alvo)
    if n_estrategias:
        a_favor.append({"t": f"Passa em {n_estrategias} estratégia{'s' if n_estrategias > 1 else ''} sua{'s' if n_estrategias > 1 else ''}", "d": "Cumpre todos os critérios que você definiu no config.yaml."})
    return a_favor, atencao


def pontuacao(a_favor: list, atencao: list) -> int:
    """De 0 a 100: começa em 50, +10 por sinal a favor, −10 por sinal de atenção."""
    return max(0, min(100, 50 + 10 * len(a_favor) - 10 * len(atencao)))


def velas_validas(hist: pd.DataFrame) -> pd.DataFrame:
    """Open/High/Low zerados recebem o fechamento (o Yahoo às vezes entrega a vela do dia zerada).
    Sai a barra fora de escala: preço acima de 20× ou abaixo de 1/20 da mediana local (21 pregões
    centrados). Repete até não cair mais barra. A referência é local, para que um bloco de preços
    quebrados no meio da série não contamine a escala do resto."""
    h = hist.copy()
    for col in ["Open", "High", "Low"]:
        h[col] = h[col].where(h[col] > 0, h["Close"])
    for _ in range(10):
        fech = h["Close"].where(h["Close"] > 0)
        med = fech.rolling(21, center=True, min_periods=1).median()
        ok = (h["Close"] > 0) & (h["High"] <= 20 * med) & (h["Low"] >= med / 20)
        if ok.all():
            break
        h = h[ok]
    return h


def escala_quebrada(hist: pd.DataFrame) -> bool:
    """A limpeza tirou alguma barra com fechamento positivo (preço fora de escala). Fechamento zero
    não conta: é dia sem negócio. Com isso, mínima, máxima e queda desde a máxima ficam de fora."""
    return int((hist["Close"] > 0).sum()) > len(velas_validas(hist))


def suspeito(hist: pd.DataFrame) -> bool:
    """Salto de 2× ou mais, ou de metade ou menos, entre dois pregões seguidos. Não remove nada:
    só marca `dados_suspeitos`, que pede para conferir a cotação."""
    def tem_salto(c: pd.Series) -> bool:
        c = c[c > 0]
        r = c / c.shift(1)
        return bool(((r >= 2) | (r <= 0.5)).any())
    return tem_salto(hist["Close"]) or tem_salto(velas_validas(hist)["Close"])
