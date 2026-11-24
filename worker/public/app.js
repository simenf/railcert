'use strict';
/* Railcert Ask: vanilla UI, no dependencies. All untrusted text goes through esc() before it touches innerHTML. */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=u=>{u=String(u||'').trim();return(/^https?:\/\//i.test(u)||/^mailto:/i.test(u)||(u[0]==='/'&&u[1]!=='/'))?u:'';};
const LS='railcertAsk.chats.v1', LSCUR='railcertAsk.current';

/* ---------- tiny markdown renderer ---------- */
/* Code spans, links and citation chips become \u0000N\u0000 placeholders (one token store shared with nested
   calls) so later passes cannot touch their HTML. \u0000 is stripped from the input and excluded from every URL
   pattern, so a placeholder can never end up inside an href; it only ever expands where it stands, in text. */
const hostOf=u=>{try{return /^https?:/i.test(u)?new URL(u).host:'';}catch(e){return '';}};
function mdInline(src,cites,_tok){
  const top=!_tok,tok=_tok||[];const put=h=>{tok.push(h);return '\u0000'+(tok.length-1)+'\u0000';};
  let s=String(src==null?'':src);if(top)s=s.replace(/\u0000/g,'');
  s=s.replace(/`([^`\n]+)`/g,(_,c)=>put('<code>'+esc(c)+'</code>'));
  s=s.replace(/\[([^\]\n]+)\]\(([^)\s\u0000]+)(?:\s+"[^"\u0000]*")?\)/g,(m,t,u)=>{const url=safeUrl(u);if(!url)return t;const host=hostOf(url);
    return put('<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+mdInline(t,null,tok)+'</a>'+(host&&!t.toLowerCase().includes(host.toLowerCase())?' <span class="host">('+esc(host)+')</span>':''));});
  if(cites){
    s=s.replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g,(m,g)=>put(g.split(/\s*[,;]\s*/).map(n=>citeChip(+n,cites)).join('')));
  }
  s=esc(s);
  s=s.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g,(m,a,b)=>'<strong>'+(a||b)+'</strong>');
  s=s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g,'$1<em>$2</em>');
  s=s.replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/g,'$1<em>$2</em>');
  s=s.replace(/(^|[\s(])(https?:\/\/[^\s<)\u0000]+[^\s<).,;:\u0000])/g,(m,p,u)=>p+'<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+u+'</a>');
  if(!top)return s;
  for(let n=0;n<8&&/\u0000\d+\u0000/.test(s);n++)s=s.replace(/\u0000(\d+)\u0000/g,(_,i)=>tok[+i]==null?'':tok[+i]);
  return s.replace(/\u0000/g,'');
}
function mdRender(src,cites){
  const lines=String(src||'').replace(/\r\n?/g,'\n').split('\n');let out='';let i=0;
  const isTbl=(a,b)=>a&&b&&a.includes('|')&&/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(b);
  const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
  const inl=t=>mdInline(t,cites);
  while(i<lines.length){
    let l=lines[i];
    if(/^\s*$/.test(l)){i++;continue;}
    let m;
    if((m=l.match(/^\s*```/))){const b=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))b.push(lines[i++]);i++;out+='<pre><code>'+esc(b.join('\n'))+'</code></pre>';continue;}
    if((m=l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))){const n=Math.min(m[1].length+1,4);out+='<h'+n+'>'+inl(m[2])+'</h'+n+'>';i++;continue;}
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){out+='<hr>';i++;continue;}
    if(isTbl(l,lines[i+1])){const h=cells(l);i+=2;const rows=[];while(i<lines.length&&lines[i].includes('|')&&!/^\s*$/.test(lines[i]))rows.push(cells(lines[i++]));
      out+='<table><thead><tr>'+h.map(c=>'<th>'+inl(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+h.map((_,k)=>'<td>'+inl(r[k]||'')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';continue;}
    if(/^\s*>/.test(l)){const b=[];while(i<lines.length&&/^\s*>/.test(lines[i]))b.push(lines[i++].replace(/^\s*>\s?/,''));out+='<blockquote>'+mdRender(b.join('\n'),cites)+'</blockquote>';continue;}
    if(/^\s*([-*+]|\d+[.)])\s+/.test(l)){
      const ord=/^\s*\d+[.)]/.test(l);const items=[];
      while(i<lines.length&&(/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])||(/^\s+\S/.test(lines[i])&&items.length))){
        const mm=lines[i].match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)/);
        if(mm)items.push(mm[1]);else items[items.length-1]+=' '+lines[i].trim();i++;}
      out+=(ord?'<ol>':'<ul>')+items.map(t=>'<li>'+inl(t)+'</li>').join('')+(ord?'</ol>':'</ul>');continue;}
    const b=[];
    while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])&&!isTbl(lines[i],lines[i+1]))b.push(lines[i++]);
    if(!b.length){b.push(lines[i++]);}
    out+='<p>'+b.map(inl).join('<br>')+'</p>';
  }
  return out;
}

