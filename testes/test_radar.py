"""Testes do lado Python do Radar. Rodar da raiz do projeto:

    .venv/Scripts/python -m unittest discover -s testes -v

Não acessam a internet: só funções puras com dados de mentira.
"""

import math
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

from radar import alertas, analise, fontes, publicar, screener

NAN = float("nan")


def velas(fechamentos, abertura=None):
    """Série diária simples: abertura/máxima/mínima iguais ao fechamento, salvo se informado."""
    idx = pd.date_range("2025-01-01", periods=len(fechamentos), freq="B")
    c = pd.Series(fechamentos, index=idx, dtype=float)
    o = pd.Series(abertura if abertura is not None else fechamentos, index=idx, dtype=float)
    return pd.DataFrame({"Open": o, "High": c, "Low": c, "Close": c, "Volume": 1000.0})


class Estrategias(unittest.TestCase):
    CRIT = [{"campo": "pl", "min": 0.5, "max": 10}, {"campo": "dy", "min": 6}]

    def test_passa(self):
        passou, ok, falhas = screener.avaliar(pd.Series({"pl": 8.0, "dy": 7.0}), self.CRIT)
        self.assertTrue(passou)
        self.assertEqual(len(ok), 2)
        self.assertEqual(falhas, [])

    def test_falha_fora_do_limite(self):
        passou, _, falhas = screener.avaliar(pd.Series({"pl": 12.0, "dy": 7.0}), self.CRIT)
        self.assertFalse(passou)
        self.assertIn("P/L", falhas[0])

    def test_sem_dado_reprova(self):
        passou, _, falhas = screener.avaliar(pd.Series({"pl": NAN, "dy": 7.0}), self.CRIT)
        self.assertFalse(passou)
        self.assertIn("sem dado", falhas[0])

    def test_limites_inclusivos(self):
        self.assertTrue(screener.avaliar(pd.Series({"pl": 10.0, "dy": 6.0}), self.CRIT)[0])

    def test_regras_de_banco(self):
        est = {"criterios": ["comum"], "criterios_financeiras": ["banco"]}
        self.assertEqual(screener.criterios_para(est, False), ["comum"])
        self.assertEqual(screener.criterios_para(est, True), ["banco"])
        self.assertIsNone(screener.criterios_para({"criterios": ["comum"]}, True))

    def test_regras_de_banco_do_config_usam_campos_que_existem(self):
        """Regra de banco com campo que o Fundamentus não tem para bancos reprova todos (bug do ITUB4)."""
        for chave, est in screener.carregar_config()["estrategias"].items():
            for c in est.get("criterios_financeiras") or []:
                self.assertNotIn(c["campo"], fontes.NAO_SE_APLICA_FIN, f"{chave}: {c['campo']}")


class ZerosDeBanco(unittest.TestCase):
    def setUp(self):
        self.df = pd.DataFrame({
            "mrg_liq": [0.0, 0.0, 12.0], "roic": [0.0, 5.0, 0.0], "roe": [20.0, 0.0, 15.0],
            "financeira": [True, False, True],
        }, index=["BANC4", "EMPR3", "SEGU3"])

    def test_zero_de_banco_vira_sem_dado(self):
        df = fontes._sem_zeros_de_banco(self.df)
        self.assertTrue(math.isnan(df.loc["BANC4", "mrg_liq"]))
        self.assertTrue(math.isnan(df.loc["SEGU3", "roic"]))

    def test_nao_mexe_em_empresa_comum_nem_em_valor_real(self):
        df = fontes._sem_zeros_de_banco(self.df)
        self.assertEqual(df.loc["EMPR3", "mrg_liq"], 0.0)   # zero de empresa comum é zero mesmo
        self.assertEqual(df.loc["SEGU3", "mrg_liq"], 12.0)  # valor real de banco fica
        self.assertEqual(df.loc["EMPR3", "roe"], 0.0)       # ROE existe para todos

    def test_nao_altera_o_original(self):
        fontes._sem_zeros_de_banco(self.df)
        self.assertEqual(self.df.loc["BANC4", "mrg_liq"], 0.0)


class NumerosBR(unittest.TestCase):
    def test_formatos(self):
        self.assertEqual(fontes._numero_br("1.234,56"), 1234.56)
        self.assertEqual(fontes._numero_br("12,5%"), 12.5)
        self.assertEqual(fontes._numero_br("-0,5"), -0.5)
        self.assertEqual(fontes._numero_br("-5.16"), -5.16)
        self.assertTrue(math.isnan(fontes._numero_br("-")))


