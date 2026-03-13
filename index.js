const { App, ExpressReceiver } = require('@slack/bolt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- UX 라이팅 가이드 데이터 로드 ---
const guidePath = path.join(__dirname, 'data', 'ux-writing-guide.json');
const guide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));

// --- Slack 앱 초기화 ---
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// --- 구글시트 연동 (선택) ---
const sheetEnabled = !!process.env.GOOGLE_API_URL;
const getRows = (q) =>
  sheetEnabled
    ? axios.get(`${process.env.GOOGLE_API_URL}?q=${encodeURIComponent(q)}`).then((r) => r.data)
    : Promise.resolve([]);
const addRow = (d) =>
  sheetEnabled
    ? axios.post(process.env.GOOGLE_API_URL, d)
    : Promise.resolve();

// --- AI 호출 (폴백 체인) ---
async function askAI(prompt) {
  const post = (url, body, headers = {}) =>
    axios.post(url, body, { headers, timeout: 15000 }).then((r) => r.data).catch(() => null);

  if (process.env.OPENAI_API_KEY) {
    const r = await post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], max_tokens: 800 },
      { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    );
    if (r) return r.choices[0].message.content.trim();
  }
  if (process.env.GROQ_API_KEY) {
    const r = await post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama3-70b-8192', messages: [{ role: 'user', content: prompt }], max_tokens: 800 },
      { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    );
    if (r) return r.choices[0].message.content.trim();
  }
  if (process.env.CLAUDE_API_KEY) {
    const r = await post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: prompt }] },
      { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
    );
    if (r) return r.content[0].text.trim();
  }
  if (process.env.GEMINI_API_KEY) {
    const r = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
    );
    if (r) return r.candidates[0].content.parts[0].text.trim();
  }
  return null;
}

// --- 유틸: 가이드에서 문구 검색 ---
function searchGuide(keyword) {
  const results = [];
  const kw = keyword.toLowerCase();
  for (const [catKey, cat] of Object.entries(guide.categories)) {
    for (const entry of cat.entries) {
      if (
        entry.situation.toLowerCase().includes(kw) ||
        entry.text.toLowerCase().includes(kw) ||
        entry.tone.toLowerCase().includes(kw) ||
        cat.label.toLowerCase().includes(kw) ||
        entry.component.toLowerCase().includes(kw)
      ) {
        results.push({ ...entry, category: cat.label, categoryKey: catKey });
      }
    }
  }
  return results;
}

// --- 유틸: 카테고리 조회 ---
function getCategory(name) {
  const n = name.toLowerCase();
  for (const [key, cat] of Object.entries(guide.categories)) {
    if (key.includes(n) || cat.label.includes(name)) {
      return { key, ...cat };
    }
  }
  return null;
}

// --- 유틸: 시스템 프롬프트 구성 ---
function buildSystemPrompt() {
  const principles = guide.principles.writingRules.map((r) => `- ${r.rule}`).join('\n');
  const tones = Object.entries(guide.toneGuide)
    .map(([name, t]) => `- ${name}: ${t.description} (${t.suffix})`)
    .join('\n');

  return `너는 유심사(Usimgle/USIMSA)의 UX 라이팅 전문가 봇이야.
유심사는 148개국 이상을 지원하는 글로벌 eSIM/USIM 해외 데이터 로밍 플랫폼이야.
주요 상품: eSIM(QR 설치), 실물유심(배송), 로컬망/로밍망 요금제
주요 플로우: 여행지 선택 → 요금제 비교 → 구매 → eSIM 설치/유심 배송 → 현지 활성화 → 데이터 사용 → 충전/종료

[브랜드 보이스]
${guide.principles.voiceTone.brand}
핵심 키워드: ${guide.principles.voiceTone.keywords.join(', ')}

[라이팅 원칙]
${principles}

[톤 가이드]
${tones}

[규칙]
- 유심사 브랜드 톤에 맞게 해요체로 답변해
- 문구 제안 시 반드시 톤, 사용 컴포넌트, 이유를 함께 설명해
- 한 문장은 40자 이내로, 능동태/긍정문 사용
- 에러 메시지는 원인 + 해결방법 구조로
- 이모지는 절제해서 사용`;
}

