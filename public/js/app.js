(() => {
  "use strict";

  /* ============================================================
     상태
     ============================================================ */
  const STORAGE_KEY = "policy-report-draft-v1";
  const state = {
    step: 1,
    answers: { q1: "", q2: "", q3: "", q4: "" },
    page_length: "1",
    result: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const wizard = $("#wizard");
  const loadingEl = $("#loading");
  const resultView = $("#resultView");
  const paperEl = $("#paper");
  const copyToast = $("#copyToast");
  const lengthBadge = $("#lengthBadge");

  /* ============================================================
     초안 로컬 저장/복원 (클라이언트 저장, 서버 저장 없음)
     ============================================================ */
  function saveDraft() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ answers: state.answers, page_length: state.page_length })
      );
    } catch (e) {
      /* 저장 실패는 조용히 무시 */
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.answers) Object.assign(state.answers, parsed.answers);
      if (parsed.page_length) state.page_length = parsed.page_length;
    } catch (e) {
      /* 손상된 데이터는 무시 */
    }
  }

  /* ============================================================
     위저드 네비게이션
     ============================================================ */
  function showStep(n) {
    state.step = n;
    $$(".step", wizard).forEach((el) => {
      el.hidden = Number(el.dataset.step) !== n;
    });
    $$(".progress-dot").forEach((dot) => {
      const s = Number(dot.dataset.step);
      dot.classList.toggle("active", s === n);
      dot.classList.toggle("done", s < n);
    });
  }

  function syncTextareasFromState() {
    $("#q1").value = state.answers.q1;
    $("#q2").value = state.answers.q2;
    $("#q3").value = state.answers.q3;
    $("#q4").value = state.answers.q4;
  }

  function bindWizard() {
    $$("[data-next]", wizard).forEach((btn) => {
      btn.addEventListener("click", () => {
        const stepEl = btn.closest(".step");
        const n = Number(stepEl.dataset.step);
        const ta = stepEl.querySelector("textarea");
        if (ta) state.answers[ta.id] = ta.value.trim();
        saveDraft();
        showStep(n + 1);
      });
    });
    $$("[data-prev]", wizard).forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = Number(btn.closest(".step").dataset.step);
        showStep(n - 1);
      });
    });

    $$(".length-card").forEach((card) => {
      card.addEventListener("click", () => {
        $$(".length-card").forEach((c) => c.dataset.selected = "false");
        card.dataset.selected = "true";
        state.page_length = card.dataset.length;
        saveDraft();
      });
    });

    $("#toSummary").addEventListener("click", () => {
      renderSummary();
      showStep(6);
    });

    $("#generateBtn").addEventListener("click", generateReport);
    $("#regenBtn").addEventListener("click", generateReport);

    $("#startOverBtn").addEventListener("click", () => {
      resultView.hidden = true;
      wizard.hidden = false;
      showStep(1);
    });

    $("#editToggle").addEventListener("click", toggleEdit);
    $("#copyBtn").addEventListener("click", copyFormatted);
  }

  function renderSummary() {
    const labels = {
      q1: "Q1 · 목표(To-be)",
      q2: "Q2 · 왜 중요한가",
      q3: "Q3 · 현재 상태(현황)",
      q4: "Q4 · 원인(문제점)",
    };
    const dl = $("#summary");
    dl.innerHTML = "";
    ["q1", "q2", "q3", "q4"].forEach((k) => {
      const dt = document.createElement("dt");
      dt.textContent = labels[k];
      const dd = document.createElement("dd");
      dd.textContent = state.answers[k] || "(입력 없음)";
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    const dt = document.createElement("dt");
    dt.textContent = "Q5 · 분량";
    const dd = document.createElement("dd");
    dd.textContent = state.page_length === "2" ? "2장 · 정식" : "1장 · 약식";
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  /* ============================================================
     보고서 생성 호출 (스트리밍 응답 처리 — Inactivity Timeout 방지)
     ============================================================ */
  async function generateReport() {
    wizard.hidden = true;
    resultView.hidden = true;
    loadingEl.hidden = false;

    try {
      const res = await fetch("/.netlify/functions/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal_tobe: state.answers.q1,
          importance: state.answers.q2,
          current_problem: state.answers.q3,
          root_cause: state.answers.q4,
          page_length: state.page_length,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`서버 응답 오류 (${res.status}) ${errText}`);
      }

      const data = await readAnthropicStream(res);
      state.result = data;
      renderResult(data);
      loadingEl.hidden = true;
      resultView.hidden = false;
    } catch (err) {
      loadingEl.hidden = true;
      wizard.hidden = false;
      alert(
        "보고서 생성 중 문제가 발생했습니다.\n" +
          (err && err.message ? err.message : "잠시 후 다시 시도해주세요.") +
          "\n\n(Netlify 함수의 ANTHROPIC_API_REPORT 환경변수가 설정되어 있는지 확인해주세요.)"
      );
    }
  }

  // Anthropic Messages API의 SSE 스트림(content_block_delta)을 읽어 텍스트를 조립하고,
  // 최종적으로 하나의 JSON 객체로 파싱한다.
  async function readAnthropicStream(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        let dataStr = "";
        rawEvent.split("\n").forEach((l) => {
          if (l.startsWith("data:")) dataStr += l.slice(5).trim();
        });
        if (!dataStr) continue;

        let evt;
        try {
          evt = JSON.parse(dataStr);
        } catch (e) {
          continue;
        }

        if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
          fullText += evt.delta.text;
        }
        if (evt.type === "error") {
          throw new Error((evt.error && evt.error.message) || "스트림 오류가 발생했습니다.");
        }
      }
    }

