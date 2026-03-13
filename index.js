const { App, ExpressReceiver } = require('@slack/bolt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
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

// --- 알림 채널 설정 (선택) ---
const notifyChannelId = process.env.NOTIFICATION_CHANNEL_ID || '';

async function sendNotification(blocks) {
  if (!notifyChannelId) return;
  try {
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: notifyChannelId,
      blocks,
      text: '새 UX 문구 알림',
    });
  } catch (err) {
    console.error('알림 전송 실패:', err.message);
  }
}

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
const updateRow = (d) =>
  sheetEnabled
    ? axios.post(process.env.GOOGLE_API_URL, { ...d, _action: 'update' })
    : Promise.resolve();

// --- JSON 파일 저장 헬퍼 ---
function saveGuide() {
  fs.writeFileSync(guidePath, JSON.stringify(guide, null, 2), 'utf-8');
}

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
        await handleAdd(args, respond, command.user_id);
        break;
      case '수정':
      case 'edit':
        await handleEdit(args, respond, command.user_id);
        break;
      case '삭제':
      case 'delete':
        await handleDelete(args, respond, command.user_id);
        break;
      case '중복검사':
      case 'duplicate':
        await handleDuplicate(args, respond);
        break;
      case '용어':
      case '용어집':
      case 'glossary':
        await handleGlossary(args, respond);
        break;
      case '내보내기':
      case 'export':
        await handleExport(args, respond);
        break;
      case '히스토리':
      case 'history':
        await handleHistory(args, respond);
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
async function handleAdd(text, respond, userId) {
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

  // ID 자동 생성 (삭제 후에도 중복되지 않도록 기존 최대 번호 기반)
  const catKey = Object.keys(guide.categories).find(
    (k) => guide.categories[k].label === category || k === category
  ) || category;
  const catData = guide.categories[catKey];
  const prefix = catKey.substring(0, 3);
  let maxNum = 0;
  if (catData) {
    for (const entry of catData.entries) {
      const match = entry.id.match(/-(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  const newId = `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;

  const now = new Date().toISOString();
  const newEntry = {
    id: newId, situation: uxText.substring(0, 20), text: uxText, tone, component,
    history: [{ action: '등록', date: now, by: userId || 'slack', detail: '최초 등록' }],
  };

  // 1) JSON에 저장
  if (!guide.categories[catKey]) {
    guide.categories[catKey] = { label: category, entries: [] };
  }
  guide.categories[catKey].entries.push(newEntry);
  try {
    saveGuide();
  } catch (err) {
    return respond({ response_type: 'ephemeral', text: `JSON 저장 오류: ${err.message}` });
  }

  // 2) 구글시트에 저장
  if (sheetEnabled) {
    try {
      await addRow({ id: newId, category: catKey, situation: newEntry.situation, text: uxText, tone, component, registeredBy: 'slack', createdAt: new Date().toISOString() });
    } catch (err) {
      // 시트 실패해도 JSON엔 이미 저장됨
    }
  }

  // 알림 채널에 신규 문구 알림 전송
  sendNotification([
    {
      type: 'header',
      text: { type: 'plain_text', text: '새 UX 문구가 등록됐어요!' },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*ID:* \`${newId}\`` },
        { type: 'mrkdwn', text: `*카테고리:* ${category}` },
        { type: 'mrkdwn', text: `*톤:* ${tone}` },
        { type: 'mrkdwn', text: `*컴포넌트:* ${component}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*문구:* "${uxText}"` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `등록자: <@${userId || 'unknown'}> | ${new Date().toLocaleDateString('ko-KR')}` }],
    },
  ]);

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
          { type: 'mrkdwn', text: `*ID:* \`${newId}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${category}` },
          { type: 'mrkdwn', text: `*톤:* ${tone}` },
          { type: 'mrkdwn', text: `*컴포넌트:* ${component}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*문구:* ${uxText}` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sheetEnabled ? 'JSON + Google Sheets 양쪽 저장 완료' : 'JSON 저장 완료 (시트 미연동)' }],
      },
    ],
  });
}