// --- 포맷팅 헬퍼 ---
function formatEntry(e) {
  return `*[${e.id}]* ${e.situation}\n> ${e.text}\n_톤: ${e.tone} | 컴포넌트: ${e.component}_`;
}

function formatEntryCompact(e) {
  return `\`${e.id}\` *${e.situation}* — ${e.text} _(${e.tone})_`;
}

// --- 슬래시 커맨드 핸들러 ---
app.command('/uxr', async ({ command, ack, respond }) => {
  await ack();

  const rawText = (command.text || '').trim();
  const spaceIdx = rawText.indexOf(' ');
  const subcommand = spaceIdx === -1 ? rawText : rawText.substring(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : rawText.substring(spaceIdx + 1).trim();

  try {
    switch (subcommand) {
      case '검색':
      case 'search':
        await handleSearch(args, respond);
        break;
      case '카테고리':
      case 'category':
        await handleCategory(args, respond);
        break;
      case '추천':
      case 'suggest':
        await handleSuggest(args, respond);
        break;
      case '피드백':
      case 'feedback':
        await handleFeedback(args, respond);
        break;
      case '등록':
      case 'add':
        await handleAdd(args, respond);
        break;
      case '톤':
      case 'tone':
        await handleTone(args, respond);
        break;
      case '원칙':
      case 'principles':
        await handlePrinciples(respond);
        break;
      case '검사':
      case 'check':
        await handleCheck(args, respond);
        break;
      case '번역':
      case 'translate':
        await handleTranslate(args, respond);
        break;
      case '비교':
      case 'compare':
        await handleCompare(args, respond);
        break;
      case '벌크검사':
      case 'bulkcheck':
        await handleBulkCheck(args, respond);
        break;
      case '랜덤':
      case 'random':
        await handleRandom(respond);
        break;
      case '통계':
      case 'stats':
        await handleStats(respond);
        break;
      case '도움말':
      case 'help':
      case '':
        await handleHelp(respond);
        break;
      default:
        // 서브커맨드 없이 바로 검색어를 입력한 경우 → 검색 실행
        await handleSearch(rawText, respond);
        break;
    }
  } catch (err) {
    console.error('Command error:', err);
    await respond({
      response_type: 'ephemeral',
      text: `오류가 발생했어요: ${err.message}`,
    });
  }
});

// --- 핸들러: 검색 ---
async function handleSearch(keyword, respond) {
  if (!keyword) {
    return respond({ response_type: 'ephemeral', text: '검색할 키워드를 입력해 주세요.\n예: `/uxr 검색 결제`' });
  }

  const results = searchGuide(keyword);

  // 구글시트에서도 검색
  let sheetResults = [];
  if (sheetEnabled) {
    try {
      sheetResults = await getRows(keyword);
    } catch (_) { /* ignore */ }
  }

  if (!results.length && !sheetResults.length) {
    return respond({ response_type: 'ephemeral', text: `"${keyword}"에 대한 UX 문구가 없어요. \`/uxr 추천 ${keyword}\`로 AI 추천을 받아보세요.` });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `"${keyword}" 검색 결과 (${results.length}건)` },
    },
  ];

  for (const entry of results.slice(0, 10)) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*[${entry.id}]* \`${entry.category}\` — ${entry.situation}\n> ${entry.text}\n_톤: ${entry.tone} | 컴포넌트: ${entry.component}_`,
      },
    });
  }

  if (results.length > 10) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `외 ${results.length - 10}건이 더 있어요.` }],
    });
  }

  if (sheetResults.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `구글시트에서 ${sheetResults.length}건 추가 발견` }],
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

