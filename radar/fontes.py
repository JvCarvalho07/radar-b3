"""Coleta de dados: fundamentos (Fundamentus), preços (Yahoo Finance) e dólar (AwesomeAPI).

Fundamentos e histórico de 1 ano são baixados uma vez por dia e guardados em cache/;
nas execuções seguintes do mesmo dia só os últimos pregões são atualizados. Isso evita
bloqueios das fontes gratuitas quando o Radar roda a cada 15 minutos.
"""

import io
import logging
import pickle
import warnings
from datetime import date
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

log = logging.getLogger(__name__)

# O yfinance ainda usa APIs do pandas marcadas como obsoletas; os avisos só poluem a saída.
warnings.filterwarnings("ignore", module="yfinance")

PASTA_CACHE = Path(__file__).resolve().parent.parent / "cache"
URL_FUNDAMENTUS = "https://www.fundamentus.com.br/resultado.php"
URL_DOLAR = "https://economia.awesomeapi.com.br/json/last/USD-BRL"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# Colunas do Fundamentus na ordem em que vêm na tabela. Mapeamos por posição
# porque os cabeçalhos originais têm acentos e abreviações instáveis.
COLUNAS_FUNDAMENTUS = [
    "papel", "cotacao", "pl", "pvp", "psr", "dy", "p_ativo", "p_cap_giro",
    "p_ebit", "p_ativ_circ_liq", "ev_ebit", "ev_ebitda", "mrg_bruta",
    "mrg_ebit", "mrg_liq", "liq_corr", "roic", "roe", "liq_2meses",
    "patrim_liq", "div_liq_patrim", "cresc_rec_5a",
]


def _cache(nome: str) -> Path:
    PASTA_CACHE.mkdir(exist_ok=True)
    return PASTA_CACHE / f"{nome}_{date.today():%Y-%m-%d}.pkl"


def _ler_cache(arq: Path):
    """Lê um cache; se estiver corrompido ou foi salvo por outro ambiente, descarta."""
    if not arq.exists():
        return None
    try:
        return pickle.loads(arq.read_bytes())
    except Exception as erro:
        log.warning("Cache %s ilegível (%s); baixando de novo.", arq.name, erro)
        arq.unlink(missing_ok=True)
        return None


def _limpar_cache_antigo():
    hoje = f"{date.today():%Y-%m-%d}"
    for arq in PASTA_CACHE.glob("*.pkl"):
        if hoje not in arq.name:
            arq.unlink(missing_ok=True)


def _numero_br(valor):
    """Converte '1.234,56%' ou '-0,5' em float (percentuais ficam em pontos)."""
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).strip().replace("%", "")
    # Algumas colunas chegam já com ponto decimal ("-5.16"); outras em formato BR.
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return float("nan")


def baixar_fundamentus() -> pd.DataFrame:
    """Tabela com ~1000 papéis da B3 e seus indicadores (cache de 1 dia)."""
    arq = _cache("fundamentus")
    em_cache = _ler_cache(arq)
    if em_cache is not None:
        return em_cache
    resp = requests.get(URL_FUNDAMENTUS, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    html = resp.content.decode("iso-8859-1")
    df = pd.read_html(io.StringIO(html), decimal=",", thousands=".")[0]
    if len(df.columns) != len(COLUNAS_FUNDAMENTUS):
        raise RuntimeError(
            f"O Fundamentus mudou o formato da tabela ({len(df.columns)} colunas, "
            f"esperado {len(COLUNAS_FUNDAMENTUS)}). Revise COLUNAS_FUNDAMENTUS."
        )
    df.columns = COLUNAS_FUNDAMENTUS
    for col in COLUNAS_FUNDAMENTUS[1:]:
        if df[col].dtype == object or str(df[col].dtype) == "str":
            df[col] = df[col].map(_numero_br)
    df["papel"] = df["papel"].astype(str).str.strip().str.upper()
    df = df.set_index("papel")
    # Bancos e seguradoras: o Fundamentus zera indicadores que não se aplicam a eles.
    df["financeira"] = (df["liq_corr"] == 0) & (df["div_liq_patrim"] == 0)
    _limpar_cache_antigo()
    arq.write_bytes(pickle.dumps(df))
    return df


def _download(papeis, periodo) -> dict[str, pd.DataFrame]:
    papeis = sorted(set(papeis))
    if not papeis:
        return {}
    tickers = [f"{p}.SA" for p in papeis]
    dados = yf.download(
        tickers, period=periodo, interval="1d", group_by="ticker",
        auto_adjust=False, progress=False, threads=True,
    )
    historicos = {}
    for papel, ticker in zip(papeis, tickers):
        try:
            df = dados[ticker] if len(tickers) > 1 else dados
            if isinstance(df.columns, pd.MultiIndex):
                df = df.droplevel(0, axis=1)
            df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        except KeyError:
            continue
        if not df.empty:
            df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
            historicos[papel] = df
        else:
            log.info("Sem histórico no Yahoo para %s", papel)
    return historicos


def baixar_historico(papeis) -> dict[str, pd.DataFrame]:
    """Histórico diário de 1 ano. Usa o cache do dia e atualiza só os últimos pregões."""
    papeis = set(papeis)
    arq = _cache("historico")
    cache = _ler_cache(arq) or {}

    faltando = papeis - set(cache)
    cache.update(_download(faltando, "1y"))

    ja_tinha = papeis & set(cache) - faltando
    for papel, recente in _download(ja_tinha, "5d").items():
        junto = pd.concat([cache[papel], recente])
        cache[papel] = junto[~junto.index.duplicated(keep="last")].sort_index()

    arq.write_bytes(pickle.dumps(cache))
    return {p: cache[p] for p in papeis if p in cache}


def metricas_de_preco(hist: pd.DataFrame) -> dict:
    """Queda desde a máxima de 52 semanas e variações recentes, em %."""
    fech = hist["Close"]
    ultimo = float(fech.iloc[-1])

    def variacao(dias):
        if len(fech) <= dias:
            return float("nan")
        return (ultimo / float(fech.iloc[-1 - dias]) - 1) * 100

    maxima = float(hist["High"].max())
    return {
        "preco": ultimo,
        "maxima_52s": maxima,
        "queda_52s": (1 - ultimo / maxima) * 100 if maxima else float("nan"),
        "var_dia": variacao(1),
        "var_30d": variacao(21),
        "var_1a": (ultimo / float(fech.iloc[0]) - 1) * 100,
        "data_preco": hist.index[-1].strftime("%Y-%m-%d"),
    }


def resumo_mercado() -> dict:
    """Ibovespa (Yahoo) e dólar comercial (AwesomeAPI): valor e variação do dia."""
    resultado = {}
    try:
        fech = yf.Ticker("^BVSP").history(period="10d")["Close"].dropna()
        resultado["ibovespa"] = {
            "valor": float(fech.iloc[-1]),
            "var_dia": (float(fech.iloc[-1]) / float(fech.iloc[-2]) - 1) * 100,
            "data": fech.index[-1].strftime("%Y-%m-%d"),
        }
    except Exception as erro:
        log.warning("Falha ao obter Ibovespa: %s", erro)
    try:
        d = requests.get(URL_DOLAR, headers=HEADERS, timeout=20).json()["USDBRL"]
        resultado["dolar"] = {
            "valor": float(d["bid"]), "var_dia": float(d["pctChange"]), "data": d["create_date"],
        }
    except Exception as erro:
        log.warning("Falha ao obter dólar: %s", erro)
    return resultado
