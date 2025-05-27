// ✅ index.js
const { ExpressReceiver } = require('@slack/bolt');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// 1) ExpressReceiver 초기화 (Signing Secret으로 검증)
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // disable built-in body parsing so we can parse slash payloads ourselves
  // (Bolt v3+ 에서 필요)
  processBeforeResponse: true
});
const app = receiver.app;

// 2) 슬랙 Slash용 Body 파싱 세팅
app.use(express.urlencoded({ extended: true }));

// 3) 구글시트 연동 함수
const getRows = q =>
  axios.get(`${process.env.GOOGLE_API_URL}?q=${encodeURIComponent(q)}`)
       .then(r => r.data);
const addRow = d =>
  axios.post(process.env.GOOGLE_API_URL, d);

// 4) AI 폴백 (GPT-4o → Groq → Claude → Gemini)
const askAI = async prompt => {
  const post = (url, body, headers={}) =>
    axios.post(url, body, { headers }).then(r=>r.data).catch(()=>null);

  if (process.env.OPENAI_API_KEY) {
    const r = await post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o', messages:[{role:'user',content:prompt}], max_tokens:500 },
      { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    );
    if (r) return r.choices[0].message.content.trim();
  }
  if (process.env.GROQ_API_KEY) {
    const r = await post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama3-70b-8192', messages:[{role:'user',content:prompt}], max_tokens:500 },
      { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }
    );
    if (r) return r.choices[0].message.content.trim();
  }
  if (process.env.CLAUDE_API_KEY) {
    const r = await post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-3-opus-20240229', max_tokens:512, messages:[{role:'user',content:prompt}] },
      { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version':'2023-06-01' }
    );
    if (r) return r.content[0].text.trim();
  }
  if (process.env.GEMINI_API_KEY) {
    const r = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents:[{ parts:[{ text:prompt }] }] }
    );
    if (r) return r.candidates[0].content.parts[0].text.trim();
  }
  return '⚠️ AI 응답 실패';
};

// 5) **핸들러 함수** (공통)
async function handleSearch(text, res) {
  try {
    const rows = await getRows(text || '');
    if (!rows.length) return res.json({ response_type:'ephemeral', text:'🔍 관련 UX 문구가 없습니다.' });
    return res.json({
      response_type: 'in_channel',
      text: rows.map(r => `• ${r[2]} (${r[1]||''})`).join('\n')
    });
  } catch (e) {
    return res.json({ response_type:'ephemeral', text:`검색 오류: ${e.message}` });
  }
}
async function handleAdd(text, res) {
  try {
    const [category, txt, tone='', notes=''] = text.split('|').map(t=>t.trim());
    if (!category || !txt) {
      return res.json({ response_type:'ephemeral', text:'예: 오류|결제 실패|정중|팝업' });
    }
    await addRow({ category, text: txt, tone, notes });
    return res.json({ response_type:'in_channel', text:'✅ 등록되었습니다!' });
  } catch (e) {
    return res.json({ response_type:'ephemeral', text:`등록 오류: ${e.message}` });
  }
}
async function handleFeedback(text, res) {
  try {
    const prompt = `아래 문구의 UX 톤·명확성·개선 포인트를 친근한 한국어로 설명해줘:\n"${text}"`;
    const output = await askAI(prompt);
    return res.json({ response_type:'in_channel', text: output });
  } catch (e) {
    return res.json({ response_type:'ephemeral', text:`피드백 오류: ${e.message}` });
  }
}
async function handleSuggest(text, res) {
  try {
    const prompt = `상황: "${text}"\n→ 적합한 UX 문구 2개와 이유를 알려줘.`;
    const output = await askAI(prompt);
    return res.json({ response_type:'in_channel', text: output });
  } catch (e) {
    return res.json({ response_type:'ephemeral', text:`추천 오류: ${e.message}` });
  }
}

// 6) **영문 + 한글** 모든 슬래시 명령어 Express 라우팅
const commands = [
  { path: '/usimgle',       fn: handleSearch },
  { path: '/유심글',        fn: handleSearch },
  { path: '/usimgle_add',   fn: handleAdd    },
  { path: '/유심글등록',    fn: handleAdd    },
  { path: '/usimgle_feedback', fn: handleFeedback },
  { path: '/유심글피드백',  fn: handleFeedback },
  { path: '/usimgle_suggest',  fn: handleSuggest },
  { path: '/유심글추천',     fn: handleSuggest }
];

for (const cmd of commands) {
  app.post(cmd.path, async (req, res) => {
    // Slack signingSecret 검증은 ExpressReceiver가 처리
    const text = req.body.text || '';
    return cmd.fn(text, res);
  });
}

// 7) 서버 실행
const port = process.env.PORT || 3000;
receiver.start(port).then(() => {
  console.log(`🚀 유심글 Slack봇 작동 중 (포트 ${port})`);
});
