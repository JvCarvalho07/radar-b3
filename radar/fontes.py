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


CAMPOS_PERFIL = {"longName": "nome", "sector": "setor", "targetLowPrice": "alvo_min", "targetMeanPrice": "alvo_medio",
                 "targetHighPrice": "alvo_max", "numberOfAnalystOpinions": "analistas", "recommendationKey": "recomendacao"}


def baixar_perfis(papeis) -> dict[str, dict]:
    """Nome, setor e alvo de preço dos analistas (Yahoo Finance), com cache de 1 dia."""
    from concurrent.futures import ThreadPoolExecutor

    arq = _cache("perfis")
    cache = _ler_cache(arq) or {}
    faltando = sorted(set(papeis) - set(cache))

    def um(papel):
        try:
            info = yf.Ticker(f"{papel}.SA").info
            return papel, {novo: info.get(velho) for velho, novo in CAMPOS_PERFIL.items()}
        except Exception as erro:  # sem cobertura, limite de acesso etc.
            log.info("Sem perfil para %s: %s", papel, erro)
            return papel, {}

    with ThreadPoolExecutor(max_workers=6) as pool:
        cache.update(dict(pool.map(um, faltando)))
    arq.write_bytes(pickle.dumps(cache))
    return {p: cache.get(p, {}) for p in papeis}


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
    arq_ibov = _cache("ibovespa")
    fech = None
    for _ in range(2):  # o Yahoo às vezes devolve vazio; uma segunda tentativa costuma resolver
        try:
            fech = yf.Ticker("^BVSP").history(period="1y")["Close"].dropna()
            if len(fech) > 1:
                arq_ibov.write_bytes(pickle.dumps(fech))
                break
        except Exception as erro:
            log.warning("Falha ao obter Ibovespa: %s", erro)
        fech = None
    if fech is None:
        fech = _ler_cache(arq_ibov)  # último valor bom do dia
    try:
        resultado["ibovespa"] = {
            "valor": float(fech.iloc[-1]),
            "var_dia": (float(fech.iloc[-1]) / float(fech.iloc[-2]) - 1) * 100,
            "data": fech.index[-1].strftime("%Y-%m-%d"),
            # Série diária de 1 ano para o gráfico principal do app.
            "serie": [[d.strftime("%Y-%m-%d"), round(float(v))] for d, v in fech.items()],
        }
    except Exception as erro:
        log.warning("Falha ao obter Ibovespa: %s", erro)
    try:
        d = requests.get(URL_DOLAR, headers=HEADERS, timeout=20).json()["USDBRL"]
        resultado["dolar"] = {
            "valor": float(d["bid"]), "var_dia": float(d["pctChange"]), "data": d["create_date"],
            "fonte": "AwesomeAPI",
        }
    except Exception as erro:
        # A AwesomeAPI costuma recusar acessos vindos de servidores (ex.: GitHub Actions).
        log.warning("AwesomeAPI indisponível (%s); usando PTAX do Banco Central.", erro)
        try:
            resultado["dolar"] = _dolar_ptax()
        except Exception as erro_bc:
            log.warning("Falha ao obter dólar: %s", erro_bc)
    if "dolar" in resultado:
        try:
            resultado["dolar"]["serie"] = serie_dolar()
        except Exception as erro:
            log.warning("Falha na série do dólar: %s", erro)
    return resultado


def serie_dolar() -> list:
    """PTAX diária de 1 ano (Banco Central), para o gráfico do dólar. Cache de 1 dia."""
    arq = _cache("dolar_serie")
    em_cache = _ler_cache(arq)
    if em_cache:
        return em_cache
    fim = date.today()
    inicio = fim - pd.Timedelta(days=370)
    url = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"
           "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
           f"?@dataInicial='{inicio:%m-%d-%Y}'&@dataFinalCotacao='{fim:%m-%d-%Y}'&$format=json")
    serie = [[c["dataHoraCotacao"][:10], round(float(c["cotacaoVenda"]), 4)]
             for c in requests.get(url, headers=HEADERS, timeout=30).json()["value"]]
    arq.write_bytes(pickle.dumps(serie))
    return serie


# Bolsas do mundo: ticker do Yahoo → (código numérico ISO do país, como no mapa world-atlas; país; índice)
INDICES = {
    "^GSPC": ("840", "Estados Unidos", "S&P 500"), "^GSPTSE": ("124", "Canadá", "S&P/TSX"), "^MXX": ("484", "México", "IPC"),
    "^BVSP": ("076", "Brasil", "Ibovespa"), "^FTSE": ("826", "Reino Unido", "FTSE 100"), "^GDAXI": ("276", "Alemanha", "DAX"),
    "^FCHI": ("250", "França", "CAC 40"), "FTSEMIB.MI": ("380", "Itália", "FTSE MIB"), "^IBEX": ("724", "Espanha", "IBEX 35"),
    "^N225": ("392", "Japão", "Nikkei 225"), "000001.SS": ("156", "China", "Xangai"), "^KS11": ("410", "Coreia do Sul", "KOSPI"),
    "^BSESN": ("356", "Índia", "Sensex"), "^AXJO": ("036", "Austrália", "ASX 200"), "^TWII": ("158", "Taiwan", "TAIEX"),
}
# Moedas com PTAX no Banco Central → países que as usam
ZONA_EURO = {"276": "Alemanha", "250": "França", "380": "Itália", "724": "Espanha", "620": "Portugal", "528": "Países Baixos",
             "056": "Bélgica", "040": "Áustria", "372": "Irlanda", "246": "Finlândia", "300": "Grécia", "703": "Eslováquia",
             "705": "Eslovênia", "233": "Estônia", "428": "Letônia", "440": "Lituânia", "196": "Chipre", "442": "Luxemburgo", "191": "Croácia"}