// --- 핸들러: 카테고리 조회 ---
async function handleCategory(name, respond) {
  if (!name) {
    const cats = Object.entries(guide.categories)
      .map(([key, cat]) => `\`${key}\` ${cat.label} (${cat.entries.length}건)`)
      .join('\n');
    return respond({
      response_type: 'ephemeral',
      text: `*카테고리 목록*\n${cats}\n\n예: \`/uxr 카테고리 주문\``,
    });
  }

  const cat = getCategory(name);
  if (!cat) {
    return respond({ response_type: 'ephemeral', text: `"${name}" 카테고리를 찾을 수 없어요.` });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${cat.label} (${cat.entries.length}건)` },
    },
  ];

  for (const entry of cat.entries) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: formatEntry(entry),
      },
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

// --- 핸들러: AI 추천 ---
async function handleSuggest(situation, respond) {
  if (!situation) {
    return respond({ response_type: 'ephemeral', text: '상황을 설명해 주세요.\n예: `/uxr 추천 사용자가 잘못된 이메일을 입력했을 때`' });
  }

  // 먼저 가이드에서 유사한 문구를 찾아 컨텍스트로 제공
  const similar = searchGuide(situation).slice(0, 3);
  const context = similar.length
    ? `\n\n[참고할 기존 문구]\n${similar.map((e) => `- ${e.situation}: "${e.text}" (톤: ${e.tone})`).join('\n')}`
    : '';

  const prompt = `${buildSystemPrompt()}
${context}

[요청]
아래 상황에 맞는 UX 문구를 3개 제안해줘.
각 문구마다 톤, 사용 컴포넌트, 추천 이유를 함께 알려줘.
답변은 한국어로, 아래 형식으로 작성해:

1. 문구: "..."
   톤: ... | 컴포넌트: ...
   이유: ...

상황: "${situation}"`;

  const aiResponse = await askAI(prompt);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요. API 키 설정을 확인해 주세요.' });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'UX 문구 추천' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*상황:* ${situation}` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: aiResponse },
    },
  ];

  if (similar.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `참고한 기존 문구: ${similar.map((e) => `\`${e.id}\``).join(', ')}` }],
    });
  }

  // 인터랙티브 버튼 추가: 채택 / 수정요청
  // Slack action value는 2000자 제한이므로 응답은 잘라서 저장
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

// --- 인터랙티브 버튼 핸들러: 채택 ---
app.action('adopt_suggest', async ({ action, ack, respond, body }) => {
  await ack();
  const { situation, response } = JSON.parse(action.value);
  const user = body.user.name || body.user.id;

  // 구글시트에 저장
  if (sheetEnabled) {
    try {
      await addRow({ category: '추천채택', text: response.substring(0, 200), tone: '추천', notes: `${user}: ${situation}` });
    } catch (_) { /* ignore */ }
  }

  await respond({
    response_type: 'in_channel',
    replace_original: false,
    text: `*${user}* 님이 위 추천 문구를 채택했어요! ${sheetEnabled ? '구글시트에 저장됐어요.' : ''}`,
  });
});

// --- 인터랙티브 버튼 핸들러: 수정요청 ---
app.action('revise_suggest', async ({ action, ack, respond }) => {
  await ack();
  const { situation } = JSON.parse(action.value);

  const prompt = `${buildSystemPrompt()}

[요청]
아래 상황에 대해 이전과 다른 방향으로 UX 문구 3개를 새롭게 제안해줘.
더 간결하거나, 다른 톤으로, 또는 다른 관점에서 접근해봐.
각 문구마다 톤, 컴포넌트, 이유를 알려줘.
상황: "${situation}"`;

  const aiResponse = await askAI(prompt);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요.' });
  }

  const truncatedResponse = aiResponse.substring(0, 1500);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '수정된 UX 문구 추천' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*상황:* ${situation}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: aiResponse } },
    { type: 'divider' },
    {
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
          text: { type: 'plain_text', text: '다시 수정 요청' },
          action_id: 'revise_suggest',
          value: JSON.stringify({ situation: situation.substring(0, 500) }),
        },
      ],
    },
  ];

  await respond({ response_type: 'in_channel', replace_original: false, blocks });
});

// --- 핸들러: 피드백 ---
async function handleFeedback(text, respond) {
  if (!text) {
    return respond({ response_type: 'ephemeral', text: '피드백받을 문구를 입력해 주세요.\n예: `/uxr 피드백 오류가 발생했습니다`' });
  }

  const prompt = `${buildSystemPrompt()}

