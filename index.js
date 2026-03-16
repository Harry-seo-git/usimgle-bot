/**
 * 유심사 UX 라이팅 봇 v3.0.0
 *
 * 개선 사항:
 * - 멀티 파일 구조 리팩토링
 * - 보안: 프롬프트 인젝션 방지, 입력 검증, API 키 보호
 * - 안정성: optional chaining, 비동기 I/O, 쓰기 큐, 에러 로깅
 * - 기능: ID 생성 개선, 삭제 확인 절차, 카테고리 페이지네이션
 * - 기타: 헬스체크 엔드포인트, graceful shutdown
 */

const { App, ExpressReceiver } = require('@slack/bolt');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

// --- 모듈 임포트 ---
const { guide, searchGuide } = require('./src/data');
const { askAI, buildSystemPrompt, sanitizeInput } = require('./src/ai');
const { sheetEnabled, addRow } = require('./src/sheets');

// 핸들러
const { handleSearch, handleCategory } = require('./src/handlers/search');
const { handleSuggest, handleFeedback, handleCompare, handleTranslate } = require('./src/handlers/ai-features');
const { handleAdd, handleEdit, handleDelete, executeDelete } = require('./src/handlers/manage');
const { handleCheck, handleBulkCheck, handleDuplicate } = require('./src/handlers/check');
const {
  handleTone, handlePrinciples, handleGlossary, handleHistory,
  handleExport, handleRandom, handleStats, handleHelp,
} = require('./src/handlers/info');

// --- Slack 앱 초기화 ---
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// --- 헬스체크 엔드포인트 ---
receiver.router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// --- 알림 채널 설정 ---
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
        await handleAdd(args, respond, command.user_id, sendNotification);
        break;
      case '수정':
      case 'edit':
        await handleEdit(args, respond, command.user_id, sendNotification);
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
        await handleHelp(respond, notifyChannelId);
        break;
      default:
        await handleSearch(rawText, respond);
        break;
    }
  } catch (err) {
    console.error('Command error:', err);
    await respond({
      response_type: 'ephemeral',
      text: '오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
    });
  }
});

// --- 인터랙티브 버튼: 채택 ---
app.action('adopt_suggest', async ({ action, ack, respond, body }) => {
  await ack();
  const { situation, response } = JSON.parse(action.value);
  const user = body.user.name || body.user.id;

  if (sheetEnabled) {
    try {
      await addRow({ category: '추천채택', text: response.substring(0, 200), tone: '추천', notes: `${user}: ${situation}` });
    } catch (err) {
      console.warn('채택 시트 저장 실패:', err.message);
    }
  }

  await respond({
    response_type: 'in_channel',
    replace_original: false,
    text: `*${user}* 님이 위 추천 문구를 채택했어요! ${sheetEnabled ? '구글시트에 저장됐어요.' : ''}`,
  });
});

