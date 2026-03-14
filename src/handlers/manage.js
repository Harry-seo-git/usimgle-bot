/**
 * 핸들러: 등록, 수정, 삭제
 * - 입력 검증 추가
 * - 삭제 시 확인 버튼
 * - ID 생성 로직 개선
 */

const { guide, saveGuide, findEntryById } = require('../data');
const { validateTone, validateComponent, validateField, VALID_TONES, VALID_COMPONENTS, VALID_FIELDS } = require('../utils');
const { sheetEnabled, addRow, updateRow, deleteRow } = require('../sheets');

// --- 카테고리 키 → prefix 매핑 ---
const CATEGORY_PREFIX_MAP = {
  onboarding: 'onb',
  browse: 'brw',
  order: 'ord',
  shipping: 'shp',
  activation: 'act',
  usage: 'usg',
  support: 'sup',
  account: 'acc',
  notification: 'ntf',
  error: 'err',
  empty: 'emp',
  loading: 'lod',
  settings: 'set',
  review: 'rev',
  promotion: 'prm',
};

function getCategoryPrefix(catKey) {
  // 먼저 매핑에서 찾기
  if (CATEGORY_PREFIX_MAP[catKey]) return CATEGORY_PREFIX_MAP[catKey];
  // 영문 키의 앞 3글자
  if (/^[a-z]/i.test(catKey)) return catKey.substring(0, 3).toLowerCase();
  // 한글 등 fallback: 'ux' + 순번
  return 'uxw';
}

async function handleAdd(text, respond, userId, sendNotification) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '등록 형식: `/uxr 등록 카테고리|상황설명|문구|톤|컴포넌트`\n예: `/uxr 등록 주문|결제 완료 시|주문이 완료됐어요!|축하|토스트`\n\n' +
        `*사용 가능한 톤:* ${VALID_TONES.join(', ')}\n*사용 가능한 컴포넌트:* ${VALID_COMPONENTS.join(', ')}`,
    });
  }

  const parts = text.split('|').map((t) => t.trim());
  if (parts.length < 3) {
    return respond({
      response_type: 'ephemeral',
      text: '최소 카테고리, 상황설명, 문구를 `|`로 구분해서 입력해 주세요.\n예: `/uxr 등록 주문|결제 완료 시|주문이 완료됐어요!|축하|토스트`',
    });
  }

  const [category, situation, uxText, tone = '안내', component = '미정'] = parts;

  // 톤 검증
  if (!validateTone(tone)) {
    return respond({
      response_type: 'ephemeral',
      text: `"${tone}"은(는) 유효하지 않은 톤이에요.\n*사용 가능한 톤:* ${VALID_TONES.join(', ')}`,
    });
  }

  // 컴포넌트 검증
  if (!validateComponent(component)) {
    return respond({
      response_type: 'ephemeral',
      text: `"${component}"은(는) 유효하지 않은 컴포넌트예요.\n*사용 가능한 컴포넌트:* ${VALID_COMPONENTS.join(', ')}`,
    });
  }

  // 문구 길이 검증
  if (uxText.length > 200) {
    return respond({
      response_type: 'ephemeral',
      text: '문구가 너무 길어요. 200자 이내로 입력해 주세요.',
    });
  }

  // 카테고리 키 찾기
  const catKey = Object.keys(guide.categories).find(
    (k) => guide.categories[k].label === category || k === category
  ) || category;

  // ID 자동 생성 (개선된 prefix 로직)
  const catData = guide.categories[catKey];
  const prefix = getCategoryPrefix(catKey);
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
    id: newId, situation, text: uxText, tone, component,
    history: [{ action: '등록', date: now, by: userId || 'slack', detail: '최초 등록' }],
  };

  // 1) JSON에 저장
  if (!guide.categories[catKey]) {
    guide.categories[catKey] = { label: category, entries: [] };
  }
  guide.categories[catKey].entries.push(newEntry);
  try {
    await saveGuide();
  } catch (err) {
    return respond({ response_type: 'ephemeral', text: `JSON 저장 오류: ${err.message}` });
  }

  // 2) 구글시트에 저장
  if (sheetEnabled) {
    try {
      await addRow({ id: newId, category: catKey, situation, text: uxText, tone, component, registeredBy: 'slack', createdAt: now });
    } catch (err) {
      console.warn('시트 저장 실패:', err.message);
    }
  }

  // 알림
  sendNotification([
    { type: 'header', text: { type: 'plain_text', text: '새 UX 문구가 등록됐어요!' } },
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
    { type: 'section', text: { type: 'mrkdwn', text: `*문구:* "${uxText}"` } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `등록자: <@${userId || 'unknown'}> | ${new Date().toLocaleDateString('ko-KR')}` }],
    },
  ]);

  return respond({
    response_type: 'in_channel',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'UX 문구 등록 완료' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*ID:* \`${newId}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${category}` },
          { type: 'mrkdwn', text: `*톤:* ${tone}` },
          { type: 'mrkdwn', text: `*컴포넌트:* ${component}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*상황:* ${situation}\n*문구:* ${uxText}` } },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sheetEnabled ? 'JSON + Google Sheets 양쪽 저장 완료' : 'JSON 저장 완료 (시트 미연동)' }],
      },
    ],
  });
}

