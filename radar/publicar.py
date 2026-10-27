"""Monta a pasta do site (app + dados em JSON) que vai para o GitHub Pages."""

import json
import math
import shutil
from pathlib import Path

import pandas as pd

from . import alertas
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

    tabela = {}
    for papel, linha in universo.iterrows():
        tabela[papel] = {c: _limpo(linha.get(c)) for c in CAMPOS_UNIVERSO if c in linha}
    _json(dados / "universo.json", tabela)

    for papel, hist in historicos.items():
        velas = [[d.strftime("%Y-%m-%d"), *(round(float(x), 2) for x in row)]
                 for d, row in zip(hist.index, hist[["Open", "High", "Low", "Close"]].values)]
        _json(dados / "precos" / f"{papel}.json", velas)