/* ---------- citations ---------- */
const locLabel=c=>[c.locator,c.page_start?('p. '+c.page_start+(c.page_end&&c.page_end!==c.page_start?'–'+c.page_end:'')):''].filter(Boolean).join(' · ');
const docName=c=>c.short_name||c.doc_title||c.doc_path||'source';
function citeChip(n,cites){
  const c=cites&&cites.get(n);
  if(!c)return '<span class="cite bad" title="Citation not found in the sources list">['+n+']</span>';
  const label='<b>'+n+'</b> '+esc(docName(c))+(locLabel(c)?' <span class="l">'+esc(locLabel(c))+'</span>':'');
  const title=esc(docName(c)+(c.doc_title&&c.short_name?' – '+c.doc_title:'')+(locLabel(c)?' – '+locLabel(c):''));
  const f=safeUrl(c.file_url),o=safeUrl(c.official_url);
  let h=f?'<a class="cite" href="'+esc(f)+'" target="_blank" rel="noopener" title="'+title+' (opens the local file)">'+label+'</a>':'<span class="cite" title="'+title+'">'+label+'</span>';
  if(o)h+='<a class="lk" href="'+esc(o)+'" target="_blank" rel="noopener noreferrer" title="Official source" aria-label="Official source of '+esc(docName(c))+'">↗</a>';
  return h;
}
function sourcesHtml(cits){
  if(!cits||!cits.length)return '';
  return '<h3 class="sh">Sources</h3><ol class="sources" style="padding-left:0">'+cits.map(c=>{
    const f=safeUrl(c.file_url),o=safeUrl(c.official_url);
    return '<li id="src-'+c.n+'"><span class="n">['+c.n+']</span><span class="sb"><b>'+esc(docName(c))+'</b>'+(c.doc_title&&c.doc_title!==docName(c)?' <span class="t">'+esc(c.doc_title)+'</span>':'')
     +'<br><span class="t">'+esc(locLabel(c)||c.heading||'')+'</span> '+(c.status?'<span class="badge '+esc(String(c.status).replace(/\s+/g,'_'))+'">'+esc(String(c.status).replace(/_/g,' '))+'</span> ':'')
     +(f?'<a class="lk" href="'+esc(f)+'" target="_blank" rel="noopener" title="Open the local file">📄 file</a> ':'')+(o?'<a class="lk" href="'+esc(o)+'" target="_blank" rel="noopener noreferrer" title="Official source">↗ official</a>':'')+'</span></li>';
  }).join('')+'</ol>';
}
function checksHtml(qc){
  const bad=(qc||[]).filter(q=>q&&q.ok===false);
  if(!bad.length)return '';
  return '<div class="warn" role="note"><b>⚠ quote not found in source</b> — '+bad.length+' quotation'+(bad.length>1?'s':'')+' could not be matched to the cited text. Check the original before relying on '+(bad.length>1?'them':'it')+'.<ul>'
    +bad.map(q=>'<li>“'+esc(String(q.quote).slice(0,220))+(String(q.quote).length>220?'…':'')+'”</li>').join('')+'</ul></div>';
}
const usageText=u=>{if(!u)return '';const p=[];if(u.prompt_tokens!=null)p.push(u.prompt_tokens.toLocaleString()+' in');if(u.completion_tokens!=null)p.push(u.completion_tokens.toLocaleString()+' out');if(u.cost_usd!=null)p.push('$'+Number(u.cost_usd).toFixed(4));return p.join(' · ');};

