/**
 * 핸들러: AI 추천, 피드백, 비교, 번역
 */

const { askAI, buildSystemPrompt, sanitizeInput } = require('../ai');
const { searchGuide, findEntryById, guide } = require('../data');

async function handleSuggest(situation, respond) {
  if (!situation) {
    return respond({ response_type: 'ephemeral', text: '상황을 설명해 주세요.\n예: `/uxr 추천 사용자가 잘못된 이메일을 입력했을 때`' });
  }

  const similar = searchGuide(situation).slice(0, 3);
  const context = similar.length
    ? `\n\n[참고할 기존 문구]\n${similar.map((e) => `- ${e.situation}: "${e.text}" (톤: ${e.tone})`).join('\n')}`
    : '';

  const systemPrompt = buildSystemPrompt() + context;
  const userMessage = `아래 상황에 맞는 UX 문구를 3개 제안해줘.
각 문구마다 톤, 사용 컴포넌트, 추천 이유를 함께 알려줘.
답변은 한국어로, 아래 형식으로 작성해:

1. 문구: "..."
   톤: ... | 컴포넌트: ...
   이유: ...

상황: "${sanitizeInput(situation)}"`;

  const aiResponse = await askAI(systemPrompt, userMessage);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요. API 키 설정을 확인해 주세요.' });
  }

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'UX 문구 추천' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*상황:* ${situation}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: aiResponse } },
  ];

  if (similar.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `참고한 기존 문구: ${similar.map((e) => `\`${e.id}\``).join(', ')}` }],
    });
  }

  const truncatedResponse = aiResponse.substring(0, 1500);
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '채택하기' },
        style: 'primary',
        action_id: 'adopt_suggest',
        value: JSON.stringify({ situation: situation.substring(0, 200), response: truncatedResponse }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '수정 요청' },
        action_id: 'revise_suggest',
        value: JSON.stringify({ situation: situation.substring(0, 500) }),
      },
    ],
  });

  return respond({ response_type: 'in_channel', blocks });
}

async function handleFeedback(text, respond) {
  if (!text) {
    return respond({ response_type: 'ephemeral', text: '피드백받을 문구를 입력해 주세요.\n예: `/uxr 피드백 오류가 발생했습니다`' });
  }

  const userMessage = `아래 UX 문구를 유심사 라이팅 가이드 기준으로 분석해줘.
분석 항목: 톤 적절성, 명확성, 길이, 긍정/부정문, 능동/수동태, 개선 포인트
마지막에 개선된 문구 2개를 제안해줘.
답변은 한국어로 작성해.

분석할 문구: "${sanitizeInput(text)}"`;

  const aiResponse = await askAI(buildSystemPrompt(), userMessage);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요. API 키 설정을 확인해 주세요.' });
  }

  return respond({
    response_type: 'in_channel',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'UX 문구 피드백' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*원본:* "${text}"` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: aiResponse } },
    ],
  });
}

async function handleCompare(text, respond) {
  if (!text || !text.includes('vs')) {
    return respond({
      response_type: 'ephemeral',
      text: '비교할 두 문구를 `vs`로 구분해 주세요.\n예: `/uxr 비교 결제가 처리되었습니다 vs 결제를 완료했어요`',
    });
  }

  const [textA, textB] = text.split('vs').map((t) => t.trim());
  if (!textA || !textB) {
    return respond({ response_type: 'ephemeral', text: '`vs` 양쪽에 문구를 입력해 주세요.' });
  }

  const userMessage = `아래 두 UX 문구를 유심사 가이드라인 기준으로 비교 분석해줘.

문구 A: "${sanitizeInput(textA)}"
문구 B: "${sanitizeInput(textB)}"

각 문구에 대해:
1. 점수 (100점 만점)
2. 장점
3. 개선점

마지막에 어떤 문구가 더 적합한지 결론을 내려줘.
답변은 한국어로 작성해.`;

  const aiResponse = await askAI(buildSystemPrompt(), userMessage);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요.' });
  }

  return respond({
    response_type: 'in_channel',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'UX 문구 비교 분석' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*문구 A:*\n"${textA}"` },
          { type: 'mrkdwn', text: `*문구 B:*\n"${textB}"` },
        ],
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: aiResponse } },
    ],
  });
}

async function handleTranslate(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '번역할 문구 또는 ID를 입력해 주세요.\n예: `/uxr 번역 ord-004` 또는 `/uxr 번역 en 결제가 완료됐어요`',
    });
  }

  const idMatch = text.match(/^([a-z]{3}-\d{3})$/i);
  let sourceText = text;
  let targetLangs = ['en', 'ja'];

  if (idMatch) {
    const id = idMatch[1].toLowerCase();
    const result = findEntryById(id);
    if (!result) {
      return respond({ response_type: 'ephemeral', text: `"${id}" ID의 문구를 찾을 수 없어요.` });
    }
    sourceText = result.entry.text;
  }

  const langMatch = text.match(/^(en|ja|zh|es|fr)\s+(.+)$/i);
  if (langMatch) {
    targetLangs = [langMatch[1].toLowerCase()];
    sourceText = langMatch[2];
  }

  const langNames = { en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어' };
  const targetLangStr = targetLangs.map((l) => langNames[l] || l).join(', ');

  const userMessage = `아래 한국어 UX 문구를 ${targetLangStr}로 번역해줘.
번역 시 유심사 브랜드 톤(친근, 명확, 간결)을 유지하고, 각 언어의 자연스러운 UX 문구 관습을 따라줘.
형식:

${targetLangs.map((l) => `[${langNames[l] || l}] ...`).join('\n')}

원문: "${sanitizeInput(sourceText)}"`;

  const aiResponse = await askAI(buildSystemPrompt(), userMessage);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요. API 키 설정을 확인해 주세요.' });
  }

  return respond({
    response_type: 'in_channel',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'UX 문구 다국어 번역' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*원문 (한국어):* "${sourceText}"` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: aiResponse } },
    ],
  });
}

module.exports = { handleSuggest, handleFeedback, handleCompare, handleTranslate };
