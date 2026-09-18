// Controle de pagamento — Baba
// Camada de dados: Airtable REST API, chamada direto do navegador.
// AIRTABLE_TOKEN e AIRTABLE_BASE_ID vem do <script> inline no index.html.
(function () {
  "use strict";

  // ---- IDs fixos da base (tabelas e campos) — ver README.md ----
  var T_MESES = "tblT8lZYNH7HcTO6u";
  var T_LANC = "tblQB5h4Vr0ydn2aX";

  var F = {
    mes: {
      mesId: "fldPMpj9ze60GoDek",
      valorMensal: "fldUArIi7cO0ZHTHv",
      totalPago: "fldQZDcaGiqpJGlpv", // rollup (so soma lancamentos com Pago=true), somente leitura
      saldo: "fldOEZg8YRjVF3JF3", // formula, somente leitura
    },
    lanc: {
      data: "fldMWSF56JQvs2qMB",
      valor: "fldyfxBAs2YRMwpx9",
      categoria: "fld5FzYoXZQ4dngXw",
      quemPagou: "fldjkJ1IE5nMLTiGN",
      motivo: "fldxJ623ugQLT0SSC",
      parcelaAtual: "fldDiC8xzZV1W8i3N",
      parcelaTotal: "fldE6clXHqXhU8exC",
      grupoParcela: "fldbb4EaqjLiP1arZ",
      origemImportId: "fldO066zZ0vXOreiL",
      mesLink: "fldetz5naUR8tjjAk",
      pago: "fldvhbCWJ3jzRADaY",
    },
  };

  var POLL_MS = 45000;

  var monthsCache = {}; // MesID -> { recordId, valorMes, totalPago, saldo }
  var currentMonthId = null;
  var currentEntries = []; // lancamentos normalizados do mes atualmente exibido
  var addOpen = false;
  var pollTimer = null;
  var currentFridays = [];
  var currentPendentesInfo = null; // { pendentes: [...datas], dividas, restanteCents }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function currentMonthKey() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(id) {
    var parts = id.split("-"); var y = parts[0], m = parseInt(parts[1], 10);
    var names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return names[m - 1] + "/" + y;
  }
  function brl(v) {
    v = Number(v) || 0;
    return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function slugify(text) {
    return String(text || "")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getFridaysOfMonth(id) {
    var parts = id.split("-"); var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    var fridays = [];
    var d = new Date(y, m - 1, 1);
    while (d.getMonth() === m - 1) {
      if (d.getDay() === 5) fridays.push(y + "-" + pad(m) + "-" + pad(d.getDate()));
      d.setDate(d.getDate() + 1);
    }
    return fridays;
  }

  // Segunda-feira (formato YYYY-MM-DD) da semana (seg-dom) que contem dateStr.
  // Usado para casar um pagamento "semanal" com a sexta da mesma semana,
  // mesmo se a data exata registrada nao for uma sexta (antecipacao/atraso).
  function mondayOf(dateStr) {
    var parts = dateStr.split("-").map(Number);
    var dt = new Date(parts[0], parts[1] - 1, parts[2]);
    var wd = dt.getDay(); // 0=dom..6=sab
    var diff = wd === 0 ? -6 : 1 - wd;
    dt.setDate(dt.getDate() + diff);
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  }

  function addMonths(id, n) {
    var parts = id.split("-"); var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    var total = (y * 12 + (m - 1)) + n;
    var ny = Math.floor(total / 12), nm = (total % 12) + 1;
    return ny + "-" + pad(nm);
  }

  // ---- modal helpers (confirm/prompt customizados, mesma UI de antes) ----
  var modalOverlay = document.getElementById("modalOverlay");
  var modalText = document.getElementById("modalText");
  var modalInputWrap = document.getElementById("modalInputWrap");
  var modalInput = document.getElementById("modalInput");
  var modalOkBtn = document.getElementById("modalOkBtn");
  var modalCancelBtn = document.getElementById("modalCancelBtn");
  var modalResolver = null;

  function closeModal(result) {
    modalOverlay.style.display = "none";
    if (modalResolver) { var r = modalResolver; modalResolver = null; r(result); }
  }
  modalCancelBtn.onclick = function () { closeModal(null); };
  modalOkBtn.onclick = function () {
    if (modalInputWrap.style.display !== "none") closeModal(modalInput.value.trim() || null);
    else closeModal(true);
  };
  modalOverlay.onclick = function (e) { if (e.target === modalOverlay) closeModal(null); };

  function showConfirm(message) {
    return new Promise(function (resolve) {
      modalResolver = resolve;
      modalText.textContent = message;
      modalInputWrap.style.display = "none";
      modalOkBtn.textContent = "Confirmar";
      modalCancelBtn.style.display = "";
      modalOverlay.style.display = "flex";
    });
  }
  function showAlert(message) {
    return new Promise(function (resolve) {
      modalResolver = resolve;
      modalText.textContent = message;
      modalInputWrap.style.display = "none";
      modalOkBtn.textContent = "OK";
      modalCancelBtn.style.display = "none";
      modalOverlay.style.display = "flex";
    });
  }
  function showPrompt(message, defaultValue) {
    return new Promise(function (resolve) {
      modalResolver = resolve;
      modalText.textContent = message;
      modalInputWrap.style.display = "";
      modalInput.value = defaultValue || "";
      modalOkBtn.textContent = "Criar";
      modalCancelBtn.style.display = "";
      modalOverlay.style.display = "flex";
      setTimeout(function () { modalInput.focus(); }, 50);
    });
  }

  // ---- cliente Airtable ----
  var offlineBanner = document.getElementById("offlineBanner");
  function showOffline(msg) {
    offlineBanner.textContent = msg || "Sem conexão com o Airtable agora — os dados não serão salvos até recarregar.";
    offlineBanner.classList.add("err");
    offlineBanner.style.display = "block";
  }
  function hideOffline() {
    offlineBanner.style.display = "none";
  }

  function atRequest(tableId, method, query, body) {
    var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE_ID + "/" + tableId;
    if (query) {
      var qs = new URLSearchParams(query).toString();
      if (qs) url += "?" + qs;
    }
    return fetch(url, {
      method: method || "GET",
      headers: {
        "Authorization": "Bearer " + AIRTABLE_TOKEN,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error("Airtable " + res.status + ": " + text);
        });
      }
      return res.json();
    });
  }

  function listAll(tableId, baseQuery) {
    var all = [];
    function page(offset) {
      var query = Object.assign({}, baseQuery, { pageSize: "100" });
      if (offset) query.offset = offset;
      return atRequest(tableId, "GET", query).then(function (data) {
        all = all.concat(data.records);
        if (data.offset) return page(data.offset);
        return all;
      });
    }
    return page(null);
  }

  function createRecordsChunked(tableId, records) {
    var chunks = [];
    for (var i = 0; i < records.length; i += 10) chunks.push(records.slice(i, i + 10));
    var created = [];
    return chunks.reduce(function (chain, chunk) {
      return chain.then(function () {
        return atRequest(tableId, "POST", null, { records: chunk, typecast: true }).then(function (data) {
          created = created.concat(data.records);
        });
      });
    }, Promise.resolve()).then(function () { return created; });
  }

  function updateRecord(tableId, recordId, fields) {
    return atRequest(tableId, "PATCH", null, { records: [{ id: recordId, fields: fields }] });
  }

  function escapeFormulaValue(v) {
    return String(v).replace(/"/g, '\\"');
  }

  function findExistingOrigemIds(ids) {
    var uniq = ids.filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });
    if (uniq.length === 0) return Promise.resolve({});
    var parts = uniq.map(function (id) {
      return '{' + F.lanc.origemImportId + '}="' + escapeFormulaValue(id) + '"';
    });
    var formula = "OR(" + parts.join(",") + ")";
    return listAll(T_LANC, {
      returnFieldsByFieldId: "true",
      filterByFormula: formula,
    }).then(function (records) {
      var found = {};
      records.forEach(function (r) {
        var oid = r.fields[F.lanc.origemImportId];
        if (oid) found[oid] = r.id;
      });
      return found;
    });
  }

  // ---- meses ----
  function loadMeses() {
    return listAll(T_MESES, { returnFieldsByFieldId: "true" }).then(function (records) {
      monthsCache = {};
      records.forEach(function (r) {
        var f = r.fields;
        var id = f[F.mes.mesId];
        if (!id) return;
        monthsCache[id] = {
          recordId: r.id,
          valorMes: Number(f[F.mes.valorMensal]) || 0,
          totalPago: Number(f[F.mes.totalPago]) || 0,
          saldo: f[F.mes.saldo] == null ? null : Number(f[F.mes.saldo]),
        };
      });
      return monthsCache;
    });
  }

  function ensureMonthRecord(mesId, fallbackValorMes) {
    if (monthsCache[mesId]) return Promise.resolve(monthsCache[mesId]);
    // recarrega antes de criar, pra reduzir chance de duplicar mes se outro
    // dispositivo tiver criado nesse meio tempo
    return loadMeses().then(function () {
      if (monthsCache[mesId]) return monthsCache[mesId];
      var fields = {};
      fields[F.mes.mesId] = mesId;
      fields[F.mes.valorMensal] = fallbackValorMes;
      return createRecordsChunked(T_MESES, [{ fields: fields }]).then(function (created) {
        var rec = created[0];
        monthsCache[mesId] = {
          recordId: rec.id,
          valorMes: fallbackValorMes,
          totalPago: 0,
          saldo: fallbackValorMes,
        };
        return monthsCache[mesId];
      });
    });
  }

  function createMonth(id, valorMes) {
    return loadMeses().then(function () {
      if (monthsCache[id]) throw new Error("Esse mês já existe.");
      var fields = {};
      fields[F.mes.mesId] = id;
      fields[F.mes.valorMensal] = valorMes;
      return createRecordsChunked(T_MESES, [{ fields: fields }]);
    });
  }

  // ---- lancamentos ----
  function normalizeLancamento(r) {
    var f = r.fields;
    return {
      id: r.id,
      date: f[F.lanc.data],
      value: Number(f[F.lanc.valor]) || 0,
      category: f[F.lanc.categoria] || "",
      payer: f[F.lanc.quemPagou] || "",
      reason: f[F.lanc.motivo] || "",
      parcelaAtual: f[F.lanc.parcelaAtual] || null,
      parcelaTotal: f[F.lanc.parcelaTotal] || null,
      grupoParcela: f[F.lanc.grupoParcela] || null,
      origemImportId: f[F.lanc.origemImportId] || null,
      paid: f[F.lanc.pago] === true,
    };
  }

  function loadLancamentosForMonth(mesId) {
    var formula = 'SEARCH("' + escapeFormulaValue(mesId) + '", ARRAYJOIN({' + F.lanc.mesLink + '}))';
    return listAll(T_LANC, {
      returnFieldsByFieldId: "true",
      filterByFormula: formula,
    }).then(function (records) {
      var list = records.map(normalizeLancamento);
      list.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
      return list;
    });
  }

  function createLancamento(fieldsById) {
    return createRecordsChunked(T_LANC, [{ fields: fieldsById }]);
  }

  function deleteLancamento(recordId) {
    return atRequest(T_LANC, "DELETE", { "records[]": recordId });
  }

  function setPago(recordId, paid) {
    var fields = {};
    fields[F.lanc.pago] = paid;
    return updateRecord(T_LANC, recordId, fields);
  }

  function editarLancamento(recordId, fields) {
    return updateRecord(T_LANC, recordId, fields);
  }

  // ---- propagacao de parcelas (campos estruturados + idempotencia) ----
  function propagateInstallments(motivo, value, payer, categoria, startMonthId, currentNum, total, grupoParcela, onProgress) {
    var valorMesFallback = (monthsCache[startMonthId] || {}).valorMes || 2500;
    var stepsRemaining = total - currentNum;
    var plan = [];
    for (var i = 1; i <= stepsRemaining; i++) {
      var num = currentNum + i;
      plan.push({ num: num, monthId: addMonths(startMonthId, i), origemId: "installment-" + grupoParcela + "-" + num });
    }
    var origemIds = plan.map(function (p) { return p.origemId; });
    return findExistingOrigemIds(origemIds).then(function (existing) {
      var pending = plan.filter(function (p) { return !existing[p.origemId]; });
      var totalPendentes = pending.length;
      return pending.reduce(function (chain, p, idx) {
        return chain.then(function () {
          if (onProgress) onProgress(idx + 1, totalPendentes);
          return ensureMonthRecord(p.monthId, valorMesFallback).then(function (mesInfo) {
            var fields = {};
            fields[F.lanc.data] = p.monthId + "-01";
            fields[F.lanc.valor] = value;
            fields[F.lanc.categoria] = categoria;
            fields[F.lanc.quemPagou] = payer;
            fields[F.lanc.motivo] = motivo;
            fields[F.lanc.parcelaAtual] = p.num;
            fields[F.lanc.parcelaTotal] = total;
            fields[F.lanc.grupoParcela] = grupoParcela;
            fields[F.lanc.origemImportId] = p.origemId;
            fields[F.lanc.mesLink] = [mesInfo.recordId];
            fields[F.lanc.pago] = true; // parcela: divida ja comprometida na compra, nao discricionaria como o semanal
            return createRecordsChunked(T_LANC, [{ fields: fields }]);
          });
        });
      }, Promise.resolve());
    });
  }

  // ---- sugestao semanal (sem sobra de centavos) ----
  function computeWeeklySuggestion(mesId, entries) {
    var mesInfo = monthsCache[mesId] || { valorMes: 0 };
    var dividasCents = 0;
    var semanaisPagas = {}; // segunda-da-semana -> true
    entries.forEach(function (e) {
      if (e.category === "Semanal") {
        semanaisPagas[mondayOf(e.date)] = true;
      } else {
        dividasCents += Math.round(e.value * 100);
      }
    });
    var fridays = getFridaysOfMonth(mesId);
    currentFridays = fridays;
    var pendentes = fridays.filter(function (f) { return !semanaisPagas[mondayOf(f)]; });
    var restanteCents = Math.round(mesInfo.valorMes * 100) - dividasCents;

    var text, values = [];
    if (pendentes.length > 0) {
      var n = pendentes.length;
      var baseCents = Math.floor(restanteCents / n);
      var remainder = restanteCents - baseCents * n; // 0..n-1, pode ser negativo se restante<0
      // distribui o resto (ou o deficit) nas ultimas parcelas, 1 centavo por vez
      for (var i = 0; i < n; i++) {
        var extra = 0;
        var fromEnd = n - i;
        if (remainder > 0 && fromEnd <= remainder) extra = 1;
        if (remainder < 0 && fromEnd <= -remainder) extra = -1;
        values.push(baseCents + extra);
      }
      var weeklyDisplay = values[0] / 100;
      text = "Semana sugerida: " + brl(weeklyDisplay) + " × " + n + " sexta(s) pendente(s) — dívidas do mês: " + brl(dividasCents / 100);
    } else {
      text = fridays.length > 0
        ? "Todas as sextas já lançadas — dívidas do mês: " + brl(dividasCents / 100)
        : "Semana sugerida: —";
    }
    return { pendentes: pendentes, valuesCents: values, text: text, dividasCents: dividasCents, restanteCents: restanteCents };
  }

  // ================== UI ==================
  var tabMonthBtn = document.getElementById("tabMonthBtn");
  var tabOverviewBtn = document.getElementById("tabOverviewBtn");
  var viewMonth = document.getElementById("viewMonth");
  var viewOverview = document.getElementById("viewOverview");
  var monthSelect = document.getElementById("monthSelect");
  var addCard = document.getElementById("addCard");
  var toggleAddBtn = document.getElementById("toggleAddBtn");

  function showMonthTab() {
    tabMonthBtn.classList.add("active"); tabOverviewBtn.classList.remove("active");
    viewMonth.style.display = ""; viewOverview.style.display = "none";
  }
  function showOverviewTab() {
    tabOverviewBtn.classList.add("active"); tabMonthBtn.classList.remove("active");
    viewMonth.style.display = "none"; viewOverview.style.display = "";
    renderOverview();
  }
  tabMonthBtn.onclick = showMonthTab;
  tabOverviewBtn.onclick = showOverviewTab;
  document.getElementById("backToOverviewBtn").onclick = showOverviewTab;

  toggleAddBtn.onclick = function () {
    addOpen = !addOpen;
    addCard.style.display = addOpen ? "" : "none";
    toggleAddBtn.textContent = addOpen ? "– Fechar formulário" : "+ Adicionar lançamento";
  };
  document.getElementById("cancelAddBtn").onclick = function () {
    addOpen = false; addCard.style.display = "none"; toggleAddBtn.textContent = "+ Adicionar lançamento";
  };

  document.getElementById("fDate").value = todayISO();

  var LS_KEY_CATEGORIA = "controle-baba:lastCategoria";
  function aplicarUltimaCategoria() {
    try {
      var lastCategoria = localStorage.getItem(LS_KEY_CATEGORIA);
      if (lastCategoria) document.getElementById("fCategoria").value = lastCategoria;
    } catch (e) { /* localStorage indisponivel (modo privado etc.) — ignora */ }
  }
  function salvarUltimaCategoria(categoria) {
    try { localStorage.setItem(LS_KEY_CATEGORIA, categoria); } catch (e) { /* ignora */ }
  }
  aplicarUltimaCategoria();

  monthSelect.onchange = function () { selectMonth(monthSelect.value); };

  document.getElementById("newMonthBtn").onclick = function () {
    var suggestion = currentMonthKey();
    showPrompt("Novo mês (formato AAAA-MM), ex: " + suggestion, suggestion).then(function (input) {
      if (!input) return;
      input = input.trim();
      if (!/^\d{4}-\d{2}$/.test(input)) { showAlert("Formato inválido. Use AAAA-MM."); return; }
      createMonth(input, 2500).then(function () {
        return rebuildMonthSelectAndSelect(input);
      }).catch(function (e) {
        console.error(e); showAlert(e.message || "Não foi possível criar o mês.");
      });
    });
  };

  var valorMesEditRow = document.getElementById("valorMesEditRow");
  document.getElementById("editValorMesBtn").onclick = function () {
    var abrir = valorMesEditRow.style.display === "none";
    valorMesEditRow.style.display = abrir ? "" : "none";
    if (abrir) document.getElementById("valorMesInput").focus();
  };

  document.getElementById("saveValorMesBtn").onclick = function () {
    if (!currentMonthId) return;
    var v = parseFloat(document.getElementById("valorMesInput").value) || 0;
    var mesInfo = monthsCache[currentMonthId];
    if (!mesInfo) return;
    var fields = {};
    fields[F.mes.valorMensal] = v;
    updateRecord(T_MESES, mesInfo.recordId, fields).then(function () {
      hideOffline();
      valorMesEditRow.style.display = "none";
      return loadMeses().then(function () { return refreshMonthView(currentMonthId); });
    }).catch(function (e) {
      console.error(e); showOffline("Não foi possível salvar (" + e.message + ").");
    });
  };

  document.getElementById("genWeeklyBtn").onclick = function () {
    if (!currentMonthId) return;
    var btn = document.getElementById("genWeeklyBtn");
    btn.disabled = true; btn.textContent = "Gerando…";
    // recarrega antes de gerar pra nao duplicar se algo mudou desde o ultimo render
    loadLancamentosForMonth(currentMonthId).then(function (entries) {
      currentEntries = entries;
      var info = computeWeeklySuggestion(currentMonthId, entries);
      if (info.pendentes.length === 0) {
        btn.textContent = "Todas as sextas já lançadas";
        return;
      }
      var mesInfo = monthsCache[currentMonthId];
      var origemIds = info.pendentes.map(function (d) { return "weekly-" + currentMonthId + "-" + d; });
      return findExistingOrigemIds(origemIds).then(function (existing) {
        var records = [];
        info.pendentes.forEach(function (date, idx) {
          var origemId = origemIds[idx];
          if (existing[origemId]) return; // ja foi gerado, evita duplicata
          var fields = {};
          fields[F.lanc.data] = date;
          fields[F.lanc.valor] = info.valuesCents[idx] / 100;
          fields[F.lanc.categoria] = "Semanal";
          fields[F.lanc.quemPagou] = "André";
          fields[F.lanc.motivo] = "Valor semanal";
          fields[F.lanc.origemImportId] = origemId;
          fields[F.lanc.mesLink] = [mesInfo.recordId];
          fields[F.lanc.pago] = false; // previsto (sexta do mes), ainda nao pago
          records.push({ fields: fields });
        });
        if (records.length === 0) return;
        return createRecordsChunked(T_LANC, records);
      });
    }).then(function () {
      hideOffline();
      btn.textContent = "Pagamentos gerados";
      return refreshMonthView(currentMonthId);
    }).catch(function (e) {
      console.error(e);
      showOffline("Não foi possível gerar os pagamentos (" + e.message + ").");
      btn.disabled = false; btn.textContent = "Tentar de novo";
    });
  };

  document.getElementById("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var submitBtn = document.getElementById("submitAddBtn");
    if (submitBtn.disabled) return;

    var date = document.getElementById("fDate").value;
    var valor = parseFloat(document.getElementById("fValor").value);
    var categoria = document.getElementById("fCategoria").value;
    var payer = document.getElementById("fPayer").value;
    var parcela = document.getElementById("fParcela").value.trim();
    var reason = document.getElementById("fReason").value.trim();
    if (!date || isNaN(valor)) { showAlert("Preencha data e valor."); return; }

    var parcelaMatch = parcela.match(/^(\d+)\s*\/\s*(\d+)$/);
    var atual = null, total = null, grupo = null;
    if (parcelaMatch) {
      atual = parseInt(parcelaMatch[1], 10);
      total = parseInt(parcelaMatch[2], 10);
      if (total <= atual) { showAlert("Na parcela, o total deve ser maior que a atual (ex: 3/12)."); return; }
      grupo = slugify(payer) + "-" + slugify(reason || categoria) + "-" + total;
    }

    // O mes do lancamento vem da DATA informada, nao da aba aberta no momento
    // (bug conhecido da versao anterior: usava sempre o mes selecionado na tela).
    var mesIdFromDate = date.slice(0, 7);

    submitBtn.disabled = true; submitBtn.textContent = "Salvando…";

    var fallbackValorMes = (monthsCache[currentMonthId] || {}).valorMes || 2500;
    ensureMonthRecord(mesIdFromDate, fallbackValorMes).then(function (mesInfo) {
      var fields = {};
      fields[F.lanc.data] = date;
      fields[F.lanc.valor] = valor;
      fields[F.lanc.categoria] = categoria;
      fields[F.lanc.quemPagou] = payer;
      fields[F.lanc.motivo] = reason || categoria;
      fields[F.lanc.mesLink] = [mesInfo.recordId];
      if (atual != null) {
        fields[F.lanc.parcelaAtual] = atual;
        fields[F.lanc.parcelaTotal] = total;
        fields[F.lanc.grupoParcela] = grupo;
        fields[F.lanc.origemImportId] = "installment-" + grupo + "-" + atual;
        fields[F.lanc.pago] = true; // parcela: divida ja comprometida na compra
      }

      var createFirst;
      if (atual != null) {
        createFirst = findExistingOrigemIds([fields[F.lanc.origemImportId]]).then(function (existing) {
          if (existing[fields[F.lanc.origemImportId]]) return null; // duplicata de clique duplo
          return createRecordsChunked(T_LANC, [{ fields: fields }]);
        });
      } else {
        createFirst = createRecordsChunked(T_LANC, [{ fields: fields }]);
      }

      return createFirst.then(function () {
        if (atual != null && total > atual) {
          return propagateInstallments(reason || categoria, valor, payer, categoria, mesIdFromDate, atual, total, grupo, function (i, totalPend) {
            submitBtn.textContent = "Criando parcela " + i + "/" + totalPend + "…";
          });
        }
      }).then(function () {
        return { mesIdFromDate: mesIdFromDate };
      });
    }).then(function (result) {
      hideOffline();
      salvarUltimaCategoria(categoria);
      document.getElementById("addForm").reset();
      document.getElementById("fDate").value = todayISO();
      aplicarUltimaCategoria();
      addOpen = false; addCard.style.display = "none";
      toggleAddBtn.textContent = "+ Adicionar lançamento";
      submitBtn.disabled = false; submitBtn.textContent = "Salvar lançamento";
      if (result.mesIdFromDate !== currentMonthId) {
        showAlert("Lançamento salvo em " + monthLabel(result.mesIdFromDate) + " (mês da data informada).").then(function () {
          return refreshMonthView(currentMonthId);
        });
      } else {
        return refreshMonthView(currentMonthId);
      }
    }).catch(function (e) {
      console.error(e);
      submitBtn.disabled = false; submitBtn.textContent = "Salvar lançamento";
      showOffline("Não foi possível salvar o lançamento (" + e.message + ").");
    });
  });

  function rebuildMonthSelect() {
    var ids = Object.keys(monthsCache).sort().reverse();
    monthSelect.innerHTML = "";
    ids.forEach(function (id) {
      var opt = document.createElement("option");
      opt.value = id; opt.textContent = monthLabel(id);
      monthSelect.appendChild(opt);
    });
    return ids;
  }

  function rebuildMonthSelectAndSelect(id) {
    rebuildMonthSelect();
    showMonthTab();
    return selectMonth(id);
  }

  function selectMonth(id) {
    currentMonthId = id;
    monthSelect.value = id;
    return refreshMonthView(id);
  }

  function refreshMonthView(id) {
    document.getElementById("entriesList").innerHTML = '<div class="empty">Carregando…</div>';
    return loadLancamentosForMonth(id).then(function (entries) {
      currentEntries = entries;
      hideOffline();
      renderEntries(id, entries);
    }).catch(function (e) {
      console.error(e);
      showOffline("Não foi possível carregar os lançamentos (" + e.message + ").");
    });
  }

  function catShort(c) {
    return { "Semanal": "Semanal", "Extra / compra": "Extra", "Adiantamento": "Adiant.", "Emprestimo": "Empréstimo" }[c] || c;
  }

  // ---- visao por pessoa (QuemPagou) ----
  var ORDEM_PAGADORES = ["André", "Andressa"];
  function sumByPayer(list, onlyPaid) {
    var totals = {};
    list.forEach(function (e) {
      if (onlyPaid && !e.paid) return;
      var payer = e.payer || "—";
      totals[payer] = (totals[payer] || 0) + e.value;
    });
    return totals;
  }
  function formatByPayer(totals) {
    var keys = Object.keys(totals);
    if (keys.length === 0) return "—";
    keys.sort(function (a, b) {
      var ia = ORDEM_PAGADORES.indexOf(a); if (ia === -1) ia = 99;
      var ib = ORDEM_PAGADORES.indexOf(b); if (ib === -1) ib = 99;
      return ia - ib;
    });
    return keys.map(function (k) { return k + ": " + brl(totals[k]); }).join(" · ");
  }
  function loadAllLancamentos() {
    return listAll(T_LANC, { returnFieldsByFieldId: "true" }).then(function (records) {
      return records.map(normalizeLancamento);
    });
  }

  // ---- saldo acumulado entre meses (informativo, nao afeta a sugestao semanal) ----
  // Soma corrida do saldo (ValorMensal - TotalPago) de cada mes em ordem cronologica.
  // Calculado no app a partir de monthsCache (ja carregado por completo) porque o
  // Airtable nao tem como expressar uma soma recursiva sobre uma cadeia de meses que
  // cresce com o tempo — cada formula/rollup so enxerga o registro ligado direto, nao
  // a cadeia inteira, e nao ha "rollup do rollup" em cadeia sem recriar campos a cada
  // mes novo.
  function computeSaldoAcumulado() {
    var ids = Object.keys(monthsCache).sort(); // cronologico (MesID = AAAA-MM ordena certo)
    var acumulado = 0;
    var porMes = {};
    ids.forEach(function (id) {
      var r = monthsCache[id];
      var saldoMes = r.saldo == null ? r.valorMes - r.totalPago : r.saldo;
      acumulado += saldoMes;
      porMes[id] = acumulado;
    });
    return porMes;
  }

  function updateStatsDisplay(mesInfo) {
    document.getElementById("valorMesInput").value = mesInfo.valorMes;
    document.getElementById("statValorMes").textContent = brl(mesInfo.valorMes);
    document.getElementById("statPago").textContent = brl(mesInfo.totalPago);
    var saldo = mesInfo.saldo == null ? mesInfo.valorMes - mesInfo.totalPago : mesInfo.saldo;
    var saldoEl = document.getElementById("statSaldo");
    saldoEl.textContent = brl(saldo);
    saldoEl.className = "val " + (saldo < 0 ? "neg" : (saldo > 0 ? "pos" : ""));
  }

  function setRowPaidVisual(row, paid) {
    row.classList.toggle("pending", !paid);
    var tag = row.querySelector(".tag.pendente");
    if (paid && tag) tag.remove();
    if (!paid && !tag) {
      var dateDiv = row.querySelector(".date");
      var span = document.createElement("span");
      span.className = "tag pendente";
      span.textContent = "Pendente";
      dateDiv.appendChild(span);
    }
  }

  // ---- edicao inline de valor/data (preserva Pago e os demais campos) ----
  function salvarEdicaoValor(recordId, novoValor) {
    var fields = {};
    fields[F.lanc.valor] = novoValor;
    return editarLancamento(recordId, fields).then(function () {
      hideOffline();
      return loadMeses().then(function () { return refreshMonthView(currentMonthId); });
    }).catch(function (e) {
      console.error(e);
      showOffline("Não foi possível salvar o valor (" + e.message + ").");
      return refreshMonthView(currentMonthId);
    });
  }

  function salvarEdicaoData(recordId, novaData) {
    var novoMesId = novaData.slice(0, 7);
    var mudouMes = novoMesId !== currentMonthId;
    var fallbackValorMes = (monthsCache[currentMonthId] || {}).valorMes || 2500;
    return (mudouMes ? ensureMonthRecord(novoMesId, fallbackValorMes) : Promise.resolve(null)).then(function (mesInfo) {
      var fields = {};
      fields[F.lanc.data] = novaData;
      if (mudouMes) fields[F.lanc.mesLink] = [mesInfo.recordId];
      return editarLancamento(recordId, fields);
    }).then(function () {
      hideOffline();
      return loadMeses();
    }).then(function () {
      return refreshMonthView(currentMonthId).then(function () {
        if (mudouMes) return showAlert("Lançamento movido pra " + monthLabel(novoMesId) + " (mês da nova data).");
      });
    }).catch(function (e) {
      console.error(e);
      showOffline("Não foi possível salvar a data (" + e.message + ").");
      return refreshMonthView(currentMonthId);
    });
  }

  function ativarEdicaoInline(span) {
    if (span.querySelector("input")) return; // ja em edicao
    var recordId = span.getAttribute("data-id");
    var field = span.getAttribute("data-field");
    var entry = currentEntries.filter(function (e) { return e.id === recordId; })[0];
    if (!entry) return;

    var original = span.textContent;
    var input = document.createElement("input");
    input.className = "inline-edit-input";
    if (field === "valor") {
      input.type = "number"; input.step = "0.01"; input.value = entry.value;
    } else {
      input.type = "date"; input.value = entry.date;
    }
    span.textContent = "";
    span.appendChild(input);
    input.focus();
    if (input.select) input.select();

    var done = false;
    function restaurar() { span.textContent = original; }
    function salvar() {
      if (done) return;
      done = true;
      if (field === "valor") {
        var novoValor = parseFloat(input.value);
        if (isNaN(novoValor) || novoValor === entry.value) { restaurar(); return; }
        span.textContent = "…";
        salvarEdicaoValor(recordId, novoValor);
      } else {
        var novaData = input.value;
        if (!novaData || novaData === entry.date) { restaurar(); return; }
        span.textContent = "…";
        salvarEdicaoData(recordId, novaData);
      }
    }
    input.onblur = salvar;
    input.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); done = true; restaurar(); }
    };
  }

  function renderEntries(id, entries) {
    var list = document.getElementById("entriesList");
    if (entries.length === 0) {
      list.innerHTML = '<div class="empty">Nenhum lançamento neste mês ainda.</div>';
    } else {
      var html = "";
      entries.slice().reverse().forEach(function (v) {
        var dateFmt = v.date ? v.date.split("-").reverse().slice(0, 2).join("/") : "";
        var parcelaTxt = v.parcelaAtual && v.parcelaTotal ? " (Parc " + v.parcelaAtual + "/" + v.parcelaTotal + ")" : "";
        html += '<div class="entry' + (v.paid ? "" : " pending") + '">' +
          '<label class="pago-toggle-wrap">' +
          '<input type="checkbox" class="pago-toggle" data-id="' + v.id + '" aria-label="Marcar lançamento como pago"' + (v.paid ? " checked" : "") + '>' +
          '</label>' +
          '<div class="info">' +
          '<div class="date"><span class="editable" data-id="' + v.id + '" data-field="data">' + dateFmt + '</span>' +
          '<span class="tag">' + catShort(v.category) + '</span>' +
          (v.paid ? "" : '<span class="tag pendente">Pendente</span>') + '</div>' +
          '<div class="reason">' + escapeHtml(v.reason || "") + escapeHtml(parcelaTxt) + '</div>' +
          '</div>' +
          '<div class="right">' +
          '<div class="value"><span class="editable" data-id="' + v.id + '" data-field="valor">' + brl(v.value) + '</span></div>' +
          '<div class="payer">' + escapeHtml(v.payer || "") + '</div>' +
          '<button class="danger" data-id="' + v.id + '">excluir</button>' +
          '</div>' +
          '</div>';
      });
      list.innerHTML = html;
      Array.prototype.forEach.call(list.querySelectorAll("input.pago-toggle"), function (chk) {
        chk.onchange = function () {
          var recordId = chk.getAttribute("data-id");
          var novoValor = chk.checked;
          var entry = currentEntries.filter(function (e) { return e.id === recordId; })[0];
          var mesInfo = monthsCache[id];
          var delta = entry ? (novoValor ? 1 : -1) * entry.value : 0;
          var row = chk.closest(".entry");

          if (entry) entry.paid = novoValor;
          setRowPaidVisual(row, novoValor);
          if (mesInfo) {
            mesInfo.totalPago += delta;
            if (mesInfo.saldo != null) mesInfo.saldo -= delta;
            updateStatsDisplay(mesInfo);
          }

          chk.disabled = true;
          setPago(recordId, novoValor).then(function () {
            hideOffline();
            chk.disabled = false;
          }).catch(function (e) {
            console.error(e);
            if (entry) entry.paid = !novoValor;
            setRowPaidVisual(row, !novoValor);
            chk.checked = !novoValor;
            if (mesInfo) {
              mesInfo.totalPago -= delta;
              if (mesInfo.saldo != null) mesInfo.saldo += delta;
              updateStatsDisplay(mesInfo);
            }
            chk.disabled = false;
            showOffline("Não foi possível atualizar (" + e.message + ").");
          });
        };
      });
      Array.prototype.forEach.call(list.querySelectorAll(".editable"), function (span) {
        span.onclick = function () { ativarEdicaoInline(span); };
      });
      Array.prototype.forEach.call(list.querySelectorAll("button.danger"), function (btn) {
        btn.onclick = function () {
          var recordId = btn.getAttribute("data-id");
          showConfirm("Excluir este lançamento?").then(function (ok) {
            if (!ok) return;
            btn.disabled = true; btn.textContent = "excluindo…";
            deleteLancamento(recordId).then(function () {
              hideOffline();
              return loadMeses().then(function () { return refreshMonthView(id); });
            }).catch(function (e) {
              console.error(e);
              btn.disabled = false; btn.textContent = "excluir";
              showOffline("Não foi possível excluir (" + e.message + ").");
            });
          });
        };
      });
    }

    var mesInfo = monthsCache[id] || { valorMes: 0, totalPago: 0, saldo: 0 };
    updateStatsDisplay(mesInfo);

    var info = computeWeeklySuggestion(id, entries);
    currentPendentesInfo = info;
    document.getElementById("suggestedWeeklyText").textContent = info.text;
    document.getElementById("byPayerMonthText").textContent = "Pago por pessoa: " + formatByPayer(sumByPayer(entries, true));

    var acumuladoPorMes = computeSaldoAcumulado();
    var saldoAcumuladoAtual = acumuladoPorMes[id];
    var elAcumulado = document.getElementById("saldoAcumuladoText");
    elAcumulado.textContent = "Saldo acumulado até este mês: " + brl(saldoAcumuladoAtual);
    elAcumulado.style.color = saldoAcumuladoAtual < 0 ? "var(--neg)" : (saldoAcumuladoAtual > 0 ? "var(--pos)" : "");

    var genBtn = document.getElementById("genWeeklyBtn");
    genBtn.disabled = info.pendentes.length === 0;
    genBtn.textContent = info.pendentes.length === 0
      ? "Todas as sextas já lançadas"
      : "Gerar " + info.pendentes.length + " pagamento(s) de sexta pendente(s)";
  }

  function renderOverview() {
    var el = document.getElementById("overviewList");
    var byPayerEl = document.getElementById("byPayerAllText");
    el.innerHTML = '<div class="empty">Carregando…</div>';
    byPayerEl.textContent = "Carregando…";
    Promise.all([loadMeses(), loadAllLancamentos()]).then(function (results) {
      var allEntries = results[1];
      var ids = Object.keys(monthsCache).sort().reverse();
      if (ids.length === 0) {
        el.innerHTML = '<div class="empty">Nenhum mês cadastrado.</div>';
        byPayerEl.textContent = "—";
        return;
      }
      hideOffline();

      byPayerEl.textContent = formatByPayer(sumByPayer(allEntries, true));

      // agrupa os meses por ano (prefixo AAAA do MesID)
      var porAno = {};
      ids.forEach(function (id) {
        var ano = id.slice(0, 4);
        porAno[ano] = porAno[ano] || [];
        porAno[ano].push(id);
      });
      var anos = Object.keys(porAno).sort().reverse();
      var anoAtual = currentMonthKey().slice(0, 4);
      var acumuladoPorMes = computeSaldoAcumulado();

      var html = "";
      anos.forEach(function (ano) {
        var mesesDoAno = porAno[ano];
        var totalPrevisto = 0, totalPago = 0;
        mesesDoAno.forEach(function (id) {
          var r = monthsCache[id];
          totalPrevisto += r.valorMes;
          totalPago += r.totalPago;
        });
        var saldoAno = totalPrevisto - totalPago;
        html += '<details class="year-group"' + (ano === anoAtual ? " open" : "") + '>' +
          '<summary class="year-summary">' +
          '<span class="year-caret">▸</span>' +
          '<span class="year-label">' + ano + '</span>' +
          '<span class="year-stats">Pago ' + brl(totalPago) + ' de ' + brl(totalPrevisto) +
          '<span class="year-saldo" style="color:' + (saldoAno < 0 ? 'var(--neg)' : (saldoAno > 0 ? 'var(--pos)' : 'inherit')) + ';">' + brl(saldoAno) + '</span>' +
          '</span>' +
          '</summary>' +
          '<div class="year-months">';
        mesesDoAno.forEach(function (id) {
          var r = monthsCache[id];
          var saldo = r.saldo == null ? r.valorMes - r.totalPago : r.saldo;
          var acumulado = acumuladoPorMes[id];
          html += '<div class="overview-row' + (saldo < 0 ? ' negative' : '') + '" data-month="' + id + '">' +
            '<div><div class="m">' + monthLabel(id) + '</div>' +
            '<div class="sub2">Pago ' + brl(r.totalPago) + ' de ' + brl(r.valorMes) +
            ' · Acumulado <span style="color:' + (acumulado < 0 ? 'var(--neg)' : (acumulado > 0 ? 'var(--pos)' : 'inherit')) + ';">' + brl(acumulado) + '</span></div></div>' +
            '<div style="text-align:right; font-weight:700; color:' + (saldo < 0 ? 'var(--neg)' : (saldo > 0 ? 'var(--pos)' : 'inherit')) + ';">' + brl(saldo) + '</div>' +
            '</div>';
        });
        html += '</div></details>';
      });
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll(".overview-row"), function (row) {
        row.onclick = function () {
          var id = row.getAttribute("data-month");
          rebuildMonthSelect();
          showMonthTab();
          selectMonth(id);
        };
      });
    }).catch(function (e) {
      console.error(e);
      showOffline("Não foi possível carregar a visão geral (" + e.message + ").");
      el.innerHTML = '<div class="empty">Sem conexão.</div>';
      byPayerEl.textContent = "—";
    });
  }

  // ---- poll leve pra pegar lancamentos feitos em outro dispositivo ----
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (addOpen || modalOverlay.style.display !== "none") return; // nao interrompe quem esta digitando
      if (viewOverview.style.display !== "none") { renderOverview(); return; }
      if (currentMonthId) {
        loadMeses().then(function () { return refreshMonthView(currentMonthId); }).catch(function () {});
      }
    }, POLL_MS);
  }

  function init() {
    if (!AIRTABLE_TOKEN || AIRTABLE_TOKEN === "COLE_SEU_TOKEN_AQUI") {
      showOffline("Configure AIRTABLE_TOKEN no index.html antes de usar (veja README.md).");
      document.getElementById("entriesList").innerHTML = '<div class="empty">Token do Airtable não configurado.</div>';
      return;
    }
    loadMeses().then(function () {
      hideOffline();
      var ids = Object.keys(monthsCache);
      if (ids.length === 0) {
        return createMonth(currentMonthKey(), 2500).then(function () { return loadMeses(); });
      }
    }).then(function () {
      var ids = rebuildMonthSelect();
      var toSelect = ids.indexOf(currentMonthKey()) >= 0 ? currentMonthKey() : ids[0];
      return selectMonth(toSelect);
    }).then(function () {
      startPolling();
    }).catch(function (e) {
      console.error(e);
      showOffline("Não foi possível conectar ao Airtable (" + e.message + ").");
      document.getElementById("entriesList").innerHTML = '<div class="empty">Sem conexão com o Airtable.</div>';
    });
  }

  init();
})();