MOEDAS = {
    "USD": ("Dólar americano", {"840": "Estados Unidos"}), "EUR": ("Euro", ZONA_EURO), "GBP": ("Libra esterlina", {"826": "Reino Unido"}),
    "JPY": ("Iene", {"392": "Japão"}), "CHF": ("Franco suíço", {"756": "Suíça"}), "CAD": ("Dólar canadense", {"124": "Canadá"}),
    "AUD": ("Dólar australiano", {"036": "Austrália"}), "DKK": ("Coroa dinamarquesa", {"208": "Dinamarca"}),
    "NOK": ("Coroa norueguesa", {"578": "Noruega"}), "SEK": ("Coroa sueca", {"752": "Suécia"}),
}


def _ptax_moeda(moeda: str) -> dict | None:
    fim = date.today()
    inicio = fim - pd.Timedelta(days=10)
    url = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"
           "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
           f"?@moeda='{moeda}'&@dataInicial='{inicio:%m-%d-%Y}'&@dataFinalCotacao='{fim:%m-%d-%Y}'"
           "&$format=json&$filter=tipoBoletim%20eq%20'Fechamento'")
    v = requests.get(url, headers=HEADERS, timeout=20).json()["value"]
    if len(v) < 2:
        return None
    atual, anterior = float(v[-1]["cotacaoVenda"]), float(v[-2]["cotacaoVenda"])
    return {"valor": atual, "var": (atual / anterior - 1) * 100, "data": v[-1]["dataHoraCotacao"][:10]}


def baixar_mundo() -> dict:
    """Bolsas do mundo (Yahoo) e moedas contra o real (PTAX). Nunca derruba a triagem."""
    arq = _cache("mundo")
    anterior = _ler_cache(arq) or {}
    mundo = {"bolsas": {}, "moedas": {}}
    try:
        dados = yf.download(list(INDICES), period="7d", interval="1d", progress=False, group_by="ticker", auto_adjust=False)
        for tk, (iso, pais, nome) in INDICES.items():
            try:
                fech = dados[tk]["Close"].dropna()
                if len(fech) >= 2:
                    mundo["bolsas"][iso] = {"pais": pais, "nome": nome, "valor": round(float(fech.iloc[-1]), 2),
                                            "var": round((float(fech.iloc[-1]) / float(fech.iloc[-2]) - 1) * 100, 2),
                                            "data": fech.index[-1].strftime("%Y-%m-%d")}
            except (KeyError, IndexError):
                continue
    except Exception as erro:
        log.warning("Falha ao obter bolsas do mundo: %s", erro)
    for moeda, (nome, paises) in MOEDAS.items():
        try:
            c = _ptax_moeda(moeda)
        except Exception as erro:
            log.warning("Falha na PTAX de %s: %s", moeda, erro)
            c = None
        if c:
            for iso, pais in paises.items():
                mundo["moedas"][iso] = {"pais": pais, "moeda": moeda, "nome": nome, "valor": round(c["valor"], 4),
                                        "var": round(c["var"], 2), "data": c["data"]}
    # O que falhou agora fica com o último valor bom do dia.
    for parte in ("bolsas", "moedas"):
        if not mundo[parte] and anterior.get(parte):
            mundo[parte] = anterior[parte]
    arq.write_bytes(pickle.dumps(mundo))
    return mundo


def _dolar_ptax() -> dict:
    """Última PTAX (oficial do Banco Central) e variação contra o dia útil anterior."""
    fim = date.today()
    inicio = fim - pd.Timedelta(days=10)
    url = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"
           "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)"
           f"?@dataInicial='{inicio:%m-%d-%Y}'&@dataFinalCotacao='{fim:%m-%d-%Y}'&$format=json")
    cotacoes = requests.get(url, headers=HEADERS, timeout=20).json()["value"]
    atual, anterior = cotacoes[-1], cotacoes[-2]
    return {
        "valor": float(atual["cotacaoVenda"]),
        "var_dia": (float(atual["cotacaoVenda"]) / float(anterior["cotacaoVenda"]) - 1) * 100,
        "data": atual["dataHoraCotacao"][:16],
        "fonte": "PTAX/BC",
    }