// --- 핸들러: 수정 ---
async function handleEdit(text, respond, userId) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '수정 형식: `/uxr 수정 ID|필드|새값`\n\n*수정 가능 필드:* text, tone, component, situation\n\n예시:\n`/uxr 수정 ord-001|text|주문이 완료됐어요!`\n`/uxr 수정 onb-003|tone|축하`',
    });
  }

  const parts = text.split('|').map((t) => t.trim());
  if (parts.length < 3) {
    return respond({
      response_type: 'ephemeral',
      text: '형식: `/uxr 수정 ID|필드|새값`\n예: `/uxr 수정 ord-001|text|결제가 완료됐어요!`',
    });
  }

  const [id, field, newValue] = parts;
  const allowedFields = ['text', 'tone', 'component', 'situation'];
  if (!allowedFields.includes(field)) {
    return respond({
      response_type: 'ephemeral',
      text: `수정 가능한 필드: ${allowedFields.join(', ')}\n입력한 필드: "${field}"`,
    });
  }

  // JSON에서 해당 ID 찾기
  let found = null;
  let catKey = null;
  for (const [key, cat] of Object.entries(guide.categories)) {
    const entry = cat.entries.find((e) => e.id === id);
    if (entry) {
      found = entry;
      catKey = key;
      break;
    }
  }

  if (!found) {
    return respond({
      response_type: 'ephemeral',
      text: `ID "${id}"를 찾을 수 없어요. \`/uxr 검색\`으로 ID를 확인해 주세요.`,
    });
  }

  const oldValue = found[field] || '(없음)';
  found[field] = newValue;

  // 히스토리 기록
  if (!found.history) found.history = [];
  found.history.push({
    action: '수정',
    date: new Date().toISOString(),
    by: userId || 'slack',
    field,
    from: oldValue,
    to: newValue,
  });

  // 1) JSON 저장
  try {
    saveGuide();
  } catch (err) {
    return respond({ response_type: 'ephemeral', text: `JSON 저장 오류: ${err.message}` });
  }

  // 2) 구글시트 수정
  if (sheetEnabled) {
    try {
      await updateRow({ id, field, value: newValue });
    } catch (err) {
      // 시트 실패해도 JSON엔 이미 저장됨
    }
  }

  // 알림 채널에 수정 알림 전송
  sendNotification([
    {
      type: 'header',
      text: { type: 'plain_text', text: 'UX 문구가 수정됐어요!' },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
        { type: 'mrkdwn', text: `*카테고리:* ${catKey}` },
        { type: 'mrkdwn', text: `*수정 필드:* ${field}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*이전:* ~${oldValue}~\n*변경:* "${newValue}"` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `수정자: <@${userId || 'unknown'}> | ${new Date().toLocaleDateString('ko-KR')}` }],
    },
  ]);

  return respond({
    response_type: 'in_channel',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'UX 문구 수정 완료' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${catKey}` },
          { type: 'mrkdwn', text: `*필드:* ${field}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*이전:* ${oldValue}\n*변경:* ${newValue}` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sheetEnabled ? 'JSON + Google Sheets 양쪽 수정 완료' : 'JSON 수정 완료 (시트 미연동)' }],
      },
    ],
  });
}

// --- 핸들러: 삭제 ---
async function handleDelete(text, respond, userId) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '삭제할 문구 ID를 입력해 주세요.\n예: `/uxr 삭제 ord-005`',
    });
  }

  const id = text.trim();

  // JSON에서 해당 ID 찾기
  let found = null;
  let catKey = null;
  let entryIndex = -1;
  for (const [key, cat] of Object.entries(guide.categories)) {
    const idx = cat.entries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      found = cat.entries[idx];
      catKey = key;
      entryIndex = idx;
      break;
    }
  }

  if (!found) {
    return respond({
      response_type: 'ephemeral',
      text: `ID "${id}"를 찾을 수 없어요. \`/uxr 검색\`으로 ID를 확인해 주세요.`,
    });
  }

  // 삭제 실행
  const deletedText = found.text;
  const deletedCategory = guide.categories[catKey].label;
  guide.categories[catKey].entries.splice(entryIndex, 1);

  try {
    saveGuide();
  } catch (err) {
    return respond({ response_type: 'ephemeral', text: `JSON 저장 오류: ${err.message}` });
  }

  // 구글시트에서도 삭제
  if (sheetEnabled) {
    try {
      await axios.post(process.env.GOOGLE_API_URL, { _action: 'delete', id });
    } catch (_) { /* 시트 실패해도 JSON엔 이미 삭제됨 */ }
  }

  // 알림 채널에 삭제 알림
  sendNotification([
    {
      type: 'header',
      text: { type: 'plain_text', text: 'UX 문구가 삭제됐어요' },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
        { type: 'mrkdwn', text: `*카테고리:* ${deletedCategory}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*삭제된 문구:* ~${deletedText}~` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `삭제자: <@${userId || 'unknown'}> | ${new Date().toLocaleDateString('ko-KR')}` }],
    },
  ]);

  return respond({
    response_type: 'in_channel',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'UX 문구 삭제 완료' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${deletedCategory}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*삭제된 문구:* ~${deletedText}~` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `${found.tone} | ${found.component} — 복구가 필요하면 \`/uxr 등록\`으로 다시 추가해 주세요.` }],
      },
    ],
  });
}

