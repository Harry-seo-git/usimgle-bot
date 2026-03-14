/**
 * 핸들러: 검사, 벌크검사, 중복검사
 */

const { askAI, buildSystemPrompt, sanitizeInput } = require('../ai');
const { getAllEntries } = require('../data');
const { checkPhrase, PASSIVE_PATTERNS, NEGATIVE_PATTERNS } = require('../utils');

async function handleCheck(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '검사할 문구를 입력해 주세요.\n예: `/uxr 검사 결제 오류가 발생하였습니다. 다시 시도하십시오.`',
    });
  }

  const { issues, autoFixed, passed } = checkPhrase(text);
  const statusIcon = passed ? 'PASS' : 'FAIL';
  const statusText = passed
    ? '가이드라인을 잘 지키고 있어요!'
    : `${issues.length}개 개선 포인트가 있어요.`;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `UX 문구 검사 [${statusIcon}]` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*원본:* "${text}"\n*글자 수:* ${text.length}자` } },
    { type: 'divider' },
  ];

  if (!passed) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*개선 포인트*\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`,
      },
    });

    if (autoFixed !== text) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*자동 수정 제안:*\n> ${autoFixed}` },
      });
    }
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: statusText },
    });
  }

  // AI 기반 심층 분석
  const userMessage = `아래 UX 문구를 유심사 가이드라인 기준으로 간단히 점수(100점 만점)와 한줄 코멘트를 달아줘.
평가 기준: 해요체 사용, 40자 이내, 능동태, 긍정문, 명확성
답변 형식: "점수: XX/100 | 코멘트: ..."

문구: "${sanitizeInput(text)}"`;

  const aiComment = await askAI(buildSystemPrompt(), userMessage);
  if (aiComment) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `AI 평가: ${aiComment}` }],
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

async function handleBulkCheck(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '여러 문구를 `/`로 구분해서 입력해 주세요.\n예: `/uxr 벌크검사 결제 실패입니다/로그인 해주십시오/배송이 완료됐어요`',
    });
  }

  const phrases = text.split('/').map((t) => t.trim()).filter(Boolean);
  if (phrases.length < 2) {
    return respond({ response_type: 'ephemeral', text: '최소 2개 이상의 문구를 `/`로 구분해 주세요.' });
  }

  const results = phrases.map((phrase) => {
    const issues = [];
    if (phrase.length > 40) issues.push('40자 초과');
    for (const { from } of PASSIVE_PATTERNS) {
      if (phrase.includes(from)) { issues.push('해요체 필요'); break; }
    }
    for (const p of NEGATIVE_PATTERNS) {
      if (p.test(phrase)) { issues.push('부정문'); break; }
    }
    return { phrase, passed: issues.length === 0, issues };
  });

  const passCount = results.filter((r) => r.passed).length;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `벌크 검사 결과 (${passCount}/${results.length} 통과)` } },
  ];

  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    const issueStr = r.issues.length ? ` — ${r.issues.join(', ')}` : '';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `\`${icon}\` "${r.phrase}"${issueStr}` },
    });
  }

  if (passCount < results.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '개별 상세 검사: `/uxr 검사 [문구]`' }],
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

async function handleDuplicate(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '중복 여부를 확인할 문구를 입력해 주세요.\n예: `/uxr 중복검사 결제가 완료됐어요`',
    });
  }

  const inputText = text.trim().toLowerCase();
  const allEntries = getAllEntries();

  // 1. 정확히 동일한 문구
  const exact = allEntries.filter((e) => e.text.toLowerCase() === inputText);

  // 2. 유사도 기반 매칭 (단어 겹침 + 부분 문자열)
  const inputWords = new Set(inputText.split(/\s+/).filter((w) => w.length > 1));
  const similar = [];
  for (const entry of allEntries) {
    if (exact.find((e) => e.id === entry.id)) continue;
    const entryLower = entry.text.toLowerCase();
    const entryWords = new Set(entryLower.split(/\s+/).filter((w) => w.length > 1));
    const overlap = [...inputWords].filter((w) => entryWords.has(w));

    // 단어 겹침 유사도
    let similarity = inputWords.size > 0 ? overlap.length / Math.max(inputWords.size, entryWords.size) : 0;

    // 부분 문자열 보정 (한국어 조사 대응)
    const inputChars = inputText.replace(/\s/g, '');
    const entryChars = entryLower.replace(/\s/g, '');
    if (inputChars.length >= 4 && entryChars.length >= 4) {
      // 공통 문자 비율로 보정
      const commonChars = [...inputChars].filter((c) => entryChars.includes(c));
      const charSimilarity = commonChars.length / Math.max(inputChars.length, entryChars.length);
      similarity = Math.max(similarity, charSimilarity);
    }

    if (similarity >= 0.4) {
      similar.push({ ...entry, similarity: Math.round(similarity * 100) });
    }
  }
  similar.sort((a, b) => b.similarity - a.similarity);

  // 3. 포함 관계
  const contained = allEntries.filter((e) => {
    if (exact.find((x) => x.id === e.id)) return false;
    if (similar.find((x) => x.id === e.id)) return false;
    const eLower = e.text.toLowerCase();
    return eLower.includes(inputText) || inputText.includes(eLower);
  });

  const totalFound = exact.length + similar.length + contained.length;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `중복 검사 결과 (${totalFound}건 발견)` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*검사 문구:* "${text}"` } },
  ];

  if (exact.length > 0) {
    blocks.push({ type: 'divider' });
    const list = exact.map((e) => `\`${e.id}\` [${e.category}] "${e.text}" _(${e.tone})_`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*동일한 문구 (${exact.length}건)*\n${list}` } });
  }

  if (similar.length > 0) {
    blocks.push({ type: 'divider' });
    const list = similar.slice(0, 5).map((e) => `\`${e.id}\` [${e.category}] "${e.text}" _(유사도 ${e.similarity}%)_`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*유사한 문구 (${similar.length}건)*\n${list}` } });
  }

  if (contained.length > 0) {
    blocks.push({ type: 'divider' });
    const list = contained.slice(0, 5).map((e) => `\`${e.id}\` [${e.category}] "${e.text}" _(${e.tone})_`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*포함 관계 (${contained.length}건)*\n${list}` } });
  }

  if (totalFound === 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '중복되는 문구가 없어요! `/uxr 등록`으로 새 문구를 추가할 수 있어요.' },
    });
  }

  return respond({ response_type: 'ephemeral', blocks });
}

module.exports = { handleCheck, handleBulkCheck, handleDuplicate };
