/**
 * 공통 유틸리티
 * - 포맷팅 헬퍼
 * - 말투 검사 패턴
 * - 입력 검증
 */

// --- 포맷팅 헬퍼 ---
function formatEntry(e) {
  return `*[${e.id}]* ${e.situation}\n> ${e.text}\n_톤: ${e.tone} | 컴포넌트: ${e.component}_`;
}

function formatEntryCompact(e) {
  return `\`${e.id}\` *${e.situation}* — ${e.text} _(${e.tone})_`;
}

// --- 말투 검사 패턴 ---
const PASSIVE_PATTERNS = [
  { from: '되었습니다', to: '됐어요' },
  { from: '하였습니다', to: '했어요' },
  { from: '됩니다', to: '돼요' },
  { from: '합니다', to: '해요' },
  { from: '십시오', to: '세요' },
  { from: '바랍니다', to: '주세요' },
  { from: '없습니다', to: '없어요' },
  { from: '있습니다', to: '있어요' },
  { from: '입니다', to: '이에요' },
];

const NEGATIVE_PATTERNS = [/할 수 없/, /불가능/, /하지 마/, /않으면/, /못합니다/, /안됩니다/, /금지/];

// --- 입력 검증 ---
const VALID_TONES = ['친근', '안내', '축하', '사과', '경고', '확인', '격려', '정보', '긴급'];
const VALID_COMPONENTS = ['토스트', '모달', '배너', '인라인', '버튼', '툴팁', '알림', '바텀시트', '스낵바', '미정'];
const VALID_FIELDS = ['text', 'tone', 'component', 'situation'];

function validateTone(tone) {
  return VALID_TONES.includes(tone);
}

function validateComponent(component) {
  return VALID_COMPONENTS.includes(component);
}

function validateField(field) {
  return VALID_FIELDS.includes(field);
}

// --- 문구 규칙 기반 검사 ---
function checkPhrase(text) {
  const issues = [];
  const suggestions = [];

  // 1. 길이 체크 (40자 이내)
  if (text.length > 40) {
    issues.push(`글자 수 ${text.length}자 (권장 40자 이내)`);
  }

  // 2. 수동태/딱딱한 말투 체크
  for (const { from, to } of PASSIVE_PATTERNS) {
    if (text.includes(from)) {
      issues.push(`"${from}" → "${to}" (해요체로 변경)`);
      suggestions.push({ from, to });
    }
  }

  // 3. 부정문 체크
  for (const p of NEGATIVE_PATTERNS) {
    if (p.test(text)) {
      issues.push(`부정 표현 "${text.match(p)[0]}" 감지 → 긍정문으로 변경 권장`);
    }
  }

  // 4. CTA 체크
  if (text.length <= 10 && !/하기$|보기$|하세요$|해주세요$/.test(text) && !/[가-힣]$/.test(text)) {
    issues.push('CTA 버튼이라면 동사로 끝나도록 권장 (예: ~하기)');
  }

  // 5. 이모지 과다 사용 체크
  const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 2) {
    issues.push(`이모지 ${emojiCount}개 감지 → 절제해서 사용 권장`);
  }

  // 자동 수정 문구 생성
  let autoFixed = text;
  for (const { from, to } of suggestions) {
    autoFixed = autoFixed.split(from).join(to);
  }

  return { issues, autoFixed, passed: issues.length === 0 };
}

module.exports = {
  formatEntry,
  formatEntryCompact,
  PASSIVE_PATTERNS,
  NEGATIVE_PATTERNS,
  VALID_TONES,
  VALID_COMPONENTS,
  VALID_FIELDS,
  validateTone,
  validateComponent,
  validateField,
  checkPhrase,
};
