/**
 * 데이터 로드/저장 모듈
 * - 비동기 파일 I/O
 * - 쓰기 큐로 레이스 컨디션 방지
 */

const fs = require('fs');
const path = require('path');

const guidePath = path.join(__dirname, '..', 'data', 'ux-writing-guide.json');

// 초기 로드 (서버 시작 시 1회, 동기 OK)
const guide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));

// --- 쓰기 큐: 동시 쓰기 레이스 컨디션 방지 ---
let writeQueue = Promise.resolve();

function saveGuide() {
  writeQueue = writeQueue
    .then(() => fs.promises.writeFile(guidePath, JSON.stringify(guide, null, 2), 'utf-8'))
    .catch((err) => {
      console.error('JSON 저장 실패:', err.message);
      throw err;
    });
  return writeQueue;
}

// --- 유틸: 모든 엔트리 플랫 배열 ---
function getAllEntries() {
  const entries = [];
  for (const [catKey, cat] of Object.entries(guide.categories)) {
    for (const entry of cat.entries) {
      entries.push({ ...entry, category: cat.label, categoryKey: catKey });
    }
  }
  return entries;
}

// --- 유틸: ID로 엔트리 찾기 ---
function findEntryById(id) {
  for (const [key, cat] of Object.entries(guide.categories)) {
    const idx = cat.entries.findIndex((e) => e.id === id);
    if (idx !== -1) {
      return { entry: cat.entries[idx], catKey: key, index: idx };
    }
  }
  return null;
}

// --- 유틸: 검색 ---
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

module.exports = {
  guide,
  guidePath,
  saveGuide,
  getAllEntries,
  findEntryById,
  searchGuide,
  getCategory,
};
