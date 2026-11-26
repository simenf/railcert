'use strict';
/* Railcert Ask: vanilla UI, no build step. All untrusted text goes through esc() before it touches innerHTML.
   The only third-party code is the vendored mermaid bundle (public/vendor/), loaded lazily when an answer has a diagram. */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=u=>{u=String(u||'').trim();return(/^https?:\/\//i.test(u)||/^mailto:/i.test(u)||(u[0]==='/'&&u[1]!=='/'))?u:'';};
const LS='railcertAsk.chats.v1', LSCUR='railcertAsk.current';

/* ---------- tiny markdown renderer ---------- */
/* Code spans, links, quotes and citations become \u0000N\u0000 placeholders (one token store shared with nested
   calls) so later passes cannot touch their HTML. \u0000 is stripped from the input and excluded from every URL
   pattern, so a placeholder can never end up inside an href; it only ever expands where it stands, in text. */
const hostOf=u=>{try{return /^https?:/i.test(u)?new URL(u).host:'';}catch(e){return '';}};
const locLabel=c=>[c.locator,c.page_start?('p. '+c.page_start+(c.page_end&&c.page_end!==c.page_start?'–'+c.page_end:'')):''].filter(Boolean).join(' · ');
const docName=c=>c.short_name||c.doc_title||c.doc_path||'source';
/** [1,2,3,5] → "1–3,5": runs of three or more collapse to a range. */
function rangeLabel(ns){
  const out=[];
  for(let i=0;i<ns.length;){let j=i;while(j+1<ns.length&&ns[j+1]===ns[j]+1)j++;
    if(j-i>=2)out.push(ns[i]+'–'+ns[j]);else for(let k=i;k<=j;k++)out.push(String(ns[k]));i=j+1;}
  return out.join(',');
}
/** One superscript for a run of neighbouring citations. The numbers ride on the <sup> class (c-N) so the card
   script can find them; the link itself points at the first source's file, so it still works without JS. */
function citeGroup(ns,cites){
  ns=[...new Set(ns)].sort((a,b)=>a-b);
  if(cites==='live')return '<sup class="cs pending">'+rangeLabel(ns)+'</sup>';
  const good=ns.filter(n=>cites.get(n)),bad=ns.filter(n=>!cites.get(n));
  let h='';
  if(good.length){
    const f=safeUrl(cites.get(good[0]).file_url);
    const lab=good.map(n=>{const c=cites.get(n);return n+' '+docName(c)+(locLabel(c)?', '+locLabel(c):'');}).join('; ');
    h+='<a class="cite" href="'+esc(f||('#src-'+good[0]))+'" aria-label="'+esc((good.length>1?'Sources ':'Source ')+lab)+'">'+rangeLabel(good)+'</a>';
  }
  if(bad.length)h+='<span class="cite bad" title="Citation not found in the sources list">'+(good.length?',':'')+bad.join(',')+'</span>';
  return '<sup class="cs'+good.map(n=>' c-'+n).join('')+'">'+h+'</sup>';
}
const QSEP='[\\s\\u00a0\\-\\u2010-\\u2015"“”„«»]+';
/** Tolerant matcher for a checked quote: whitespace, hyphens and quote marks between words are interchangeable. */
function quoteRe(q){
  const words=String(q||'').split(new RegExp(QSEP)).filter(Boolean).slice(0,80);
  if(words.length<2)return null;
  const w=words.map(x=>x.replace(/[.*+?^${}()|[\]\\\/]/g,'\\$&').replace(/['’‘]/g,"['’‘]"));
  return new RegExp(w.join(QSEP)+'["”»’]?','i');
}
function quoteHtml(m,q){
  if(q.ok)return '<span class="q ok">'+esc(m)+'</span><span class="qv" title="Quote verified against source '+(q.n||'')+'"><span class="sr"> (quote verified)</span></span>';
  return '<span class="q bad'+(q.n?' c-'+q.n:'')+'" title="This quotation was not found in the text of source '+(q.n||'')+'. Check the original.">'+esc(m)+'<span class="sr"> (quote not found in the cited source)</span></span>';
}
const CITE_RE=/[ \t]*\[\d+(?:\s*[,;]\s*\d+)*\](?:[ \t]*\[\d+(?:\s*[,;]\s*\d+)*\])*/g;
function mdInline(src,cites,_tok,opts){
  const top=!_tok,tok=_tok||[];const put=h=>{tok.push(h);return '\u0000'+(tok.length-1)+'\u0000';};
  let s=String(src==null?'':src);if(top)s=s.replace(/\u0000/g,'');
  s=s.replace(/`([^`\n]+)`/g,(_,c)=>put('<code>'+esc(c)+'</code>'));
  s=s.replace(/\[([^\]\n]+)\]\(([^)\s\u0000]+)(?:\s+"[^"\u0000]*")?\)/g,(m,t,u)=>{const url=safeUrl(u);if(!url)return t;const host=hostOf(url);
    return put('<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+mdInline(t,null,tok)+'</a>'+(host&&!t.toLowerCase().includes(host.toLowerCase())?' <span class="host">('+esc(host)+')</span>':''));});
  if(opts&&opts.quotes)for(const q of opts.quotes){if(q.used||!q.re)continue;s=s.replace(q.re,m=>{q.used=true;return put(quoteHtml(m,q));});}
  if(cites)s=s.replace(CITE_RE,m=>put(citeGroup(m.match(/\d+/g).map(Number),cites)));
  s=esc(s);
  s=s.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g,(m,a,b)=>'<strong>'+(a||b)+'</strong>');
  s=s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g,'$1<em>$2</em>');
  s=s.replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/g,'$1<em>$2</em>');
  s=s.replace(/(^|[\s(])(https?:\/\/[^\s<)\u0000]+[^\s<).,;:\u0000])/g,(m,p,u)=>p+'<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+u+'</a>');
  if(!top)return s;
  for(let n=0;n<8&&/\u0000\d+\u0000/.test(s);n++)s=s.replace(/\u0000(\d+)\u0000/g,(_,i)=>tok[+i]==null?'':tok[+i]);
  return s.replace(/\u0000/g,'');
}
/** Markdown → HTML. cites: Map n→Citation, 'live' while streaming (numbers without links), or null.
   opts.quotes: [{re,ok,n,used}] marks checked quotes inline (used is set on the first match). An unclosed code
   fence runs to the end of the text, so a half-streamed block renders as code, never as markup. */
function mdRender(src,cites,opts){
  const lines=String(src||'').replace(/\r\n?/g,'\n').split('\n');let out='';let i=0;
  const isTbl=(a,b)=>a&&b&&a.includes('|')&&/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(b);
  const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
  const inl=t=>mdInline(t,cites,null,opts);
  while(i<lines.length){
    let l=lines[i];
    if(/^\s*$/.test(l)){i++;continue;}
    let m;
    if((m=l.match(/^\s*```\s*([\w-]*)/))){const lang=m[1].toLowerCase();const b=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))b.push(lines[i++]);i++;
      out+=lang==='mermaid'?'<div class="mmd"><pre class="mmd-src"><code>'+esc(b.join('\n'))+'</code></pre></div>':'<pre><code>'+esc(b.join('\n'))+'</code></pre>';continue;}
    if((m=l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))){const n=Math.min(m[1].length+1,4);out+='<h'+n+'>'+inl(m[2])+'</h'+n+'>';i++;continue;}
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){out+='<hr>';i++;continue;}
    if(isTbl(l,lines[i+1])){const h=cells(l);i+=2;const rows=[];while(i<lines.length&&lines[i].includes('|')&&!/^\s*$/.test(lines[i]))rows.push(cells(lines[i++]));
      out+='<div class="tbl'+(rows.length>12?' long':'')+'"><table><thead><tr>'+h.map(c=>'<th>'+inl(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+h.map((_,k)=>'<td>'+inl(r[k]||'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';continue;}
    if(/^\s*>/.test(l)){const b=[];while(i<lines.length&&/^\s*>/.test(lines[i]))b.push(lines[i++].replace(/^\s*>\s?/,''));out+='<blockquote>'+mdRender(b.join('\n'),cites,opts)+'</blockquote>';continue;}
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
/** Escaped excerpt with the quoted words wrapped in <mark>. */
function markQuotes(text,quotes){
  const t=String(text||'');const rs=[];
  for(const q of quotes||[]){const re=quoteRe(q);const m=re&&re.exec(t);if(m)rs.push([m.index,m.index+m[0].length]);}
  rs.sort((a,b)=>a[0]-b[0]);let out='',p=0;
  for(const[a,b]of rs){if(a<p)continue;out+=esc(t.slice(p,a))+'<mark>'+esc(t.slice(a,b))+'</mark>';p=b;}
  return out+esc(t.slice(p));
}

/* ---------- source map (own SVG, no library) ---------- */
const LEVELS=['EU framework','Implementing and delegated acts','ERA guidance and national rules','Specifications','Standards'];
const filePath=p=>'/files/'+String(p||'').split('/').map(encodeURIComponent).join('/');
const lvl=n=>Math.max(0,Math.min(4,Number.isFinite(+n.level)?+n.level:2));
function wrapLabel(s,max){
  const words=String(s||'').split(/\s+/).filter(Boolean);const lines=[''];
  for(const w of words){const cur=lines[lines.length-1];
    if(!cur)lines[lines.length-1]=w;else if((cur+' '+w).length<=max)lines[lines.length-1]=cur+' '+w;else lines.push(w);}
  let out=lines.slice(0,2);if(lines.length>2)out[1]=out[1]+'…';
  return out.map(l=>l.length>max+1?l.slice(0,max)+'…':l);
}
/** Edges between included nodes, thinned to each node's strongest three links so a 14-node map stays legible. */
function mapEdges(map){
  const nodes=((map&&map.nodes)||[]).slice(0,14);const has=new Set(nodes.map(n=>n.path));
  const all=((map&&map.edges)||[]).filter(e=>e&&has.has(e.from)&&has.has(e.to)&&e.from!==e.to);
  const keep=new Set();
  for(const n of nodes){all.filter(e=>e.from===n.path||e.to===n.path).sort((a,b)=>(+b.mentions||0)-(+a.mentions||0)).slice(0,3).forEach(e=>keep.add(e));}
  return {edges:all.filter(e=>keep.has(e)),total:all.length};
}
/** Layered "who cites whom": one band per legal level, arrows from the citing to the cited document. */
function sourceMapSvg(map,narrow,uidp){
  const nodes=((map&&map.nodes)||[]).slice(0,14);if(nodes.length<2)return '';
  const id=String(uidp||'sm').replace(/[^\w-]/g,'');
  const index=new Map(nodes.map((n,i)=>[n.path,i]));
  const W=narrow?340:720,PAD=12,GAP=narrow?10:14,BH=44,PER=narrow?2:5,LBL=22,BAND=narrow?32:42;
  const levels=[...new Set(nodes.map(lvl))].sort((a,b)=>a-b);
  const rowsBy=levels.map(L=>{const ids=nodes.map((n,i)=>i).filter(i=>lvl(nodes[i])===L);const rows=[];for(let k=0;k<ids.length;k+=PER)rows.push(ids.slice(k,k+PER));return rows;});
  const maxK=Math.max(...rowsBy.flat().map(r=>r.length));
  const BW=Math.floor(Math.min(narrow?156:176,(W-2*PAD-(maxK-1)*GAP)/maxK));
  const pos=[];let y=4,bands='',lanes='';
  levels.forEach((L,li)=>{
    const top=y;y+=LBL;
    rowsBy[li].forEach((row,ri)=>{const k=row.length,x0=(W-(k*BW+(k-1)*GAP))/2;
      row.forEach((i,j)=>{pos[i]={x:x0+j*(BW+GAP),y,w:BW,h:BH};});y+=BH+(ri<rowsBy[li].length-1?GAP:0);});
    y+=10;
    bands+='<rect class="sm-lane" x="0" y="'+top+'" width="'+W+'" height="'+(y-top)+'" rx="6"/>';lanes+='<text class="sm-ll" x="'+PAD+'" y="'+(top+15)+'">'+esc(LEVELS[L])+'</text>';
    y+=BAND-10+(li<levels.length-1?6:0);
  });
  const H=y-BAND+30;
  // attachment points: spread the edges that meet one side of a box across its width
  const edges=mapEdges(map).edges;if(!edges.length)return '';
  const maxM=Math.max(1,...edges.map(e=>+e.mentions||1));
  const sides=new Map();const at=(i,side,ei,ox)=>{const k=i+side;if(!sides.has(k))sides.set(k,[]);sides.get(k).push({ei,ox});};
  const geo=edges.map((e,ei)=>{const a=pos[index.get(e.from)],b=pos[index.get(e.to)];
    const sa=b.y>=a.y?'b':'t',sb=b.y>a.y?'t':'b';
    at(index.get(e.from),sa,ei,b.x);at(index.get(e.to),sb,ei,a.x);return{a,b,sa,sb};});
  const pt={};
  for(const[k,list]of sides){const i=+k.slice(0,-1),side=k.slice(-1),p=pos[i];list.sort((u,v)=>u.ox-v.ox);
    list.forEach((it,j)=>{(pt[it.ei]||(pt[it.ei]={}))[i===index.get(edges[it.ei].from)?'a':'b']={x:p.x+p.w*(.2+.6*(j+1)/(list.length+1)),y:side==='b'?p.y+p.h:p.y};});}
  const label=i=>nodes[i].label||nodes[i].path;
  let eh='';
  edges.forEach((e,ei)=>{const g=geo[ei],p=pt[ei]||{};const A=p.a,B=p.b;if(!A||!B)return;
    let d;if(g.a.y===g.b.y){const drop=14+Math.min(12,Math.abs(A.x-B.x)/40);d='M'+A.x+' '+A.y+'C'+A.x+' '+(A.y+drop)+' '+B.x+' '+(B.y+drop)+' '+B.x+' '+(B.y+2);}
    else{const dy=B.y-A.y,end=B.y-Math.sign(dy)*2;d='M'+A.x+' '+A.y+'C'+A.x+' '+(A.y+dy/2)+' '+B.x+' '+(B.y-dy/2)+' '+B.x+' '+end;}
    const sw=(1+1.8*Math.log(1+(+e.mentions||1))/Math.log(1+maxM)).toFixed(2);
    eh+='<g class="sm-e" data-f="'+index.get(e.from)+'" data-t="'+index.get(e.to)+'"><title>'+esc(label(index.get(e.from))+' cites '+label(index.get(e.to))+(e.mentions?' ('+e.mentions+' mention'+(e.mentions>1?'s':'')+')':''))+'</title><path d="'+d.replace(/(\d\.\d)\d+/g,'$1')+'" stroke-width="'+sw+'" marker-end="url(#'+id+'-ah)"/></g>';});
  const maxCh=Math.floor((BW-16)/6.7);
  let nh='';
  nodes.forEach((n,i)=>{const p=pos[i];const lines=wrapLabel(label(i),maxCh);const ns=(n.ns||[]).filter(Number.isFinite).sort((a,b)=>a-b);
    const ty=p.y+p.h/2-(lines.length-1)*7+4;
    const tip=label(i)+(n.status?' · '+String(n.status).replace(/_/g,' '):'')+(ns.length?' · cited as '+rangeLabel(ns):(n.cited?'':' · links two cited documents'))+' · opens the file';
    nh+='<a class="sm-n'+(n.cited?' cited':' bridge')+'" href="'+esc(filePath(n.path))+'" target="_blank" rel="noopener" data-i="'+i+'" aria-label="'+esc(tip)+'"><title>'+esc(tip)+'</title>'
      +'<rect class="bx" x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+p.h+'" rx="6"/>'
      +'<text x="'+(p.x+p.w/2)+'" y="'+ty+'" text-anchor="middle">'+lines.map((l,k)=>'<tspan x="'+(p.x+p.w/2)+'" dy="'+(k?14:0)+'">'+esc(l)+'</tspan>').join('')+'</text>';
    if(ns.length){let t=rangeLabel(ns);if(t.length>11)t=t.slice(0,t.lastIndexOf(',',10)>0?t.lastIndexOf(',',10):10)+'…';const bw=10+t.length*6.4;nh+='<g class="sm-b"><rect x="'+(p.x+p.w-bw+6)+'" y="'+(p.y-8)+'" width="'+bw+'" height="16" rx="8"/><text x="'+(p.x+p.w-bw/2+6)+'" y="'+(p.y+3.5)+'" text-anchor="middle">'+esc(t)+'</text></g>';}
    nh+='</a>';});
  return '<svg class="smsvg" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="group" aria-label="How the sources cite each other">'
    +'<defs><marker id="'+id+'-ah" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="sm-ah" d="M0 0L10 5L0 10z"/></marker></defs>'
    +bands+'<g class="sm-es">'+eh+'</g>'+lanes+nh+'</svg>';
}

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
  ul.innerHTML=chats.map(c=>'<li class="'+(cur&&cur.id===c.id?'cur':'')+'"><button class="open" type="button" data-id="'+esc(c.id)+'" title="'+esc(c.title)+'">'+esc(c.title)+'</button><button class="del" type="button" data-del="'+esc(c.id)+'" aria-label="Delete chat: '+esc(c.title)+'" title="Delete">'+icon('x')+'</button></li>').join('');
}
$('#histlist').onclick=e=>{const o=e.target.closest('[data-id]'),d=e.target.closest('[data-del]');if(o)selectChat(o.dataset.id);else if(d)deleteChat(d.dataset.del);};
$('#newchat').onclick=()=>{if(busy)return;newChat();closeHist();};
const closeHist=()=>{$('#hist').classList.remove('open');$('#histtoggle').setAttribute('aria-expanded','false');};
$('#histtoggle').onclick=()=>{const o=$('#hist').classList.toggle('open');$('#histtoggle').setAttribute('aria-expanded',o);};

/* ---------- icons (one stroke family, drawn on a 16px grid) ---------- */
const ICONS={
  copy:'<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  file:'<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5"/>',
  ext:'<path d="M9.5 2.5h4v4"/><path d="M13.5 2.5l-6 6"/><path d="M12 9.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V4.5A.5.5 0 0 1 3 4h3.5"/>',
  regen:'<path d="M13.2 6.2A5.5 5.5 0 1 0 13.5 9"/><path d="M13.5 2.5v3.8H9.7"/>',
  down:'<path d="M8 2.5v8"/><path d="M4.8 7.5L8 10.7l3.2-3.2"/><path d="M2.5 13.5h11"/>',
  check:'<path d="M3.2 8.4l3 3 6.6-6.8"/>',
  chev:'<path d="M6 3.5L10.5 8 6 12.5"/>',
  x:'<path d="M4 4l8 8M12 4l-8 8"/>',
  code:'<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>',
  arrow:'<path d="M3 8h9.5"/><path d="M9 4.5L12.5 8 9 11.5"/>',
};
const icon=n=>'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false">'+ICONS[n]+'</svg>';
const badge=st=>st?'<span class="badge '+esc(String(st).replace(/\s+/g,'_'))+'">'+esc(String(st).replace(/_/g,' '))+'</span>':'';
const isPdfLink=u=>/#page=\d+/.test(u||'')||/\.pdf(#|$)/i.test(u||'');

/* ---------- message rendering ---------- */
const EXAMPLES=['What does a DeBo check for a vehicle authorisation in Norway?','Which CSM RA risk acceptance principles exist?','What is required in SUBSET-026 for level transitions (Set 3)?','Hva krever samtrafikkforskriften for ibruktakelse av faste installasjoner?'];
const LIBRARY=[
  ['EU framework','Interoperability and Safety Directives, the ERA Regulation, 2018/545 vehicle authorisation, registers'],
  ['TSIs and CSMs','Technical specifications for interoperability, CSM RA and the other common safety methods'],
  ['ERA guidance','Application guides and the practical-arrangements guidelines'],
  ['ERTMS','Specification Sets 1–4: SUBSETs for ETCS and GSM-R'],
  ['Norway','Norwegian law and SJT guidance, Bane NOR TRV requirements'],
  ['Cybersecurity','The Cyber Resilience Act (CRA)'],
];
function welcomeHtml(){
  return '<div class="welcome"><h2>Ask the library</h2><p class="lede">Answers are written from the Railcert library of railway regulation<span id="libcount"></span>. Every claim carries a numbered source that opens the PDF at the cited page. Ask in English or Norwegian.</p>'
    +'<dl class="lib">'+LIBRARY.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>'
    +'<p class="fine">Paid standards (EN, IEC, ISO, UIC) are not in the library. Answers can still say which documents cite them.</p>'
    +'<h3 class="sh">Try a question</h3><div class="examples">'+EXAMPLES.map(e=>'<button type="button" data-ex="'+esc(e)+'">'+icon('arrow')+'<span>'+esc(e)+'</span></button>').join('')+'</div></div>';
}
const citeMap=m=>new Map((m.citations||[]).map(c=>[c.n,c]));
const stepText=s=>typeof s==='string'?s:(s&&s.summary)||'';
const fmtDur=ms=>ms<1000?'<1 s':ms<60000?Math.round(ms/1000)+' s':Math.floor(ms/60000)+' min '+Math.round(ms%60000/1000)+' s';
function traceSummary(steps,ms){
  const c={};let known=0;
  for(const s of steps){const t=typeof s==='string'?'':(s.tool||'');if(t)known++;c[t]=(c[t]||0)+1;}
  const p=[];
  if(!known)p.push(steps.length+' step'+(steps.length>1?'s':''));
  else{if(c.search)p.push('Searched '+c.search+'×');if(c.read)p.push((p.length?'read ':'Read ')+c.read+' passage'+(c.read>1?'s':''));
    const o=steps.length-(c.search||0)-(c.read||0);if(o)p.push(o+' other lookup'+(o>1?'s':''));}
  if(ms)p.push(fmtDur(ms));
  return p.join(' · ');
}
function traceHtml(steps,ms){
  if(!steps||!steps.length)return '';
  return '<details class="trace"><summary>'+icon('chev')+'<span>'+esc(traceSummary(steps,ms))+'</span></summary><ol>'+steps.map(s=>'<li>'+esc(stepText(s))+'</li>').join('')+'</ol></details>';
}
function quotesFor(m){
  const byChunk=new Map((m.citations||[]).map(c=>[c.chunk_id,c.n]));
  return (m.quote_checks||[]).filter(q=>q&&q.quote&&(q.ok===true||q.ok===false)).map(q=>({quote:q.quote,ok:q.ok,n:q.n!=null?q.n:(byChunk.get(q.chunk_id)||null),re:quoteRe(q.quote),used:false}));
}
function sourcesHtml(cits){
  if(!cits||!cits.length)return '';
  const docs=[];const by=new Map();
  for(const c of [...cits].sort((a,b)=>a.n-b.n)){const k=c.doc_path||docName(c);if(!by.has(k)){const d={c,ps:[]};by.set(k,d);docs.push(d);}by.get(k).ps.push(c);}
  const names=docs.map(d=>docName(d.c));const shown=names.slice(0,4).join(' · ')+(names.length>4?' · +'+(names.length-4)+' more':'');
  return '<details class="srcs"><summary>'+icon('chev')+'<span class="sl">Sources</span><span class="sn">'+esc(shown)+'</span><span class="sc">'+cits.length+' passage'+(cits.length>1?'s':'')+'</span></summary><ol class="sdocs">'
    +docs.map(d=>{const c=d.c,o=safeUrl(c.official_url);
      return '<li class="sdoc"><div class="sdh"><b>'+esc(docName(c))+'</b>'+badge(c.status)+(o?'<a class="lk xl" href="'+esc(o)+'" target="_blank" rel="noopener noreferrer">'+icon('ext')+'Official source</a>':'')+'</div>'
        +(c.doc_title&&c.doc_title!==docName(c)?'<div class="sdt">'+esc(c.doc_title)+'</div>':'')
        +'<ul class="sps">'+d.ps.map(p=>{const f=safeUrl(p.file_url);
          return '<li id="src-'+p.n+'"><span class="pn">'+p.n+'</span><span class="pl">'+esc(p.locator||p.heading||'Passage')+(p.heading&&p.locator?' <span class="ph">'+esc(p.heading)+'</span>':'')+'</span>'
            +(f?'<a class="lk" href="'+esc(f)+'" target="_blank" rel="noopener">'+icon('file')+(isPdfLink(f)&&p.page_start?'PDF p. '+p.page_start+(p.page_end&&p.page_end!==p.page_start?'–'+p.page_end:''):'Open file')+'</a>':'')+'</li>';}).join('')+'</ul></li>';}).join('')+'</ol></details>';
}
function smapHtml(sm){
  if(!sm||!sm.nodes||sm.nodes.length<2)return '';
  const n=Math.min(14,sm.nodes.length),{edges,total}=mapEdges(sm),e=edges.length;if(!e)return '';
  return '<details class="smap"><summary>'+icon('chev')+'<span class="sl">How these sources connect</span><span class="sc">'+n+' documents · '+(e<total?'strongest '+e+' of '+total+' citation links':e+' citation link'+(e===1?'':'s'))+'</span></summary><div class="smb"></div>'
    +'<p class="smleg"><span><i class="lg-c"></i>Cited in this answer</span><span><i class="lg-b"></i>Links two cited documents</span><span><i class="lg-e"></i>Arrow: cites</span><span>Select a box to open the file</span></p></details>';
}
function qnoteHtml(bad){
  if(!bad.length)return '';
  const lost=bad.filter(q=>!q.used);
  return '<p class="qnote" role="note"><i class="qn-i" aria-hidden="true"></i><span>'+(bad.length===1?'One quotation was':bad.length+' quotations were')+' not found in the cited source'+(bad.length-lost.length?' and '+(bad.length-lost.length===1?'is':'are')+' underlined in amber':'')+'. Check the original before relying on '+(bad.length>1?'them':'it')+'.'
    +(lost.length?' Not located in the text: '+lost.map(q=>'“'+esc(String(q.quote).slice(0,160))+(String(q.quote).length>160?'…':'')+'”').join(', ')+'.':'')+'</span></p>';
}
const usageText=u=>{if(!u)return '';const p=[];if(u.prompt_tokens!=null)p.push(u.prompt_tokens.toLocaleString()+' in');if(u.completion_tokens!=null)p.push(u.completion_tokens.toLocaleString()+' out');if(u.cost_usd!=null)p.push('$'+Number(u.cost_usd).toFixed(4));return p.join(' · ');};
function asstInner(m,last){
  let h=traceHtml(m.steps,m.ms);
  const quotes=quotesFor(m);
  if(m.content)h+='<div class="md">'+mdRender(m.content,citeMap(m),{quotes})+'</div>';
  if(m.stopped)h+='<p class="note">Stopped before the answer was complete.</p>';
  if(m.error)h+='<div class="err" role="alert">'+esc(m.error)+'</div>';
  h+=qnoteHtml(quotes.filter(q=>!q.ok));
  h+=sourcesHtml(m.citations)+smapHtml(m.source_map);
  if(last&&m.follow_ups&&m.follow_ups.length)h+='<div class="fups" role="group" aria-label="Follow-up questions">'+m.follow_ups.slice(0,3).map(q=>'<button type="button" class="fup" data-ask="'+esc(q)+'">'+icon('arrow')+'<span>'+esc(q)+'</span></button>').join('')+'</div>';
  if(m.content){
    const u=usageText(m.usage);
    h+='<div class="acts"><button class="act" type="button" data-act="copy">'+icon('copy')+'<span>Copy</span></button>'
      +(m.citations&&m.citations.length?'<button class="act" type="button" data-act="copysrc">'+icon('copy')+'<span>Copy with sources</span></button>':'')
      +'<button class="act" type="button" data-act="regen">'+icon('regen')+'<span>Regenerate</span></button>'
      +'<button class="act" type="button" data-act="md">'+icon('down')+'<span>Export .md</span></button>'
      +((u||m.model)?'<span class="usage">'+esc([m.model?(modelNames[m.model]||m.model):'',u].filter(Boolean).join(' · '))+'</span>':'')+'</div>';
  }
  return h;
}
function msgEl(m,idx,last){
  const d=document.createElement('div');
  if(m.role==='user'){d.className='msg user';d.innerHTML='<div class="bub">'+esc(m.content)+'</div>';}
  else{d.className='msg asst';d.dataset.idx=idx;d.innerHTML=asstInner(m,last);d._m=m;enhance(d,m);}
  return d;
}
const lastAsst=()=>{for(let i=cur.messages.length-1;i>=0;i--)if(cur.messages[i].role==='assistant')return i;return -1;};
function renderAll(){
  closeCard();
  const box=$('#msgs');
  box.innerHTML=cur.messages.length?'':welcomeHtml();
  if(!cur.messages.length)showLibCount();
  const la=lastAsst();
  cur.messages.forEach((m,i)=>box.appendChild(msgEl(m,i,i===la)));
  $('#ctitle').textContent=cur.title;
  renderHist();box.scrollTop=box.scrollHeight;
}
/** DOM work after an answer is inserted: popup wiring, diagrams, the lazily drawn source map. */
function enhance(el,m){
  for(const a of el.querySelectorAll('.md a.cite')){a.setAttribute('aria-haspopup','dialog');a.setAttribute('aria-expanded','false');}
  for(const q of el.querySelectorAll('.md .q.bad')){q.tabIndex=0;q.setAttribute('role','button');q.setAttribute('aria-haspopup','dialog');q.dataset.tip=q.title;q.removeAttribute('title');}
  if(el.querySelector('.mmd'))queueMicrotask(()=>renderDiagrams(el,m));
  const sm=el.querySelector('details.smap');
  if(sm)sm.addEventListener('toggle',()=>{if(sm.open)requestAnimationFrame(()=>drawMap(sm,m));});
}
const nearBottom=()=>{const b=$('#msgs');return b.scrollHeight-b.scrollTop-b.clientHeight<80;};
const scrollDown=()=>{const b=$('#msgs');b.scrollTop=b.scrollHeight;};

/* ---------- source map drawing ---------- */
const smObs=typeof ResizeObserver==='function'?new ResizeObserver(es=>{for(const e of es){const d=e.target.closest('details.smap');if(d&&d.open){const el=d.closest('.msg');if(el&&el._m)drawMap(d,el._m);}}}):null;
function drawMap(d,m){
  const body=d.querySelector('.smb');const narrow=body.clientWidth<560;
  if(body.dataset.narrow===String(narrow)&&body.firstChild)return;
  body.dataset.narrow=String(narrow);
  body.innerHTML=sourceMapSvg(m.source_map,narrow,'sm-'+uid());
  const svg=body.querySelector('svg');if(!svg)return;
  if(smObs&&!body.dataset.obs){smObs.observe(body);body.dataset.obs='1';}
  const es=[...svg.querySelectorAll('.sm-e')];
  const sel=i=>{svg.classList.toggle('has-sel',i!=null);
    const on=new Set([i]);for(const e of es){const hit=i!=null&&(e.dataset.f===String(i)||e.dataset.t===String(i));e.classList.toggle('on',hit);if(hit){on.add(+e.dataset.f);on.add(+e.dataset.t);}}
    for(const n of svg.querySelectorAll('.sm-n'))n.classList.toggle('on',i!=null&&on.has(+n.dataset.i));};
  svg.addEventListener('pointerover',e=>{const n=e.target.closest('.sm-n');sel(n?+n.dataset.i:null);});
  svg.addEventListener('pointerleave',()=>sel(null));
  svg.addEventListener('focusin',e=>{const n=e.target.closest('.sm-n');sel(n?+n.dataset.i:null);});
  svg.addEventListener('focusout',()=>sel(null));
}

/* ---------- diagrams (mermaid, vendored, loaded on first use) ---------- */
let mmdP=null;
function loadMermaid(){
  return mmdP||(mmdP=new Promise((res,rej)=>{const s=document.createElement('script');s.src='vendor/mermaid.min.js';
    s.onload=()=>window.mermaid?res(window.mermaid):rej(new Error('Diagram renderer did not start'));
    s.onerror=()=>{mmdP=null;s.remove();rej(new Error('Could not load the diagram renderer'));};document.head.appendChild(s);}));
}
const isDark=()=>matchMedia('(prefers-color-scheme: dark)').matches;
function mmdConfig(){
  const cs=getComputedStyle(document.documentElement),v=k=>cs.getPropertyValue(k).trim(),dark=isDark();
  const font=getComputedStyle(document.body).fontFamily;
  return {startOnLoad:false,securityLevel:'strict',theme:'base',darkMode:dark,fontFamily:font,
    themeVariables:{darkMode:dark,fontFamily:font,fontSize:'13px',background:v('--panel'),mainBkg:v('--panel'),primaryColor:v('--panel'),primaryTextColor:v('--ink'),primaryBorderColor:v('--mute'),
      secondaryColor:v('--chip'),tertiaryColor:v('--bg'),textColor:v('--ink'),lineColor:v('--mute'),nodeBorder:v('--mute'),clusterBkg:v('--chip'),clusterBorder:v('--line'),
      edgeLabelBackground:v('--panel'),noteBkgColor:v('--chip'),noteTextColor:v('--ink'),noteBorderColor:v('--line'),actorBkg:v('--panel'),actorBorder:v('--mute'),actorTextColor:v('--ink'),
      signalColor:v('--mute'),signalTextColor:v('--ink'),labelBoxBkgColor:v('--chip'),labelTextColor:v('--ink'),cScale0:v('--chip'),cScale1:v('--chip'),cScale2:v('--chip')},
    flowchart:{htmlLabels:true,curve:'basis',padding:12,wrappingWidth:190,useMaxWidth:true},sequence:{useMaxWidth:true},timeline:{useMaxWidth:true}};
}
function diagramShell(b,code,state,msg){
  b.className='mmd '+state;b.dataset.src=code;
  b.innerHTML='<div class="mmdbar"><span class="mk">'+(state==='failed'?esc(msg||'This diagram could not be drawn, so its source is shown.'):'Diagram')+'</span>'
    +(state==='done'?'<button class="act" type="button" data-act="mmdsrc" aria-pressed="false">'+icon('code')+'<span>View source</span></button>':'')
    +'<button class="act" type="button" data-act="mmdcopy">'+icon('copy')+'<span>Copy</span></button></div>'
    +(state==='done'?'<div class="mmdsvg"></div>':'')+'<pre class="mmd-src"'+(state==='done'?' hidden':'')+'><code>'+esc(code)+'</code></pre>';
}
async function renderDiagrams(root,m){
  const blocks=[...root.querySelectorAll('.mmd:not(.done):not(.failed)')];if(!blocks.length)return;
  for(const b of blocks)if(!b.dataset.src){const c=b.querySelector('code');b.dataset.src=c?c.textContent:'';b.classList.add('loading');}
  let mm;
  try{mm=await loadMermaid();}catch(e){for(const b of blocks)diagramShell(b,b.dataset.src,'failed',e.message+'; showing its source.');return;}
  mm.initialize(mmdConfig());
  for(const b of blocks){
    const code=b.dataset.src,id='mmd-'+uid();
    try{
      const r=await mm.render(id,code);
      diagramShell(b,code,'done');b.querySelector('.mmdsvg').innerHTML=r.svg;
      if(m)linkDiagramCites(b,m);
    }catch(e){
      for(const x of [document.getElementById(id),document.getElementById('d'+id)])if(x)x.remove();
      diagramShell(b,code,'failed');
    }
  }
}
/** "(3)" in a node label becomes the same superscript source link as in the text. */
function linkDiagramCites(b,m){
  const cm=citeMap(m);if(!cm.size)return;
  const tw=document.createTreeWalker(b.querySelector('.mmdsvg'),NodeFilter.SHOW_TEXT);const hits=[];
  while(tw.nextNode()){const t=tw.currentNode;if(/\(\d+(?:\s*,\s*\d+)*\)/.test(t.nodeValue)&&t.parentElement&&t.parentElement.closest('foreignObject'))hits.push(t);}
  for(const t of hits){
    // only a free-standing "(n)" or "(n)(m)" counts; "Art. 4(2)" and "(2)(a)" are legal references
    const html=esc(t.nodeValue).replace(/(^|\s+)((?:\(\d{1,3}(?:\s*,\s*\d{1,3})*\))+)(?=$|[\s.,;:!?])/g,(all,sp,g)=>{const ns=g.match(/\d+/g).map(Number);return ns.every(n=>cm.get(n))?citeGroup(ns,cm):all;});
    const span=document.createElement('span');span.innerHTML=html;t.replaceWith(...span.childNodes);
  }
  for(const a of b.querySelectorAll('a.cite')){a.setAttribute('aria-haspopup','dialog');a.setAttribute('aria-expanded','false');}
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',async()=>{
  // redraw drawn diagrams in the new theme; the old drawing stays until the new one is ready
  const done=[...document.querySelectorAll('.mmd.done')];if(!done.length||!window.mermaid)return;
  window.mermaid.initialize(mmdConfig());
  for(const b of done){const id='mmd-'+uid();
    try{const r=await window.mermaid.render(id,b.dataset.src);b.querySelector('.mmdsvg').innerHTML=r.svg;const el=b.closest('.msg');if(el&&el._m)linkDiagramCites(b,el._m);}
    catch(e){for(const x of [document.getElementById(id),document.getElementById('d'+id)])if(x)x.remove();}}
});

/* ---------- source card (hover, focus or tap a citation number) ---------- */
const card=$('#card'),scrim=$('#scrim');
let cardFor=null,cardPinned=false,hoverT=0,leaveT=0,lastPtr='mouse',noFocusOpen=false;
const sheetMode=()=>matchMedia('(max-width: 640px)').matches;
const nsOf=el=>{const s=el.closest('.cs')||el;return [...s.className.matchAll(/\bc-(\d+)/g)].map(x=>+x[1]);};
function cardHtml(trigger,m){
  const cm=citeMap(m),ns=nsOf(trigger).filter(n=>cm.get(n));
  const quotes=quotesFor(m).filter(q=>q.ok);
  const bad=trigger.classList.contains('q');
  let h='<div class="cdh"><span id="card-t">'+(bad?'Quote not found':(ns.length>1?'Sources ':'Source ')+rangeLabel(ns))+'</span><button class="cx" type="button" data-act="close" aria-label="Close">'+icon('x')+'</button></div><div class="cdb">';
  if(bad)h+='<p class="cwarn">This quotation was not found in the text of '+(ns.length?'source '+rangeLabel(ns):'its cited source')+'. The model may have paraphrased or misquoted it. Check the original before relying on it.</p>';
  for(const n of ns){const c=cm.get(n),f=safeUrl(c.file_url),o=safeUrl(c.official_url);
    const qs=quotes.filter(q=>q.n===n).map(q=>q.quote);
    h+='<section class="cp"><div class="cpt"><span class="pn">'+n+'</span><b>'+esc(docName(c))+'</b>'+badge(c.status)+'</div>'
      +(c.doc_title&&c.doc_title!==docName(c)?'<div class="cpd">'+esc(c.doc_title)+'</div>':'')
      +'<div class="cpl">'+esc([locLabel(c),c.heading].filter(Boolean).join(' · '))+'</div>'
      +(c.excerpt?'<blockquote class="cpx">'+markQuotes(c.excerpt,qs)+'</blockquote>':'')
      +'<div class="cpa">'+(f?'<a class="btn sm pri" href="'+esc(f)+'" target="_blank" rel="noopener">'+icon('file')+(isPdfLink(f)&&c.page_start?'Open PDF at p. '+c.page_start:'Open file')+'</a>':'')
      +(o?'<a class="btn sm" href="'+esc(o)+'" target="_blank" rel="noopener noreferrer">'+icon('ext')+'Official source</a>':'')+'</div></section>';}
  return h+'</div>';
}
function placeCard(){
  if(!cardFor)return;
  if(card.classList.contains('sheet'))return;
  const r=cardFor.getBoundingClientRect(),vw=innerWidth,vh=innerHeight,w=card.offsetWidth,h=card.offsetHeight;
  if(r.bottom<0||r.top>vh){closeCard();return;}
  let x=Math.min(Math.max(8,r.left+r.width/2-w/2),vw-w-8),y=r.bottom+6;
  if(y+h>vh-8&&r.top-h-6>8)y=r.top-h-6;else if(y+h>vh-8)y=Math.max(8,vh-h-8);
  card.style.left=x+'px';card.style.top=y+'px';
}
function openCard(trigger,{pin=false,focus=false}={}){
  const el=trigger.closest('.msg');const m=el&&el._m;if(!m)return;
  clearTimeout(hoverT);clearTimeout(leaveT);
  if(cardFor!==trigger){
    if(cardFor)cardFor.setAttribute('aria-expanded','false');
    cardFor=trigger;card.innerHTML=cardHtml(trigger,m);
    const sheet=sheetMode()&&(pin||lastPtr!=='mouse');
    card.classList.toggle('sheet',sheet);scrim.hidden=!sheet;
    card.style.left=card.style.top='';card.hidden=false;placeCard();
    card.classList.remove('in');void card.offsetWidth;card.classList.add('in');
  }
  if(pin&&sheetMode()&&!card.classList.contains('sheet')){card.classList.add('sheet');scrim.hidden=false;card.style.left=card.style.top='';card.classList.remove('in');void card.offsetWidth;card.classList.add('in');}
  trigger.setAttribute('aria-expanded','true');
  cardPinned=cardPinned||pin;
  if(focus||card.classList.contains('sheet')){const f=card.querySelector('.cdb a,.cdb button')||card.querySelector('.cx');if(f)f.focus({preventScroll:true});}
}
function closeCard(refocus){
  clearTimeout(hoverT);clearTimeout(leaveT);
  if(!cardFor)return;
  const t=cardFor;cardFor=null;cardPinned=false;card.hidden=true;scrim.hidden=true;card.classList.remove('in','sheet');t.setAttribute('aria-expanded','false');
  if(refocus&&document.contains(t)){noFocusOpen=true;t.focus({preventScroll:true});noFocusOpen=false;}
}
const triggerOf=e=>e.target.closest&&e.target.closest('.msg.asst a.cite, .msg.asst .q.bad');
const msgsEl=$('#msgs');
addEventListener('pointerdown',e=>{lastPtr=e.pointerType||'mouse';if(cardFor&&!card.contains(e.target)&&!cardFor.contains(e.target))closeCard();},true);
msgsEl.addEventListener('pointerover',e=>{const t=triggerOf(e);if(!t||e.pointerType!=='mouse')return;clearTimeout(leaveT);if(cardFor===t)return;
  if(cardPinned&&cardFor)return;clearTimeout(hoverT);hoverT=setTimeout(()=>openCard(t),cardFor?40:140);});
msgsEl.addEventListener('pointerout',e=>{const t=triggerOf(e);if(!t||e.pointerType!=='mouse')return;clearTimeout(hoverT);
  if(cardFor===t&&!cardPinned&&!card.contains(e.relatedTarget))leaveT=setTimeout(()=>closeCard(),260);});
card.addEventListener('pointerenter',()=>clearTimeout(leaveT));
card.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!cardPinned&&!(cardFor&&cardFor.contains(e.relatedTarget)))leaveT=setTimeout(()=>closeCard(),260);});
msgsEl.addEventListener('focusin',e=>{const t=triggerOf(e);if(!t||noFocusOpen)return;if(lastPtr!=='mouse'&&!e.target.matches(':focus-visible'))return;if(cardFor!==t)openCard(t);});
msgsEl.addEventListener('focusout',e=>{const t=triggerOf(e);if(t&&cardFor===t&&!cardPinned&&e.relatedTarget&&!card.contains(e.relatedTarget))closeCard();});
card.addEventListener('focusout',e=>{if(cardFor&&e.relatedTarget&&!card.contains(e.relatedTarget)&&e.relatedTarget!==cardFor&&!card.classList.contains('sheet'))closeCard();});
msgsEl.addEventListener('keydown',e=>{const t=triggerOf(e);if(!t)return;
  if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){e.preventDefault();openCard(t,{pin:true,focus:true});}
  else if(e.key==='Escape'&&cardFor){e.preventDefault();closeCard();}});
