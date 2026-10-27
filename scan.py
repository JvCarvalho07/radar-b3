"""Roda a triagem, avisa o que mudou e gera o site em publico/.

Uso:  python scan.py               (triagem + notificações)
      python scan.py --sem-alerta  (só atualiza os dados do app)
"""

import argparse
import logging
import sys
from pathlib import Path

from radar import alertas, publicar, screener


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Radar B3: triagem de ações")
    parser.add_argument("--sem-alerta", action="store_true", help="não envia notificações")
    parser.add_argument("--saida", default="publico", help="pasta do site gerado (padrão: publico)")
    args = parser.parse_args()

    config = screener.carregar_config()
    print("Baixando dados (Fundamentus + Yahoo Finance + AwesomeAPI)...")
    resultado, universo, historicos = screener.rodar(config)
    print(f"{resultado['papeis_liquidos']} de {resultado['total_papeis']} papéis passaram no filtro de liquidez.")
    for est in resultado["estrategias"].values():
        print(f"  {est['nome']}: {len(est['papeis'])} papéis")

    linhas = alertas.processar(resultado, config, universo, enviar_alertas=not args.sem_alerta)
    if not linhas:
        print("Nada mudou desde a última execução.")

    publicar.gerar(resultado, universo, historicos, Path(args.saida))
    print(f"Site gerado em {args.saida}/")


if __name__ == "__main__":
    main()
