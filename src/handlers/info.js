/**
 * 핸들러: 톤, 원칙, 용어, 히스토리, 내보내기, 랜덤, 통계, 도움말
 */

const { guide, getAllEntries, findEntryById } = require('../data');
const { formatEntryCompact } = require('../utils');
const glossary = require('../glossary');
const { sheetEnabled } = require('../sheets');

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

  const examples = [];
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      if (entry.tone === name) examples.push({ ...entry, category: cat.label });
    }
  }

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `톤 가이드: ${name}` } },
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
      { type: 'header', text: { type: 'plain_text', text: '유심사 UX 라이팅 원칙' } },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*브랜드 보이스:* ${guide.principles.voiceTone.brand}\n\n${voiceRules}` },
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: rules.join('\n\n') } },
    ],
  });
}

async function handleGlossary(text, respond) {
  if (!text) {
    const termList = Object.entries(glossary)
      .map(([, info]) => `*${info.official}* — ${info.desc}`)
      .join('\n');

    return respond({
      response_type: 'ephemeral',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `유심사 브랜드 용어집 (${Object.keys(glossary).length}개)` } },
        { type: 'section', text: { type: 'mrkdwn', text: termList } },
        { type: 'divider' },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '특정 용어 조회: `/uxr 용어 eSIM`' }] },
      ],
    });
  }

  const query = text.trim();
  let matchKey = null;

  for (const [key, info] of Object.entries(glossary)) {
    if (key.toLowerCase() === query.toLowerCase() || info.official.toLowerCase() === query.toLowerCase()) {
      matchKey = key;
      break;
    }
  }

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

  const examples = [];
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      if (entry.text.includes(info.official) || info.wrong.some((w) => entry.text.includes(w))) {
        examples.push({ ...entry, category: cat.label });
      }
    }
  }

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `용어: ${info.official}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*설명:* ${info.desc}` } },
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
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*사용 예시 (${examples.length}건)*\n${list}` } });
  }

  if (info.wrong.some((w) => w.toLowerCase() === query.toLowerCase())) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `"${query}"는 잘못된 표기예요. *${info.official}*로 사용해 주세요.` }],
    });
  }

  return respond({ response_type: 'in_channel', blocks });
}

async function handleHistory(text, respond) {
  if (!text) {
    return respond({ response_type: 'ephemeral', text: '사용법: `/uxr 히스토리 [ID]`\n예: `/uxr 히스토리 ord-001`' });
  }

  const id = text.trim();
  const result = findEntryById(id);
  if (!result) {
    return respond({ response_type: 'ephemeral', text: `ID "${id}"를 찾을 수 없어요. \`/uxr 검색\`으로 ID를 확인해 주세요.` });
  }

  const { entry: found, catKey } = result;
  const history = found.history || [];
  if (history.length === 0) {
    return respond({ response_type: 'ephemeral', text: `\`${id}\` 의 변경 이력이 없습니다.` });
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
      { type: 'header', text: { type: 'plain_text', text: `${id} 변경 히스토리` } },
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
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n\n') } },
    ],
  });
}

async function handleExport(format, respond) {
  const allEntries = getAllEntries().map((e) => ({
    id: e.id,
    category: e.category,
    categoryKey: e.categoryKey,
    situation: e.situation,
    text: e.text,
    tone: e.tone,
    component: e.component,
  }));

  const fmt = (format || '').trim().toLowerCase();

  if (fmt === 'json') {
    const jsonStr = JSON.stringify(allEntries, null, 2);
    const preview = jsonStr.substring(0, 2800);

    return respond({
      response_type: 'ephemeral',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `UX 문구 내보내기 — JSON (${allEntries.length}건)` } },
        { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${preview}${jsonStr.length > 2800 ? '\n... (이하 생략)' : ''}\`\`\`` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '전체 데이터는 서버의 `data/ux-writing-guide.json` 파일에서 확인할 수 있어요.' }] },
      ],
    });
  }

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
      { type: 'header', text: { type: 'plain_text', text: `UX 문구 내보내기 — CSV (${allEntries.length}건)` } },
      { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${preview}${remainCount > 0 ? `\n... (외 ${remainCount}건)` : ''}\`\`\`` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*전체 CSV를 복사하려면* 아래 코드 블록을 펼쳐주세요:' } },
      { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${csv.substring(0, 2900)}${csv.length > 2900 ? '\n... (슬랙 글자 제한으로 잘림 — 서버 파일에서 전체 확인)' : ''}\`\`\`` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: '형식 옵션: `/uxr 내보내기` (CSV) 또는 `/uxr 내보내기 json` (JSON)' }] },
    ],
  });
}