card.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();closeCard(true);return;}
  if(e.key==='Tab'){const f=[...card.querySelectorAll('a[href],button')];if(!f.length)return;
    if(!e.shiftKey&&document.activeElement===f[f.length-1]||e.shiftKey&&document.activeElement===f[0]){e.preventDefault();closeCard(true);}}
});
card.addEventListener('click',e=>{if(e.target.closest('[data-act=close]'))closeCard(true);});
scrim.addEventListener('click',()=>closeCard(true));
addEventListener('keydown',e=>{if(e.key==='Escape'&&cardFor&&!card.contains(document.activeElement))closeCard();});
msgsEl.addEventListener('scroll',()=>{if(cardFor)requestAnimationFrame(placeCard);},{passive:true});
addEventListener('resize',()=>{if(cardFor&&!card.classList.contains('sheet'))requestAnimationFrame(placeCard);});

/* ---------- clicks inside the conversation ---------- */
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return true;}catch(e){
    const ta=document.createElement('textarea');ta.value=t;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
    let ok=false;try{ok=document.execCommand('copy');}catch(_){}ta.remove();return ok;}
}
function flash(btn,txt){const s=btn.querySelector('span');if(!s)return;const o=s.dataset.o||s.textContent;s.dataset.o=o;s.textContent=txt;btn.classList.add('ok');$('#status').textContent=txt;
  clearTimeout(btn._t);btn._t=setTimeout(()=>{s.textContent=o;btn.classList.remove('ok');},1600);}