const cleaned = fullText
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    // AI가 JSON 앞뒤에 군더더기 문장을 붙이는 경우까지 대비해, 가장 바깥쪽 { ... }만 추출한다.
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const jsonCandidate =
      firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;

    try {
      return JSON.parse(jsonCandidate);
    } catch (e) {
      throw new Error(
        "모델 응답을 JSON으로 해석하지 못했습니다. (응답 끝부분 미리보기: \u201C" +
          cleaned.slice(-200) +
          "\u201D)"
      );
    }
  }

  /* ============================================================
     결과 렌더링 (3-1 서식 규정 적용된 A4 미리보기)
     ============================================================ */
  function line(level, marker, text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.className = `lvl-${level}`;
    const m = document.createElement("span");
    m.className = "marker";
    m.textContent = marker;
    const t = document.createElement("span");
    t.className = "txt";
    t.textContent = text;
    div.appendChild(m);
    div.appendChild(t);
    return div;
  }

  function heading(text) {
    const div = document.createElement("div");
    div.className = "lvl-0";
    const m = document.createElement("span");
    m.className = "marker";
    m.textContent = "□";
    const t = document.createElement("span");
    t.className = "txt";
    t.textContent = text;
    div.appendChild(m);
    div.appendChild(t);
    return div;
  }

  function renderResult(data) {
    paperEl.innerHTML = "";
    lengthBadge.textContent = state.page_length === "2" ? "2장 · 정식" : "1장 · 약식";

    const title = document.createElement("h1");
    title.className = "paper-title";
    title.textContent = data.title || "정책기획보고서";
    paperEl.appendChild(title);

    // ---- 추진배경 ----
    const bg = data.background || {};
    const secBg = document.createElement("div");
    secBg.className = "sec";
    secBg.appendChild(heading("추진배경"));

    const purposeCombined = [bg.purpose, bg.necessity].filter(Boolean).join(" ");
    appendIfNode(secBg, line(1, "○", purposeCombined ? `(목적·필요성) ${purposeCombined}` : ""));
    appendIfNode(secBg, line(1, "○", bg.current_status ? `(현황) ${bg.current_status}` : ""));
    appendIfNode(secBg, line(1, "○", bg.problem_cause ? `(문제점) ${bg.problem_cause}` : ""));
    appendIfNode(secBg, line(3, "·", bg.cause_analytic ? `분석적 근거: ${bg.cause_analytic}` : ""));
    appendIfNode(secBg, line(3, "·", bg.cause_empathetic ? `공감적 근거: ${bg.cause_empathetic}` : ""));
    paperEl.appendChild(secBg);

    // ---- 개선방안 ----
    const imp = data.improvement || {};
    const secImp = document.createElement("div");
    secImp.className = "sec";
    secImp.appendChild(heading("개선방안"));
    if (imp.criteria) {
      const tag = document.createElement("div");
      tag.className = "criteria-tag";
      tag.style.marginLeft = "1.4em";
      tag.textContent = `MECE 기준: ${imp.criteria}`;
      secImp.appendChild(tag);
    }
    (imp.items || []).forEach((item) => {
      appendIfNode(secImp, line(1, "○", `(${item.title || "방안"}) ${item.detail || ""}`));
      appendIfNode(secImp, line(2, "-", item.related_cause ? `관련 원인: ${item.related_cause}` : ""));
    });
    paperEl.appendChild(secImp);

    // ---- 추진계획 ----
    const secPlan = document.createElement("div");
    secPlan.className = "sec";
    secPlan.appendChild(heading("추진계획"));
    (data.plan || []).forEach((p) => {
      appendIfNode(
        secPlan,
        line(1, "○", `(${p.phase || "단계"}) ${p.action || ""}${p.timing ? ` — ${p.timing}` : ""}`)
      );
    });
    paperEl.appendChild(secPlan);

    // ---- 기대효과 (2장/정식일 때만) ----
    if (state.page_length === "2" && Array.isArray(data.expected_effect) && data.expected_effect.length) {
      const secEff = document.createElement("div");
      secEff.className = "sec";
      secEff.appendChild(heading("기대효과"));
      const table = document.createElement("table");
      table.className = "effect-table";
      const thead = document.createElement("tr");
      thead.innerHTML = "<th>구분</th><th>수치</th>";
      table.appendChild(thead);
      data.expected_effect.forEach((e) => {
        const tr = document.createElement("tr");
        const td1 = document.createElement("td");
        td1.textContent = e.metric || "";
        const td2 = document.createElement("td");
        td2.textContent = e.value || "";
        tr.appendChild(td1);
        tr.appendChild(td2);
        table.appendChild(tr);
      });
      secEff.appendChild(table);
      paperEl.appendChild(secEff);
    }
  }

  function appendIfNode(parent, node) {
    if (node) parent.appendChild(node);
  }

  /* ============================================================
     인라인 편집 토글
     ============================================================ */
  function toggleEdit() {
    const editables = $$(".txt", paperEl);
    const turningOn = editables[0] && editables[0].getAttribute("contenteditable") !== "true";
    editables.forEach((el) => el.setAttribute("contenteditable", turningOn ? "true" : "false"));
    $("#editToggle").textContent = turningOn ? "✓ 편집 완료" : "✎ 직접 수정";
  }

  /* ============================================================
     서식 포함 복사 (한글 HWP / MS Word 붙여넣기 대응)
     ============================================================ */
  const INLINE_STYLE = {
    "paper-title":
      "font-family:'HY헤드라인M','Noto Sans KR','Malgun Gothic',sans-serif;font-size:22pt;font-weight:700;margin:0 0 10pt;border-bottom:2px solid #1B3A5C;padding-bottom:8pt;",
    "lvl-0":
      "font-family:'HY헤드라인M','Noto Sans KR','Malgun Gothic',sans-serif;font-size:16pt;font-weight:700;margin:14pt 0 8pt;",
    "lvl-1":
      "font-family:'휴먼명조','Noto Serif KR','Batang',serif;font-size:15pt;line-height:2;margin:0 0 7pt 1.4em;",
    "lvl-2":
      "font-family:'휴먼명조','Noto Serif KR','Batang',serif;font-size:15pt;line-height:2;margin:0 0 7pt 2.8em;",
    "lvl-3":
      "font-family:'중고딕','Noto Sans KR','Malgun Gothic',sans-serif;font-size:13pt;line-height:1.8;margin:0 0 6pt 4.2em;color:#5B6472;",
    "criteria-tag":
      "font-family:'중고딕','Noto Sans KR','Malgun Gothic',sans-serif;font-size:11pt;color:#28517C;margin:0 0 4pt 1.4em;display:block;",
    "effect-table":
      "border-collapse:collapse;font-family:'중고딕','Noto Sans KR','Malgun Gothic',sans-serif;font-size:12pt;margin-left:1.4em;width:90%;",
  };

  function buildRichHtml() {
    const clone = paperEl.cloneNode(true);
    // contenteditable 속성 제거 (붙여넣기 결과 깔끔하게)
    $$("[contenteditable]", clone).forEach((el) => el.removeAttribute("contenteditable"));

    // 클래스별 인라인 스타일 주입
    Object.keys(INLINE_STYLE).forEach((cls) => {
      $$(`.${cls}`, clone).forEach((el) => {
        el.setAttribute("style", (el.getAttribute("style") || "") + INLINE_STYLE[cls]);
      });
    });
    $$("th, td", clone).forEach((el) => {
      el.setAttribute(
        "style",
        (el.getAttribute("style") || "") + "border:1px solid #DEE3EA;padding:6pt 10pt;text-align:left;"
      );
    });
    $$("th", clone).forEach((el) => {
      el.setAttribute("style", (el.getAttribute("style") || "") + "background:#E5E5E5;font-weight:700;");
    });

    const wrapper = document.createElement("div");
    wrapper.setAttribute(
      "style",
      "letter-spacing:0;padding:15mm 20mm;font-family:'휴먼명조','Noto Serif KR',serif;"
    );
    wrapper.appendChild(clone);
    return wrapper.outerHTML;
  }

  async function copyFormatted() {
    const html = buildRichHtml();
    const text = paperEl.innerText;

    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      showToast();
    } catch (e) {
      // 폴백: 순수 텍스트 복사
      try {
        await navigator.clipboard.writeText(text);
        showToast();
      } catch (e2) {
        alert("클립보드 복사에 실패했습니다. 브라우저 권한을 확인해주세요.");
      }
    }
  }

  function showToast() {
    copyToast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (copyToast.hidden = true), 3200);
  }

  /* ============================================================
     초기화
     ============================================================ */
  loadDraft();
  syncTextareasFromState();
  if (state.page_length === "2") {
    document.addEventListener("DOMContentLoaded", () => {
      $$(".length-card").forEach((c) => (c.dataset.selected = c.dataset.length === "2" ? "true" : "false"));
    });
  }
  bindWizard();
  showStep(1);
})();