// --- 핸들러: 중복검사 ---
async function handleDuplicate(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '중복 여부를 확인할 문구를 입력해 주세요.\n예: `/uxr 중복검사 결제가 완료됐어요`',
    });
  }

  const inputText = text.trim().toLowerCase();
  const allEntries = [];
  for (const [catKey, cat] of Object.entries(guide.categories)) {
    for (const entry of cat.entries) {
      allEntries.push({ ...entry, category: cat.label, categoryKey: catKey });
    }
  }

  // 1. 정확히 동일한 문구
  const exact = allEntries.filter((e) => e.text.toLowerCase() === inputText);

  // 2. 유사도 기반 매칭 (단어 겹침)
  const inputWords = new Set(inputText.split(/\s+/).filter((w) => w.length > 1));
  const similar = [];
  for (const entry of allEntries) {
    if (exact.find((e) => e.id === entry.id)) continue;
    const entryWords = new Set(entry.text.toLowerCase().split(/\s+/).filter((w) => w.length > 1));
    const overlap = [...inputWords].filter((w) => entryWords.has(w));
    const similarity = inputWords.size > 0 ? overlap.length / Math.max(inputWords.size, entryWords.size) : 0;
    if (similarity >= 0.4) {
      similar.push({ ...entry, similarity: Math.round(similarity * 100) });
    }
  }
  similar.sort((a, b) => b.similarity - a.similarity);

  // 3. 포함 관계 (입력 문구가 기존 문구에 포함되거나 반대)
  const contained = allEntries.filter((e) => {
    if (exact.find((x) => x.id === e.id)) return false;
    if (similar.find((x) => x.id === e.id)) return false;
    const eLower = e.text.toLowerCase();
    return eLower.includes(inputText) || inputText.includes(eLower);
  });

  const totalFound = exact.length + similar.length + contained.length;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `중복 검사 결과 (${totalFound}건 발견)` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*검사 문구:* "${text}"` },
    },
  ];

  if (exact.length > 0) {
    blocks.push({ type: 'divider' });
    const list = exact.map((e) => `\`${e.id}\` [${e.category}] "${e.text}" _(${e.tone})_`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*동일한 문구 (${exact.length}건)*\n${list}` },
    });
  }

  if (similar.length > 0) {
    blocks.push({ type: 'divider' });
    const list = similar.slice(0, 5).map((e) => `\`${e.id}\` [${e.category}] "${e.text}" _(유사도 ${e.similarity}%)_`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*유사한 문구 (${similar.length}건)*\n${list}` },
    });
  }

  if (contained.length > 0) {
    blocks.push({ type: 'divider' });
    const list = contained.slice(0, 5).map((e) => `\`${e.id}\` [${e.category}] "${e.text}" _(${e.tone})_`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*포함 관계 (${contained.length}건)*\n${list}` },
    });
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

// --- 핸들러: 용어집 ---
const glossary = {
  'eSIM': { official: 'eSIM', wrong: ['이심', 'e심', 'ESIM', 'esim', 'E-SIM'], desc: '디지털 SIM. 항상 "eSIM"으로 표기 (대소문자 주의)' },
  'USIM': { official: 'USIM', wrong: ['유심', '유심카드', 'usim'], desc: '물리적 SIM 카드. 공식 표기는 "USIM"이지만 사용자 문맥에서 "유심"도 허용' },
  '유심사': { official: '유심사', wrong: ['USIMSA', 'Usimgle', '유심사닷컴'], desc: '서비스 공식 명칭. 한글 "유심사"로 통일' },
  '요금제': { official: '요금제', wrong: ['플랜', '상품', '패키지'], desc: '데이터 상품을 지칭할 때 "요금제"로 통일' },
  '데이터': { official: '데이터', wrong: ['데이타', 'Data'], desc: '"데이터"로 통일. "데이타" 사용 금지' },
  '로밍': { official: '로밍', wrong: ['로밍서비스', '국제로밍'], desc: '해외 데이터 사용을 의미. "로밍"으로 간결하게' },
  'QR코드': { official: 'QR코드', wrong: ['QR 코드', 'qr코드', 'QR'], desc: '"QR코드" 붙여서 표기' },
  '활성화': { official: '활성화', wrong: ['개통', '등록', '액티베이션'], desc: 'eSIM/USIM을 사용 가능 상태로 만드는 것. "활성화"로 통일' },
  '충전': { official: '충전', wrong: ['리차지', '탑업', 'top-up'], desc: '데이터 추가 구매. "충전"으로 통일' },
  '고객센터': { official: '고객센터', wrong: ['CS', '상담센터', '콜센터', '지원센터'], desc: '고객 지원 채널. "고객센터"로 통일' },
};

async function handleGlossary(text, respond) {
  if (!text) {
    const termList = Object.entries(glossary)
      .map(([term, info]) => `*${info.official}* — ${info.desc}`)
      .join('\n');

    return respond({
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `유심사 브랜드 용어집 (${Object.keys(glossary).length}개)` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: termList },
        },
        { type: 'divider' },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '특정 용어 조회: `/uxr 용어 eSIM`' }],
        },
      ],
    });
  }

  // 특정 용어 조회
  const query = text.trim();
  let matchKey = null;

  // 공식 표기로 검색
  for (const [key, info] of Object.entries(glossary)) {
    if (key.toLowerCase() === query.toLowerCase() || info.official.toLowerCase() === query.toLowerCase()) {
      matchKey = key;
      break;
    }
  }

  // 잘못된 표기로 검색
  if (!matchKey) {
    for (const [key, info] of Object.entries(glossary)) {
      if (info.wrong.some((w) => w.toLowerCase() === query.toLowerCase())) {
        matchKey = key;
        break;
      }
    }
  }

  if (!matchKey) {
    return respond({
      response_type: 'ephemeral',
      text: `"${query}" 용어를 찾을 수 없어요. \`/uxr 용어\`로 전체 목록을 확인해 주세요.`,
    });
  }

  const info = glossary[matchKey];

  // 해당 용어가 사용된 문구 예시
  const examples = [];
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      if (entry.text.includes(info.official) || info.wrong.some((w) => entry.text.includes(w))) {
        examples.push({ ...entry, category: cat.label });
      }
    }
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `용어: ${info.official}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*설명:* ${info.desc}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*공식 표기:* ${info.official}` },
        { type: 'mrkdwn', text: `*잘못된 표기:* ${info.wrong.join(', ')}` },
      ],
    },
  ];

  if (examples.length > 0) {
    blocks.push({ type: 'divider' });
    const list = examples.slice(0, 5).map((e) => formatEntryCompact(e)).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*사용 예시 (${examples.length}건)*\n${list}` },
    });
  }

  // 입력이 잘못된 표기였으면 경고
  if (info.wrong.some((w) => w.toLowerCase() === query.toLowerCase())) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `"${query}"는 잘못된 표기예요. *${info.official}*로 사용해 주세요.` }],
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

// --- 핸들러: 내보내기 ---
async function handleExport(format, respond) {
  const allEntries = [];
  for (const [catKey, cat] of Object.entries(guide.categories)) {
    for (const entry of cat.entries) {
      allEntries.push({
        id: entry.id,
        category: cat.label,
        categoryKey: catKey,
        situation: entry.situation,
        text: entry.text,
        tone: entry.tone,
        component: entry.component,
      });
    }
  }

  const fmt = (format || '').trim().toLowerCase();

  if (fmt === 'json') {
    // JSON 포맷
    const jsonStr = JSON.stringify(allEntries, null, 2);
    const preview = jsonStr.substring(0, 2800);

    return respond({
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `UX 문구 내보내기 — JSON (${allEntries.length}건)` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `\`\`\`${preview}${jsonStr.length > 2800 ? '\n... (이하 생략)' : ''}\`\`\`` },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '전체 데이터는 서버의 `data/ux-writing-guide.json` 파일에서 확인할 수 있어요.' }],
        },
      ],
    });
  }

  // 기본: CSV 포맷 (모든 필드 따옴표 감싸기)
  const csvHeader = 'ID,카테고리,카테고리키,상황,문구,톤,컴포넌트';
  const csvRows = allEntries.map((e) =>
    `"${e.id}","${e.category}","${e.categoryKey}","${e.situation.replace(/"/g, '""')}","${e.text.replace(/"/g, '""')}","${e.tone}","${e.component}"`
  );
  const csv = [csvHeader, ...csvRows].join('\n');
  const previewCount = Math.min(8, csvRows.length);
  const preview = [csvHeader, ...csvRows.slice(0, previewCount)].join('\n');
  const remainCount = csvRows.length - previewCount;

  return respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `UX 문구 내보내기 — CSV (${allEntries.length}건)` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `\`\`\`${preview}${remainCount > 0 ? `\n... (외 ${remainCount}건)` : ''}\`\`\`` },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*전체 CSV를 복사하려면* 아래 코드 블록을 펼쳐주세요:',
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `\`\`\`${csv.substring(0, 2900)}${csv.length > 2900 ? '\n... (슬랙 글자 제한으로 잘림 — 서버 파일에서 전체 확인)' : ''}\`\`\`` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '형식 옵션: `/uxr 내보내기` (CSV) 또는 `/uxr 내보내기 json` (JSON)' }],
      },
    ],
  });
}