class PrecoJusto(unittest.TestCase):
    def test_graham_e_bazin(self):
        r = analise.preco_justo(preco=20, pl=10, pvp=2, dy=6)
        self.assertAlmostEqual(r["lpa"], 2)
        self.assertAlmostEqual(r["vpa"], 10)
        self.assertAlmostEqual(r["graham"], round(math.sqrt(22.5 * 2 * 10), 2))
        self.assertAlmostEqual(r["bazin"], 20)   # DPA 1,20 ÷ 6%

    def test_dividendo_fora_do_normal(self):
        # histórico desde 2022; janela dos 3 anos anteriores (out/2022 a out/2025): 1,00 por ano
        anos = [["2022-06-01", 1.0], ["2023-06-01", 1.0], ["2024-06-01", 1.0], ["2025-06-01", 1.0]]
        normal = {"dy": 15, "proventos_todos": anos + [["2026-06-01", 1.2]]}
        extra = {"dy": 30, "proventos_todos": anos + [["2026-06-01", 3.0]]}
        self.assertIsNone(analise.dividendo_fora_do_normal(normal, 8, hoje="2026-10-28"))
        r = analise.dividendo_fora_do_normal(extra, 10, hoje="2026-10-28")
        self.assertAlmostEqual(r["ultimo"], 3.0)
        self.assertAlmostEqual(r["media"], 1.0)
        # com o aviso, o preço-teto de Bazin (que supõe dividendo recorrente) não conta a favor
        u = {**extra, "preco": 10, "bazin": 50}
        with mock.patch.object(analise, "dividendo_fora_do_normal", return_value=r):
            a_favor, atencao = analise.sinais(u, 0)
        self.assertFalse(any("Bazin" in a["t"] for a in a_favor))
        self.assertTrue(any("fora do normal" in a["t"] for a in atencao))

    def test_dividendo_com_historico_curto(self):
        curto = {"dy": 40, "proventos_todos": [["2025-12-01", 2.0], ["2026-05-01", 0.1]]}
        self.assertIn("maior", analise.dividendo_fora_do_normal(curto, 5, hoje="2026-10-28"))
        self.assertIsNone(analise.dividendo_fora_do_normal({**curto, "dy": 8}, 5, hoje="2026-10-28"))

    def test_sem_lucro_nao_tem_graham(self):
        self.assertNotIn("graham", analise.preco_justo(preco=20, pl=-5, pvp=2, dy=0))


class Velas(unittest.TestCase):
    def test_abertura_zerada_recebe_o_fechamento(self):
        h = analise.velas_validas(velas([10, 11, 12], abertura=[0, 11, 12]))
        self.assertEqual(h["Open"].iloc[0], 10)

    def test_barra_fora_de_escala_sai(self):
        fech = [10.0] * 30
        fech[15] = 1000.0
        h = analise.velas_validas(velas(fech))
        self.assertEqual(len(h), 29)
        self.assertTrue(analise.escala_quebrada(velas(fech)))

    def test_serie_normal_fica_inteira(self):
        fech = [10 + i * 0.1 for i in range(40)]
        self.assertEqual(len(analise.velas_validas(velas(fech))), 40)
        self.assertFalse(analise.escala_quebrada(velas(fech)))
        self.assertFalse(analise.suspeito(velas(fech)))

    def test_salto_de_2x_e_suspeito(self):
        self.assertTrue(analise.suspeito(velas([10.0] * 10 + [20.0] * 10)))

    def test_grafico_comeca_depois_do_ultimo_salto(self):
        """Grupamento sem ajuste (7 → 341, depois 217 → 30): o gráfico fica só com o trecho final."""
        h = velas([7.0] * 5 + [341.0] * 5 + [30.0] * 6)
        self.assertEqual(list(analise.depois_do_ultimo_salto(h)["Close"]), [30.0] * 6)
        normal = velas([10 + i * 0.1 for i in range(20)])
        self.assertEqual(len(analise.depois_do_ultimo_salto(normal)), 20)


