"""Aplica as estratégias do config.yaml e explica por que cada papel passou."""

import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yaml

from . import analise, fontes


def _metricas(h: pd.DataFrame) -> dict:
    """Métricas de preço sobre a série limpa. Com escala quebrada, a queda desde a máxima não é confiável."""
    v = analise.velas_validas(h)
    m = fontes.metricas_de_preco(v) if len(v) else {}
    if m and analise.escala_quebrada(h):
        m["queda_52s"] = float("nan")
    return m

RAIZ = Path(__file__).resolve().parent.parent
PASTA_DADOS = RAIZ / "dados"
FUSO = ZoneInfo("America/Sao_Paulo")

CAMPOS_PRECO = {"queda_52s", "var_dia", "var_30d", "var_1a"}
# Os indicadores que não existem para bancos ficam em fontes.NAO_SE_APLICA_FIN.

# Rótulo e se o valor é percentual (para exibição).
ROTULOS = {
    "cotacao": ("Cotação", False), "pl": ("P/L", False), "pvp": ("P/VP", False),
    "psr": ("PSR", False), "dy": ("DY", True), "ev_ebit": ("EV/EBIT", False),
    "ev_ebitda": ("EV/EBITDA", False), "mrg_bruta": ("Margem bruta", True),
    "mrg_ebit": ("Margem EBIT", True), "mrg_liq": ("Margem líquida", True),
    "liq_corr": ("Liquidez corrente", False), "roic": ("ROIC", True),
    "roe": ("ROE", True), "liq_2meses": ("Volume médio", False),
    "patrim_liq": ("Patrimônio líquido", False),
    "div_liq_patrim": ("Dív. líq./Patrim.", False),
    "cresc_rec_5a": ("Cresc. receita 5a", True),
    "queda_52s": ("Abaixo da máx. 52s", True), "var_dia": ("Var. dia", True),
    "var_30d": ("Var. 30d", True), "var_1a": ("Var. 1 ano", True),
}


def carregar_config(caminho=RAIZ / "config.yaml") -> dict:
    with open(caminho, encoding="utf-8") as f:
        return yaml.safe_load(f)


def agora() -> datetime:
    return datetime.now(FUSO)


def fmt_num(valor, casas=2) -> str:
    """1234.5 -> '1.234,50'"""
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return "—"
    return f"{valor:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fmt_campo(campo, valor) -> str:
    rotulo, pct = ROTULOS.get(campo, (campo, False))
    return f"{rotulo} {fmt_num(valor, 1 if pct else 2)}{'%' if pct else ''}"


def criterios_para(est: dict, financeira: bool) -> list[dict] | None:
    """Critérios aplicáveis ao papel; None quando a estratégia não vale para ele."""
    if not financeira:
        return est["criterios"]
    return est.get("criterios_financeiras")


def avaliar(linha: pd.Series, criterios: list[dict]) -> tuple[bool, list[str], list[str]]:
    """Retorna (passou, motivos atendidos, critérios que falharam)."""
    ok, falhas = [], []
    for c in criterios:
        campo = c["campo"]
        valor = linha.get(campo, float("nan"))
        if valor is None or pd.isna(valor):
            falhas.append(f"{ROTULOS.get(campo, (campo,))[0]} sem dado")
            continue
        dentro = ("min" not in c or valor >= c["min"]) and ("max" not in c or valor <= c["max"])
        (ok if dentro else falhas).append(fmt_campo(campo, valor))
    return not falhas, ok, falhas


def rodar(config: dict | None = None) -> tuple[dict, pd.DataFrame, dict]:
    """Executa a triagem. Retorna (resultado serializável, universo, históricos)."""
    config = config or carregar_config()
    estrategias = config.get("estrategias", {})
    watchlist = config.get("watchlist", []) or []

    fund = fontes.baixar_fundamentus()
    universo = fund[fund["liq_2meses"] >= config.get("liquidez_minima", 0)].copy()

    # 1ª etapa: só fundamentos, para baixar preços apenas de quem interessa.
    candidatos = set()
    for est in estrategias.values():
        for papel, linha in universo.iterrows():
            crit = criterios_para(est, bool(linha["financeira"]))
            if crit is None:
                continue
            if avaliar(linha, [c for c in crit if c["campo"] not in CAMPOS_PRECO])[0]:
                candidatos.add(papel)
    papeis_watch = [w["papel"].upper() for w in watchlist]

    # Preços de todas as ações com liquidez (não só das candidatas), para o app mostrar
    # gráfico, régua e leitura de qualquer uma. O histórico de 1 ano vem uma vez por dia.
    historicos = fontes.baixar_historico(set(universo.index) | candidatos | set(papeis_watch))
    # Se o Yahoo falhar, abortar evita alertas falsos de "saiu" em massa.
    if candidatos and not historicos:
        raise RuntimeError("O Yahoo Finance não devolveu preços. Tente de novo em alguns minutos.")
    metricas = pd.DataFrame(
        {p: _metricas(h) for p, h in historicos.items()}
    ).T
    for col in metricas.columns.drop("data_preco", errors="ignore"):
        metricas[col] = pd.to_numeric(metricas[col], errors="coerce")
    universo = universo.join(metricas, how="left")

    # 2ª etapa: todos os critérios, incluindo os de preço.
    resultados = {}
    for chave, est in estrategias.items():
        linhas = []
        for papel, linha in universo.iterrows():
            crit = criterios_para(est, bool(linha["financeira"]))
            if crit is None:
                continue
            passou, motivos, _ = avaliar(linha, crit)
            if passou:
                linhas.append({
                    "papel": papel,
                    "financeira": bool(linha["financeira"]),
                    "preco": _float(linha.get("preco")) or _float(linha["cotacao"]),
                    "motivos": motivos,
                    **{c: _float(linha.get(c)) for c in ("pl", "pvp", "dy", "roe", "queda_52s", "var_dia")},
                })
        linhas.sort(key=lambda x: x["papel"])
        resultados[chave] = {
            "nome": est["nome"], "descricao": est.get("descricao", ""), "papeis": linhas,
            "criterios": est["criterios"], "criterios_financeiras": est.get("criterios_financeiras"),
        }

    watch = []
    for w in watchlist:
        papel = w["papel"].upper()
        m = _metricas(historicos[papel]) if papel in historicos else {}
        watch.append({
            "papel": papel, "abaixo_de": w.get("abaixo_de"), "acima_de": w.get("acima_de"),
            **{k: (_float(v) if not isinstance(v, str) else v) for k, v in m.items()},
        })

    resultado = {
        "gerado_em": agora().isoformat(timespec="seconds"),
        "total_papeis": int(len(fund)),
        "papeis_liquidos": int(len(universo)),
        "estrategias": resultados,
        "watchlist": watch,
        "mercado": fontes.resumo_mercado(),
    }
    return resultado, universo, historicos


def motivo_saida(papel: str, est: dict, universo: pd.DataFrame) -> str:
    """Explica por que um papel deixou de passar numa estratégia."""
    if papel in universo.index:
        linha = universo.loc[papel]
        crit = criterios_para(est, bool(linha["financeira"]))
        if crit:
            falhas = avaliar(linha, crit)[2]
            if falhas:
                return "não cumpre: " + ", ".join(falhas)
    return "saiu do filtro de liquidez ou ficou sem dados"


def _float(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None
