// Throwaway mock of the railcert-ask API for UI testing. Pure Node, no deps.  node server.cjs [port]
// Questions containing these words switch the /api/ask scenario:
//   "network" → connection drops · "error" → error event · "legacy" → old done event without the v2 fields
//   "baddiagram" → a mermaid block that fails to parse · anything else → the full v2 answer (slow token stream)
const http=require('http'),fs=require('fs'),path=require('path');
const PUB=path.join(__dirname,'..','..','public'),PORT=+process.argv[2]||8788;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.txt':'text/plain; charset=utf-8'};
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; object-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
const cit=(n,o)=>Object.assign({n,chunk_id:100+n,doc_path:'03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf',doc_title:'Commission Implementing Regulation (EU) No 402/2013 on the common safety method for risk evaluation and assessment',short_name:'CSM RA',reference:'Reg 402/2013',status:'consolidated',area:'CSM_Safety',ertms_set:null,locator:'Art. 5',heading:'Risk acceptance principles',page_start:7,page_end:7,inner_file:null,anchor:null,file_url:'/files/03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf#page=7',official_url:'https://eur-lex.europa.eu/eli/reg_impl/2013/402/oj'},o||{});
const hit=(i,o)=>Object.assign(cit(i),{snippet:'The risk acceptance principles are: compliance with codes of practice, comparison with similar systems, explicit risk estimation (ERA) for the proposal.',score:.9-i*.1},o||{});
const sse=(res,ev,d)=>res.write('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const IOD={doc_path:'01_EU_Framework/Directive_2016-797_Interoperability.pdf',short_name:'Interoperability Directive',doc_title:'Directive (EU) 2016/797 on the interoperability of the rail system within the European Union (recast)',reference:'Dir 2016/797',status:'in_force',area:'EU_Framework',official_url:'https://eur-lex.europa.eu/eli/dir/2016/797/oj'};
const PA={doc_path:'01_EU_Framework/Reg_2018-545_Practical_arrangements_VA.pdf',short_name:'2018/545',doc_title:'Commission Implementing Regulation (EU) 2018/545 establishing practical arrangements for the railway vehicle authorisation and railway vehicle type authorisation process',reference:'Reg 2018/545',status:'in_force',area:'Vehicle_Authorisation_Registers',official_url:'https://eur-lex.europa.eu/eli/reg_impl/2018/545/oj'};
const GUIDE={doc_path:'06_ERA_Guides/ERA-PRG-005_VA_guidelines.pdf',short_name:'PA VA Guidelines',doc_title:'Guidelines for the practical arrangements for vehicle authorisation (ERA-PRG-005)',reference:'ERA-PRG-005',status:'in_force',area:'ERA_Guides',official_url:'https://www.era.europa.eu/domains/vehicles/vehicle-authorisation_en'};
const f=(p,page)=>'/files/'+p+'#page='+page;
const V2_CITES=[
  cit(1,Object.assign({},IOD,{chunk_id:4101,locator:'Art. 21(3)',heading:'Vehicle authorisation for placing on the market',page_start:38,page_end:38,file_url:f(IOD.doc_path,38),
    excerpt:'3. The applicant shall submit the application for a vehicle authorisation through the one-stop shop referred to in Article 12 of Regulation (EU) 2016/796. The application file shall include evidence of the technical compatibility of the vehicle with the network in the area of use and of the safe integration of the vehicle, demonstrated on the basis of the relevant TSIs, national rules and registers.'})),
  cit(2,Object.assign({},IOD,{chunk_id:4105,locator:'Art. 21(8)',heading:'Authorising entity',page_start:39,page_end:40,file_url:f(IOD.doc_path,39),
    excerpt:'8. Where the area of use is limited to a network or networks within one Member State only, the applicant may choose whether to submit the application to the Agency or to the national safety authority of that Member State. The national safety authority shall then issue the vehicle authorisation.'})),
  cit(3,Object.assign({},PA,{chunk_id:5203,locator:'Art. 4',heading:'Pre-engagement',page_start:9,page_end:9,file_url:f(PA.doc_path,9),
    excerpt:'1. Before submitting an application, the applicant may request pre-engagement with the authorising entity. 2. The pre-engagement baseline shall record the TSIs, national rules and the requirements the authorising entity will assess, including the parameters to be checked for network compatibility.'})),
  cit(4,Object.assign({},PA,{chunk_id:5240,locator:'Art. 34',heading:'Time for the assessment',page_start:21,page_end:21,file_url:f(PA.doc_path,21),
    excerpt:'The authorising entity shall take a decision on the application without undue delay and at the latest within four months of the receipt of a complete file. The time limit may be suspended where the authorising entity requests additional information from the applicant.'})),
  cit(5,{chunk_id:6105,locator:'Art. 6(1)',heading:'Independent assessment',page_start:9,page_end:10,file_url:'/files/03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf#page=9',
    excerpt:'An independent assessment of the correct application of the risk management process set out in Annex I and of the results of this application shall be carried out by an assessment body. The assessment body shall meet the criteria listed in Annex II.'}),
  cit(6,Object.assign({},GUIDE,{chunk_id:7311,locator:'§ 2.3.4',heading:'Checks carried out by the national safety authority',page_start:58,page_end:59,file_url:f(GUIDE.doc_path,58),
    excerpt:'The national safety authority checks the evidence related to the national rules notified for the area of use. The checks are limited to the parameters identified in the pre-engagement baseline and do not repeat the verification already performed by the notified or designated bodies.'})),
];
const V2_ANSWER=[
'In Norway the national safety authority (Statens jernbanetilsyn) or ERA authorises the vehicle on the basis of the application file; the DeBo checks conformity with the **notified national rules** only, not the TSIs [1][2][6].',
'',
'## Who authorises',
'',
'- For an area of use limited to Norway, the applicant chooses whether to apply to ERA or to the national safety authority [2].',
'- The application goes through the one-stop shop, with evidence of technical compatibility and safe integration [1].',
'- Pre-engagement is optional but fixes the baseline the authorising entity will assess [3].',
'',
'## What the DeBo checks',
'',
'The guidelines say the national checks “are limited to the parameters identified in the pre-engagement baseline” [6]. The directive also states that the DeBo “shall verify every national rule including those not notified” [1], which should be checked against the source.',
'',
'> The authorising entity shall take a decision “at the latest within four months of the receipt of a complete file” [4].',
'',
'| Step | Who | Basis |',
'|---|---|---|',
'| Pre-engagement | Applicant, authorising entity | 2018/545 Art. 4 [3] |',
'| Conformity with national rules | DeBo | PA VA Guidelines § 2.3.4 [6] |',
'| Safe integration (CSM RA) | AsBo | CSM RA Art. 6 [5] |',
'| Decision within 4 months | ERA or SJT | 2018/545 Art. 34 [4] |',
'',
'```mermaid',
'flowchart TD',
'  A["Pre-engagement baseline (3)"] --> B["Application via one-stop shop (1)"]',
'  B --> C{"Area of use only Norway?"}',
'  C -- yes --> D["Søkeren velger ERA eller Statens jernbanetilsyn som autoriserende enhet (1)(2)"]',
'  C -- no --> E["ERA authorises"]',
'  D --> F["DeBo: notified national rules (6)"]',
'  E --> F',
'  F --> G["AsBo: safe integration (5)"]',
'  G --> H["Decision within 4 months (4)"]',
'```',
'',
'Paid standards such as `EN 50126` are not in the library; only the documents that cite them are.',
].join('\n');
const V2_DONE={answer:V2_ANSWER,citations:V2_CITES,
  quote_checks:[
    {quote:'are limited to the parameters identified in the pre-engagement baseline',chunk_id:7311,ok:true,n:6},
    {quote:'shall verify every national rule including those not notified',chunk_id:4101,ok:false,n:1},
    {quote:'at the latest within four months of the receipt of a complete file',chunk_id:5240,ok:true,n:4},
  ],
  follow_ups:['Which national rules has Norway notified for vehicles?','What goes into the pre-engagement baseline?','When is a new authorisation needed after a change to the vehicle?'],
  source_map:{nodes:[
    {path:IOD.doc_path,label:'Interoperability Directive',area:'EU_Framework',status:'in_force',kind:'act',cited:true,ns:[1,2],level:0},
    {path:'01_EU_Framework/Directive_2016-798_Safety.pdf',label:'Safety Directive',area:'EU_Framework',status:'in_force',kind:'act',cited:false,ns:[],level:0},
    {path:PA.doc_path,label:'2018/545 Practical arrangements',area:'Vehicle_Authorisation_Registers',status:'in_force',kind:'act',cited:true,ns:[3,4],level:1},
    {path:'03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf',label:'CSM RA',area:'CSM_Safety',status:'consolidated',kind:'act',cited:true,ns:[5],level:1},
    {path:'02_TSI/LOC_PAS_TSI_2023.pdf',label:'LOC&PAS TSI',area:'TSI',status:'in_force',kind:'act',cited:false,ns:[],level:1},
    {path:GUIDE.doc_path,label:'PA VA Guidelines',area:'ERA_Guides',status:'in_force',kind:'guide',cited:true,ns:[6],level:2},
    {path:'08_Norway/Samtrafikkforskriften.pdf',label:'Samtrafikkforskriften',area:'Norway',status:'in_force',kind:'national',cited:false,ns:[],level:2},
    {path:'09_Referenced/EN_50126-1.pdf',label:'EN 50126-1 <RAMS>',area:'Referenced_Documents',status:'',kind:'standard',cited:false,ns:[],level:4},
  ],edges:[
    {from:PA.doc_path,to:IOD.doc_path,mentions:14},
    {from:'03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf',to:'01_EU_Framework/Directive_2016-798_Safety.pdf',mentions:6},
    {from:'02_TSI/LOC_PAS_TSI_2023.pdf',to:IOD.doc_path,mentions:9},
    {from:GUIDE.doc_path,to:PA.doc_path,mentions:31},
    {from:GUIDE.doc_path,to:'03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf',mentions:7},
    {from:GUIDE.doc_path,to:IOD.doc_path,mentions:12},
    {from:'08_Norway/Samtrafikkforskriften.pdf',to:IOD.doc_path,mentions:5},
    {from:PA.doc_path,to:'03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf',mentions:3},
    {from:'03_CSM_Safety/CSM_RA_402-2013_consolidated.pdf',to:'09_Referenced/EN_50126-1.pdf',mentions:2},
    {from:'02_TSI/LOC_PAS_TSI_2023.pdf',to:'09_Referenced/EN_50126-1.pdf',mentions:4},
  ]},
  usage:{prompt_tokens:24518,completion_tokens:744,cost_usd:0.0061},steps:5};

const LEGACY_ANSWER='## Risk acceptance principles\n\nCSM RA defines **three** principles [1]:\n\n1. Application of *codes of practice*\n2. Comparison with reference systems [1, 2]\n3. Explicit risk estimation\n\nThe text says “the proposer shall demonstrate compliance with all the requirements of this Regulation” [2] and also “this sentence was invented by the model for testing” [1].\n\n| Principle | Article |\n|---|---|\n| Codes of practice | Art. 5(1) |\n| Reference system | Art. 5(2) |\n\nSee [the official text](https://eur-lex.europa.eu/eli/reg_impl/2013/402) and `Annex I`. <b>raw html</b> must be escaped. Unknown cite [9].\n';
const LEGACY_DONE={answer:LEGACY_ANSWER,citations:[cit(1),cit(2,{short_name:'SUBSET-026',doc_title:'System Requirements Specification',locator:'3.5.3.7',page_start:41,page_end:42,area:'ERTMS_Specifications',file_url:'/files/x.pdf#page=41'})],quote_checks:[{quote:'the proposer shall demonstrate compliance with all the requirements of this Regulation',chunk_id:102,ok:true},{quote:'this sentence was invented by the model for testing',chunk_id:101,ok:false}],usage:{prompt_tokens:18234,completion_tokens:612,cost_usd:0.0042},steps:2};

http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://x');
  res.setHeader('Content-Security-Policy',CSP);
  if(u.pathname==='/api/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,docs:991,chunks:48213,vectors:true,model:'deepseek/deepseek-v4.1-flash',build_date:'2026-11-20'}));}
  if(u.pathname==='/api/search'){res.setHeader('Content-Type','application/json');const q=u.searchParams.get('q');
    if(q==='boom'){res.statusCode=500;return res.end('{"error":"search backend down"}');}
    return res.end(JSON.stringify({query:q,mode:'hybrid',results:[hit(1),hit(2,{short_name:'SUBSET-026',locator:'3.5.3.7',status:'repealed',area:'ERTMS_Specifications',ertms_set:'Set3',file_url:null,page_start:null,heading:'Level transitions'}),hit(3,{doc_title:'<img src=x onerror=alert(1)>',snippet:'<script>alert(1)</script> risk acceptance'})]}));}
  if(u.pathname==='/api/ask'&&req.method==='POST'){
    let b='';for await(const c of req)b+=c;const msgs=JSON.parse(b).messages;const last=msgs[msgs.length-1].content;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    if(/network/i.test(last)){res.write('event: step\ndata: {"n":1,"tool":"search","summary":"Searching “x”"}\n\n');await sleep(300);return res.destroy();}
    const legacy=/legacy/i.test(last);
    sse(res,'step',{n:1,tool:'search',args:{},summary:'Searching “vehicle authorisation Norway DeBo” — 14 hits'});await sleep(450);
    sse(res,'step',{n:2,tool:'search',args:{},summary:'Searching “national rules notified area of use” — 9 hits'});await sleep(450);
    if(/error/i.test(last)){sse(res,'error',{message:'Upstream model returned 502'});return res.end();}
    let done;
    if(legacy)done=LEGACY_DONE;
    else{
      sse(res,'step',{n:3,tool:'read',args:{},summary:'Reading Interoperability Directive, Art. 21'});await sleep(400);
      sse(res,'step',{n:4,tool:'read',args:{},summary:'Reading 2018/545, Art. 4 and Art. 34'});await sleep(400);
      sse(res,'step',{n:5,tool:'search',args:{},summary:'Searching “PA VA guidelines national safety authority checks” — 6 hits'});await sleep(400);
      done=JSON.parse(JSON.stringify(V2_DONE));
      if(/baddiagram/i.test(last))done.answer=done.answer.replace('flowchart TD','flowchart TD\n  A[[[ broken --> ((');
    }
    const words=done.answer.match(/\S+\s*/g);
    for(let i=0;i<words.length;i+=2){sse(res,'token',{t:words.slice(i,i+2).join('')});await sleep(45);}
    sse(res,'done',done);
    return res.end();
  }
  if(u.pathname.startsWith('/files/')){res.setHeader('Content-Type','text/plain');return res.end('mock file: '+decodeURIComponent(u.pathname));}
  let p=u.pathname==='/'?'/index.html':u.pathname;const fl=path.join(PUB,path.normalize(p));
  if(!fl.startsWith(PUB)||!fs.existsSync(fl)||fs.statSync(fl).isDirectory()){res.statusCode=404;return res.end('not found');}
  res.setHeader('Content-Type',MIME[path.extname(fl)]||'application/octet-stream');res.end(fs.readFileSync(fl));
}).listen(PORT,'127.0.0.1',()=>console.log('mock on http://127.0.0.1:'+PORT));