[요청]
아래 UX 문구를 유심사 라이팅 가이드 기준으로 분석해줘.
분석 항목: 톤 적절성, 명확성, 길이, 긍정/부정문, 능동/수동태, 개선 포인트
마지막에 개선된 문구 2개를 제안해줘.
답변은 한국어로 작성해.

분석할 문구: "${text}"`;

  const aiResponse = await askAI(prompt);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요. API 키 설정을 확인해 주세요.' });
  }

  return respond({
    response_type: 'in_channel',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'UX 문구 피드백' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*원본:* "${text}"` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: aiResponse },
      },
    ],
  });
}

// --- 핸들러: 등록 ---
async function handleAdd(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '등록 형식: `/uxr 등록 카테고리|문구|톤|컴포넌트`\n예: `/uxr 등록 주문|주문이 완료됐어요!|축하|토스트`',
    });
  }

  const parts = text.split('|').map((t) => t.trim());
  if (parts.length < 2) {
    return respond({
      response_type: 'ephemeral',
      text: '최소 카테고리와 문구를 `|`로 구분해서 입력해 주세요.\n예: `/uxr 등록 주문|주문이 완료됐어요!|축하|토스트`',
    });
  }

  const [category, uxText, tone = '안내', component = '미정'] = parts;

  // 구글시트에 저장
  if (sheetEnabled) {
    try {
      await addRow({ category, text: uxText, tone, notes: component });
    } catch (err) {
      return respond({ response_type: 'ephemeral', text: `등록 오류: ${err.message}` });
    }
  }

  return respond({
    response_type: 'in_channel',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'UX 문구 등록 완료' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*카테고리:* ${category}` },
          { type: 'mrkdwn', text: `*톤:* ${tone}` },
          { type: 'mrkdwn', text: `*문구:* ${uxText}` },
          { type: 'mrkdwn', text: `*컴포넌트:* ${component}` },
        ],
      },
    ],
  });
}

// --- 핸들러: 톤 가이드 ---
async function handleTone(name, respond) {
  if (!name) {
    const tones = Object.entries(guide.toneGuide)
      .map(([n, t]) => `*${n}* — ${t.description} _(${t.suffix})_`)
      .join('\n');
    return respond({
      response_type: 'ephemeral',
      text: `*톤 가이드*\n\n${tones}\n\n특정 톤 조회: \`/uxr 톤 친근\``,
    });
  }

  const tone = guide.toneGuide[name];
  if (!tone) {
    return respond({ response_type: 'ephemeral', text: `"${name}" 톤을 찾을 수 없어요. \`/uxr 톤\`으로 목록을 확인해 주세요.` });
  }

  // 해당 톤을 사용하는 문구 예시
  const examples = [];
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      if (entry.tone === name) examples.push({ ...entry, category: cat.label });
    }
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `톤 가이드: ${name}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*설명:* ${tone.description}\n*문장 끝 패턴:* ${tone.suffix}\n*이모지 사용:* ${tone.emoji ? '허용' : '지양'}`,
      },
    },
  ];

  if (examples.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*예시 (${examples.length}건)*\n${examples.slice(0, 5).map((e) => formatEntryCompact(e)).join('\n')}`,
      },
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

// --- 핸들러: 원칙 ---
async function handlePrinciples(respond) {
  const rules = guide.principles.writingRules.map((r, i) => {
    let text = `*${i + 1}. ${r.rule}*`;
    if (r.example) text += `\n   예: ${r.example}`;
    if (r.good) text += `\n   (O) ${r.good}\n   (X) ${r.bad}`;
    return text;
  });

  const voiceRules = guide.principles.voiceTone.rules.map((r) => `• ${r}`).join('\n');

  return respond({
    response_type: 'in_channel',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '유심사 UX 라이팅 원칙' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*브랜드 보이스:* ${guide.principles.voiceTone.brand}\n\n${voiceRules}`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: rules.join('\n\n') },
      },
    ],
  });
}