msgsEl.addEventListener('click',async e=>{
  const ex=e.target.closest('[data-ex]');if(ex){ask(ex.dataset.ex);return;}
  const fu=e.target.closest('[data-ask]');if(fu){ask(fu.dataset.ask);return;}
  const t=triggerOf(e);
  if(t){if(t.tagName==='A'&&(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1))return;e.preventDefault();
    if(cardFor===t&&cardPinned)closeCard();else openCard(t,{pin:true});return;}
  const b=e.target.closest('[data-act]');if(!b)return;
  const el=b.closest('.msg');const idx=el?+el.dataset.idx:-1;const m=cur.messages[idx];
  const act=b.dataset.act;
  if(act==='mmdsrc'){const f=b.closest('.mmd');const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on);
    f.querySelector('.mmd-src').hidden=!on;f.querySelector('.mmdsvg').hidden=on;b.querySelector('span').textContent=on?'View diagram':'View source';return;}
  if(act==='mmdcopy'){const f=b.closest('.mmd');flash(b,await copyText('```mermaid\n'+f.dataset.src+'\n```')?'Copied':'Copy failed');return;}
  if(!m)return;
  if(act==='copy')flash(b,await copyText(m.content||'')?'Copied':'Copy failed');
  else if(act==='copysrc')flash(b,await copyText(answerMd(m,null))?'Copied':'Copy failed');
  else if(act==='md'){const q=questionFor(idx);download('railcert-answer-'+slug(q||cur.title)+'.md',docHeader(q||cur.title)+answerMd(m,q));}
  else if(act==='regen')regenerate(idx);
});
const questionFor=idx=>{for(let i=idx-1;i>=0;i--)if(cur.messages[i].role==='user')return cur.messages[i].content;return '';};
function regenerate(idx){
  if(busy)return;const q=questionFor(idx);if(!q)return;
  if(idx===cur.messages.length-1&&cur.messages[idx-1]&&cur.messages[idx-1].role==='user'){cur.messages.splice(idx-1,2);persist();renderAll();}
  ask(q);
}

