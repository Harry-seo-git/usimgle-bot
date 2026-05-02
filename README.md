# 유심사 UX 라이팅 봇

유심사(USIMSA) 서비스의 UX 문구를 슬랙에서 관리하는 봇입니다.
문구 검색·등록·수정·삭제, AI 기반 추천·검사·피드백, 주간 리포트까지 `/uxr` 하나로 처리합니다.

## 주요 기능

### 검색 & 조회
| 명령어 | 설명 |
|--------|------|
| `/uxr 검색 [키워드]` | UX 문구 검색 |
| `/uxr 카테고리 [이름]` | 카테고리별 문구 조회 |
| `/uxr 톤 [이름]` | 톤 가이드 조회 |
| `/uxr 용어 [단어]` | 브랜드 용어집 |
| `/uxr 통계` | 현황 대시보드 |
| `/uxr 랜덤` | 오늘의 UX 라이팅 팁 |

### AI 기능
| 명령어 | 설명 |
|--------|------|
| `/uxr 추천 [상황]` | AI 문구 추천 (채택/수정 버튼) |
| `/uxr 피드백 [문구]` | 문구 개선점 분석 |
| `/uxr 비교 [A] vs [B]` | 두 문구 비교 |
| `/uxr 검사 [문구]` | 가이드라인 일관성 검사 |
| `/uxr 벌크검사 [문구1/문구2/...]` | 여러 문구 한번에 검사 |
| `/uxr 번역 [문구 또는 ID]` | 다국어 번역 |

### 문구 관리
| 명령어 | 설명 |
|--------|------|
| `/uxr 등록 [카테고리\|상황\|문구\|톤\|컴포넌트]` | 새 문구 등록 |
| `/uxr 수정 [ID\|필드\|값]` | 문구 수정 |
| `/uxr 삭제 [ID]` | 문구 삭제 (확인 절차) |
| `/uxr 중복검사 [문구]` | 유사 문구 탐지 |
| `/uxr 내보내기` | CSV/JSON 내보내기 |

### 기타
- `@봇 멘션` / `DM` — 자연어 질문
- 주간 UX Writing 리포트 자동 발송 (매주 월요일 09:00 KST)
- 문구 변경 시 지정 채널에 실시간 알림

## 설치

```bash
npm install
cp .env.example .env  # 환경변수 설정
```

## 환경변수

`.env.example` 참고. 필수/선택 항목:

| 변수 | 필수 | 설명 |
|------|------|------|
| `SLACK_BOT_TOKEN` | O | Slack Bot Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | O | Slack Signing Secret |
| `GROQ_API_KEY` | △ | Groq API 키 (AI 1순위) |
| `OPENAI_API_KEY` | △ | OpenAI API 키 (AI 2순위) |
| `CLAUDE_API_KEY` | △ | Anthropic API 키 (AI 3순위) |
| `GOOGLE_API_URL` | - | Google Sheets 연동 URL |
| `NOTIFICATION_CHANNEL_ID` | - | 알림 채널 ID |
| `RENDER_EXTERNAL_URL` | - | Render 배포 시 self-ping용 URL |
| `PORT` | - | 서버 포트 (기본 3000) |

> AI API 키는 최소 1개 필요합니다. 위에서부터 순서대로 시도하며, 실패 시 다음으로 폴백합니다.

## Slack App 설정

1. [api.slack.com/apps](https://api.slack.com/apps)에서 앱 생성
2. **Bot Token Scopes**: `chat:write`, `commands`, `app_mentions:read`, `im:history`
3. **Slash Commands**: `/uxr` → `https://your-domain.com/slack/events`
4. **Interactivity**: `https://your-domain.com/slack/events`
5. **Event Subscriptions**: `app_mention`, `message.im` → `https://your-domain.com/slack/events`
6. 워크스페이스에 설치 후 토큰을 `.env`에 입력

## 실행

```bash
npm start        # 프로덕션
npm run dev      # 개발 모드 (--watch)
```

## 프로젝트 구조

```
├── index.js                    # Slack Bolt 앱 (라우팅, 인터랙티브, cron)
├── src/
│   ├── ai.js                   # AI 호출 (Groq → OpenAI → Claude 폴백)
│   ├── data.js                 # JSON 데이터 로드/저장 (비동기 쓰기 큐)
│   ├── sheets.js               # Google Sheets 연동
│   ├── glossary.js             # 브랜드 용어집 (17개 항목)
│   ├── utils.js                # 검사 규칙, 톤/컴포넌트 유효성 검증
│   └── handlers/
│       ├── search.js           # 검색, 카테고리
│       ├── ai-features.js      # 추천, 피드백, 비교, 번역
│       ├── manage.js           # 등록, 수정, 삭제
│       ├── check.js            # 검사, 벌크검사, 중복검사
│       └── info.js             # 도움말, 통계, 톤, 원칙, 용어집 등
├── data/
│   └── ux-writing-guide.json   # UX 문구 데이터 (225건, 12 카테고리)
├── scripts/
│   └── sync-to-sheets.js       # Google Sheets 전체 동기화
└── UX_WRITING_GUIDE.md         # UX 라이팅 가이드 문서
```

## 배포

Render Free 티어 기준:

- **Build Command**: `npm install`
- **Start Command**: `node index.js`
- **Environment**: Node 18+
- `RENDER_EXTERNAL_URL` 설정 시 14분 간격 self-ping으로 슬립 방지

## 데이터 저장

- **1차**: `data/ux-writing-guide.json` (로컬 JSON)
- **2차**: Google Sheets (Apps Script 웹앱 경유, 선택)

`npm run sync-sheets`로 JSON → Sheets 전체 동기화 가능

## 기술 스택

- **런타임**: Node.js 18+
- **Slack**: @slack/bolt (ExpressReceiver, HTTP 모드)
- **AI**: Groq (Llama 3.3 70B) → OpenAI (GPT-4o) → Claude (Sonnet) 폴백 체인
- **스케줄링**: node-cron
- **데이터**: JSON + Google Sheets 이중 저장

## 라이선스

[MIT License](LICENSE) © 2025 Harry