// --- 핸들러: 히스토리 ---
async function handleHistory(text, respond) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '사용법: `/uxr 히스토리 [ID]`\n예: `/uxr 히스토리 ord-001`',
    });
  }

  const id = text.trim();
  let found = null;
  let catKey = null;
  for (const [key, cat] of Object.entries(guide.categories)) {
    const entry = cat.entries.find((e) => e.id === id);
    if (entry) {
      found = entry;
      catKey = key;
      break;
    }
  }

  if (!found) {
    return respond({
      response_type: 'ephemeral',
      text: `ID "${id}"를 찾을 수 없어요. \`/uxr 검색\`으로 ID를 확인해 주세요.`,
    });
  }

  const history = found.history || [];
  if (history.length === 0) {
    return respond({
      response_type: 'ephemeral',
      text: `\`${id}\` 의 변경 이력이 없습니다. (히스토리 기능 추가 이전에 등록된 문구)`,
    });
  }

  const lines = history.map((h, i) => {
    const date = h.date ? h.date.substring(0, 16).replace('T', ' ') : '?';
    if (h.action === '등록') {
      return `${i + 1}. *${h.action}* — ${date}\n    ${h.detail || ''}`;
    }
    return `${i + 1}. *${h.action}* \`${h.field}\` — ${date}\n    "${h.from}" → "${h.to}"`;
  });

  return respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${id} 변경 히스토리` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${catKey}` },
          { type: 'mrkdwn', text: `*현재 문구:* ${found.text}` },
          { type: 'mrkdwn', text: `*변경 횟수:* ${history.length}회` },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n\n') },
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

