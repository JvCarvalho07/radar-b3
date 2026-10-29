// Testes das contas da carteira. Rodar da raiz do projeto:  node testes/carteira.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const codigo = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "site", "carteira.js"), "utf8");
const stub = `
const estado = { universo: {
  AAAA3: { preco: 10, desdobramentos: [["2025-06-01", 2]], proventos_todos: [["2025-03-01", 0.5], ["2025-09-01", 0.5]] },
  GRUP3: { preco: 50, desdobramentos: [["2025-06-01", 0.1]] },
  BBBB4: { preco: 20 }, CCCC3: { preco: 30 }, DDDD3: { preco: 40 }, EEEE3: { preco: 10 },
}, resultado: { estrategias: {}, mercado: { ibovespa: { serie_total: [["2025-01-02", 100], ["2025-02-03", 100], ["2025-07-01", 110], ["2025-10-01", 121]] } } } };
const precoDe = (p) => { const u = estado.universo[p] || {}; return u.preco ?? u.cotacao ?? null; };
const dif = (a, b) => (a == null || !b ? null : (a / b - 1) * 100);
const num = (v) => String(v); const reais = (v) => "R$" + v; const sinal = (v) => String(v);
const carregarJSON = async () => [];
`;
const testes = `
let falhas = 0;
const ok = (cond, nome, extra) => { console.log((cond ? "OK   " : "FALHA") + " " + nome + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); if (!cond) falhas++; };
const L = (id, tipo, papel, data, qtd, preco, taxas = 0) => ({ id, criado: id, tipo, papel, data, qtd, preco, taxas });
const perto = (a, b) => Math.abs(a - b) < 1e-6;

// 1. desdobramento 2:1: 100 a R$20 vira 200 a R$10; preço hoje 10 -> resultado 0
let c = calcularCarteira([L(1, "compra", "AAAA3", "2025-01-10", 100, 20)]);
let p = c.pos.AAAA3;
ok(p.qtd === 200 && perto(p.pm, 10) && perto(p.resultado, 0), "desdobramento 2:1", { qtd: p.qtd, pm: p.pm, res: p.resultado });
// proventos: 03/2025 (antes do split) 100 × fator 2 × 0,5 = 100; 09/2025: 200 × 0,5 = 100 -> 200
ok(perto(p.proventos, 200), "proventos antes e depois do desdobramento", p.proventos);

// 2. grupamento 1:10: 105 ações a R$5 -> 10 ações, 0,5 vai para o caixa ao PM
c = calcularCarteira([L(1, "compra", "GRUP3", "2025-01-10", 105, 5)]);
p = c.pos.GRUP3;
ok(p.qtd === 10 && perto(p.pm, 50) && perto(p.recebido, 25), "grupamento 1:10 com fração", { qtd: p.qtd, pm: p.pm, caixa: p.recebido });

// 3. day trade: mesmo resultado nas duas ordens de digitação
const base = [L(1, "compra", "BBBB4", "2025-01-10", 100, 10)];
const ordemA = [...base, L(2, "compra", "BBBB4", "2025-02-10", 100, 12), L(3, "venda", "BBBB4", "2025-02-10", 100, 13)];
const ordemB = [...base, L(2, "venda", "BBBB4", "2025-02-10", 100, 13), L(3, "compra", "BBBB4", "2025-02-10", 100, 12)];
const a = calcularCarteira(ordemA), b = calcularCarteira(ordemB);
ok(perto(a.pos.BBBB4.pm, b.pos.BBBB4.pm) && perto(a.realizado, b.realizado) && perto(a.pos.BBBB4.pm, 10) && perto(a.realizado, 100),
   "day trade não depende da ordem", { pmA: a.pos.BBBB4.pm, pmB: b.pos.BBBB4.pm, lucroA: a.realizado, lucroB: b.realizado });
ok(perto(a.dayMes["2025-02"], 1300) && !a.vendasMes["2025-02"], "day trade fora do limite de R$ 20 mil", { day: a.dayMes, vendas: a.vendasMes });

// 4. apagar a compra de que uma venda depende aumenta o excesso
const comVenda = [L(1, "compra", "CCCC3", "2025-01-10", 100, 10), L(2, "venda", "CCCC3", "2025-03-10", 100, 15)];
ok(calcularCarteira(comVenda).excesso === 0 && calcularCarteira([comVenda[1]]).excesso === 100, "venda sem saldo vira excesso");
// venda antes da compra (fora de ordem)
ok(calcularCarteira([L(1, "venda", "CCCC3", "2025-01-01", 50, 10), L(2, "compra", "CCCC3", "2025-02-01", 100, 10)]).excesso === 50, "venda anterior à compra é detectada");

// 5. ação sem preço fica fora do patrimônio
c = calcularCarteira([L(1, "compra", "ZZZZ3", "2025-01-10", 100, 10), L(2, "compra", "BBBB4", "2025-01-10", 10, 10)]);
ok(c.pos.ZZZZ3.valor === null && perto(c.valor, 200) && c.semPreco.includes("ZZZZ3"), "sem cotação fora do patrimônio", { valor: c.valor });

// 6. Ibovespa nas mesmas datas: compra 1000 em 02/2025 (nível 100), compra 1000 em 07/2025 (110); hoje 121
c = calcularCarteira([L(1, "compra", "BBBB4", "2025-02-03", 50, 20), L(2, "compra", "BBBB4", "2025-07-01", 50, 20)]);
const ib = ibovEquivalente(c.fluxos);
ok(perto(ib.v, ((1000 / 100 + 1000 / 110) * 121 - 2000) / 2000 * 100), "Ibovespa equivalente", ib);

// 7. regra de peso: 2 ações não disparam; 5 ações com uma de 60% disparam
(async () => {
  let al = await avaliarSaidas({ lancamentos: [L(1, "compra", "BBBB4", "2025-01-10", 10, 20), L(2, "compra", "CCCC3", "2025-01-10", 30, 30)] }, false);
  ok(!al.some((x) => x.regra === "peso"), "peso não dispara com 2 ações", al.map((x) => x.regra));
  al = await avaliarSaidas({ lancamentos: [L(1, "compra", "BBBB4", "2025-01-10", 10, 20), L(2, "compra", "CCCC3", "2025-01-10", 1, 30), L(3, "compra", "DDDD3", "2025-01-10", 1, 40), L(4, "compra", "EEEE3", "2025-01-10", 1, 10), L(5, "compra", "AAAA3", "2025-07-10", 1, 10)] }, false);
  ok(al.some((x) => x.regra === "peso" && x.papel === "BBBB4"), "peso dispara com 5 ações e concentração", al.map((x) => x.papel + ":" + x.regra));

  // 8. arquivo importado é conferido: código, tipo, números; nada de HTML nem __proto__
  const imp = normalizarCarteira({ lancamentos: [
    L("a", "compra", "petr4f", "2025-01-10", 10, 30),
    L("b", "<img src=x onerror=alert(1)>", "PETR4", "2025-01-10", 10, 30),
    L('x"><img>', "compra", "VALE3", "2025-01-10", 5, 60),
    L("c", "compra", "__proto__", "2025-01-10", 1, 1),
    L("d", "compra", "BBAS3", "<b>2025</b>", 1, 1),
    { id: "e", tipo: "compra", papel: "ITUB4", data: "2025-01-10", qtd: "100", preco: "40" },
    L("f", "compra", "ITUB4", "2025-01-10", 1.5, 40),
  ], saida: { pesoMax: "999", graham: false } });
  ok(imp.descartadas === 4 && imp.carteira.lancamentos.length === 3, "importação descarta linhas inválidas", imp.descartadas);
  ok(imp.carteira.lancamentos[0].papel === "PETR4", "PETR4F vira PETR4");
  ok(imp.carteira.lancamentos[1].id !== 'x"><img>', "id com HTML é trocado");
  ok(imp.carteira.lancamentos[2].qtd === 100 && imp.carteira.lancamentos[2].preco === 40, "números em texto viram número");
  ok(imp.carteira.saida.pesoMax === 100 && imp.carteira.saida.graham === false && !("quedaTopo" in imp.carteira.saida),
    "regras de saída limitadas; as que faltam ficam no padrão", imp.carteira.saida);
  ok(({}).qtd === undefined, "nada vaza para Object.prototype");
  ok(normalizarCarteira({}).carteira.lancamentos.length === 0 && normalizarCarteira(null).carteira.lancamentos.length === 0, "carteira salva estragada não quebra");

  // 9. gráfico: day trade digitado ao contrário não cria posição fantasma
  const vel = (p) => [["2025-01-10", p, p, p, p], ["2025-01-13", p, p, p, p]];
  let s = serieCarteira([L(1, "venda", "BBBB4", "2025-01-10", 100, 20), L(2, "compra", "BBBB4", "2025-01-10", 100, 20)], { BBBB4: vel(20) });
  ok(s && s.serie.at(-1).valor === 0, "day trade não deixa posição no gráfico", s && s.serie.at(-1));
  // 10. grupamento: gráfico usa ações inteiras, como o cartão (105 a R$5, 1:10 → 10 ações)
  s = serieCarteira([L(1, "compra", "GRUP3", "2025-01-10", 105, 5)], { GRUP3: [["2025-07-01", 50, 50, 50, 50], ["2025-07-02", 50, 50, 50, 50]] });
  ok(s && s.serie.at(-1).valor === 500, "grupamento no gráfico bate com o cartão", s && s.serie.at(-1));
  // 11. ação sem arquivo de preços não apaga o gráfico inteiro
  s = serieCarteira([L(1, "compra", "BBBB4", "2025-01-10", 10, 20), L(2, "compra", "CCCC3", "2025-01-10", 10, 30)], { BBBB4: vel(20), CCCC3: [] });
  ok(s && s.serie.at(-1).valor === 200 && s.serie.at(-1).custo === 200 && s.semVelas[0] === "CCCC3", "ação sem preços fica fora do gráfico", s && s.serie.at(-1));

  console.log(falhas ? falhas + " falha(s)" : "tudo certo");
  if (falhas) process.exitCode = 1;
})();
`;
vm.runInNewContext(stub + codigo + testes, { console, crypto: globalThis.crypto });
