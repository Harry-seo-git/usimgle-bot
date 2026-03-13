/**
 * JSON → Google Sheets 마이그레이션 스크립트
 *
 * 사용법: node migrate-to-sheets.js
 *
 * .env의 GOOGLE_API_URL이 설정되어 있어야 합니다.
 * Google Sheets 첫 행에 헤더가 필요합니다:
 *   id | category | situation | text | tone | component | registeredBy | createdAt
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SHEET_URL = process.env.GOOGLE_API_URL;
if (!SHEET_URL) {
  console.error('❌ GOOGLE_API_URL이 .env에 설정되어 있지 않습니다.');
  process.exit(1);
}

const guide = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'ux-writing-guide.json'), 'utf-8')
);

// 모든 엔트리를 플랫 배열로 변환
const allEntries = [];
for (const [categoryKey, category] of Object.entries(guide.categories)) {
  for (const entry of category.entries) {
    allEntries.push({
      id: entry.id,
      category: categoryKey,
      situation: entry.situation,
      text: entry.text,
      tone: entry.tone || '',
      component: entry.component || '',
      registeredBy: 'migration',
      createdAt: new Date().toISOString(),
    });
  }
}

console.log(`📦 총 ${allEntries.length}개 항목을 Google Sheets로 마이그레이션합니다...\n`);

// 순차적으로 전송 (Google Apps Script 부하 방지)
async function migrate() {
  let success = 0;
  let fail = 0;

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    try {
      await axios.post(SHEET_URL, entry, { timeout: 10000 });
      success++;
      process.stdout.write(`\r✅ ${success}/${allEntries.length} 완료`);
      // 요청 간 딜레이 (Apps Script 제한 방지)
      if (i < allEntries.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      fail++;
      console.log(`\n❌ 실패: ${entry.id} - ${err.message}`);
      // 실패 시 재시도 1회
      try {
        await new Promise((r) => setTimeout(r, 1000));
        await axios.post(SHEET_URL, entry, { timeout: 10000 });
        success++;
        fail--;
        console.log(`  ↪ 재시도 성공: ${entry.id}`);
      } catch {
        console.log(`  ↪ 재시도도 실패: ${entry.id}`);
      }
    }
  }

  console.log(`\n\n🎉 마이그레이션 완료!`);
  console.log(`   성공: ${success}개`);
  if (fail > 0) console.log(`   실패: ${fail}개`);

  // 검증: GET으로 확인
  try {
    const res = await axios.get(SHEET_URL, { timeout: 10000 });
    console.log(`   시트 현재 행 수: ${Array.isArray(res.data) ? res.data.length : 'N/A'}`);
  } catch {
    console.log('   (시트 행 수 확인 실패 - 수동으로 확인해 주세요)');
  }
}

migrate().catch((err) => {
  console.error('마이그레이션 에러:', err.message);
  process.exit(1);
});