// --- 공통: 말투 검사 패턴 ---
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
    autoFixed = autoFixed.split(from).join(to);
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

  const results = phrases.map((phrase) => {
    const issues = [];
    if (phrase.length > 40) issues.push('40자 초과');
    for (const { from } of PASSIVE_PATTERNS) {
      if (phrase.includes(from)) { issues.push('해요체 필요'); break; }
    }
    for (const p of NEGATIVE_PATTERNS) {
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
  // 전체 문구 수 계산
  let totalEntries = 0;
  for (const cat of Object.values(guide.categories)) {
    totalEntries += cat.entries.length;
  }
  const catCount = Object.keys(guide.categories).length;

  return respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'UX Writing Bot' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `유심사 UX 라이팅 가이드 봇이에요.\n현재 *${catCount}개 카테고리*, *${totalEntries}건의 문구*가 등록되어 있어요.`,
        },
      },
      { type: 'divider' },
      // --- 검색 & 조회 ---
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*:mag: 검색 & 조회*',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '`/uxr 검색 [키워드]`\n키워드로 문구 검색\n_예: `/uxr 검색 결제`_' },
          { type: 'mrkdwn', text: '`/uxr 카테고리 [이름]`\n카테고리별 문구 조회\n_예: `/uxr 카테고리 주문`_' },
          { type: 'mrkdwn', text: '`/uxr 톤 [톤이름]`\n톤 가이드 조회\n_예: `/uxr 톤 친근`_' },
          { type: 'mrkdwn', text: '`/uxr 원칙`\n라이팅 원칙 전체 조회' },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '`/uxr 통계`\n가이드 현황 대시보드' },
          { type: 'mrkdwn', text: '`/uxr 랜덤`\n오늘의 UX 팁 + 문구' },
          { type: 'mrkdwn', text: '`/uxr 용어 [용어]`\n브랜드 용어집 조회\n_예: `/uxr 용어 eSIM`_' },
          { type: 'mrkdwn', text: '`/uxr 히스토리 [ID]`\n문구 변경 이력 조회\n_예: `/uxr 히스토리 ord-001`_' },
        ],
      },
      { type: 'divider' },
      // --- AI 기능 ---
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*:sparkles: AI 기능*',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '`/uxr 추천 [상황]`\nAI 문구 제안 (채택/수정)\n_예: `/uxr 추천 이메일 형식이 잘못됐을 때`_' },
          { type: 'mrkdwn', text: '`/uxr 피드백 [문구]`\n문구 개선점 분석\n_예: `/uxr 피드백 오류가 발생했습니다`_' },
          { type: 'mrkdwn', text: '`/uxr 비교 [A] vs [B]`\n두 문구 비교 분석\n_예: `/uxr 비교 처리되었습니다 vs 완료했어요`_' },
          { type: 'mrkdwn', text: '`/uxr 번역 [문구/ID]`\n다국어 번역 (en/ja/zh)\n_예: `/uxr 번역 ord-004`_' },
        ],
      },
      { type: 'divider' },
      // --- 검사 ---
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*:white_check_mark: 검사*',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '`/uxr 검사 [문구]`\n가이드라인 일관성 검사\n_예: `/uxr 검사 결제 오류가 발생하였습니다`_' },
          { type: 'mrkdwn', text: '`/uxr 벌크검사 [A/B/C]`\n여러 문구 한번에 검사\n_예: `/uxr 벌크검사 결제 실패입니다/로그인 해주십시오`_' },
          { type: 'mrkdwn', text: '`/uxr 중복검사 [문구]`\n등록 전 유사 문구 탐지\n_예: `/uxr 중복검사 결제가 완료됐어요`_' },
        ],
      },
      { type: 'divider' },
      // --- 관리 ---
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*:pencil2: 문구 관리*',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '`/uxr 등록 [카테고리|문구|톤|컴포넌트]`\n새 문구 등록\n_예: `/uxr 등록 주문|주문이 완료됐어요!|축하|토스트`_' },
          { type: 'mrkdwn', text: '`/uxr 수정 [ID|필드|새값]`\n기존 문구 수정\n_예: `/uxr 수정 ord-001|text|결제가 완료됐어요!`_' },
          { type: 'mrkdwn', text: '`/uxr 삭제 [ID]`\n문구 삭제\n_예: `/uxr 삭제 ord-005`_' },
          { type: 'mrkdwn', text: '`/uxr 내보내기 [json]`\nCSV/JSON 내보내기\n_예: `/uxr 내보내기` `/uxr 내보내기 json`_' },
        ],
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: [
              `*카테고리:* ${Object.values(guide.categories).map((c) => c.label).join(' · ')}`,
              notifyChannelId ? `*알림:* <#${notifyChannelId}> (등록/수정/삭제 알림 + 매주 월요일 주간 리포트)` : '',
              '*TIP:* `/uxr [키워드]`만 입력해도 바로 검색돼요!',
            ].filter(Boolean).join('\n'),
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