// --- 핸들러: 문구 일관성 검사 ---
async function handleCheck(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '검사할 문구를 입력해 주세요.\n예: `/uxr 검사 결제 오류가 발생하였습니다. 다시 시도하십시오.`',
    });
  }

  // 로컬 규칙 기반 자동 검사
  const issues = [];
  const suggestions = [];

  // 1. 길이 체크 (40자 이내)
  if (text.length > 40) {
    issues.push(`글자 수 ${text.length}자 (권장 40자 이내)`);
  }

  // 2. 수동태/딱딱한 말투 체크
  const passivePatterns = [
    { pattern: /되었습니다/g, fix: '됐어요' },
    { pattern: /하였습니다/g, fix: '했어요' },
    { pattern: /됩니다/g, fix: '돼요' },
    { pattern: /합니다/g, fix: '해요' },
    { pattern: /십시오/g, fix: '세요' },
    { pattern: /바랍니다/g, fix: '주세요' },
    { pattern: /없습니다/g, fix: '없어요' },
    { pattern: /있습니다/g, fix: '있어요' },
    { pattern: /입니다/g, fix: '이에요' },
  ];
  for (const { pattern, fix } of passivePatterns) {
    if (pattern.test(text)) {
      issues.push(`"${pattern.source}" → "${fix}" (해요체로 변경)`);
      suggestions.push({ from: pattern.source, to: fix });
    }
  }

  // 3. 부정문 체크
  const negativePatterns = [
    /할 수 없/,
    /불가능/,
    /하지 마/,
    /않으면/,
    /못합니다/,
    /안됩니다/,
    /금지/,
  ];
  for (const p of negativePatterns) {
    if (p.test(text)) {
      issues.push(`부정 표현 "${text.match(p)[0]}" 감지 → 긍정문으로 변경 권장`);
    }
  }

  // 4. CTA 체크 (버튼 텍스트 패턴)
  if (text.length <= 10 && !/하기$|보기$|하세요$|해주세요$/.test(text) && !/[가-힣]$/.test(text)) {
    issues.push('CTA 버튼이라면 동사로 끝나도록 권장 (예: ~하기)');
  }

  // 5. 이모지 과다 사용 체크
  const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 2) {
    issues.push(`이모지 ${emojiCount}개 감지 → 절제해서 사용 권장`);
  }

  // 결과 구성
  const passed = issues.length === 0;
  const statusIcon = passed ? 'PASS' : 'FAIL';
  const statusText = passed
    ? '가이드라인을 잘 지키고 있어요!'
    : `${issues.length}개 개선 포인트가 있어요.`;

  // 자동 수정 문구 생성
  let autoFixed = text;
  for (const { from, to } of suggestions) {
    autoFixed = autoFixed.replace(new RegExp(from, 'g'), to);
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `UX 문구 검사 [${statusIcon}]` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*원본:* "${text}"\n*글자 수:* ${text.length}자` },
    },
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

  // AI 기반 심층 분석도 추가
  const prompt = `${buildSystemPrompt()}

[요청]
아래 UX 문구를 유심사 가이드라인 기준으로 간단히 점수(100점 만점)와 한줄 코멘트를 달아줘.
평가 기준: 해요체 사용, 40자 이내, 능동태, 긍정문, 명확성
답변 형식: "점수: XX/100 | 코멘트: ..."

문구: "${text}"`;

  const aiComment = await askAI(prompt);
  if (aiComment) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `AI 평가: ${aiComment}` }],
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

// --- 핸들러: 다국어 번역 ---
async function handleTranslate(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '번역할 문구 또는 ID를 입력해 주세요.\n예: `/uxr 번역 ord-004` 또는 `/uxr 번역 en 결제가 완료됐어요`',
    });
  }

  // ID로 검색하는 경우
  const idMatch = text.match(/^([a-z]{3}-\d{3})$/i);
  let sourceText = text;
  let targetLangs = ['en', 'ja'];

  if (idMatch) {
    const id = idMatch[1].toLowerCase();
    let found = null;
    for (const cat of Object.values(guide.categories)) {
      for (const entry of cat.entries) {
        if (entry.id === id) { found = entry; break; }
      }
      if (found) break;
    }
    if (!found) {
      return respond({ response_type: 'ephemeral', text: `"${id}" ID의 문구를 찾을 수 없어요.` });
    }
    sourceText = found.text;
  }

  // 언어 지정 파싱 (예: "en 결제가 완료됐어요" 또는 "ja 결제가 완료됐어요")
  const langMatch = text.match(/^(en|ja|zh|es|fr)\s+(.+)$/i);
  if (langMatch) {
    targetLangs = [langMatch[1].toLowerCase()];
    sourceText = langMatch[2];
  }

  const langNames = { en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어' };
  const targetLangStr = targetLangs.map((l) => langNames[l] || l).join(', ');

  const prompt = `${buildSystemPrompt()}

[요청]
아래 한국어 UX 문구를 ${targetLangStr}로 번역해줘.
번역 시 유심사 브랜드 톤(친근, 명확, 간결)을 유지하고, 각 언어의 자연스러운 UX 문구 관습을 따라줘.
형식:

${targetLangs.map((l) => `[${langNames[l] || l}] ...`).join('\n')}

원문: "${sourceText}"`;

  const aiResponse = await askAI(prompt);
  if (!aiResponse) {
    return respond({ response_type: 'ephemeral', text: 'AI 응답을 받지 못했어요. API 키 설정을 확인해 주세요.' });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'UX 문구 다국어 번역' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*원문 (한국어):* "${sourceText}"` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: aiResponse },
    },
  ];

  return respond({ response_type: 'in_channel', blocks });
}

