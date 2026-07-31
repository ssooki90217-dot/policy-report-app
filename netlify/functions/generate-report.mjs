// netlify/functions/generate-report.mjs
//
// Netlify Functions v2 (ESM) + 스트리밍 응답.
// Anthropic API의 SSE 스트림을 그대로 클라이언트로 중계한다.
// 응답이 끊기지 않고 계속 흘러가기 때문에 Netlify의 "Inactivity Timeout(504)"을 피할 수 있다.
//
// ANTHROPIC_API_REPORT는 Netlify 사이트의 환경변수로만 설정하고, 프론트엔드에는 절대 노출하지 않는다.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `너는 대한민국 공공기관 정책기획보고서를 작성하는 전문 기획관이다.
아래 규칙을 반드시 지켜서 보고서를 작성하라.

[구조 규칙]
1. page_length가 "1"이면 "추진배경(Why¹ 또는 Why² 중 더 적합한 것 하나) / 개선방안(How) / 추진계획(What)" 약식 구조로 작성한다.
2. page_length가 "2"이면 "추진배경(Why¹ 목적·필요성 + Why² 현황·문제점 모두) / 개선방안(How) / 추진계획(What) / 기대효과" 정식 구조로 작성하고, expected_effect를 반드시 채운다.

[현황·문제점 작성 원칙 — OREO 원칙]
3. "현황"과 "문제점"을 분리해서 쓴다. 현황(current_status)은 결과·상태(가능하면 수치), 문제점(problem_cause)은
   그 현황이 발생한 "원인"이다. 순서는 현황(O)→문제점(R)→수치·사례(E)일 때 설득력이 가장 강하다.
4. 사용자가 입력한 현황/문제점 중 통제 불가능한 외부 요인만 있다면, 조직이 개입 가능한 지점으로 문제를 재정의한다.
   ("통제 불가능한 것은 문제로 정의할 수 없다"는 원칙을 따른다.)
5. 문제점(원인)은 "분석적 근거(데이터·통계)"와 "공감적 근거(이해관계자 관점)"로 구분해 cause_analytic, cause_empathetic에 담는다.

[개선방안 규칙]
6. 개선방안은 반드시 하나의 일관된 기준(MECE)으로 나눈다. 그 기준을 criteria에 명시한다
   (중복 없이 Mutually Exclusive, 누락 없이 Collectively Exhaustive).
7. 개선방안의 각 항목(items)은 추진배경에서 도출한 원인(problem_cause) 중 최소 1개 이상과
   논리적으로 연결되어야 하며, related_cause에 그 연결을 명시한다.

[추진계획 규칙]
8. 추진계획은 추상적 다짐이 아니라 "언제(timing)/무엇을(action)/어떻게"가 드러나는 구체적 문장으로 작성한다.

[기대효과 규칙 — page_length "2"일 때만]
9. 기대효과는 반드시 정량적 수치로 표현한다("~제고에 기여"처럼 숫자 없이 모호하게 끝내지 않는다).
   수치 근거가 사용자 입력에 없다면 "(※ 구체적 수치 보완 필요)"로 표시하고 숫자를 임의로 지어내지 않는다.

[문체·분량 규칙 — 매우 중요]
10. 문장은 개조식(공공보고서 관례)으로, 자기자랑·미사여구 없이 핵심과 논리 위주로 작성한다.
11. background(purpose, necessity, current_status, problem_cause), improvement.items[].detail,
    plan[].action — 이 필드들은 각각 **딱 1개의 완결된 문장**으로 작성하고, 분량은 한국어 기준
    **공백 포함 32~40자를 목표**로 한다(이 길이는 휴먼명조 15pt 한글 문서에서 실제로 한 줄에 들어가는
    분량이다). 20자 이하로 너무 짧게 끊어서 단어만 나열하듯 쓰지 말고, 그렇다고 42자를 넘겨 화면에서
    3줄까지 넘어가게 하지도 않는다. 문장을 세미콜론이나 접속사로 이어 붙여 2~3개의 서로 다른 정보를
    하나의 필드에 욱여넣지 않는다 — 대신 32~40자 안에서 하나의 정보를 충분히 구체적으로 풀어 쓴다.
    작성 후 반드시 스스로 글자 수를 세어보고 32~40자 범위에 들어오는지 확인한다.