/* ---------- state ---------- */
let chats=[];let cur=null;let abortCtl=null;let busy=false;
const load=()=>{try{chats=JSON.parse(localStorage.getItem(LS)||'[]')||[];}catch(e){chats=[];}};
const save=()=>{try{localStorage.setItem(LS,JSON.stringify(chats.slice(0,100)));localStorage.setItem(LSCUR,cur?cur.id:'');}catch(e){}};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function newChat(){cur={id:uid(),title:'New chat',updated:Date.now(),messages:[]};renderAll();$('#q').focus();}
function selectChat(id){if(busy)return;const c=chats.find(x=>x.id===id);if(c){cur=c;save();renderAll();}closeHist();}
function deleteChat(id){if(busy&&cur&&cur.id===id)return;const c=chats.find(x=>x.id===id);if(!c||!confirm('Delete this chat?'))return;chats=chats.filter(x=>x.id!==id);if(cur&&cur.id===id){cur=null;newChat();}save();renderHist();}
function persist(){if(!cur.messages.length)return;if(!chats.includes(cur))chats.unshift(cur);cur.updated=Date.now();chats.sort((a,b)=>b.updated-a.updated);save();renderHist();}
function renderHist(){
  const ul=$('#histlist');
  if(!chats.length){ul.innerHTML='<li class="histempty">No saved chats yet.</li>';return;}
  ul.innerHTML=chats.map(c=>'<li class="'+(cur&&cur.id===c.id?'cur':'')+'"><button class="open" type="button" data-id="'+esc(c.id)+'" title="'+esc(c.title)+'">'+esc(c.title)+'</button><button class="del" type="button" data-del="'+esc(c.id)+'" aria-label="Delete chat: '+esc(c.title)+'" title="Delete">×</button></li>').join('');
}
$('#histlist').onclick=e=>{const o=e.target.closest('[data-id]'),d=e.target.closest('[data-del]');if(o)selectChat(o.dataset.id);else if(d)deleteChat(d.dataset.del);};
$('#newchat').onclick=()=>{if(busy)return;newChat();closeHist();};
const closeHist=()=>{$('#hist').classList.remove('open');$('#histtoggle').setAttribute('aria-expanded','false');};
$('#histtoggle').onclick=()=>{const o=$('#hist').classList.toggle('open');$('#histtoggle').setAttribute('aria-expanded',o);};

/* ---------- message rendering ---------- */
const EXAMPLES=['What does a DeBo check for a vehicle authorisation in Norway?','Which CSM RA risk acceptance principles exist?','What is required in SUBSET-026 for level transitions (Set 3)?','Hva krever samtrafikkforskriften for ibruktakelse av faste installasjoner?'];
function welcomeHtml(){return '<div class="welcome"><h2>Ask the library</h2><p>Questions are answered from the railway-regulation library (EU acts, TSIs, CSMs, ERA guides, ERTMS specifications, Norwegian rules). Every claim should carry a source you can open. Norwegian or English.</p><div class="examples">'+EXAMPLES.map(e=>'<button type="button" data-ex="'+esc(e)+'">'+esc(e)+'</button>').join('')+'</div></div>';}
const citeMap=m=>new Map((m.citations||[]).map(c=>[c.n,c]));
function traceHtml(steps,open){
  if(!steps||!steps.length)return '';
  return '<details class="trace"'+(open?' open':'')+'><summary>'+steps.length+' step'+(steps.length>1?'s':'')+' taken</summary><ol>'+steps.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol></details>';
}
function asstInner(m){
  let h=traceHtml(m.steps,false);
  if(m.content)h+='<div class="md">'+mdRender(m.content,citeMap(m))+'</div>';
  if(m.stopped)h+='<div class="warn">Stopped before the answer was complete.</div>';
  if(m.error)h+='<div class="err" role="alert">'+esc(m.error)+'</div>';
  h+=checksHtml(m.quote_checks)+sourcesHtml(m.citations);
  const u=usageText(m.usage);if(u)h+='<div class="usage">'+esc(u)+(m.nsteps?' · '+m.nsteps+' tool call'+(m.nsteps>1?'s':''):'')+'</div>';
  return h;
}
function msgEl(m,idx){
  const d=document.createElement('div');
  if(m.role==='user'){d.className='msg user';d.innerHTML='<div class="bub">'+esc(m.content)+'</div>';}
  else{d.className='msg asst';d.innerHTML=asstInner(m);}
  return d;
}
function renderAll(){
  const box=$('#msgs');
  box.innerHTML=cur.messages.length?'':welcomeHtml();
  cur.messages.forEach((m,i)=>box.appendChild(msgEl(m,i)));
  $('#ctitle').textContent=cur.title;
  renderHist();box.scrollTop=box.scrollHeight;
}
$('#msgs').onclick=e=>{const b=e.target.closest('[data-ex]');if(b){$('#q').value=b.dataset.ex;ask();}};
const nearBottom=()=>{const b=$('#msgs');return b.scrollHeight-b.scrollTop-b.clientHeight<80;};
const scrollDown=()=>{const b=$('#msgs');b.scrollTop=b.scrollHeight;};

