"""Monta a pasta do site (app + dados em JSON) que vai para o GitHub Pages."""

import hashlib
import json
import math
import re
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


def _carimbar_versao(saida: Path):
    """O app instalado só percebe versão nova quando o sw.js muda. Carimba nele um resumo dos arquivos
    do app: mudou qualquer arquivo, muda o carimbo e o app se atualiza sozinho. Só dados novos não mudam."""
    resumo = hashlib.sha1()
    for f in sorted(p for p in PASTA_SITE.rglob("*") if p.is_file()):
        resumo.update(f.relative_to(PASTA_SITE).as_posix().encode())
        resumo.update(f.read_bytes())
    sw = saida / "sw.js"
    texto = sw.read_text(encoding="utf-8")
    novo = re.sub(r'const VERSAO = "[^"]*";', f'const VERSAO = "radar-{resumo.hexdigest()[:12]}";', texto, count=1)
    sw.write_text(novo, encoding="utf-8")


def gerar(resultado: dict, universo: pd.DataFrame, historicos: dict, saida: Path):
    if saida.exists():
        shutil.rmtree(saida)
    shutil.copytree(PASTA_SITE, saida)
    _carimbar_versao(saida)
    dados = saida / "dados"

    # Série bruta para detectar salto e escala quebrada; a limpa para o resto (faixas, gráfico, precos/).
    brutos = historicos
    historicos = {p: v for p, v in ((p, analise.velas_validas(h)) for p, h in brutos.items()) if len(v)}

    _json(dados / "resultado.json", resultado)
    _json(dados / "historico.json", alertas.ler_historico())
    _json(dados / "mundo.json", fontes.baixar_mundo())

    perfis = fontes.baixar_perfis(historicos)
    eventos = fontes.baixar_eventos(historicos)
    contagem = {}
    for est in resultado["estrategias"].values():
        for p in est["papeis"]:
            contagem[p["papel"]] = contagem.get(p["papel"], 0) + 1

    tabela = {}
    for papel, linha in universo.iterrows():
        u = {c: _limpo(linha.get(c)) for c in CAMPOS_UNIVERSO if c in linha}
        if papel in historicos:
            hist = historicos[papel]
            # Últimos ~3 meses de fechamento para os mini gráficos.
            u["spark"] = [round(float(x), 2) for x in hist["Close"].iloc[-63:]]
            if "Dividends" in hist:
                # Proventos do último ano (data ex e valor por ação), para a tela da ação
                div = hist["Dividends"].fillna(0)
                u["proventos"] = [[d.strftime("%Y-%m-%d"), round(float(v), 4)] for d, v in div[div > 0].items()]
            u.update(analise.faixas(hist))
            if analise.suspeito(brutos[papel]):
                # Salto de 2× sem explicação: aviso na carteira; nada é escondido.
                u["dados_suspeitos"] = True
            if analise.escala_quebrada(brutos[papel]):
                # Barra fora de escala saiu da série: mínima, máxima e queda desde a máxima não são confiáveis.
                u["escala_quebrada"] = True
                for k in ("min_52s", "max_52s", "queda_52s"):
                    u.pop(k, None)
            ev = eventos.get(papel)
            if ev is None:
                # Sem histórico completo: proventos só do último ano e desdobramentos desconhecidos
                u["eventos_incompletos"] = True
                u["proventos_todos"] = u.get("proventos", [])
            else:
                u["proventos_todos"] = ev["proventos"]
                if ev["desdobramentos"]:
                    u["desdobramentos"] = ev["desdobramentos"]
                # Resposta vazia do Yahoo não prova que não houve provento: o histórico de preço desmente.
                if not ev["proventos"] and u.get("proventos"):
                    u["proventos_todos"] = u["proventos"]
                    u["eventos_incompletos"] = True
            u.update({k: _limpo(v) for k, v in perfis.get(papel, {}).items()})
            u.update(analise.preco_justo(u.get("cotacao"), u.get("pl"), u.get("pvp"), u.get("dy")))
            if u.get("financeira"):
                u.pop("graham", None)   # banco: Graham não se aplica, e some de todas as telas
            u["a_favor"], u["atencao"] = analise.sinais(u, contagem.get(papel, 0))
            u["pontos"] = analise.pontuacao(u["a_favor"], u["atencao"])
        tabela[papel] = u
    _json(dados / "universo.json", tabela)

    for papel, hist in historicos.items():
        if tabela.get(papel, {}).get("escala_quebrada"):
            hist = analise.depois_do_ultimo_salto(hist)   # o gráfico mostra só o trecho com escala coerente
        velas = [[d.strftime("%Y-%m-%d"), *(round(float(x), 2) for x in row[:4]), int(row[4] or 0)]
                 for d, row in zip(hist.index, hist[["Open", "High", "Low", "Close", "Volume"]].fillna(0).values)]
        _json(dados / "precos" / f"{papel}.json", velas)