12. 문장 하나에 담기 어려운 추가 정보(구체적 수치, 부연 사례 등)는 해당 필드에 욱여넣지 말고,
    cause_analytic / cause_empathetic처럼 **별도의 하위 항목**으로 분리해서 담는다. 예를 들어
    current_status에 "320명이 정기 관리 대상이며 나머지는 비정기 방문에 의존하고, 최근 3년간
    발견까지 3일 이상 걸린 사례가 8건이다"처럼 여러 정보를 몰아넣지 말고, 가장 핵심적인 현황
    수치 하나만 current_status에 남기고 나머지 부가 수치는 잘라낸다.
13. 사용자가 입력하지 않은 사실(수치, 기관명 등)을 임의로 지어내지 않는다. 부족한 정보는
    "(※ 구체적 수치 보완 필요)"로 표시한다. 전체 분량은 1장은 간결하게, 2장은 충분히 상세하게 작성한다.

[출력 형식]
반드시 아래 JSON 스키마 하나만 출력한다. 코드펜스(\`\`\`), 설명, 전/후 텍스트를 절대 포함하지 않는다.

{
  "title": "보고서 제목 (예: 「○○ 도입」 검토 보고 형태, 20자 내외)",
  "background": {
    "purpose": "목적 (1문장, 32~40자)",
    "necessity": "필요성/시급성 (1문장, 32~40자, 없으면 빈 문자열)",
    "current_status": "현황 = 결과·상태 (1문장, 32~40자, 핵심 수치 하나만)",
    "problem_cause": "문제점 = 원인 (1문장, 32~40자)",
    "cause_analytic": "분석적 근거 (1문장, 32~40자, 없으면 빈 문자열)",
    "cause_empathetic": "공감적 근거 (1문장, 32~40자, 없으면 빈 문자열)"
  },
  "improvement": {
    "criteria": "MECE 분류 기준 (예: 시점 기준: 사전/사중/사후)",
    "items": [
      { "title": "방안 제목", "detail": "구체적 설명 (1문장, 32~40자)", "related_cause": "관련 원인 요약 (1문장, 25자 내외, 없으면 빈 문자열)" }
    ]
  },
  "plan": [
    { "phase": "단계/시기", "action": "구체적 실행 내용 (1문장, 32~40자)", "timing": "일정 (없으면 빈 문자열)" }
  ],
  "expected_effect": [
    { "metric": "지표명", "value": "정량 수치" }
  ]
}

page_length가 "1"이면 expected_effect는 빈 배열 []로 두고, background의 필드 중 이번 보고서에 쓰지 않기로
선택한 Why(목적·필요성 또는 현황·문제점) 관련 필드는 빈 문자열로 둔다.`;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "잘못된 요청 본문입니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { goal_tobe, importance, current_problem, root_cause, page_length } = payload || {};

  if (!goal_tobe || !importance || !current_problem || !root_cause) {
    return new Response(
      JSON.stringify({ error: "goal_tobe, importance, current_problem, root_cause는 필수입니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_REPORT;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "서버에 ANTHROPIC_API_REPORT 환경변수가 설정되어 있지 않습니다. Netlify 사이트 설정 > Environment variables에서 등록해주세요.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const length = page_length === "2" ? "2" : "1";

  const userMessage = `아래는 사용자가 위저드에서 입력한 4개의 답변과 선택한 분량이다. 이를 바탕으로 위 규칙과
JSON 스키마에 맞춰 정책기획보고서를 작성하라.

- page_length: "${length}"
- Q1 (목표, To-be): ${goal_tobe}
- Q2 (중요성/필요성): ${importance}
- Q3 (현재 문제와 상태 = 현황): ${current_problem}
- Q4 (원인 = 문제점): ${root_cause}`;

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        stream: true,
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Anthropic API 요청 중 네트워크 오류가 발생했습니다.", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `Anthropic API 오류 (${upstream.status})`, detail: errText }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Anthropic의 SSE 스트림을 그대로 클라이언트로 중계한다.
  // 데이터가 끊기지 않고 계속 흘러가므로 Netlify의 Inactivity Timeout(504)을 피할 수 있다.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
};
