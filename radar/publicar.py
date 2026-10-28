"""Monta a pasta do site (app + dados em JSON) que vai para o GitHub Pages."""

import json
import math
import shutil
from pathlib import Path

import pandas as pd

from . import alertas, analise, fontes
from .screener import RAIZ

PASTA_SITE = RAIZ / "site"
CAMPOS_UNIVERSO = ["cotacao", "pl", "pvp", "psr", "dy", "ev_ebitda", "mrg_liq", "roic", "roe",
                   "liq_corr", "div_liq_patrim", "cresc_rec_5a", "liq_2meses", "financeira",
                   "preco", "var_dia", "var_30d", "var_1a", "queda_52s"]


def _limpo(v):
    if isinstance(v, float):
        return None if math.isnan(v) else round(v, 4)
    if hasattr(v, "item"):  # tipos numpy
        return _limpo(v.item())
    return v


def _json(caminho: Path, dados):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def gerar(resultado: dict, universo: pd.DataFrame, historicos: dict, saida: Path):
    if saida.exists():
        shutil.rmtree(saida)
    shutil.copytree(PASTA_SITE, saida)
    dados = saida / "dados"

    _json(dados / "resultado.json", resultado)
    _json(dados / "historico.json", alertas.ler_historico())
    _json(dados / "mundo.json", fontes.baixar_mundo())

    perfis = fontes.baixar_perfis(historicos)
    contagem = {}
    for est in resultado["estrategias"].values():
        for p in est["papeis"]:
            contagem[p["papel"]] = contagem.get(p["papel"], 0) + 1

    tabela = {}
    for papel, linha in universo.iterrows():
        u = {c: _limpo(linha.get(c)) for c in CAMPOS_UNIVERSO if c in linha}
        if papel in historicos:
            # Últimos ~3 meses de fechamento para os mini gráficos.
            u["spark"] = [round(float(x), 2) for x in historicos[papel]["Close"].iloc[-63:]]
            u.update(analise.faixas(historicos[papel]))
            u.update({k: _limpo(v) for k, v in perfis.get(papel, {}).items()})
            u.update(analise.preco_justo(u.get("cotacao"), u.get("pl"), u.get("pvp"), u.get("dy")))
            u["a_favor"], u["atencao"] = analise.sinais(u, contagem.get(papel, 0))
            u["pontos"] = analise.pontuacao(u["a_favor"], u["atencao"])
        tabela[papel] = u
    _json(dados / "universo.json", tabela)

    for papel, hist in historicos.items():
        velas = [[d.strftime("%Y-%m-%d"), *(round(float(x), 2) for x in row[:4]), int(row[4] or 0)]
                 for d, row in zip(hist.index, hist[["Open", "High", "Low", "Close", "Volume"]].fillna(0).values)]
        _json(dados / "precos" / f"{papel}.json", velas)
