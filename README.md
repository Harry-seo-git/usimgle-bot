# 유심사 UX 라이팅 봇

유심사(Usimgle) 서비스의 UX 라이팅 가이드를 관리하고, 슬랙에서 AI 기반 문구 추천/검사/피드백을 제공하는 봇입니다.

## 주요 기능

| 명령어 | 기능 |
|--------|------|
| `/ux 검색 [키워드]` | 가이드에서 UX 문구 검색 |
| `/ux 카테고리 [이름]` | 카테고리별 문구 조회 |
| `/ux 추천 [상황]` | AI가 가이드 기반으로 문구 제안 (채택/수정 버튼 포함) |
| `/ux 피드백 [문구]` | 기존 문구의 개선점 분석 |
| `/ux 비교 [A] vs [B]` | 두 문구 비교 분석 |
| `/ux 검사 [문구]` | 가이드라인 일관성 자동 검사 |
| `/ux 벌크검사 [문구1/문구2/...]` | 여러 문구 한번에 검사 |
| `/ux 번역 [문구 또는 ID]` | 다국어 번역 (영어/일본어 등) |
| `/ux 등록 [카테고리\|문구\|톤\|컴포넌트]` | 새 문구 등록 |
| `/ux 톤 [이름]` | 톤 가이드 조회 |
| `/ux 원칙` | 라이팅 원칙 조회 |
| `/ux 통계` | 가이드 현황 대시보드 |
| `/ux 랜덤` | 오늘의 UX 라이팅 팁 |
| `@봇 멘션` / `DM` | 자연어로 자유롭게 질문 |

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

`.env.example`을 복사해서 `.env` 파일을 만들고 값을 채워주세요.

```bash
cp .env.example .env
```

```env
# Slack (필수)
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret

# AI API 키 (최소 1개 필수 - 위에서부터 순서대로 시도)
OPENAI_API_KEY=
GROQ_API_KEY=
CLAUDE_API_KEY=
GEMINI_API_KEY=

# 구글시트 연동 (선택)
GOOGLE_API_URL=

# 서버
PORT=3000
```

### 3. Slack App 설정

1. [api.slack.com/apps](https://api.slack.com/apps)에서 새 앱 생성
2. **OAuth & Permissions** > Bot Token Scopes 추가:
   - `chat:write`
   - `commands`
   - `app_mentions:read`
   - `im:history`
3. **Slash Commands** > `/ux` 명령어 등록
   - Request URL: `https://your-domain.com/slack/events`
4. **Interactivity & Shortcuts** 활성화
   - Request URL: `https://your-domain.com/slack/events`
5. **Event Subscriptions** 활성화
   - Request URL: `https://your-domain.com/slack/events`
   - Subscribe to: `app_mention`, `message.im`
6. 워크스페이스에 앱 설치 후 Bot Token과 Signing Secret을 `.env`에 입력

### 4. 실행

```bash
npm start
```

## 프로젝트 구조

```
usimgle-bot/
├── index.js                      # 슬랙 봇 메인 코드
├── package.json
├── .env.example                  # 환경변수 템플릿
├── UX_WRITING_GUIDE.md           # UX 라이팅 가이드 문서 (사람용)
├── README.md                     # 이 파일
└── data/
    └── ux-writing-guide.json     # UX 라이팅 데이터 (봇용)
```

## 배포

Render, Railway, Vercel 등에 배포할 수 있습니다.

```bash
# Render 예시 - Start Command
node index.js
```

## AI 폴백 체인

AI API는 위에서부터 순서대로 시도하며, 실패 시 다음 API로 넘어갑니다:

1. OpenAI (GPT-4o)
2. Groq (Llama 3 70B)
3. Anthropic (Claude Sonnet)
4. Google (Gemini Pro)
