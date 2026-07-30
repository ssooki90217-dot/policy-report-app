# 정책기획보고서 자동 작성 웹서비스

Q1~Q4(목표·중요성·현황·원인)와 Q5(분량 1장/2장)를 입력받아, 추진배경–개선방안–추진계획(–기대효과)
구조의 정책기획보고서를 자동 생성하는 웹앱입니다. `requirements.md`(별도 전달) 기준으로 제작되었습니다.

```
public/                 → 정적 프론트엔드 (Netlify가 그대로 서빙)
  index.html
  css/style.css
  js/app.js
netlify/functions/
  generate-report.js    → Anthropic API를 호출하는 서버리스 함수
netlify.toml            → Netlify 빌드/함수 설정
package.json
```

## 1. 배포 방법 (택 1)

### 방법 A — Git 연동 배포 (추천, 함수까지 정상 동작)
1. 이 폴더를 GitHub/GitLab 저장소로 올립니다.
2. Netlify → **Add new site → Import an existing project**로 저장소를 연결합니다.
3. Build settings는 `netlify.toml`을 그대로 인식합니다 (Publish directory: `public`,
   Functions directory: `netlify/functions`).
4. **Site configuration → Environment variables**에서 `ANTHROPIC_API_KEY`를 등록합니다.
5. Deploy. `https://your-site.netlify.app` 에서 바로 사용 가능합니다.

### 방법 B — Netlify CLI로 수동 배포 (Git 없이도 함수 포함 배포 가능)
```bash
npm install -g netlify-cli
cd report-app
netlify login
netlify deploy --prod
```
`netlify deploy`는 `netlify/functions`까지 함께 패키징해서 올려주므로, 이 폴더를 그대로
zip으로 보관해뒀다가 CLI가 설치된 PC에서 압축을 풀고 위 명령만 실행하면 됩니다.

### 방법 C — Netlify 대시보드에 폴더/zip 드래그 앤 드롭 (가장 간단, 단 함수 미지원)
Netlify 사이트의 "Deploys" 탭에 이 폴더(또는 zip)를 그대로 끌어다 놓으면 배포는 되지만,
**서버리스 함수(`netlify/functions`)는 드래그 앤 드롭 배포에서 자동으로 처리되지 않을 수 있습니다.**
빠르게 프론트엔드 화면(UI)만 미리 보고 싶을 때 사용하고, 실제 "보고서 생성" 기능까지
쓰려면 방법 A 또는 B를 사용해주세요.

## 2. 환경변수
| 이름 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 키. **절대 프론트엔드 코드에 넣지 말고**, Netlify 환경변수로만 등록하세요. |

## 3. 로컬에서 테스트하기
```bash
npm install -g netlify-cli
cd report-app
export ANTHROPIC_API_KEY=sk-ant-...   # 로컬 환경변수로 임시 설정
netlify dev
```
`netlify dev`는 정적 파일과 `netlify/functions`를 함께 로컬 서버(기본 http://localhost:8888)로
띄워주므로, 실제 배포와 동일하게 "보고서 생성" 버튼까지 테스트할 수 있습니다.

## 4. 참고
- 사용자 입력·생성 결과는 서버에 저장하지 않습니다(브라우저 `localStorage`에 임시 초안만 저장).
- 결과 화면의 "서식 포함 복사하기" 버튼은 글꼴·크기·줄간격을 인라인 스타일로 포함한 HTML을
  클립보드에 담아, 한글(HWP)이나 MS Word에 붙여넣어도 서식이 최대한 유지되도록 만들었습니다
  (HY헤드라인M·휴먼명조 등 폰트가 설치된 환경이라면 그대로 적용됩니다).