/* ---------- SSE ---------- */
async function streamAsk(messages,onEvent,signal){
  const r=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({messages}),signal});
  if(!r.ok){let t='';try{const j=await r.json();t=j.error||'';}catch(e){}throw new Error((t||('Request failed'))+' (HTTP '+r.status+')');}
  if(!r.body)throw new Error('This browser cannot read streamed responses.');
  const rd=r.body.getReader(),dec=new TextDecoder();let buf='';
  const flush=blk=>{let ev='message',data=[];for(const ln of blk.split('\n')){if(ln.startsWith('event:'))ev=ln.slice(6).trim();else if(ln.startsWith('data:'))data.push(ln.slice(5).replace(/^ /,''));}
    if(!data.length)return;let j;try{j=JSON.parse(data.join('\n'));}catch(e){return;}onEvent(ev,j);};
  for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true}).replace(/\r\n?/g,'\n');
    let k;while((k=buf.indexOf('\n\n'))>=0){flush(buf.slice(0,k));buf=buf.slice(k+2);}}
  if(buf.trim())flush(buf);
}
function setBusy(b){busy=b;$('#send').hidden=b;$('#stop').hidden=!b;$('#q').disabled=false;$('#newchat').disabled=b;if(!b)$('#q').focus();}
async function ask(){
  const ta=$('#q');const text=ta.value.trim();if(!text||busy)return;
  ta.value='';autosize();
  cur.messages.push({role:'user',content:text});
  if(cur.title==='New chat')cur.title=text.length>60?text.slice(0,57)+'…':text;
  persist();
  const box=$('#msgs');if(box.querySelector('.welcome'))box.innerHTML='';
  box.appendChild(msgEl(cur.messages[cur.messages.length-1]));
  const m={role:'assistant',content:'',steps:[],citations:[],quote_checks:[]};
  const el=document.createElement('div');el.className='msg asst';
  el.innerHTML='<details class="trace" open><summary><span class="spin" aria-hidden="true"></span><span class="tl">Working…</span></summary><ol></ol></details><div class="streaming cursor" id="live"></div>';
  box.appendChild(el);scrollDown();$('#ctitle').textContent=cur.title;
  const ol=el.querySelector('ol'),tl=el.querySelector('.tl'),live=el.querySelector('#live');live.removeAttribute('id');
  const status=$('#status');status.textContent='Searching the library…';
  let raw='';let finished=false;
  abortCtl=new AbortController();setBusy(true);
  const history=cur.messages.map(x=>({role:x.role,content:x.content})).filter(x=>x.content);
  try{
    await streamAsk(history,(ev,j)=>{
      const stick=nearBottom();
      if(ev==='step'){const s=j.summary||('Step '+j.n+': '+j.tool);m.steps.push(s);const li=document.createElement('li');li.textContent=s;ol.appendChild(li);tl.textContent=s;status.textContent=s;}
      else if(ev==='token'){raw+=j.t||'';live.textContent=raw.replace(/\[c:\d+\]/g,'');}
      else if(ev==='done'){finished=true;m.content=j.answer!=null?j.answer:raw;m.citations=j.citations||[];m.quote_checks=j.quote_checks||[];m.usage=j.usage;m.nsteps=j.steps;}
      else if(ev==='error'){finished=true;m.error=j.message||'The server reported an error.';m.content=m.content||raw.replace(/\[c:\d+\]/g,'');}
      if(stick)scrollDown();
    },abortCtl.signal);
    if(!finished){m.error='The connection ended before the answer was complete.';m.content=raw.replace(/\[c:\d+\]/g,'');}
  }catch(e){
    m.content=raw.replace(/\[c:\d+\]/g,'');
    if(e.name==='AbortError')m.stopped=true;else m.error=(e.message||'Network error')+(/fetch|network/i.test(e.message||'')?' – is the Ask server running?':'');
  }
  abortCtl=null;setBusy(false);status.textContent=m.error?'Error':'Answer complete';
  if(m.content||m.error||m.steps.length){cur.messages.push(m);persist();}
  const fin=msgEl(m);el.replaceWith(fin);scrollDown();
}
$('#form').onsubmit=e=>{e.preventDefault();ask();};
$('#stop').onclick=()=>{if(abortCtl)abortCtl.abort();};
const autosize=()=>{const t=$('#q');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,200)+'px';};
$('#q').addEventListener('input',autosize);
$('#q').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask();}});