// --- 핸들러: 문구 비교 ---
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

  const prompt = `${buildSystemPrompt()}

[요청]
아래 두 UX 문구를 유심사 가이드라인 기준으로 비교 분석해줘.

문구 A: "${textA}"
문구 B: "${textB}"

각 문구에 대해:
1. 점수 (100점 만점)
2. 장점
3. 개선점

마지막에 어떤 문구가 더 적합한지 결론을 내려줘.
답변은 한국어로 작성해.`;

  const aiResponse = await askAI(prompt);
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

// --- 핸들러: 벌크 검사 ---
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

  const passivePatterns = [
    { pattern: /되었습니다/, fix: '됐어요' },
    { pattern: /하였습니다/, fix: '했어요' },
    { pattern: /됩니다/, fix: '돼요' },
    { pattern: /합니다/, fix: '해요' },
    { pattern: /십시오/, fix: '세요' },
    { pattern: /바랍니다/, fix: '주세요' },
    { pattern: /없습니다/, fix: '없어요' },
    { pattern: /있습니다/, fix: '있어요' },
    { pattern: /입니다/, fix: '이에요' },
  ];

  const negativePatterns = [/할 수 없/, /불가능/, /하지 마/, /않으면/, /못합니다/, /안됩니다/];

  const results = phrases.map((phrase) => {
    const issues = [];
    if (phrase.length > 40) issues.push('40자 초과');
    for (const { pattern } of passivePatterns) {
      if (pattern.test(phrase)) { issues.push('해요체 필요'); break; }
    }
    for (const p of negativePatterns) {
      if (p.test(phrase)) { issues.push('부정문'); break; }
    }
    const passed = issues.length === 0;
    return { phrase, passed, issues };
  });

  const passCount = results.filter((r) => r.passed).length;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `벌크 검사 결과 (${passCount}/${results.length} 통과)` },
    },
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

// --- 핸들러: 랜덤 UX 팁 ---
async function handleRandom(respond) {
  // 전체 문구 수집
  const allEntries = [];
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      allEntries.push({ ...entry, category: cat.label });
    }
  }

  // 랜덤 문구 선택
  const entry = allEntries[Math.floor(Math.random() * allEntries.length)];

  // 랜덤 라이팅 팁
  const tips = [
    '한 문장은 40자 이내로! 짧을수록 읽기 쉬워요.',
    '"~합니다" 대신 "~해요"를 쓰면 더 친근해져요.',
    '에러 메시지는 "원인 + 해결방법"으로 구성해 보세요.',
    'CTA 버튼은 "주문하기"처럼 동사로 시작하면 클릭률이 올라가요.',
    '"~할 수 없습니다" 대신 "~하면 가능해요"로 바꿔보세요.',
    '이모지는 핵심 포인트에만 1~2개 절제해서 사용해요.',
    '로딩 문구에는 "잠시만 기다려 주세요"처럼 기다림의 이유를 알려주세요.',
    '빈 화면(Empty State)에는 다음 행동을 안내하는 문구를 넣어보세요.',
    '사과 문구에는 "죄송해요" + 해결 의지를 함께 담아주세요.',
    '성공 메시지에는 다음 단계를 안내하면 사용자 경험이 좋아져요.',
  ];
  const tip = tips[Math.floor(Math.random() * tips.length)];

  return respond({
    response_type: 'in_channel',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '오늘의 UX 라이팅 팁' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*TIP:* ${tip}` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*오늘의 문구 예시*\n\`${entry.id}\` \`${entry.category}\`\n*${entry.situation}*\n> ${entry.text}\n_톤: ${entry.tone} | 컴포넌트: ${entry.component}_`,
        },
      },
    ],
  });
}

