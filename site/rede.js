// Rede do Radar: estratégias no centro, ações em volta, ligadas pelas estratégias em que entram.
// Passar o mouse (ou o foco do teclado) acende as conexões; clicar abre a ação.
function montarRede(slot) {
  const ests = Object.entries(estado.resultado.estrategias);
  const ligacoes = {};
  for (const [k, e] of ests) for (const p of e.papeis) (ligacoes[p.papel] ||= []).push(k);
  const papeis = Object.keys(ligacoes).sort((a, b) => ligacoes[a][0].localeCompare(ligacoes[b][0]) || a.localeCompare(b));
  if (!papeis.length) return;

  const C = 400, R_EST = 150, R_ACAO = 318, R_ROT = 332;
  const polar = (r, ang) => [C + r * Math.cos(ang), C + r * Math.sin(ang)];
  const angEst = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / ests.length;
  const posEst = Object.fromEntries(ests.map(([k], i) => [k, polar(R_EST, angEst(i))]));
  const angAcao = (i) => -Math.PI / 2 + (i + 0.5) * (2 * Math.PI) / papeis.length;
  // Cor do nó pela pontuação dos sinais: brasa (poucos pontos) → âmbar (muitos)
  const corPontos = (p) => {
    const t = Math.max(0, Math.min(1, ((estado.universo[p]?.pontos ?? 50) - 30) / 70));
    return `hsl(${10 + t * 28}, 100%, ${50 + t * 12}%)`;
  };

  const linhas = [], nos = [], rotulos = [];
  papeis.forEach((p, i) => {
    const a = angAcao(i), [x, y] = polar(R_ACAO, a);
    for (const k of ligacoes[p]) {
      const [ex, ey] = posEst[k], [cx, cy] = polar(R_EST * 1.25, a);
      linhas.push(`<path class="lig" data-p="${p}" data-e="${k}" d="M${ex.toFixed(1)},${ey.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}"/>`);
    }
    nos.push(`<circle class="no-acao" data-p="${p}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" fill="${corPontos(p)}" tabindex="0" role="link" aria-label="${p}"/>`);
    const graus = (a * 180) / Math.PI, vira = graus > 90 && graus < 270;
    const [lx, ly] = polar(R_ROT, a);
    rotulos.push(`<text class="rot-acao" data-p="${p}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${vira ? "end" : "start"}" dominant-baseline="middle"
      transform="rotate(${(vira ? graus + 180 : graus).toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})">${p}</text>`);
  });
  const nosEst = ests.map(([k, e], i) => {
    const [x, y] = posEst[k];
    return `<g class="no-est" data-e="${k}" tabindex="0" role="button" aria-label="${esc(e.nome)}">
      <circle cx="${x}" cy="${y}" r="34"/><text x="${x}" y="${y - 4}" text-anchor="middle" class="est-num">${e.papeis.length}</text>
      <text x="${x}" y="${y + 13}" text-anchor="middle" class="est-nome">${esc(e.nome.split(" ")[0])}</text></g>`;
  }).join("");

  slot.innerHTML = `<section class="painel rede" id="rede">
    <div class="painel-cabeca"><h2>Rede do Radar</h2><span class="extra">Passe o mouse numa ação ou estratégia para ver as conexões</span></div>
    <div class="rede-grade">
      <svg viewBox="0 0 800 800" class="rede-svg" role="group" aria-label="Ações ligadas às estratégias em que entram">
        <defs><radialGradient id="orbe" cx="40%" cy="35%"><stop offset="0" stop-color="#ffd29a"/><stop offset=".45" stop-color="#ff7a1f"/><stop offset="1" stop-color="#5a1d08"/></radialGradient></defs>
        <g class="aneis"><circle cx="400" cy="400" r="${R_ACAO + 34}"/><circle cx="400" cy="400" r="${R_ACAO - 22}" class="tracejado"/><circle cx="400" cy="400" r="${R_EST + 52}" class="tracejado"/><circle cx="400" cy="400" r="92"/></g>
        <g class="ligacoes">${linhas.join("")}</g>
        <circle cx="400" cy="400" r="58" fill="url(#orbe)" class="orbe-centro"/>
        <text x="400" y="396" text-anchor="middle" class="centro-num">${papeis.length}</text>
        <text x="400" y="416" text-anchor="middle" class="centro-rot">ações</text>
        ${nosEst}
        <g>${nos.join("")}</g><g>${rotulos.join("")}</g>
      </svg>
      <aside class="rede-detalhe" id="rede-detalhe" aria-live="polite"></aside>
    </div></section>`;

  const svg = $(".rede-svg", slot), detalhe = $("#rede-detalhe", slot);
  const limpar = () => { svg.classList.remove("focado"); $$(".on", svg).forEach((el) => el.classList.remove("on")); };
  const acender = (sel) => { limpar(); svg.classList.add("focado"); $$(sel, svg).forEach((el) => el.classList.add("on")); };

  const mostrarAcao = (p) => {
    acender(`[data-p="${p}"]`);
    for (const k of ligacoes[p]) $(`.no-est[data-e="${k}"]`, svg).classList.add("on");
    const u = estado.universo[p] || {};
    detalhe.innerHTML = `<div class="ativo-cel">${logo(p, "g")}<div><b style="font-size:20px">${esc(p)}</b><span class="nome">${esc(curto(u.nome) || "")}</span></div></div>
      <div class="figura" style="margin-top:18px">${reais(precoDe(p))}</div>
      <div class="delta">${varCel(u.var_dia)} hoje · ${varCel(u.var_30d, 1)} em 30 dias</div>
      ${u.pontos != null ? `<div class="pontuacao" style="margin-top:16px"><div class="faint">Pontuação dos sinais</div><div class="valor">${u.pontos}<small> de 100</small></div><div class="trilha-pont"><span style="width:${u.pontos}%"></span></div></div>` : ""}
      <div class="faint" style="margin-bottom:8px">Entra em</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${ligacoes[p].map((k) => `<span class="pilula aviso">${esc(estado.resultado.estrategias[k].nome)}</span>`).join("")}</div>
      <a class="botao-fogo" style="margin-top:18px" href="#acao/${esc(p)}">Abrir ${esc(p)}</a>`;
  };
  const mostrarEst = (k) => {
    acender(`[data-e="${k}"]`);
    const e = estado.resultado.estrategias[k];
    for (const p of e.papeis) $$(`[data-p="${p.papel}"]:not(.lig)`, svg).forEach((el) => el.classList.add("on"));
    const top = [...e.papeis].sort((a, b) => (estado.universo[b.papel]?.pontos ?? 0) - (estado.universo[a.papel]?.pontos ?? 0)).slice(0, 4);
    detalhe.innerHTML = `<div class="faint">Estratégia</div><b style="font-size:20px;display:block;margin-top:2px">${esc(e.nome)}</b>
      <p class="muted" style="margin-top:6px">${esc(e.descricao)}</p>
      <div class="figura" style="margin-top:14px">${e.papeis.length}<span class="faint" style="font-size:14px;font-weight:500"> ações cumprem hoje</span></div>
      <div class="faint" style="margin:14px 0 8px">Maiores pontuações</div>
      ${top.map((p) => `<a class="mudanca" href="#acao/${esc(p.papel)}" style="grid-template-columns:44px minmax(0,1fr) auto">${logo(p.papel)}<div><b>${esc(p.papel)}</b><p>${reais(p.preco)}</p></div><span class="quando">${estado.universo[p.papel]?.pontos ?? "—"} pts</span></a>`).join("")}
      <a class="botao-vidro" style="margin-top:12px" href="#estrategias/${k}">Ver a estratégia</a>`;
  };

  svg.addEventListener("mouseover", (ev) => {
    const a = ev.target.closest("[data-p]:not(.lig)"), e = ev.target.closest(".no-est");
    if (a) mostrarAcao(a.dataset.p); else if (e) mostrarEst(e.dataset.e);
  });
  svg.addEventListener("focusin", (ev) => {
    const a = ev.target.closest("[data-p]"), e = ev.target.closest(".no-est");
    if (a) mostrarAcao(a.dataset.p); else if (e) mostrarEst(e.dataset.e);
  });
  svg.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-p]:not(.lig)"), e = ev.target.closest(".no-est");
    if (a) location.hash = `#acao/${a.dataset.p}`; else if (e) location.hash = `#estrategias/${e.dataset.e}`;
  });
  svg.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  svg.addEventListener("mouseleave", limpar);
  const inicial = acaoDestaque();
  if (inicial && ligacoes[inicial]) { mostrarAcao(inicial); limpar(); }
}