/* ---------- export ---------- */
$('#export').onclick=()=>{
  if(!cur||!cur.messages.length)return;
  let md='# '+cur.title+'\n\n_Exported '+new Date().toISOString().slice(0,16).replace('T',' ')+' from Railcert Ask. AI-generated from the library; verify against the official text._\n\n';
  for(const m of cur.messages){
    if(m.role==='user'){md+='## Question\n\n'+m.content+'\n\n';continue;}
    md+='## Answer\n\n'+(m.content||'')+'\n\n';
    if(m.error)md+='> Error: '+m.error+'\n\n';
    const bad=(m.quote_checks||[]).filter(q=>q.ok===false);
    if(bad.length)md+='> ⚠ Quotes not found in the cited source:\n'+bad.map(q=>'> - “'+q.quote+'”').join('\n')+'\n\n';
    if(m.citations&&m.citations.length){md+='### Sources\n\n'+m.citations.map(c=>{
      const f=c.file_url?location.origin+c.file_url:'';
      return '['+c.n+'] **'+docName(c)+'**'+(c.doc_title&&c.doc_title!==docName(c)?' – '+c.doc_title:'')+(locLabel(c)?', '+locLabel(c):'')+(c.status?' ('+c.status+')':'')+(c.official_url?' – <'+c.official_url+'>':'')+(f?' – [local file]('+f.replace(/ /g,'%20')+')':'');}).join('\n\n')+'\n\n';}
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([md],{type:'text/markdown'}));
  a.download='railcert-ask-'+(cur.title.replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,40).toLowerCase()||'chat')+'.md';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};

/* ---------- tabs ---------- */
function setMode(mode){
  for(const t of document.querySelectorAll('[role=tab]')){const on=t.dataset.mode===mode;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;}
  $('#v-ask').classList.toggle('on',mode==='ask');$('#v-ask').hidden=mode!=='ask';
  $('#v-search').classList.toggle('on',mode==='search');$('#v-search').hidden=mode!=='search';
  try{history.replaceState(null,'','#'+mode);}catch(e){}
  (mode==='ask'?$('#q'):$('#sq')).focus();
}
document.querySelectorAll('[role=tab]').forEach(t=>{t.onclick=()=>setMode(t.dataset.mode);
  t.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const o=t.dataset.mode==='ask'?'search':'ask';setMode(o);$('#tab-'+o).focus();}};});