/* ---------- SSE ---------- */
async function streamAsk(messages,onEvent,signal){
  const r=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(modelSel()?{messages,model:modelSel()}:{messages}),signal});
  if(!r.ok){let t='';try{const j=await r.json();t=j.error||'';}catch(e){}throw new Error((t||('Request failed'))+' (HTTP '+r.status+')');}
  if(!r.body)throw new Error('This browser cannot read streamed responses.');
  const rd=r.body.getReader(),dec=new TextDecoder();let buf='';
  const flush=blk=>{let ev='message',data=[];for(const ln of blk.split('\n')){if(ln.startsWith('event:'))ev=ln.slice(6).trim();else if(ln.startsWith('data:'))data.push(ln.slice(5).replace(/^ /,''));}
    if(!data.length)return;let j;try{j=JSON.parse(data.join('\n'));}catch(e){return;}onEvent(ev,j);};
  for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true}).replace(/\r\n?/g,'\n');
    let k;while((k=buf.indexOf('\n\n'))>=0){flush(buf.slice(0,k));buf=buf.slice(k+2);}}
  if(buf.trim())flush(buf);
}
function setBusy(b){busy=b;$('#send').hidden=b;$('#stop').hidden=!b;$('#q').disabled=false;$('#newchat').disabled=b;
  for(const f of document.querySelectorAll('.fup,[data-act=regen]'))f.disabled=b;if(!b)$('#q').focus();}
