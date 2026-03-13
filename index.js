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

  return `너는 유심사(Usimgle)의 UX 라이팅 전문가 봇이야.
유심사는 USIM/SIM 카드 온라인 마켓플레이스 서비스야.

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
app.command('/ux', async ({ command, ack, respond }) => {
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
    return respond({ response_type: 'ephemeral', text: '검색할 키워드를 입력해 주세요.\n예: `/ux 검색 결제`' });
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
    return respond({ response_type: 'ephemeral', text: `"${keyword}"에 대한 UX 문구가 없어요. \`/ux 추천 ${keyword}\`로 AI 추천을 받아보세요.` });
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
      text: `*카테고리 목록*\n${cats}\n\n예: \`/ux 카테고리 주문\``,
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
    return respond({ response_type: 'ephemeral', text: '상황을 설명해 주세요.\n예: `/ux 추천 사용자가 잘못된 이메일을 입력했을 때`' });
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

  return respond({ response_type: 'in_channel', blocks });
}

// --- 핸들러: 피드백 ---
async function handleFeedback(text, respond) {
  if (!text) {
    return respond({ response_type: 'ephemeral', text: '피드백받을 문구를 입력해 주세요.\n예: `/ux 피드백 오류가 발생했습니다`' });
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
      text: '등록 형식: `/ux 등록 카테고리|문구|톤|컴포넌트`\n예: `/ux 등록 주문|주문이 완료됐어요!|축하|토스트`',
    });
  }

  const parts = text.split('|').map((t) => t.trim());
  if (parts.length < 2) {
    return respond({
      response_type: 'ephemeral',
      text: '최소 카테고리와 문구를 `|`로 구분해서 입력해 주세요.\n예: `/ux 등록 주문|주문이 완료됐어요!|축하|토스트`',
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
      text: `*톤 가이드*\n\n${tones}\n\n특정 톤 조회: \`/ux 톤 친근\``,
    });
  }

  const tone = guide.toneGuide[name];
  if (!tone) {
    return respond({ response_type: 'ephemeral', text: `"${name}" 톤을 찾을 수 없어요. \`/ux 톤\`으로 목록을 확인해 주세요.` });
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
            '`/ux 검색 [키워드]` — 키워드로 UX 문구 검색',
            '`/ux 카테고리 [이름]` — 카테고리별 문구 조회',
            '`/ux 추천 [상황설명]` — AI가 상황에 맞는 문구 제안',
            '`/ux 피드백 [문구]` — 기존 문구의 개선점 분석',
            '`/ux 등록 [카테고리|문구|톤|컴포넌트]` — 새 문구 등록',
            '`/ux 톤 [톤이름]` — 톤 가이드 조회',
            '`/ux 원칙` — 라이팅 원칙 조회',
            '`/ux 도움말` — 이 도움말 표시',
          ].join('\n'),
        },
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '카테고리: 온보딩 · 상품탐색 · 주문/결제 · 배송 · 개통 · 계정 · 고객지원 · 시스템 · 마케팅',
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
