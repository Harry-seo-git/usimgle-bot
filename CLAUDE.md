# 유심사 UX 라이팅 슬랙봇

## 프로젝트 개요
- **서비스**: 유심사(USIMSA) - 글로벌 eSIM/USIM 해외 데이터 로밍 플랫폼
- **목적**: UX 문구 관리 슬랙봇 (`/uxr` 슬래시 커맨드)
- **런타임**: Node.js 18+, @slack/bolt 기반

## 프로젝트 구조
```
index.js              # 앱 진입점 (Slack Bolt 앱 설정 + 라우팅)
src/
  handlers/
    search.js         # 검색 관련 핸들러
    ai-features.js    # AI 추천/피드백/비교/번역/검사
    manage.js         # 등록/수정/삭제
    check.js          # 중복검사/내보내기
    info.js           # 도움말/용어집/리포트/카테고리
  ai.js               # AI API 호출 (OpenAI, Groq 등 멀티 프로바이더)
  data.js             # 데이터 로드/저장 (JSON 파일)
  sheets.js           # Google Sheets 연동
  glossary.js         # 브랜드 용어집 데이터
  utils.js            # 공통 유틸 함수
data/
  ux-writing-guide.json  # UX 문구 데이터 (193건)
```

## 개발 컨벤션
- 커밋 메시지: 한글 사용, conventional commits 스타일 (`feat:`, `fix:`, `refactor:` 등)
- 코드 언어: JavaScript (CommonJS, require 사용)
- 환경 변수: `.env` 파일 사용 (dotenv)
- 데이터 저장: JSON 파일 + Google Sheets 이중 저장

## 주요 명령어
- `npm start` - 봇 실행
- `npm run dev` - 개발 모드 (--watch)

## 주의사항
- `.env` 파일에 슬랙 토큰, AI API 키 등 민감 정보 포함 — 절대 커밋 금지
- `data/ux-writing-guide.json` 수정 시 기존 ID 체계(`카테고리약어-번호`) 유지
- AI 호출 시 반드시 '처리 중...' 메시지를 먼저 표시 (Slack 3초 타임아웃 방지)