// --- 주간 UX 리포트 자동 발송 ---
function getWeeklyReport() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const allEntries = [];
  const catStats = {};
  const toneCount = {};
  const newEntries = [];
  const editedEntries = [];

  for (const [catKey, cat] of Object.entries(guide.categories)) {
    catStats[catKey] = { label: cat.label, count: cat.entries.length };
    for (const entry of cat.entries) {
      allEntries.push({ ...entry, category: cat.label, categoryKey: catKey });
      toneCount[entry.tone] = (toneCount[entry.tone] || 0) + 1;

      if (!entry.history) continue;
      for (const h of entry.history) {
        const hDate = new Date(h.date);
        if (hDate < weekAgo) continue;
        if (h.action === '등록') {
          newEntries.push({ ...entry, category: cat.label });
        } else if (h.action === '수정') {
          editedEntries.push({ id: entry.id, category: cat.label, field: h.field, from: h.from, to: h.to, by: h.by });
        }
      }
    }
  }

  const totalCount = allEntries.length;
  const catCount = Object.keys(catStats).length;
  const toneTotal = Object.keys(toneCount).length;

  // 톤 분포 상위 5개
  const toneSorted = Object.entries(toneCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const toneBar = toneSorted.map(([t, c]) => `${t}: ${c}건`).join(' · ');

  // 카테고리 상위 5개
  const catSorted = Object.entries(catStats).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  const catBar = catSorted.map(([, c]) => `${c.label}: ${c.count}건`).join(' · ');

  // 날짜 포맷
  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const periodStr = `${fmt(weekAgo)} ~ ${fmt(now)}`;

  return { totalCount, catCount, toneTotal, toneBar, catBar, newEntries, editedEntries, periodStr };
}

