# 유심사 UX 라이팅 슬랙봇

## 프로젝트 개요
- **서비스**: 유심사(USIMSA) - 글로벌 eSIM/USIM 해외 데이터 로밍 플랫폼
- **목적**: UX 문구 관리 슬랙봇 (`/uxr` 슬래시 커맨드, 22개 서브커맨드)
- **런타임**: Node.js 18+, @slack/bolt (ExpressReceiver, HTTP 모드)

## 프로젝트 구조
```
index.js                        # Slack Bolt 앱 (라우팅, 인터랙티브, cron, self-ping)
src/
  ai.js                         # AI 호출 (Groq → OpenAI → Claude 폴백 체인)
  data.js                       # JSON 데이터 로드/저장 (비동기 쓰기 큐)
  sheets.js                     # Google Sheets 연동
  glossary.js                   # 브랜드 용어집 (17개 항목)
  utils.js                      # 검사 규칙, 톤/컴포넌트 검증, 공통 유틸
  handlers/
    search.js                   # 검색, 카테고리 (페이지네이션)
    ai-features.js              # 추천/피드백/비교/번역 (처리 중 메시지 포함)
    manage.js                   # 등록/수정/삭제 (입력 검증, 시트 동기화)
    check.js                    # 검사/벌크검사/중복검사
    info.js                     # 도움말/통계/톤/원칙/용어집/히스토리/내보내기/랜덤
data/
  ux-writing-guide.json         # UX 문구 데이터 (225건, 12 카테고리)
scripts/
  sync-to-sheets.js             # Google Sheets 전체 동기화
```

## 개발 컨벤션
- 커밋 메시지: 한글, conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`)
- 코드: JavaScript (CommonJS, require)
- 환경 변수: `.env` (dotenv)
- 데이터: JSON + Google Sheets 이중 저장

## 주요 명령어
- `npm start` — 봇 실행
- `npm run dev` — 개발 모드 (--watch)
- `npm run sync-sheets` — JSON → Google Sheets 전체 동기화

## 주의사항
- `.env` 파일 절대 커밋 금지
- `data/ux-writing-guide.json` 수정 시 ID 체계(`카테고리약어-번호`) 유지
- AI 호출 전 반드시 '처리 중...' 메시지 표시 (Slack 3초 타임아웃 방지)
- 입력 검증: `VALID_TONES`, `VALID_COMPONENTS` 화이트리스트 사용
- 프롬프트 인젝션: `sanitizeInput()` → 시스템/유저 메시지 분리