// --- 핸들러: 통계 ---
async function handleStats(respond) {
  // 카테고리별 통계
  const catStats = Object.entries(guide.categories).map(([key, cat]) => ({
    key,
    label: cat.label,
    count: cat.entries.length,
  }));
  const totalEntries = catStats.reduce((sum, c) => sum + c.count, 0);

  // 톤 분포
  const toneCount = {};
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      toneCount[entry.tone] = (toneCount[entry.tone] || 0) + 1;
    }
  }
  const toneSorted = Object.entries(toneCount).sort((a, b) => b[1] - a[1]);

  // 컴포넌트 분포
  const compCount = {};
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      compCount[entry.component] = (compCount[entry.component] || 0) + 1;
    }
  }
  const compSorted = Object.entries(compCount).sort((a, b) => b[1] - a[1]);

  // 막대 그래프 생성
  const maxCount = Math.max(...catStats.map((c) => c.count));
  const catBars = catStats
    .map((c) => {
      const bar = '█'.repeat(Math.round((c.count / maxCount) * 10));
      return `${c.label} ${bar} ${c.count}건`;
    })
    .join('\n');

  const toneList = toneSorted
    .map(([tone, count]) => `${tone}: ${count}건`)
    .join(' · ');

  const compList = compSorted
    .slice(0, 8)
    .map(([comp, count]) => `${comp}: ${count}건`)
    .join(' · ');

  return respond({
    response_type: 'in_channel',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `UX 라이팅 가이드 통계 (총 ${totalEntries}건)` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*카테고리별 분포*\n\`\`\`\n${catBars}\n\`\`\`` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*톤 분포*\n${toneList}` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*컴포넌트 분포 (상위 8개)*\n${compList}` },
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `카테고리 ${catStats.length}개 · 톤 ${toneSorted.length}종 · 컴포넌트 ${compSorted.length}종` }],
      },
    ],
  });
}

// --- 핸들러: 도움말 ---
async function handleHelp(respond) {
  return respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '유심사 UX 라이팅 봇 도움말' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*기본*',
            '`/uxr 검색 [키워드]` — 키워드로 UX 문구 검색',
            '  예: `/uxr 검색 결제`  `/uxr 검색 eSIM`',
            '`/uxr 카테고리 [이름]` — 카테고리별 문구 조회',
            '  예: `/uxr 카테고리 주문`  `/uxr 카테고리` (목록)',
            '`/uxr 톤 [톤이름]` — 톤 가이드 조회',
            '  예: `/uxr 톤 친근`  `/uxr 톤 사과`',
            '`/uxr 원칙` — 라이팅 원칙 조회',
            '`/uxr 통계` — 가이드 현황 대시보드',
            '`/uxr 랜덤` — 오늘의 UX 라이팅 팁',
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*AI 기능*',
            '`/uxr 추천 [상황설명]` — AI가 상황에 맞는 문구 제안',
            '  예: `/uxr 추천 사용자가 잘못된 이메일을 입력했을 때`',
            '`/uxr 피드백 [문구]` — 기존 문구의 개선점 분석',
            '  예: `/uxr 피드백 오류가 발생했습니다`',
            '`/uxr 비교 [문구A] vs [문구B]` — 두 문구 비교 분석',
            '  예: `/uxr 비교 결제가 처리되었습니다 vs 결제를 완료했어요`',
            '`/uxr 번역 [문구 또는 ID]` — 다국어 번역',
            '  예: `/uxr 번역 ord-004`  `/uxr 번역 en 결제가 완료됐어요`',
          ].join('\n'),
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*검사/관리*',
            '`/uxr 검사 [문구]` — 가이드라인 일관성 검사',
            '  예: `/uxr 검사 결제 오류가 발생하였습니다. 다시 시도하십시오.`',
            '`/uxr 벌크검사 [문구1/문구2/...]` — 여러 문구 한번에 검사',
            '  예: `/uxr 벌크검사 결제 실패입니다/로그인 해주십시오/배송 완료됐어요`',
            '`/uxr 등록 [카테고리|문구|톤|컴포넌트]` — 새 문구 등록',
            '  예: `/uxr 등록 주문|주문이 완료됐어요!|축하|토스트`',
          ].join('\n'),
        },
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '카테고리: 온보딩 · 상품탐색 · 주문/결제 · 배송 · eSIM · 여행/로밍 · 개통 · 계정 · 고객지원 · 시스템 · 마케팅',
          },
        ],
      },
    ],
  });
}

