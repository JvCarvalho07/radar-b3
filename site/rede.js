// Rede do Radar v4 (substitui site/rede.js). Sem d3, sem build.
// Regra igual à do radar/screener.py: critério reprovado ou sem dado (nulo) conta como falta; zero é valor.
// Anel (de dentro para fora): 0 = entra numa estratégia; 1 = falta 1 critério; 2 = faltam 2; 3 = faltam 3 ou mais.
// Cor: estratégia em que a ação chega mais perto. Empate: vale a primeira na ordem do config.yaml, e o cartão diz quais empataram.
// Ao focar ou passar o mouse: linha cheia = entra; pontilhada = falta 1 critério.
// Até 760 px: lista. Acima: roda, e a mesma lista num bloco recolhível abaixo dela.
// Só .rede-caixa é reescrito, então o globo (mesmo slot) não é apagado ao trocar de largura.

const ANEL_R = [104, 170, 236, 300];
const RAIO_CAPTURA = 10; // unidades do SVG (viewBox 800)
const MQ_CELULAR = "(max-width: 760px)";
const LARG_CARACTERE = 6.6; // px por caractere de texto 11px negrito (aproximação para centralizar o rótulo)
const CORES_ESTRATEGIA = ["#ff7a1f", "#7fb8ff", "#8fe3b5"];
const TITULOS_ANEL = ["Entram numa estratégia", "Falta 1 critério", "Faltam 2 critérios", "Faltam 3 ou mais"];

// Um único ouvinte para a página inteira. Refaz a rede só no slot atual, se ele ainda estiver na página.
let slotRede = null;
matchMedia(MQ_CELULAR).addEventListener("change", () => {
  if (slotRede && slotRede.isConnected) montarRede(slotRede);
});

// Mesma conta do screener: critério reprovado ou sem dado conta como falta.
function conferir(u, e) {
  if (u.financeira && !e.criterios_financeiras) return null; // financeira fora desta estratégia
  const itens = (u.financeira ? e.criterios_financeiras : e.criterios).map((c) => {
    const v = u[c.campo];
    const semDado = v == null;
    const falha = !semDado && ((c.min != null && v < c.min) || (c.max != null && v > c.max));
    return { c, v, semDado, falha };
  });
  const falhas = itens.filter((i) => i.falha).length, sem = itens.filter((i) => i.semDado).length;
  return { itens, falhas, sem, faltam: falhas + sem, ok: falhas + sem === 0 };
}

// Uma linha por ação, com a estratégia em que ela chega mais perto (menos critérios faltando).
function resumoRede() {
  const ests = Object.entries(estado.resultado.estrategias), linhas = [];
  for (const [papel, u] of Object.entries(estado.universo)) {
    if (!("pl" in u)) continue; // papel só da watchlist, sem indicadores
    const porEst = {};
    for (const [k, e] of ests) { const r = conferir(u, e); if (r) porEst[k] = r; }
    // sort é estável: em empate, a estratégia que vem primeiro no config.yaml fica na frente.
    const ks = Object.keys(porEst).sort((a, b) => porEst[a].faltam - porEst[b].faltam);
    if (!ks.length) continue;
    const r = porEst[ks[0]];
    const empate = ks.filter((x) => !porEst[x].ok && porEst[x].faltam === r.faltam);
    linhas.push({ papel, u, porEst, k: ks[0], r, faltam: r.faltam, entra: ks.filter((x) => porEst[x].ok), empate });
  }
  return linhas;
}

// Lista agrupada por anel. Usada no celular e, no desktop, dentro de <details>.
function htmlLista(linhas, recolher = false) {
  return TITULOS_ANEL.map((t, n) => {
    const itens = linhas.filter((l) => Math.min(l.faltam, 3) === n);
    if (!itens.length) return "";
    const ul = `<ul class="lista-rede">${itens.map((l) => {
      const e = estado.resultado.estrategias[l.k];
      const situ = l.entra.length ? `entra em ${l.entra.length}` : `${esc(e.nome)}: falta ${l.faltam}`;
      return `<li><a href="#acao/${esc(l.papel)}"><b>${esc(l.papel)}</b><span>${esc(curto(l.u.nome) || "")}</span><em>${situ}</em></a></li>`;
    }).join("")}</ul>`;
    // No celular cada anel é um bloco recolhível, para a página inicial não virar uma lista de 193 linhas.
    return recolher ? `<details class="grupo-recolhivel"><summary>${t} <b>${itens.length}</b></summary>${ul}</details>`
      : `<h3 class="grupo-rede">${t} · ${itens.length}</h3>${ul}`;
  }).join("");
}