async function sendWeeklyReport() {
  if (!notifyChannelId) return;

  const r = getWeeklyReport();
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 주간 UX Writing 리포트 (${r.periodStr})` },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*총 문구:* ${r.totalCount}개` },
        { type: 'mrkdwn', text: `*카테고리:* ${r.catCount}개` },
        { type: 'mrkdwn', text: `*신규 등록:* ${r.newEntries.length}건` },
        { type: 'mrkdwn', text: `*수정:* ${r.editedEntries.length}건` },
      ],
    },
  ];

  // 신규 등록 목록
  if (r.newEntries.length > 0) {
    blocks.push({ type: 'divider' });
    const newList = r.newEntries.slice(0, 10).map((e) =>
      `• \`${e.id}\` [${e.category}] ${e.text} _(${e.tone})_`
    ).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🆕 신규 등록*\n${newList}` },
    });
  }

  // 수정 목록
  if (r.editedEntries.length > 0) {
    blocks.push({ type: 'divider' });
    const editList = r.editedEntries.slice(0, 10).map((e) =>
      `• \`${e.id}\` [${e.category}] ${e.field}: ~${e.from}~ → "${e.to}"`
    ).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*✏️ 수정 내역*\n${editList}` },
    });
  }

  // 변동 없을 때
  if (r.newEntries.length === 0 && r.editedEntries.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '이번 주는 등록/수정된 문구가 없어요.' },
    });
  }

  // 분포 요약
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `*톤 분포 Top 5:* ${r.toneBar}\n*카테고리 Top 5:* ${r.catBar}` }],
  });

  try {
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: notifyChannelId,
      blocks,
      text: `주간 UX Writing 리포트 (${r.periodStr})`,
    });
    console.log('주간 리포트 전송 완료');
  } catch (err) {
    console.error('주간 리포트 전송 실패:', err.message);
  }
}

// 매주 월요일 오전 9시 (KST) 자동 발송
cron.schedule('0 9 * * 1', () => {
  console.log('주간 UX 리포트 생성 시작...');
  sendWeeklyReport();
}, { timezone: 'Asia/Seoul' });

// --- 서버 실행 ---
const port = process.env.PORT || 3000;
(async () => {
  await app.start(port);
  console.log(`유심사 UX 라이팅 봇 실행 중 (포트 ${port})`);
  if (notifyChannelId) {
    console.log(`알림 채널: ${notifyChannelId} (신규 문구 알림 + 매주 월요일 리포트)`);
  }
})();
