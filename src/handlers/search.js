/**
 * 핸들러: 검색, 카테고리 조회
 */

const { searchGuide, getCategory, guide } = require('../data');
const { formatEntry } = require('../utils');
const { sheetEnabled, getRows } = require('../sheets');

// 블록 최대 개수 (Slack 제한 50개, 여유 두고 45)
const MAX_BLOCKS = 45;

async function handleSearch(keyword, respond) {
  if (!keyword) {
    return respond({ response_type: 'ephemeral', text: '검색할 키워드를 입력해 주세요.\n예: `/uxr 검색 결제`' });
  }

  const results = searchGuide(keyword);

  let sheetResults = [];
  if (sheetEnabled) {
    try {
      sheetResults = await getRows(keyword);
    } catch (err) {
      console.warn('시트 검색 실패:', err.message);
    }
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

  // 페이지네이션: Slack 블록 제한 대응
  const pageSize = Math.min(cat.entries.length, MAX_BLOCKS - 2);
  for (const entry of cat.entries.slice(0, pageSize)) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: formatEntry(entry) },
    });
  }

  if (cat.entries.length > pageSize) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `외 ${cat.entries.length - pageSize}건 — \`/uxr 검색\`으로 개별 조회해 주세요.` }],
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

module.exports = { handleSearch, handleCategory };