function montarRede(slot) {
  slotRede = slot;
  if (!slot.querySelector(":scope > .rede-caixa")) slot.insertAdjacentHTML("afterbegin", '<div class="rede-caixa"></div>');
  const caixa = slot.querySelector(":scope > .rede-caixa");
  const ests = Object.entries(estado.resultado.estrategias), ordem = Object.fromEntries(ests.map(([k], i) => [k, i]));
  const linhas = resumoRede().sort((a, b) => ordem[a.k] - ordem[b.k] || a.faltam - b.faltam || a.papel.localeCompare(b.papel));
  if (!linhas.length) return;
  const N = linhas.length;
  if (matchMedia(MQ_CELULAR).matches) {
    caixa.innerHTML = `<section class="painel rede" id="rede">
      <div class="painel-cabeca"><h2>Rede do Radar</h2><span class="extra">${N} ações líquidas</span></div>
      ${htmlLista(linhas, true)}
      <p class="faint legenda-rede">Toque num grupo para ver as ações e numa ação para abrir a análise.</p>
    </section>`;
    return;
  }

  const C = 400, entram = linhas.filter((l) => l.faltam === 0).length;
  const polar = (r, ang) => [C + r * Math.cos(ang), C + r * Math.sin(ang)];

  // Dentro de cada anel, espaçamento igual. As ações já vêm agrupadas por estratégia.
  [0, 1, 2, 3].forEach((n) => {
    const grupo = linhas.filter((l) => Math.min(l.faltam, 3) === n);
    grupo.forEach((l, j) => {
      l.ang = -Math.PI / 2 + ((j + 0.5) * 2 * Math.PI) / grupo.length;
      [l.x, l.y] = polar(ANEL_R[n], l.ang);
    });
  });

  const corDe = Object.fromEntries(ests.map(([k], i) => [k, CORES_ESTRATEGIA[i % CORES_ESTRATEGIA.length]]));
  for (const l of linhas) {
    l.raioNo = 2 + Math.min(2.5, Math.max(0, Math.log10((l.u.liq_2meses || 1e6) / 1e6)) * 0.8);
    l.cor = corDe[l.k];
  }
  const porPapel = Object.fromEntries(linhas.map((l) => [l.papel, l]));

  // Centro de cada estratégia: média angular das ações que chegam mais perto dela; sem nenhuma, posição igual no círculo.
  const hubs = Object.fromEntries(ests.map(([k], i) => {
    const angs = linhas.filter((l) => l.k === k).map((l) => l.ang);
    const ang = angs.length
      ? Math.atan2(angs.reduce((s, a) => s + Math.sin(a), 0), angs.reduce((s, a) => s + Math.cos(a), 0))
      : -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / ests.length;
    const [x, y] = polar(330, ang);
    return [k, { ang, x, y }];
  }));

  // Rótulo centralizado no centro da estratégia, empurrado para dentro do viewBox (800) se preciso.
  const setores = ests.map(([k, e]) => {
    const h = hubs[k], w = e.nome.length * LARG_CARACTERE;
    const x = Math.min(800 - 6 - w / 2, Math.max(6 + w / 2, h.x));
    return `<text class="setor-rot" style="fill:${corDe[k]}" x="${x.toFixed(1)}" y="${h.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(e.nome)}</text>`;
  }).join("");
  const nos = linhas.map((l) => `<circle class="no${l.faltam === 0 ? " entra" : ""}" tabindex="0" role="link" aria-label="${esc(l.papel)}: ${l.entra.length ? "entra" : `falta ${l.faltam}`}" data-p="${esc(l.papel)}" cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="${l.raioNo.toFixed(1)}" fill="${l.cor}"/>`).join("");
  const porAnel = [0, 1, 2, 3].map((n) => linhas.filter((l) => Math.min(l.faltam, 3) === n).length);

  caixa.innerHTML = `<section class="painel rede" id="rede">
    <div class="painel-cabeca"><h2>Rede do Radar</h2><span class="extra">${N} ações líquidas · quanto mais perto do centro, mais perto de entrar</span></div>
    <div class="rede-grade">
      <svg viewBox="0 0 800 800" class="rede-svg" role="img" aria-label="${N} ações líquidas; ${entram} entram numa estratégia">
        <defs><radialGradient id="orbe" cx="40%" cy="35%"><stop offset="0" stop-color="#ffd29a"/><stop offset=".45" stop-color="#ff7a1f"/><stop offset="1" stop-color="#5a1d08"/></radialGradient></defs>
        <g class="aneis">${ANEL_R.map((r, i) => `<circle cx="${C}" cy="${C}" r="${r}"${i ? ' class="tracejado"' : ""}/>`).join("")}</g>
        <circle cx="${C}" cy="${C}" r="58" fill="url(#orbe)" class="orbe-centro"/>
        <text x="${C}" y="396" text-anchor="middle" class="centro-num">${entram}</text>
        <text x="${C}" y="416" text-anchor="middle" class="centro-rot">entram</text>
        ${setores}
        <g id="ligas"></g>
        <g>${nos}</g>
        <text id="etiqueta" class="etiqueta"></text>
        <rect class="captura" x="0" y="0" width="800" height="800"/>
      </svg>
      <aside class="rede-detalhe" id="rede-detalhe"></aside>
    </div>
    <p class="faint legenda-rede">Anéis, de dentro para fora: entra numa estratégia · falta 1 critério · faltam 2 · faltam 3 ou mais. Cor = estratégia em que a ação chega mais perto; em empate, vale a primeira do config.yaml, e o cartão mostra o empate. Não indica compra nem venda. Tamanho = liquidez. Ao focar ou passar o mouse: linha cheia = entra; pontilhada = falta 1 critério.</p>
    <details class="lista-todas"><summary>Ver as ${N} ações como lista</summary>${htmlLista(linhas)}</details>
  </section>`;

  const svg = $(".rede-svg", caixa), detalhe = $("#rede-detalhe", caixa), etiqueta = $("#etiqueta", caixa), ligas = $("#ligas", caixa);
  let fixado = null, atual = null;

  const resumoPadrao = () => `<div class="faint">Das ${N} ações líquidas</div>
    <ul class="lista-criterios">
      <li><span>Entram numa estratégia</span><b class="ok">${porAnel[0]}</b></li>
      <li><span>Falta 1 critério</span><b>${porAnel[1]}</b></li>
      <li><span>Faltam 2</span><b>${porAnel[2]}</b></li>
      <li><span>Faltam 3 ou mais</span><b>${porAnel[3]}</b></li>
    </ul>
    <p class="muted" style="margin-top:14px">Passe o mouse, toque ou use Tab para ver os critérios de uma ação. Clique ou Enter abre a análise.</p>`;

  const cartao = (l) => {
    const u = l.u, e = estado.resultado.estrategias[l.k], r = l.r, preco = precoDe(l.papel);
    const outras = l.empate.filter((x) => x !== l.k).map((x) => esc(estado.resultado.estrategias[x].nome));
    const situacao = l.entra.length ? `Entra em ${l.entra.length} de ${ests.length} estratégias`
      : `Mais perto de ${esc(e.nome)}: falta ${l.faltam} critério${l.faltam > 1 ? "s" : ""}${outras.length ? ` (empate com ${outras.join(", ")})` : ""}`;
    const porEstTxt = ests.map(([k, x]) => {
      const q = l.porEst[k];
      const txt = !q ? "não se aplica" : q.ok ? "entra" : `faltam ${q.faltam}`;
      return `<li class="${q?.ok ? "ok" : ""}"><span>${esc(x.nome)}</span><b>${txt}</b></li>`;
    }).join("");
    const crit = r.itens.map(({ c, v, semDado, falha }) => {
      const pct = PCT.has(c.campo), p = pct ? "%" : "";
      const casas = (x) => (Math.abs(x) < 10 ? 1 : 0);
      const falta = c.min != null && v < c.min ? c.min - v : (c.max != null && v > c.max ? v - c.max : 0);
      const situ = semDado ? "sem dado" : falha ? `falta ${num(falta, casas(falta))}${pct ? " p.p." : ""}` : "atende";
      return `<li class="${semDado ? "" : falha ? "falha" : "ok"}"><span>${esc(textoCriterio(c))}</span><b>${semDado ? "—" : num(v, casas(v)) + p} · ${situ}</b></li>`;
    }).join("");
    const m = u.graham && preco ? (u.graham / preco - 1) * 100 : null;
    const graham = m == null ? "" : `<p class="faint" style="margin-top:14px">Preço justo de Graham (fórmula simplificada): ${reais(u.graham)}, ${m >= 0 ? "+" : ""}${num(m, 0)}% em relação ao preço.${Math.abs(m) > 200 ? " Valor extremo: confira os dados antes de usar." : ""}</p>`;
    return `<div class="faint">${esc(l.papel)} · ${esc(curto(u.nome) || "")}</div>
      <div class="figura" style="font-size:24px;margin-top:4px">${reais(preco)}</div>
      <p style="margin:10px 0 14px;font-weight:600">${situacao}</p>
      <ul class="lista-criterios">${porEstTxt}</ul>
      <div class="faint" style="margin:16px 0 8px">Critérios de ${esc(e.nome)}</div>
      <ul class="lista-criterios">${crit}</ul>
      ${graham}
      <a class="botao-fogo" style="margin-top:auto" href="#acao/${esc(l.papel)}">Abrir ${esc(l.papel)}</a>`;
  };

  // Ligações: cheia = entra na estratégia; pontilhada = falta 1 critério.
  const ligar = (l) => {
    ligas.innerHTML = ests.map(([k]) => {
      const q = l.porEst[k], h = hubs[k];
      if (!q) return "";
      const cheia = q.ok, pontilhada = !cheia && q.faltam === 1;
      if (!cheia && !pontilhada) return "";
      return `<path class="liga${pontilhada ? " pontilhada" : ""}" d="M${l.x.toFixed(1)} ${l.y.toFixed(1)} Q${C} ${C} ${h.x.toFixed(1)} ${h.y.toFixed(1)}"/>`;
    }).join("");
  };

  const mostrar = (p) => {
    const l = porPapel[p];
    if (!l) return;
    atual = p;
    svg.classList.add("focado");
    $$(".no", svg).forEach((n) => n.classList.toggle("on", n.dataset.p === p));
    ligar(l);
    const lado = l.x >= C ? 1 : -1;
    etiqueta.textContent = p;
    etiqueta.setAttribute("x", (l.x + lado * (l.raioNo + 6)).toFixed(1));
    etiqueta.setAttribute("y", (l.y + 4).toFixed(1));
    etiqueta.setAttribute("text-anchor", lado > 0 ? "start" : "end");
    detalhe.innerHTML = cartao(l);
  };
  const limpar = () => {
    if (fixado) return mostrar(fixado);
    atual = null;
    svg.classList.remove("focado");
    $$(".no", svg).forEach((n) => n.classList.remove("on"));
    ligas.innerHTML = "";
    etiqueta.textContent = "";
    detalhe.innerHTML = resumoPadrao();
  };

  // Ponto mais próximo do ponteiro, dentro de RAIO_CAPTURA. A captura é um único retângulo.
  const maisPerto = (ev) => {
    const ponto = svg.createSVGPoint();
    ponto.x = ev.clientX; ponto.y = ev.clientY;
    const q = ponto.matrixTransform(svg.getScreenCTM().inverse());
    let melhor = null, menor = RAIO_CAPTURA;
    for (const l of linhas) {
      const d = Math.hypot(l.x - q.x, l.y - q.y);
      if (d < menor) { menor = d; melhor = l; }
    }
    return melhor;
  };
  svg.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") return;
    const l = maisPerto(ev);
    if (l) { if (l.papel !== atual) mostrar(l.papel); }
    else if (atual !== fixado) limpar();
  });
  svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType !== "touch") limpar(); });
  svg.addEventListener("click", (ev) => {
    const l = maisPerto(ev);
    if (!l) { fixado = null; limpar(); return; }
    // Sem hover (tablet com toque): o 1º toque mostra a ação; o 2º abre a análise.
    if (matchMedia("(hover: none)").matches && fixado !== l.papel) { fixado = l.papel; mostrar(l.papel); return; }
    location.hash = `#acao/${l.papel}`;
  });
  // Teclado: Tab percorre as ações; o foco mostra o cartão; Enter abre a análise.
  svg.addEventListener("focusin", (ev) => { const p = ev.target.dataset?.p; if (p && p !== atual) mostrar(p); });
  svg.addEventListener("focusout", () => { fixado = null; limpar(); });
  svg.addEventListener("keydown", (ev) => {
    const p = ev.target.dataset?.p;
    if (ev.key === "Enter" && p) location.hash = `#acao/${p}`;
  });
  limpar();
}
