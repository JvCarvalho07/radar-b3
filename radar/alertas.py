"""Compara com a execução anterior e avisa só o que mudou, por notificação push do app."""

import json
import logging
import os
import tempfile
from datetime import datetime

import pandas as pd

from .screener import CAMPOS_PRECO, PASTA_DADOS, RAIZ, criterios_para, fmt_num, motivo_saida

log = logging.getLogger(__name__)

ARQ_ESTADO = PASTA_DADOS / "estado.json"
ARQ_HISTORICO = PASTA_DADOS / "historico_alertas.jsonl"
AVISO = "Triagem pelos critérios definidos por você. Não é recomendação de compra ou venda."
# Domínio do app; vai na assinatura VAPID para os serviços de push saberem quem envia.
# (A biblioteca só aceita "https://dominio", sem caminho.)
URL_APP = "https://jvcarvalho07.github.io"


def _ler_estado() -> dict | None:
    if ARQ_ESTADO.exists():
        return json.loads(ARQ_ESTADO.read_text(encoding="utf-8"))
    return None


def _sem_preco(papel: str, est: dict, universo: pd.DataFrame) -> bool:
    """O papel só ficou de fora porque o Yahoo não devolveu o preço desta vez (regra de preço sem dado).
    Isso não é saída de verdade: avisar "saiu" agora e "entrou" na próxima rodada seria alarme falso."""
    if papel not in universo.index:
        return False
    linha = universo.loc[papel]
    crit = criterios_para(est, bool(linha.get("financeira")))
    return bool(crit) and any(c["campo"] in CAMPOS_PRECO and pd.isna(linha.get(c["campo"])) for c in crit)


def calcular_mudancas(resultado: dict, config: dict, universo: pd.DataFrame,
                      anterior: dict | None) -> tuple[list[str], dict]:
    """Gera as linhas do alerta e o novo estado a ser salvo."""
    novo = {"estrategias": {}, "watchlist": {}}
    linhas = []

    for chave, est in resultado["estrategias"].items():
        atuais = {p["papel"]: p for p in est["papeis"]}
        novo["estrategias"][chave] = sorted(atuais)
        if anterior is None:
            continue
        antes = set(anterior.get("estrategias", {}).get(chave, []))
        entraram = sorted(set(atuais) - antes)
        sairam = sorted(antes - set(atuais))
        # Sem preço nesta rodada: continua no estado como estava e decide quando o preço voltar.
        sem_preco = [p for p in sairam if _sem_preco(p, config["estrategias"][chave], universo)]
        if sem_preco:
            sairam = [p for p in sairam if p not in sem_preco]
            novo["estrategias"][chave] = sorted(set(atuais) | set(sem_preco))
        if not (entraram or sairam):
            continue
        linhas.append(f"[{est['nome']}]")
        for p in entraram:
            info = atuais[p]
            linhas.append(f"+ {p} (R$ {fmt_num(info['preco'])}): " + " · ".join(info["motivos"]))
        for p in sairam:
            linhas.append(f"- {p} saiu: {motivo_saida(p, config['estrategias'][chave], universo)}")

    alertas_preco = []
    estado_watch = (anterior or {}).get("watchlist", {})
    for w in resultado["watchlist"]:
        preco = w.get("preco")
        if preco is None:   # sem preço nesta rodada: guarda o que já tinha, para não repetir o alerta depois
            if w["papel"] in estado_watch:
                novo["watchlist"][w["papel"]] = estado_watch[w["papel"]]
            continue
        flags = {
            "abaixo": w.get("abaixo_de") is not None and preco <= w["abaixo_de"],
            "acima": w.get("acima_de") is not None and preco >= w["acima_de"],
        }
        novo["watchlist"][w["papel"]] = flags
        antes = estado_watch.get(w["papel"], {})
        # Avisa só quando cruza o nível (não a cada execução).
        if flags["abaixo"] and not antes.get("abaixo"):
            alertas_preco.append(f"{w['papel']} caiu para R$ {fmt_num(preco)} (seu alerta: abaixo de R$ {fmt_num(w['abaixo_de'])})")
        if flags["acima"] and not antes.get("acima"):
            alertas_preco.append(f"{w['papel']} subiu para R$ {fmt_num(preco)} (seu alerta: acima de R$ {fmt_num(w['acima_de'])})")
    if alertas_preco:
        linhas.append("[Alertas de preço]")
        linhas += alertas_preco

    if anterior is None:
        resumo = ", ".join(f"{e['nome']}: {len(e['papeis'])}" for e in resultado["estrategias"].values())
        linhas.insert(0, f"Primeira execução. Papéis em cada estratégia: {resumo}. "
                         "A partir de agora você recebe só o que entrar ou sair.")
    return linhas, novo