async function handleEdit(text, respond, userId, sendNotification) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '수정 형식: `/uxr 수정 ID|필드|새값`\n\n*수정 가능 필드:* ' + VALID_FIELDS.join(', ') +
        '\n\n예시:\n`/uxr 수정 ord-001|text|주문이 완료됐어요!`\n`/uxr 수정 onb-003|tone|축하`',
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

  if (!validateField(field)) {
    return respond({
      response_type: 'ephemeral',
      text: `수정 가능한 필드: ${VALID_FIELDS.join(', ')}\n입력한 필드: "${field}"`,
    });
  }

  // 톤/컴포넌트 필드 수정 시 값 검증
  if (field === 'tone' && !validateTone(newValue)) {
    return respond({
      response_type: 'ephemeral',
      text: `"${newValue}"은(는) 유효하지 않은 톤이에요.\n*사용 가능한 톤:* ${VALID_TONES.join(', ')}`,
    });
  }
  if (field === 'component' && !validateComponent(newValue)) {
    return respond({
      response_type: 'ephemeral',
      text: `"${newValue}"은(는) 유효하지 않은 컴포넌트예요.\n*사용 가능한 컴포넌트:* ${VALID_COMPONENTS.join(', ')}`,
    });
  }

  // 텍스트 길이 검증
  if (field === 'text' && newValue.length > 200) {
    return respond({ response_type: 'ephemeral', text: '문구가 너무 길어요. 200자 이내로 입력해 주세요.' });
  }

  const result = findEntryById(id);
  if (!result) {
    return respond({
      response_type: 'ephemeral',
      text: `ID "${id}"를 찾을 수 없어요. \`/uxr 검색\`으로 ID를 확인해 주세요.`,
    });
  }

  const { entry: found, catKey } = result;
  const oldValue = found[field] || '(없음)';
  found[field] = newValue;

  if (!found.history) found.history = [];
  found.history.push({
    action: '수정',
    date: new Date().toISOString(),
    by: userId || 'slack',
    field,
    from: oldValue,
    to: newValue,
  });

  try {
    await saveGuide();
  } catch (err) {
    return respond({ response_type: 'ephemeral', text: `JSON 저장 오류: ${err.message}` });
  }

  if (sheetEnabled) {
    try {
      await updateRow({ id, field, value: newValue });
    } catch (err) {
      console.warn('시트 수정 실패:', err.message);
    }
  }

  sendNotification([
    { type: 'header', text: { type: 'plain_text', text: 'UX 문구가 수정됐어요!' } },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
        { type: 'mrkdwn', text: `*카테고리:* ${catKey}` },
        { type: 'mrkdwn', text: `*수정 필드:* ${field}` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*이전:* ~${oldValue}~\n*변경:* "${newValue}"` } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `수정자: <@${userId || 'unknown'}> | ${new Date().toLocaleDateString('ko-KR')}` }],
    },
  ]);

  return respond({
    response_type: 'in_channel',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'UX 문구 수정 완료' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${catKey}` },
          { type: 'mrkdwn', text: `*필드:* ${field}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*이전:* ${oldValue}\n*변경:* ${newValue}` } },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: sheetEnabled ? 'JSON + Google Sheets 양쪽 수정 완료' : 'JSON 수정 완료 (시트 미연동)' }],
      },
    ],
  });
}

// 삭제 확인 버튼 표시
async function handleDelete(text, respond, userId) {
  if (!text) {
    return respond({
      response_type: 'ephemeral',
      text: '삭제할 문구 ID를 입력해 주세요.\n예: `/uxr 삭제 ord-005`',
    });
  }

  const id = text.trim();
  const result = findEntryById(id);
  if (!result) {
    return respond({
      response_type: 'ephemeral',
      text: `ID "${id}"를 찾을 수 없어요. \`/uxr 검색\`으로 ID를 확인해 주세요.`,
    });
  }

  const { entry: found, catKey } = result;

  // 삭제 전 확인 버튼 표시
  return respond({
    response_type: 'ephemeral',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '문구 삭제 확인' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${guide.categories[catKey].label}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*문구:* "${found.text}"\n_톤: ${found.tone} | 컴포넌트: ${found.component}_` } },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '정말 삭제할까요? 삭제 후에는 복구할 수 없어요.' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '삭제 확인' },
            style: 'danger',
            action_id: 'confirm_delete',
            value: JSON.stringify({ id, userId }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '취소' },
            action_id: 'cancel_delete',
          },
        ],
      },
    ],
  });
}

// 실제 삭제 실행 (확인 버튼 클릭 후)
async function executeDelete(id, userId, sendNotification) {
  const result = findEntryById(id);
  if (!result) return { success: false, message: `ID "${id}"를 찾을 수 없어요.` };

  const { entry: found, catKey, index: entryIndex } = result;
  const deletedText = found.text;
  const deletedCategory = guide.categories[catKey].label;

  guide.categories[catKey].entries.splice(entryIndex, 1);

  try {
    await saveGuide();
  } catch (err) {
    return { success: false, message: `JSON 저장 오류: ${err.message}` };
  }

  if (sheetEnabled) {
    try {
      await deleteRow(id);
    } catch (err) {
      console.warn('시트 삭제 실패:', err.message);
    }
  }

  sendNotification([
    { type: 'header', text: { type: 'plain_text', text: 'UX 문구가 삭제됐어요' } },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
        { type: 'mrkdwn', text: `*카테고리:* ${deletedCategory}` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*삭제된 문구:* ~${deletedText}~` } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `삭제자: <@${userId || 'unknown'}> | ${new Date().toLocaleDateString('ko-KR')}` }],
    },
  ]);

  return {
    success: true,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'UX 문구 삭제 완료' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*ID:* \`${id}\`` },
          { type: 'mrkdwn', text: `*카테고리:* ${deletedCategory}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*삭제된 문구:* ~${deletedText}~` } },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `${found.tone} | ${found.component} — 복구가 필요하면 \`/uxr 등록\`으로 다시 추가해 주세요.` }],
      },
    ],
  };
}

module.exports = { handleAdd, handleEdit, handleDelete, executeDelete };