const stripRaw=s=>String(s||'').replace(/\[c:\d+\]/g,'');
async function ask(override){
  const ta=$('#q');const text=(override!=null?String(override):ta.value).trim();if(!text||busy)return;
  if(override==null){ta.value='';autosize();}
  closeCard();
  const box=$('#msgs');
  for(const f of box.querySelectorAll('.fups'))f.remove();
  cur.messages.push({role:'user',content:text});
  if(cur.title==='New chat')cur.title=text.length>60?text.slice(0,57)+'…':text;
  persist();
  if(box.querySelector('.welcome'))box.innerHTML='';
  box.appendChild(msgEl(cur.messages[cur.messages.length-1]));
  const m={role:'assistant',content:'',steps:[],citations:[],quote_checks:[]};
  const el=document.createElement('div');el.className='msg asst running';
  el.innerHTML='<details class="trace live" open><summary><span class="spin" aria-hidden="true"></span><span class="tl">Working…</span></summary><ol></ol></details><div class="md live" aria-busy="true"></div>';
  box.appendChild(el);scrollDown();$('#ctitle').textContent=cur.title;
  const ol=el.querySelector('ol'),tl=el.querySelector('.tl'),live=el.querySelector('.md.live');
  const status=$('#status');status.textContent='Searching the library…';
  let raw='';let finished=false;let paintT=0;const t0=performance.now();
  const paint=()=>{paintT=0;const stick=nearBottom();live.innerHTML=mdRender(stripRaw(raw),'live');if(stick)scrollDown();};
  abortCtl=new AbortController();setBusy(true);
  const history=cur.messages.map(x=>({role:x.role,content:x.content})).filter(x=>x.content);
  try{
    await streamAsk(history,(ev,j)=>{
      const stick=nearBottom();
      if(ev==='step'){const s=j.summary||('Step '+j.n+': '+j.tool);m.steps.push({tool:j.tool||'',summary:s});const li=document.createElement('li');li.textContent=s;ol.appendChild(li);tl.textContent=s;status.textContent=s;}
      else if(ev==='token'){if(!raw)tl.textContent='Writing the answer…';raw+=j.t||'';if(!paintT)paintT=setTimeout(paint,100);}
      else if(ev==='done'){finished=true;m.content=j.answer!=null?j.answer:raw;m.citations=j.citations||[];m.quote_checks=j.quote_checks||[];m.usage=j.usage;m.nsteps=j.steps;m.model=j.model;
        if(Array.isArray(j.follow_ups))m.follow_ups=j.follow_ups.filter(x=>typeof x==='string'&&x.trim()).slice(0,3);
        if(j.source_map&&Array.isArray(j.source_map.nodes))m.source_map=j.source_map;}
      else if(ev==='error'){finished=true;m.error=j.message||'The server reported an error.';m.content=m.content||stripRaw(raw);}
      if(stick)scrollDown();
    },abortCtl.signal);
    if(!finished){m.error='The connection ended before the answer was complete.';m.content=stripRaw(raw);}
  }catch(e){
    m.content=stripRaw(raw);
    if(e.name==='AbortError')m.stopped=true;else m.error=(e.message||'Network error')+(/fetch|network/i.test(e.message||'')?' – is the Ask server running?':'');
  }
  clearTimeout(paintT);m.ms=Math.round(performance.now()-t0);
  abortCtl=null;setBusy(false);status.textContent=m.error?'Error':'Answer complete';
  if(m.content||m.error||m.steps.length){cur.messages.push(m);persist();}
  const fin=msgEl(m,cur.messages.indexOf(m),true);el.replaceWith(fin);scrollDown();
}
$('#form').onsubmit=e=>{e.preventDefault();ask();};
$('#stop').onclick=()=>{if(abortCtl)abortCtl.abort();};
const autosize=()=>{const t=$('#q');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,200)+'px';};
$('#q').addEventListener('input',autosize);
$('#q').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask();}});