/* ---------- search ---------- */
const AREAS=['EU_Framework','TSI','CSM_Safety','Conformity_Assessment','Vehicle_Authorisation_Registers','ERA_Guides','ERTMS_Specifications','Norway','Referenced_Documents','Cybersecurity_CRA'];
const SETS=['Set1','Set2','Set3','Set4','informative'];
const addOpts=(sel,vals)=>{const have=new Set([...sel.options].map(o=>o.value));for(const v of vals)if(v&&!have.has(v)){sel.add(new Option(v.replace(/_/g,' '),v));have.add(v);}};
addOpts($('#sarea'),AREAS);addOpts($('#sset'),SETS);
function hl(snippet,q){
  const h=esc(snippet);
  const terms=[...new Set(String(q).toLowerCase().split(/[^\p{L}\p{N}\-\/.]+/u).filter(t=>t.length>2))].slice(0,8);
  if(!terms.length)return h;
  // one combined pass (longest first), so a later term can never match inside a <mark> inserted for an earlier one
  const alt=terms.sort((a,b)=>b.length-a.length).map(t=>t.replace(/[.*+?^${}()|[\]\\\/]/g,'\\$&')).join('|');
  return h.replace(new RegExp('(?<![\\p{L}\\p{N}&#;])(?:'+alt+')','giu'),'<mark>$&</mark>');
}
function hitHtml(h,q){
  const f=safeUrl(h.file_url),o=safeUrl(h.official_url);
  return '<li class="hit"><div class="top"><span class="sn">'+esc(docName(h))+'</span>'+(h.status?'<span class="badge '+esc(String(h.status).replace(/\s+/g,'_'))+'">'+esc(String(h.status).replace(/_/g,' '))+'</span>':'')
   +(h.ertms_set?'<span class="badge">'+esc(h.ertms_set)+'</span>':'')+(h.doc_title&&h.doc_title!==docName(h)?'<span class="dt">'+esc(h.doc_title)+'</span>':'')+'</div>'
   +'<div class="loc">'+esc([h.locator,h.heading,h.page_start?'p. '+h.page_start+(h.page_end&&h.page_end!==h.page_start?'–'+h.page_end:''):'',h.area].filter(Boolean).join(' · '))+'</div>'
   +'<div class="snip">'+hl(h.snippet||'',q)+'</div><div class="links">'
   +(f?'<a class="lk" href="'+esc(f)+'" target="_blank" rel="noopener" title="Open the local file at this page">📄 file</a>':'')
   +(o?'<a class="lk" href="'+esc(o)+'" target="_blank" rel="noopener noreferrer" title="Official source">↗ official</a>':'')
   +(h.score!=null?'<span class="sc" title="Relevance score">'+Number(h.score).toFixed(2)+'</span>':'')+'</div></li>';
}
let sctl=null;
async function search(){
  const q=$('#sq').value.trim();if(!q)return;
  const p=new URLSearchParams({q,k:'20'});
  if($('#sarea').value)p.set('area',$('#sarea').value);
  if($('#sset').value)p.set('ertms_set',$('#sset').value);
  p.set('include_repealed',$('#srep').checked?'1':'0');
  const meta=$('#smeta'),hits=$('#hits');meta.textContent='Searching…';
  if(sctl)sctl.abort();sctl=new AbortController();
  try{
    const r=await fetch('/api/search?'+p,{signal:sctl.signal});const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error((j.error||'Search failed')+' (HTTP '+r.status+')');
    const res=j.results||[];addOpts($('#sarea'),res.map(x=>x.area));
    meta.textContent=res.length?res.length+' passage'+(res.length>1?'s':'')+' · '+(j.mode==='hybrid'?'hybrid (keyword + semantic)':'keyword')+' search':'No matches. Try fewer words, an identifier such as SUBSET-026, or include repealed texts.';
    hits.innerHTML=res.map(h=>hitHtml(h,q)).join('');
  }catch(e){if(e.name==='AbortError')return;meta.textContent='';hits.innerHTML='<li class="err" role="alert">'+esc(e.message||'Network error')+'</li>';}
}
$('#sform').onsubmit=e=>{e.preventDefault();search();};

/* ---------- health ---------- */
async function health(){
  const el=$('#health');
  try{
    const r=await fetch('/api/health');const j=await r.json();if(!r.ok||!j.ok)throw new Error();
    el.classList.remove('bad');
    el.textContent=[(j.docs||0).toLocaleString()+' docs',(j.chunks||0).toLocaleString()+' passages','semantic '+(j.vectors?'on':'off'),j.model||'',j.build_date?'built '+j.build_date:''].filter(Boolean).join(' · ');
    if(j.build_date)$('#build').textContent='Index built '+j.build_date+'.';
  }catch(e){el.classList.add('bad');el.textContent='Server not reachable';}
}

/* ---------- boot ---------- */
(function(){
  const live=document.createElement('div');live.id='status';live.className='sr';live.setAttribute('aria-live','polite');live.setAttribute('role','status');document.body.appendChild(live);
  load();
  const id=(()=>{try{return localStorage.getItem(LSCUR);}catch(e){return '';}})();
  cur=chats.find(c=>c.id===id)||null;
  if(!cur)newChat();else renderAll();
  health();
  if(location.hash==='#search')setMode('search');
  addEventListener('hashchange',()=>{const m=location.hash.slice(1);if(m==='ask'||m==='search')setMode(m);});
  autosize();
})();
