// Throwaway mock of the railcert-ask API for UI testing. Pure Node, no deps.  node server.js [port]
const http=require('http'),fs=require('fs'),path=require('path');
const PUB=path.join(__dirname,'..','..','public'),PORT=+process.argv[2]||8788;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
const cit=(n,o)=>Object.assign({n,chunk_id:100+n,doc_path:'x/y.pdf',doc_title:'Commission Implementing Regulation (EU) 402/2013 on the common safety method for risk evaluation and assessment',short_name:'CSM RA',reference:'Reg 402/2013',status:'in_force',area:'CSM_Safety',ertms_set:null,locator:'Art. 5',heading:'Risk acceptance principles',page_start:7,page_end:7,inner_file:null,anchor:null,file_url:'/files/03_CSM_Safety/CSM_RA.pdf#page=7',official_url:'https://eur-lex.europa.eu/eli/reg_impl/2013/402'},o||{});
const hit=(i,o)=>Object.assign(cit(i),{snippet:'The risk acceptance principles are: compliance with codes of practice, comparison with similar systems, explicit risk estimation (ERA) for the proposal.',score:.9-i*.1},o||{});
const sse=(res,ev,d)=>res.write('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/api/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,docs:991,chunks:48213,vectors:true,model:'deepseek/deepseek-v4.1-flash',build_date:'2026-11-20'}));}
  if(u.pathname==='/api/search'){res.setHeader('Content-Type','application/json');const q=u.searchParams.get('q');
    if(q==='boom'){res.statusCode=500;return res.end('{"error":"search backend down"}');}
    return res.end(JSON.stringify({query:q,mode:'hybrid',results:[hit(1),hit(2,{short_name:'SUBSET-026',locator:'3.5.3.7',status:'repealed',area:'ERTMS_Specifications',ertms_set:'Set3',file_url:null,page_start:null,heading:'Level transitions'}),hit(3,{doc_title:'<img src=x onerror=alert(1)>',snippet:'<script>alert(1)</script> risk acceptance'})]}));}
  if(u.pathname==='/api/ask'&&req.method==='POST'){
    let b='';for await(const c of req)b+=c;const msgs=JSON.parse(b).messages;const last=msgs[msgs.length-1].content;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    if(/network/i.test(last)){res.write('event: step\ndata: {"n":1,"tool":"search","summary":"Searching “x”"}\n\n');await sleep(300);return res.destroy();}
    sse(res,'step',{n:1,tool:'search',args:{},summary:'Searching “risk acceptance principles CSM RA” — 12 hits'});await sleep(500);
    sse(res,'step',{n:2,tool:'read',args:{},summary:'Reading CSM RA, Art. 5'});await sleep(500);
    if(/error/i.test(last)){sse(res,'error',{message:'Upstream model returned 502'});return res.end();}
    const ans='## Risk acceptance principles\n\nCSM RA defines **three** principles [1]:\n\n1. Application of *codes of practice*\n2. Comparison with reference systems [1, 2]\n3. Explicit risk estimation\n\nThe text says “the proposer shall demonstrate compliance with all the requirements of this Regulation” [2] and also “this sentence was invented by the model for testing” [1].\n\n| Principle | Article |\n|---|---|\n| Codes of practice | Art. 5(1) |\n| Reference system | Art. 5(2) |\n\nSee [the official text](https://eur-lex.europa.eu/eli/reg_impl/2013/402) and `Annex I`. <b>raw html</b> must be escaped. Unknown cite [9].\n';
    for(const w of ans.match(/\S+\s*/g)){sse(res,'token',{t:w.replace(/\[\d+(, \d)?\]/g,m=>m)});await sleep(25);}
    sse(res,'done',{answer:ans,citations:[cit(1),cit(2,{short_name:'SUBSET-026',doc_title:'System Requirements Specification',locator:'3.5.3.7',page_start:41,page_end:42,area:'ERTMS_Specifications',file_url:'/files/x.pdf#page=41'})],quote_checks:[{quote:'the proposer shall demonstrate compliance with all the requirements of this Regulation',chunk_id:102,ok:true},{quote:'this sentence was invented by the model for testing',chunk_id:101,ok:false}],usage:{prompt_tokens:18234,completion_tokens:612,cost_usd:0.0042},steps:2});
    return res.end();
  }
  if(u.pathname.startsWith('/files/')){res.setHeader('Content-Type','text/plain');return res.end('mock file');}
  let p=u.pathname==='/'?'/index.html':u.pathname;const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)){res.statusCode=404;return res.end('not found');}
  res.setHeader('Content-Type',MIME[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));
}).listen(PORT,'127.0.0.1',()=>console.log('mock on http://127.0.0.1:'+PORT));