/* ---------- export ---------- */
const slug=s=>String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,40).toLowerCase()||'chat';
const docHeader=t=>'# '+t+'\n\n_Exported '+new Date().toISOString().slice(0,16).replace('T',' ')+' from Railcert Ask. AI-generated from the library; verify against the official text._\n\n';
function answerMd(m,question){
  let md=question!=null?'## Question\n\n'+question+'\n\n## Answer\n\n':'';
  md+=(m.content||'')+'\n\n';
  if(m.error)md+='> Error: '+m.error+'\n\n';
  const bad=(m.quote_checks||[]).filter(q=>q.ok===false);
  if(bad.length)md+='> ⚠ Quotes not found in the cited source:\n'+bad.map(q=>'> - “'+q.quote+'”').join('\n')+'\n\n';
  if(m.citations&&m.citations.length){md+=(question!=null?'### ':'')+'Sources\n\n'+m.citations.map(c=>{
    const f=c.file_url?location.origin+c.file_url:'';
    return '['+c.n+'] **'+docName(c)+'**'+(c.doc_title&&c.doc_title!==docName(c)?' – '+c.doc_title:'')+(locLabel(c)?', '+locLabel(c):'')+(c.status?' ('+c.status+')':'')+(c.official_url?' – <'+c.official_url+'>':'')+(f?' – [local file]('+f.replace(/ /g,'%20')+')':'');}).join('\n\n')+'\n\n';}
  return md;
}
function download(name,text){
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));a.download=name;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
$('#export').onclick=()=>{
  if(!cur||!cur.messages.length)return;
  let md=docHeader(cur.title);
  for(const [i,m] of cur.messages.entries()){
    if(m.role==='user'){md+='## Question\n\n'+m.content+'\n\n';continue;}
    md+=answerMd(m,null).replace(/^/,'## Answer\n\n').replace(/\n\nSources\n\n/,'\n\n### Sources\n\n');
  }
  download('railcert-ask-'+slug(cur.title)+'.md',md);
};