async function handleRandom(respond) {
  const allEntries = getAllEntries();
  const entry = allEntries[Math.floor(Math.random() * allEntries.length)];

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
      { type: 'header', text: { type: 'plain_text', text: '오늘의 UX 라이팅 팁' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*TIP:* ${tip}` } },
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

async function handleStats(respond) {
  const catStats = Object.entries(guide.categories).map(([key, cat]) => ({
    key,
    label: cat.label,
    count: cat.entries.length,
  }));
  const totalEntries = catStats.reduce((sum, c) => sum + c.count, 0);

  const toneCount = {};
  const compCount = {};
  for (const cat of Object.values(guide.categories)) {
    for (const entry of cat.entries) {
      toneCount[entry.tone] = (toneCount[entry.tone] || 0) + 1;
      compCount[entry.component] = (compCount[entry.component] || 0) + 1;
    }
  }
  const toneSorted = Object.entries(toneCount).sort((a, b) => b[1] - a[1]);
  const compSorted = Object.entries(compCount).sort((a, b) => b[1] - a[1]);

  const maxCount = Math.max(...catStats.map((c) => c.count));
  const catBars = catStats
    .map((c) => {
      const bar = '\u2588'.repeat(Math.round((c.count / maxCount) * 10));
      return `${c.label} ${bar} ${c.count}건`;
    })
    .join('\n');

  const toneList = toneSorted.map(([tone, count]) => `${tone}: ${count}건`).join(' \u00b7 ');
  const compList = compSorted.slice(0, 8).map(([comp, count]) => `${comp}: ${count}건`).join(' \u00b7 ');

  return respond({
    response_type: 'in_channel',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `UX 라이팅 가이드 통계 (총 ${totalEntries}건)` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*카테고리별 분포*\n\`\`\`\n${catBars}\n\`\`\`` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*톤 분포*\n${toneList}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*컴포넌트 분포 (상위 8개)*\n${compList}` } },
      { type: 'divider' },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `카테고리 ${catStats.length}개 \u00b7 톤 ${toneSorted.length}종 \u00b7 컴포넌트 ${compSorted.length}종` }],
      },
    ],
  });
}

async function handleHelp(respond, notifyChannelId) {
  let totalEntries = 0;
  for (const cat of Object.values(guide.categories)) {
    totalEntries += cat.entries.length;
  }
  const catCount = Object.keys(guide.categories).length;

  return respond({
    response_type: 'ephemeral',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'UX Writing Bot' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `유심사 UX 라이팅 가이드 봇이에요.\n현재 *${catCount}개 카테고리*, *${totalEntries}건의 문구*가 등록되어 있어요.`,
        },
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*:mag: 검색 & 조회*' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 검색 [키워드]` — 키워드로 문구 검색\n_예: `/uxr 검색 결제`  `/uxr 검색 eSIM`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 카테고리 [이름]` — 카테고리별 문구 조회\n_예: `/uxr 카테고리 주문`  `/uxr 카테고리` (전체 목록)_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 톤 [톤이름]` — 톤 가이드 조회\n_예: `/uxr 톤 친근`  `/uxr 톤 사과`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 원칙` — 라이팅 원칙 전체 조회' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 통계` — 카테고리/톤/컴포넌트 현황 대시보드' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 랜덤` — 오늘의 UX 라이팅 팁 + 랜덤 문구' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 용어 [용어]` — 브랜드 용어집 조회\n_예: `/uxr 용어 eSIM`  `/uxr 용어` (전체 목록)_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 히스토리 [ID]` — 문구 변경 이력 조회\n_예: `/uxr 히스토리 ord-001`_' } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*:sparkles: AI 기능*' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 추천 [상황설명]` — AI가 상황에 맞는 문구 3개 제안\n_예: `/uxr 추천 사용자가 잘못된 이메일을 입력했을 때`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 피드백 [문구]` — 기존 문구의 개선점 분석\n_예: `/uxr 피드백 오류가 발생했습니다`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 비교 [문구A] vs [문구B]` — 두 문구 비교 분석\n_예: `/uxr 비교 결제가 처리되었습니다 vs 결제를 완료했어요`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 번역 [문구 또는 ID]` — 다국어 번역 (en/ja/zh/es/fr)\n_예: `/uxr 번역 ord-004`  `/uxr 번역 en 결제가 완료됐어요`_' } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*:white_check_mark: 검사*' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 검사 [문구]` — 가이드라인 일관성 검사 + AI 점수\n_예: `/uxr 검사 결제 오류가 발생하였습니다. 다시 시도하십시오.`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 벌크검사 [문구1/문구2/...]` — 여러 문구 한번에 검사\n_예: `/uxr 벌크검사 결제 실패입니다/로그인 해주십시오/배송 완료됐어요`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 중복검사 [문구]` — 등록 전 유사 문구 탐지\n_예: `/uxr 중복검사 결제가 완료됐어요`_' } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*:pencil2: 문구 관리*' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 등록 [카테고리|상황|문구|톤|컴포넌트]` — 새 문구 등록\n_예: `/uxr 등록 주문|결제 완료 시|주문이 완료됐어요!|축하|토스트`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 수정 [ID|필드|새값]` — 기존 문구 수정\n_예: `/uxr 수정 ord-001|text|결제가 완료됐어요!`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 삭제 [ID]` — 문구 삭제 (확인 절차 포함)\n_예: `/uxr 삭제 ord-005`_' } },
      { type: 'section', text: { type: 'mrkdwn', text: '`/uxr 내보내기 [json]` — 전체 문구 CSV/JSON 내보내기\n_예: `/uxr 내보내기`  `/uxr 내보내기 json`_' } },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: [
              `*카테고리:* ${Object.values(guide.categories).map((c) => c.label).join(' \u00b7 ')}`,
              notifyChannelId ? `*알림:* <#${notifyChannelId}> (등록/수정/삭제 알림 + 매주 월요일 주간 리포트)` : '',
              '*TIP:* `/uxr [키워드]`만 입력해도 바로 검색돼요!',
            ].filter(Boolean).join('\n'),
          },
        ],
      },
    ],
  });
}

module.exports = {
  handleTone,
  handlePrinciples,
  handleGlossary,
  handleHistory,
  handleExport,
  handleRandom,
  handleStats,
  handleHelp,
};