class Alertas(unittest.TestCase):
    CONFIG = {"estrategias": {"caiu": {"nome": "Caiu demais", "criterios": [
        {"campo": "pl", "min": 0.5, "max": 15}, {"campo": "queda_52s", "min": 30}]}}}

    def _rodada(self, universo, membros, anterior, watchlist=()):
        resultado = {"estrategias": {"caiu": {"nome": "Caiu demais", "papeis": [
            {"papel": p, "preco": 10.0, "motivos": ["ok"]} for p in membros]}}, "watchlist": list(watchlist)}
        return alertas.calcular_mudancas(resultado, self.CONFIG, universo, anterior)

    def test_sem_preco_nao_e_saida(self):
        """O Yahoo não devolveu o preço de XYZ3 nesta rodada: nada de "saiu" (e depois "entrou")."""
        universo = pd.DataFrame({"pl": [8.0], "queda_52s": [NAN], "financeira": [False]}, index=["XYZ3"])
        linhas, novo = self._rodada(universo, [], {"estrategias": {"caiu": ["XYZ3"]}})
        self.assertEqual(linhas, [])
        self.assertEqual(novo["estrategias"]["caiu"], ["XYZ3"])

    def test_saida_de_verdade_avisa(self):
        universo = pd.DataFrame({"pl": [8.0], "queda_52s": [12.0], "financeira": [False]}, index=["XYZ3"])
        linhas, novo = self._rodada(universo, [], {"estrategias": {"caiu": ["XYZ3"]}})
        self.assertTrue(any(l.startswith("- XYZ3 saiu") for l in linhas))
        self.assertEqual(novo["estrategias"]["caiu"], [])

    def test_alerta_de_preco_nao_repete_depois_de_rodada_sem_preco(self):
        universo = pd.DataFrame({"pl": [8.0], "queda_52s": [40.0], "financeira": [False]}, index=["XYZ3"])
        w = {"papel": "BBAS3", "abaixo_de": 20.0, "acima_de": None}
        anterior = {"estrategias": {"caiu": ["XYZ3"]}, "watchlist": {"BBAS3": {"abaixo": True, "acima": False}}}
        _, novo = self._rodada(universo, ["XYZ3"], anterior, [{**w, "preco": None}])
        self.assertEqual(novo["watchlist"]["BBAS3"], {"abaixo": True, "acima": False})
        linhas, _ = self._rodada(universo, ["XYZ3"], novo, [{**w, "preco": 19.0}])
        self.assertFalse(any("BBAS3" in l for l in linhas))

    def test_secret_com_linha_estragada_nao_derruba(self):
        bom = '{"endpoint": "https://exemplo/1", "keys": {}}'
        with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": bom + "\nisso não é json\n" + bom}):
            self.assertEqual(len(alertas._inscricoes()), 2)
        with mock.patch.dict(os.environ, {"PUSH_SUBSCRIPTIONS": "[quebrado"}):
            self.assertEqual(alertas._inscricoes(), [])


class DataDeBrasilia(unittest.TestCase):
    def test_cache_usa_a_data_de_brasilia(self):
        """Às 22h de Brasília já é 1h do dia seguinte em UTC; o cache tem que continuar sendo o de hoje."""
        from datetime import datetime, timezone
        utc = datetime(2026, 10, 29, 1, 0, tzinfo=timezone.utc)
        with mock.patch.object(fontes, "datetime") as dt:
            dt.now.side_effect = lambda tz=None: utc.astimezone(tz)
            self.assertEqual(str(fontes._hoje()), "2026-10-28")


class CarimboDeVersao(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        self.site.mkdir()
        (self.site / "sw.js").write_text('const VERSAO = "radar-v1";\nconst X = 1;\n', encoding="utf-8")
        (self.site / "app.js").write_text("console.log(1);\n", encoding="utf-8")
        self._original = publicar.PASTA_SITE
        publicar.PASTA_SITE = self.site

    def tearDown(self):
        publicar.PASTA_SITE = self._original
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _carimbo(self, nome):
        saida = self.tmp / nome
        shutil.copytree(self.site, saida)
        publicar._carimbar_versao(saida)
        linha = (saida / "sw.js").read_text(encoding="utf-8").splitlines()[0]
        return linha

    def test_mesmo_codigo_mesmo_carimbo(self):
        a, b = self._carimbo("a"), self._carimbo("b")
        self.assertEqual(a, b)
        self.assertRegex(a, r'^const VERSAO = "radar-[0-9a-f]{12}";$')

    def test_codigo_novo_muda_o_carimbo(self):
        a = self._carimbo("a")
        (self.site / "app.js").write_text("console.log(2);\n", encoding="utf-8")
        self.assertNotEqual(a, self._carimbo("b"))


if __name__ == "__main__":
    unittest.main()
