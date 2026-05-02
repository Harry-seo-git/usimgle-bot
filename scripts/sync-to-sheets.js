/**
 * Google Sheets 전체 동기화 스크립트
 *
 * JSON 데이터를 Google Sheets에 전체 동기화합니다.
 * 기존 시트 데이터를 모두 지우고 새로 삽입합니다.
 *
 * 사용법: node scripts/sync-to-sheets.js
 */

require('dotenv').config();
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const GOOGLE_API_URL = process.env.GOOGLE_API_URL;

if (!GOOGLE_API_URL) {
  console.error('GOOGLE_API_URL 환경변수가 설정되지 않았어요.');
  console.error('.env 파일에 GOOGLE_API_URL을 추가해 주세요.');
  process.exit(1);
}

const guidePath = path.join(__dirname, '..', 'data', 'ux-writing-guide.json');
const guide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));

function getAllEntries() {
  const entries = [];
  for (const [catKey, cat] of Object.entries(guide.categories)) {
    for (const entry of cat.entries) {
      entries.push({
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
  return entries;
}

async function syncToSheets() {
  const entries = getAllEntries();
  console.log(`총 ${entries.length}건의 문구를 Google Sheets에 동기화합니다.\n`);

  // 1단계: 전체 초기화 요청
  console.log('[1/2] 기존 시트 데이터 초기화 중...');
  try {
    await axios.post(GOOGLE_API_URL, { _action: 'clear_all' });
    console.log('  초기화 완료\n');
  } catch (err) {
    console.warn(`  초기화 실패 (${err.message}) — 개별 삽입으로 진행합니다.\n`);
  }

  // 2단계: 전체 데이터 벌크 삽입 시도
  console.log('[2/2] 데이터 삽입 중...');
  try {
    // 벌크 삽입 시도
    await axios.post(GOOGLE_API_URL, {
      _action: 'bulk_insert',
      entries,
      meta: {
        version: guide.meta.version,
        lastUpdated: guide.meta.lastUpdated,
        totalCount: entries.length,
      },
    });
    console.log(`  벌크 삽입 완료 (${entries.length}건)\n`);
  } catch (bulkErr) {
    // 벌크 실패 시 개별 삽입
    console.warn(`  벌크 삽입 실패 (${bulkErr.message}) — 개별 삽입으로 전환합니다.\n`);

    let success = 0;
    let fail = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      try {
        await axios.post(GOOGLE_API_URL, entry);
        success++;
        // 진행률 표시 (10건마다)
        if ((i + 1) % 10 === 0 || i === entries.length - 1) {
          process.stdout.write(`  ${i + 1}/${entries.length} 처리 중... (성공: ${success}, 실패: ${fail})\r`);
        }
        // API 레이트 리밋 방지 (100ms 간격)
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        fail++;
        console.error(`\n  [실패] ${entry.id}: ${err.message}`);
      }
    }

    console.log(`\n\n  개별 삽입 완료 — 성공: ${success}건, 실패: ${fail}건`);
  }

  // 요약
  const catStats = Object.entries(guide.categories)
    .map(([, cat]) => `${cat.label}: ${cat.entries.length}건`)
    .join(', ');
  console.log(`\n동기화 완료!`);
  console.log(`  버전: ${guide.meta.version}`);
  console.log(`  총 문구: ${entries.length}건`);
  console.log(`  카테고리별: ${catStats}`);
}

syncToSheets().catch((err) => {
  console.error('동기화 오류:', err.message);
  process.exit(1);
});