// --- 앱 멘션 핸들러 (자연어 질문) ---
app.event('app_mention', async ({ event, say }) => {
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!text) {
    return say('안녕하세요! UX 라이팅에 대해 물어보세요. 예: "결제 실패 시 메시지 추천해줘"');
  }

  // 가이드에서 관련 문구 검색
  const keywords = text.split(/\s+/).filter((w) => w.length > 1);
  const allResults = [];
  for (const kw of keywords) {
    allResults.push(...searchGuide(kw));
  }
  const unique = [...new Map(allResults.map((e) => [e.id, e])).values()].slice(0, 5);

  const context = unique.length
    ? `\n\n[관련 기존 문구]\n${unique.map((e) => `- ${e.id} / ${e.situation}: "${e.text}" (톤: ${e.tone}, 컴포넌트: ${e.component})`).join('\n')}`
    : '';

  const prompt = `${buildSystemPrompt()}
${context}

[사용자 질문]
${text}

위 질문에 대해 유심사 UX 라이팅 가이드를 참고하여 답변해줘.
기존 문구가 있으면 해당 문구를 안내하고, 없으면 가이드라인에 맞는 새 문구를 제안해.
답변은 한국어로, 슬랙에서 읽기 편한 형태로 작성해.`;

  const aiResponse = await askAI(prompt);
  if (!aiResponse) {
    return say('AI 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: aiResponse },
    },
  ];

  if (unique.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `참고 문구: ${unique.map((e) => `\`${e.id}\``).join(' ')}` }],
    });
  }

  return say({ blocks });
});

// --- DM 메시지 핸들러 ---
app.event('message', async ({ event, say }) => {
  // DM에서만 반응, 봇 자신의 메시지는 무시
  if (event.channel_type !== 'im' || event.bot_id) return;

  const text = (event.text || '').trim();
  if (!text) return;

  const keywords = text.split(/\s+/).filter((w) => w.length > 1);
  const allResults = [];
  for (const kw of keywords) {
    allResults.push(...searchGuide(kw));
  }
  const unique = [...new Map(allResults.map((e) => [e.id, e])).values()].slice(0, 5);

  const context = unique.length
    ? `\n\n[관련 기존 문구]\n${unique.map((e) => `- ${e.id} / ${e.situation}: "${e.text}" (톤: ${e.tone})`).join('\n')}`
    : '';

  const prompt = `${buildSystemPrompt()}
${context}

[사용자 질문]
${text}

위 질문에 유심사 UX 라이팅 전문가로서 답변해줘. 한국어로 답변해.`;

  const aiResponse = await askAI(prompt);
  if (!aiResponse) {
    return say('AI 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  return say(aiResponse);
});

// --- 서버 실행 ---
const port = process.env.PORT || 3000;
(async () => {
  await app.start(port);
  console.log(`유심사 UX 라이팅 봇 실행 중 (포트 ${port})`);
})();
