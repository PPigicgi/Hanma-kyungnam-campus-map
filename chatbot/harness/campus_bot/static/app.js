'use strict';
const form=document.querySelector('#chat-form'), input=document.querySelector('#question');
const messages=document.querySelector('#messages'), send=document.querySelector('#send');
const cancel=document.querySelector('#cancel'), error=document.querySelector('#error');
const count=document.querySelector('#char-count'), clear=document.querySelector('#clear');
const initial=messages.firstElementChild.cloneNode(true);
let history=[],active=null,requestTimeoutMs=630000;

function textElement(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
function message(role,text){const article=document.createElement('article');article.className='message '+role;article.append(textElement('span',role==='user'?'나':'한마','speaker'));article.append(textElement('p',text));messages.append(article);messages.scrollTop=messages.scrollHeight;return article;}
function busy(value){send.disabled=value;cancel.hidden=!value;send.hidden=value;clear.disabled=value;document.querySelectorAll('[data-question]').forEach(b=>b.disabled=value);input.setAttribute('aria-busy',String(value));}
function showError(text){error.textContent=text;error.hidden=!text;}
function render(data){
  const article=message('assistant',data.answer);
  const mode=data.generation?.mode;
  article.append(textElement('div',['openai','codex'].includes(mode)?'AI가 자료를 바탕으로 작성한 답변':mode==='source_fallback'?'원문 안내 (AI 답변 미사용)':'자료 조회 답변','basis'));
  if(data.sources?.length){
    const list=document.createElement('div');list.className='sources';list.setAttribute('aria-label','답변 출처');
    for(const source of data.sources){
      let url;try{url=new URL(source.url);}catch{continue;}
      if(url.protocol!=='https:'||url.hostname!=='www.kyungnam.ac.kr')continue;
      const item=document.createElement('div'), a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.className='source-link';a.textContent=`[문서 ${source.document_id}] ${source.title} (새 창)`;item.append(a);
      const date=source.modified_at||source.published_at;if(date)item.append(textElement('span','자료 날짜 '+date,'source-date'));
      list.append(item);
    }article.append(list);
  }
  for(const warning of data.warnings||[])article.append(textElement('div',warning,'warning'));
  if(data.outcome!=='answered'&&data.next_actions?.length)article.append(textElement('div',data.next_actions.join(' '),'muted'));
  article.append(textElement('div',`기준일 ${data.as_of}, 자료 수집 ${data.data_as_of||'확인 불가'}`,'basis'));
  messages.scrollTop=messages.scrollHeight;
}
async function ask(question){
  if(active)return;question=question.trim();if(!question){showError('질문을 입력해 주세요.');input.focus();return;}
  if(question.length>2000){showError('질문은 2,000자 이내로 입력해 주세요.');return;}
  showError('');message('user',question);input.value='';count.textContent='0 / 2000';
  const loading=message('assistant','질문을 분석해 관련 자료를 찾고 답변을 준비하고 있어요.');loading.classList.add('loading');
  const controller=new AbortController();active=controller;busy(true);let timedOut=false;
  const started=Date.now();
  const progress=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);if(elapsed>=15)loading.querySelector('p').textContent=`답변을 준비하고 있어요. ${elapsed}초 지났어요. 자료 확인에 시간이 더 걸릴 수 있습니다.`;},1000);
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},requestTimeoutMs);
  try{
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,history:history.slice(-4)}),signal:controller.signal});
    const data=await response.json();loading.remove();
    if(!response.ok){throw new Error(data.answer||'요청을 처리하지 못했습니다. 질문을 확인하고 다시 시도해 주세요.');}
    render(data);history.push(question);
  }catch(err){loading.remove();input.value=question;count.textContent=`${input.value.length} / 2000`;showError(err.name==='AbortError'?(timedOut?'응답이 지연되었습니다. 다시 보내기를 눌러 주세요.':'요청을 취소했습니다. 질문을 수정하거나 다시 보내세요.'):(err instanceof TypeError?'서버에 연결하지 못했습니다. 서버 실행 상태를 확인한 뒤 다시 보내세요.':err.message||'연결하지 못했습니다. 다시 시도해 주세요.'));}
  finally{clearTimeout(timer);clearInterval(progress);active=null;busy(false);input.focus();}
}
form.addEventListener('submit',event=>{event.preventDefault();ask(input.value);});
input.addEventListener('input',()=>count.textContent=`${input.value.length} / 2000`);
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();ask(input.value);}});
document.querySelectorAll('[data-question]').forEach(button=>button.addEventListener('click',()=>ask(button.dataset.question)));
cancel.addEventListener('click',()=>active?.abort());
clear.addEventListener('click',()=>{history=[];messages.replaceChildren(initial.cloneNode(true));showError('');input.value='';count.textContent='0 / 2000';input.focus();});
fetch('/api/info').then(r=>r.json()).then(info=>{
  const limit=info.llm?.request_timeout_seconds;if(Number.isFinite(limit)&&limit>=30&&limit<=3600)requestTimeoutMs=(limit+30)*1000;
  document.querySelector('#snapshot').textContent=info.data_as_of+' 수집 자료 기준';
  document.querySelector('#answer-mode').textContent=info.llm?.configured?'AI 답변 설정됨, 질문할 때 연결 확인':info.llm?.state==='disabled'?'자료 검색 모드':'AI 설정 대기, 자료 검색 모드';
  if(!info.ready)showError('안내 자료에 연결하지 못했습니다. 운영자에게 확인해 주세요.');
}).catch(()=>showError('서버에 연결하지 못했습니다. 잠시 후 새로고침해 주세요.'));
