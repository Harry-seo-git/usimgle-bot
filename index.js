const { App } = require('@slack/bolt');
const axios = require('axios');
require('dotenv').config();
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});
const getRows = q =>
  axios.get(`${process.env.GOOGLE_API_URL}?q=${encodeURIComponent(q)}`).then(r=>r.data);
const addRow  = d => axios.post(process.env.GOOGLE_API_URL, d);
const askAI = async p=>{
  const post=(u,b,h={})=>axios.post(u,b,{headers:h}).then(r=>r.data).catch(()=>null);
  if(process.env.OPENAI_API_KEY){
    const r=await post('https://api.openai.com/v1/chat/completions',
      {model:'gpt-4o',messages:[{role:'user',content:p}],max_tokens:500},
      {Authorization:`Bearer ${process.env.OPENAI_API_KEY}`}); if(r) return r.choices[0].message.content.trim();
  }
  if(process.env.GROQ_API_KEY){
    const r=await post('https://api.groq.com/openai/v1/chat/completions',
      {model:'llama3-70b-8192',messages:[{role:'user',content:p}],max_tokens:500},
      {Authorization:`Bearer ${process.env.GROQ_API_KEY}`}); if(r) return r.choices[0].message.content.trim();
  }
  if(process.env.CLAUDE_API_KEY){
    const r=await post('https://api.anthropic.com/v1/messages',
      {model:'claude-3-opus-20240229',max_tokens:512,
       messages:[{role:'user',content:p}]},
      {'x-api-key':process.env.CLAUDE_API_KEY,'anthropic-version':'2023-06-01'});
    if(r) return r.content[0].text.trim();
  }
  if(process.env.GEMINI_API_KEY){
    const r=await post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {contents:[{parts:[{text:p}]}]});
    if(r) return r.candidates[0].content.parts[0].text.trim();
  }
  return '⚠️ AI 응답 실패';
};
const search   = async ({command,ack,say})=>{await ack();const rows=await getRows(command.text||'');if(!rows.length)return say('🔍 관련 UX 문구가 없습니다.');say(rows.map(r=>`• ${r[2]} (${r[1]||''})`).join('\n'));};
const add      = async ({command,ack,say})=>{await ack();const [c,t,to='',n='']=command.text.split('|').map(s=>s.trim());if(!c||!t)return say('예: /유심글등록 오류|결제 실패|정중|팝업');await addRow({category:c,text:t,tone:to,notes:n});say('✅ 등록되었습니다!');};
const feedback = async ({command,ack,say})=>{await ack();say(await askAI(`아래 문구 UX 피드백:\n\"${command.text}\"`));};
const suggest  = async ({command,ack,say})=>{await ack();say(await askAI(`상황: \"${command.text}\" 문구 2개+이유`));};
app.command('/유심글', search);          app.command('/usimgle', search);
app.command('/유심글등록', add);         app.command('/usimgle_add', add);
app.command('/유심글피드백', feedback);   app.command('/usimgle_feedback', feedback);
app.command('/유심글추천', suggest);      app.command('/usimgle_suggest', suggest);
(async()=>{await app.start(process.env.PORT||3000);console.log('🚀 유심글 Slack봇 Render 작동');})();