// --- 인터랙티브 버튼: 수정요청 ---
app.action('revise_suggest', async ({ action, ack, respond }) => {
  await ack();
  const { situation } = JSON.parse(action.value);

  await respond({ response_type: 'ephemeral', text: '수정된 추천 문구를 생성하고 있어요... 잠시만 기다려 주세요.' });

  const userMessage = `아래 상황에 대해 이전과 다른 방향으로 UX 문구 3개를 새롭게 제안해줘.
더 간결하거나, 다른 톤으로, 또는 다른 관점에서 접근해봐.
각 문구마다 톤, 컴포넌트, 이유를 알려줘.
상황: "${sanitizeInput(situation)}"`;

  const aiResponse = await askAI(buildSystemPrompt(), userMessage);
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

// --- 인터랙티브 버튼: 삭제 확인 ---
app.action('confirm_delete', async ({ action, ack, respond }) => {
  await ack();
  const { id, userId } = JSON.parse(action.value);

  const result = await executeDelete(id, userId, sendNotification);
  if (!result.success) {
    return respond({ response_type: 'ephemeral', text: result.message, replace_original: true });
  }

  return respond({ response_type: 'in_channel', blocks: result.blocks, replace_original: true });
});

// --- 인터랙티브 버튼: 삭제 취소 ---
app.action('cancel_delete', async ({ ack, respond }) => {
  await ack();
  return respond({ response_type: 'ephemeral', text: '삭제가 취소됐어요.', replace_original: true });
});

// --- 앱 멘션 / DM 공통 핸들러 ---
async function handleNaturalLanguage(text, say) {
  if (!text) {
    return say('안녕하세요! UX 라이팅에 대해 물어보세요. 예: "결제 실패 시 메시지 추천해줘"');
  }

  await say('답변을 준비하고 있어요... 잠시만 기다려 주세요.');

  const keywords = text.split(/\s+/).filter((w) => w.length > 1);
  const allResults = [];
  for (const kw of keywords) {
    allResults.push(...searchGuide(kw));
  }
  const unique = [...new Map(allResults.map((e) => [e.id, e])).values()].slice(0, 5);

  const context = unique.length
    ? `\n\n[관련 기존 문구]\n${unique.map((e) => `- ${e.id} / ${e.situation}: "${e.text}" (톤: ${e.tone}, 컴포넌트: ${e.component})`).join('\n')}`
    : '';

  const systemPrompt = buildSystemPrompt() + context;
  const userMessage = `${sanitizeInput(text)}

위 질문에 대해 유심사 UX 라이팅 가이드를 참고하여 답변해줘.
기존 문구가 있으면 해당 문구를 안내하고, 없으면 가이드라인에 맞는 새 문구를 제안해.
답변은 한국어로, 슬랙에서 읽기 편한 형태로 작성해.`;

  const aiResponse = await askAI(systemPrompt, userMessage);
  if (!aiResponse) {
    return say('AI 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: aiResponse } },
  ];

  if (unique.length) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `참고 문구: ${unique.map((e) => `\`${e.id}\``).join(' ')}` }],
    });
  }

  return say({ blocks });
}

// --- 앱 멘션 ---
app.event('app_mention', async ({ event, say }) => {
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
  return handleNaturalLanguage(text, say);
});

// --- DM 메시지 ---
app.event('message', async ({ event, say }) => {
  if (event.channel_type !== 'im' || event.bot_id) return;
  const text = (event.text || '').trim();
  if (!text) return;
  return handleNaturalLanguage(text, say);
});

// --- 주간 리포트 ---
function getWeeklyReport() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const catStats = {};
  const toneCount = {};
  const newEntries = [];
  const editedEntries = [];
  let totalCount = 0;

  for (const [catKey, cat] of Object.entries(guide.categories)) {
    catStats[catKey] = { label: cat.label, count: cat.entries.length };
    totalCount += cat.entries.length;

    for (const entry of cat.entries) {
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

  const catCount = Object.keys(catStats).length;
  const toneSorted = Object.entries(toneCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const toneBar = toneSorted.map(([t, c]) => `${t}: ${c}건`).join(' \u00b7 ');
  const catSorted = Object.entries(catStats).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  const catBar = catSorted.map(([, c]) => `${c.label}: ${c.count}건`).join(' \u00b7 ');

  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const periodStr = `${fmt(weekAgo)} ~ ${fmt(now)}`;

  return { totalCount, catCount, toneBar, catBar, newEntries, editedEntries, periodStr };
}

async function sendWeeklyReport() {
  if (!notifyChannelId) return;

  const r = getWeeklyReport();
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `주간 UX Writing 리포트 (${r.periodStr})` } },
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

  if (r.newEntries.length > 0) {
    blocks.push({ type: 'divider' });
    const newList = r.newEntries.slice(0, 10).map((e) =>
      `\u2022 \`${e.id}\` [${e.category}] ${e.text} _(${e.tone})_`
    ).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*신규 등록*\n${newList}` } });
  }

  if (r.editedEntries.length > 0) {
    blocks.push({ type: 'divider' });
    const editList = r.editedEntries.slice(0, 10).map((e) =>
      `\u2022 \`${e.id}\` [${e.category}] ${e.field}: ~${e.from}~ \u2192 "${e.to}"`
    ).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*수정 내역*\n${editList}` } });
  }

  if (r.newEntries.length === 0 && r.editedEntries.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '이번 주는 등록/수정된 문구가 없어요.' } });
  }

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

// 매주 월요일 오전 9시 (KST)
cron.schedule('0 9 * * 1', () => {
  console.log('주간 UX 리포트 생성 시작...');
  sendWeeklyReport();
}, { timezone: 'Asia/Seoul' });

// --- 서버 실행 ---
const port = process.env.PORT || 3000;
(async () => {
  await app.start(port);
  console.log(`유심사 UX 라이팅 봇 v3.0 실행 중 (포트 ${port})`);
  if (notifyChannelId) {
    console.log(`알림 채널: ${notifyChannelId}`);
  }
})();

// --- Render Free 슬립 방지: 14분마다 self-ping ---
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(() => {
    axios.get(`${RENDER_URL}/health`).catch(() => {});
  }, 14 * 60 * 1000);
  console.log('Self-ping 활성화 (14분 간격)');
}

// --- Graceful Shutdown ---
function gracefulShutdown(signal) {
  console.log(`${signal} 수신, 서버 종료 중...`);
  app.stop().then(() => {
    console.log('서버가 정상 종료됐어요.');
    process.exit(0);
  }).catch((err) => {
    console.error('서버 종료 오류:', err.message);
    process.exit(1);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