def _inscricoes() -> list[dict]:
    """Aparelhos inscritos: variável PUSH_SUBSCRIPTIONS (Actions) ou inscricoes_push.txt (local).

    Aceita uma lista JSON ou um objeto JSON por linha.
    """
    texto = os.getenv("PUSH_SUBSCRIPTIONS", "")
    arq = RAIZ / "inscricoes_push.txt"
    if not texto.strip() and arq.exists():
        texto = arq.read_text(encoding="utf-8")
    texto = texto.strip()
    if not texto:
        return []
    # Uma linha estragada no secret não pode derrubar a rodada inteira: pula a linha e avisa qual foi.
    if texto.startswith("["):
        try:
            lista = json.loads(texto)
            return [i for i in lista if isinstance(i, dict)] if isinstance(lista, list) else []
        except json.JSONDecodeError:
            log.error("PUSH_SUBSCRIPTIONS não é uma lista JSON válida; nenhuma notificação enviada.")
            return []
    inscricoes = []
    for n, linha in enumerate(texto.splitlines(), 1):
        if not linha.strip():
            continue
        try:
            item = json.loads(linha)
        except json.JSONDecodeError:
            log.error("PUSH_SUBSCRIPTIONS: linha %d não é um código válido; pulei essa linha.", n)
            continue
        if isinstance(item, dict):
            inscricoes.append(item)
    return inscricoes


def _tem_chave() -> bool:
    return bool(os.getenv("VAPID_PRIVATE_KEY", "").strip()) or (RAIZ / "vapid_private.pem").exists()


def _chave_vapid() -> tuple[str | None, bool]:
    """Caminho do arquivo da chave privada e se ele é temporário (criado a partir de VAPID_PRIVATE_KEY,
    que precisa ser apagado depois do envio)."""
    pem = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    if pem:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
        tmp.write(pem + "\n")
        tmp.close()
        return tmp.name, True
    arq = RAIZ / "vapid_private.pem"
    return (str(arq), False) if arq.exists() else (None, False)


def enviar_push(titulo: str, corpo: str) -> dict:
    """Envia a notificação para todos os aparelhos e devolve um resumo do envio."""
    inscricoes = _inscricoes()
    status = {"configurado": bool(inscricoes and _tem_chave()), "inscricoes": len(inscricoes),
              "enviadas": 0, "expiradas": 0}
    if not status["configurado"]:
        return status
    from pywebpush import WebPushException, webpush

    chave, temporaria = _chave_vapid()
    carga = json.dumps({"titulo": titulo, "corpo": corpo, "url": "./#alertas"}, ensure_ascii=False)
    try:
        for n, insc in enumerate(inscricoes, 1):
            try:
                webpush(insc, carga, vapid_private_key=chave, vapid_claims={"sub": URL_APP}, ttl=6 * 3600)
                status["enviadas"] += 1
            except WebPushException as erro:
                codigo = getattr(erro.response, "status_code", None)
                if codigo in (404, 410):
                    status["expiradas"] += 1  # o aparelho desinscreveu ou a inscrição venceu
                else:
                    # Os logs do Actions são públicos: só o código, nunca o endereço do aparelho.
                    log.error("Falha no push do aparelho %d (HTTP %s).", n, codigo)
            except Exception as erro:  # rede, inscrição malformada etc.
                log.error("Falha no push do aparelho %d (%s).", n, type(erro).__name__)
    finally:
        if temporaria:
            os.unlink(chave)
    return status


def processar(resultado: dict, config: dict, universo: pd.DataFrame, enviar_alertas=True) -> list[str]:
    """Calcula mudanças, notifica, grava estado e histórico. Anexa o status do push ao resultado."""
    PASTA_DADOS.mkdir(exist_ok=True)
    anterior = _ler_estado()
    linhas, novo_estado = calcular_mudancas(resultado, config, universo, anterior)
    status_push = (anterior or {}).get("push") or {"configurado": bool(_inscricoes() and _tem_chave()),
                                                   "inscricoes": len(_inscricoes())}

    if linhas:
        with open(ARQ_HISTORICO, "a", encoding="utf-8") as f:
            f.write(json.dumps({"em": resultado["gerado_em"], "linhas": linhas}, ensure_ascii=False) + "\n")
        texto = "\n".join(linhas)
        print(f"Radar B3 - {datetime.fromisoformat(resultado['gerado_em']):%d/%m %H:%M}\n{texto}\n\n{AVISO}")
        if enviar_alertas:
            mudancas = sum(1 for l in linhas if l[:1] in "+-") + sum(1 for l in linhas if "seu alerta" in l)
            titulo = f"Radar B3: {mudancas} mudança{'s' if mudancas != 1 else ''}" if mudancas else "Radar B3"
            corpo = "\n".join(l for l in linhas if not l.startswith("["))[:300]
            status_push = enviar_push(titulo, corpo)
            status_push["em"] = resultado["gerado_em"]
            if not status_push["configurado"]:
                print("\n(Push não configurado: alerta exibido só aqui e no histórico do app. Veja o README.)")

    novo_estado["push"] = status_push
    resultado["push"] = status_push
    ARQ_ESTADO.write_text(json.dumps(novo_estado, ensure_ascii=False, indent=1), encoding="utf-8")
    return linhas


def ler_historico(limite=100) -> list[dict]:
    if not ARQ_HISTORICO.exists():
        return []
    regs = []
    for l in ARQ_HISTORICO.read_text(encoding="utf-8").splitlines()[-limite:]:
        try:
            regs.append(json.loads(l))
        except json.JSONDecodeError:
            continue   # linha vazia ou cortada (rodada interrompida no meio da gravação)
    return regs[::-1]