/* ---------- tabs ---------- */
function setMode(mode){
  for(const t of document.querySelectorAll('[role=tab]')){const on=t.dataset.mode===mode;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;}
  $('#v-ask').classList.toggle('on',mode==='ask');$('#v-ask').hidden=mode!=='ask';
  $('#v-search').classList.toggle('on',mode==='search');$('#v-search').hidden=mode!=='search';
  try{history.replaceState(null,'','#'+mode);}catch(e){}
  closeCard();
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
  return '<li class="hit"><div class="top"><span class="sn">'+esc(docName(h))+'</span>'+badge(h.status)
   +(h.ertms_set?'<span class="badge">'+esc(h.ertms_set)+'</span>':'')+(h.doc_title&&h.doc_title!==docName(h)?'<span class="dt">'+esc(h.doc_title)+'</span>':'')+'</div>'
   +'<div class="loc">'+esc([h.locator,h.heading,h.page_start?'p. '+h.page_start+(h.page_end&&h.page_end!==h.page_start?'–'+h.page_end:''):'',h.area].filter(Boolean).join(' · '))+'</div>'
   +'<div class="snip">'+hl(h.snippet||'',q)+'</div><div class="links">'
   +(f?'<a class="lk" href="'+esc(f)+'" target="_blank" rel="noopener" title="Open the local file at this page">'+icon('file')+(isPdfLink(f)&&h.page_start?'PDF p. '+h.page_start:'Open file')+'</a>':'')
   +(o?'<a class="lk" href="'+esc(o)+'" target="_blank" rel="noopener noreferrer" title="Official source">'+icon('ext')+'Official source</a>':'')
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
let libDocs=0;
function showLibCount(){const s=$('#libcount');if(s&&libDocs)s.textContent=' ('+libDocs.toLocaleString()+' documents)';}
/* ---------- model picker ---------- */
const LSMODEL='railcertAskModel';let modelNames={};
function fillModels(list,def){
  const sel=$('#model');if(!sel)return;
  if(!Array.isArray(list)||!list.length){list=def?[{id:def,label:def,default:true}]:[];}
  modelNames={};for(const m of list)modelNames[m.id]=m.label||m.id;
  let saved='';try{saved=localStorage.getItem(LSMODEL)||'';}catch(e){}
  if(!list.some(m=>m.id===saved))saved=(list.find(m=>m.default)||list[0]||{}).id||'';
  sel.innerHTML=list.map(m=>'<option value="'+esc(m.id)+'">'+esc((m.label||m.id)+(m.default?' (default)':''))+'</option>').join('');
  sel.value=saved;sel.closest('.mpick').hidden=list.length<2;
}
function modelSel(){const sel=$('#model');return sel&&sel.value?sel.value:'';}
document.addEventListener('change',e=>{if(e.target&&e.target.id==='model'){try{localStorage.setItem(LSMODEL,e.target.value);}catch(err){}}});

async function health(){
  const el=$('#health');
  try{
    const r=await fetch('/api/health');const j=await r.json();if(!r.ok||!j.ok)throw new Error();
    el.classList.remove('bad');
    el.textContent=[(j.docs||0).toLocaleString()+' docs',(j.chunks||0).toLocaleString()+' passages','semantic '+(j.vectors?'on':'off'),j.build_date?'built '+j.build_date:''].filter(Boolean).join(' · ');
    fillModels(j.models,j.model);
    if(j.build_date)$('#build').textContent='Index built '+j.build_date+'.';
    libDocs=j.docs||0;showLibCount();
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
