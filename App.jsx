import { useState, useRef, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTING MAPPING  (계정과목 → 재무제표 항목)
// ─────────────────────────────────────────────────────────────────────────────
const ACC_MAP = {
  // 손익계산서 매출
  "매출":          { fs:"pl", plGroup:"revenue",   label:"매출액" },
  // 손익계산서 매출원가
  "매출원가":      { fs:"pl", plGroup:"cogs",       label:"매출원가" },
  // 손익계산서 판매관리비
  "급여":          { fs:"pl", plGroup:"sga",        label:"급여" },
  "임차료":        { fs:"pl", plGroup:"sga",        label:"임차료" },
  "식대":          { fs:"pl", plGroup:"sga",        label:"복리후생비(식대)" },
  "소모품비":      { fs:"pl", plGroup:"sga",        label:"소모품비" },
  "광고선전비":    { fs:"pl", plGroup:"sga",        label:"광고선전비" },
  "접대비":        { fs:"pl", plGroup:"sga",        label:"접대비" },
  "차량유지비":    { fs:"pl", plGroup:"sga",        label:"차량유지비" },
  "복리후생비":    { fs:"pl", plGroup:"sga",        label:"복리후생비" },
  "통신비":        { fs:"pl", plGroup:"sga",        label:"통신비" },
  "교육훈련비":    { fs:"pl", plGroup:"sga",        label:"교육훈련비" },
  "수수료":        { fs:"pl", plGroup:"sga",        label:"지급수수료" },
  "세금과공과":    { fs:"pl", plGroup:"sga",        label:"세금과공과" },
  "보험료":        { fs:"pl", plGroup:"sga",        label:"보험료" },
  "여비교통비":    { fs:"pl", plGroup:"sga",        label:"여비교통비" },
  "잡비":          { fs:"pl", plGroup:"sga",        label:"잡비" },
  "미확인":        { fs:"pl", plGroup:"sga",        label:"미확인비용" },
};

const CAT_COLOR = {
  "매출":"#34d399","매출원가":"#60a5fa","급여":"#818cf8","임차료":"#a78bfa",
  "식대":"#fbbf24","소모품비":"#9ca3af","광고선전비":"#f472b6","접대비":"#fb923c",
  "차량유지비":"#2dd4bf","복리후생비":"#a3e635","통신비":"#38bdf8",
  "교육훈련비":"#c084fc","수수료":"#94a3b8","세금과공과":"#f87171",
  "보험료":"#e879f9","여비교통비":"#0ea5e9","잡비":"#71717a","미확인":"#f97316"
};
const cc = a => CAT_COLOR[a] || "#9ca3af";
const ACCOUNT_CATEGORIES = Object.keys(ACC_MAP);

const KWORDS = [
  {k:["스타벅스","커피","카페","빽다방","투썸","이디야","배달","배민","요기요","점심","저녁","식당","음식점","편의점","gs25","cu"],a:"식대"},
  {k:["주유","gs칼텍스","sk에너지","현대오일","하이패스","톨게이트","주차"],a:"차량유지비"},
  {k:["aws","azure","gcp","클라우드","호스팅","도메인","네이버클라우드"],a:"통신비"},
  {k:["kt","skt","lg유플","인터넷","핸드폰"],a:"통신비"},
  {k:["네이버광고","구글광고","카카오광고","메타광고","광고비","마케팅비"],a:"광고선전비"},
  {k:["임차료","월세","임대"],a:"임차료"},
  {k:["국민연금","건강보험","고용보험","산재","4대보험","원천세","부가세","세금"],a:"세금과공과"},
  {k:["교육","세미나","강의","훈련"],a:"교육훈련비"},
  {k:["보험료","화재보험","자동차보험"],a:"보험료"},
  {k:["급여","월급","인건비","퇴직금","상여"],a:"급여"},
  {k:["쿠팡","다이소","오피스","사무용품","문구"],a:"소모품비"},
  {k:["항공","ktx","기차","택시","버스","지하철"],a:"여비교통비"},
  {k:["수수료","pg","결제대행"],a:"수수료"},
  {k:["회식","접대","골프"],a:"접대비"},
  {k:["복리","경조사","명절","선물"],a:"복리후생비"},
];
function quickCat(desc){
  const lo=(desc||"").toLowerCase();
  for(const {k,a} of KWORDS) if(k.some(x=>lo.includes(x))) return a;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L CALCULATOR  (전체 거래 → 손익계산서)
// ─────────────────────────────────────────────────────────────────────────────
function calcPL(allTxs, filterFn = ()=>true) {
  const txs = allTxs.filter(filterFn);

  const revenue = txs
    .filter(t => ACC_MAP[t.category]?.plGroup === "revenue" && t.amount > 0)
    .reduce((s,t) => s + t.amount, 0);

  const cogs = txs
    .filter(t => ACC_MAP[t.category]?.plGroup === "cogs")
    .reduce((s,t) => s + Math.abs(t.amount), 0);

  const sgaByLabel = {};
  txs.filter(t => ACC_MAP[t.category]?.plGroup === "sga").forEach(t => {
    const lbl = ACC_MAP[t.category].label;
    sgaByLabel[lbl] = (sgaByLabel[lbl] || 0) + Math.abs(t.amount);
  });
  const totalSGA = Object.values(sgaByLabel).reduce((s,v) => s+v, 0);

  const grossProfit    = revenue - cogs;
  const operatingProfit= grossProfit - totalSGA;
  const grossMargin    = revenue > 0 ? (grossProfit / revenue * 100) : 0;
  const opMargin       = revenue > 0 ? (operatingProfit / revenue * 100) : 0;

  return { revenue, cogs, grossProfit, totalSGA, sgaByLabel, operatingProfit, grossMargin, opMargin };
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE SHEET CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
function calcBS(allTxs, accounts) {
  const totalIn  = allTxs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
  const totalOut = allTxs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
  const revenue  = allTxs.filter(t=>ACC_MAP[t.category]?.plGroup==="revenue"&&t.amount>0).reduce((s,t)=>s+t.amount,0);
  const retainedEarnings = totalIn - totalOut;

  // 유동자산: 업로드된 입금 기반 현금 추정
  const cashBalance = Math.max(totalIn - totalOut, 0);
  const ar = Math.round(revenue * 0.08); // 미수금 추정

  // 비유동자산: 지출 중 소모품 등
  const tangible = allTxs.filter(t=>["소모품비"].includes(t.category)).reduce((s,t)=>s+Math.abs(t.amount),0);

  // 부채
  const ap       = Math.round(allTxs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0) * 0.06);
  const accrued  = Math.round(allTxs.filter(t=>t.category==="급여").reduce((s,t)=>s+Math.abs(t.amount),0) * 0.04);

  const totalAsset = cashBalance + ar + tangible;
  const totalLiab  = ap + accrued;
  const equity     = Math.round(totalIn * 0.3);
  const totalEquity = equity + retainedEarnings;

  return {
    assets: {
      current: [
        { name:"현금 및 현금성자산", value: cashBalance, note:"업로드 거래 기반" },
        { name:"매출채권(미수금)",   value: ar,           note:"매출×8% 추정" },
      ],
      noncurrent: [
        { name:"유형자산",           value: tangible,     note:"소모품비 누계" },
      ],
    },
    liabilities: {
      current: [
        { name:"매입채무",           value: ap,           note:"지출×6% 추정" },
        { name:"미지급비용(급여)",   value: accrued,      note:"급여×4% 추정" },
      ],
    },
    equity: [
      { name:"자본금",               value: equity,       note:"수입×30% 추정" },
      { name:"이익잉여금",           value: retainedEarnings, note:"수입-지출" },
    ],
    totals: { asset: totalAsset, liab: totalLiab, equity: totalEquity },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE PARSING
// ─────────────────────────────────────────────────────────────────────────────
function parseFile(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>{
      try{
        const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array",codepage:949});
        res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""}));
      }catch(e){rej(e);}
    };
    r.readAsArrayBuffer(file);
  });
}
function normalizeRows(rows){
  let hIdx=-1;
  for(let i=0;i<Math.min(rows.length,15);i++){
    const r=rows[i].map(c=>String(c).replace(/\s/g,"").toLowerCase());
    if(r.some(c=>c.includes("날짜")||c.includes("거래일")||c.includes("일자"))){hIdx=i;break;}
  }
  if(hIdx<0)hIdx=0;
  const h=rows[hIdx].map(c=>String(c).trim().toLowerCase().replace(/\s/g,""));
  const fc=(...kws)=>{for(const kw of kws){const i=h.findIndex(x=>x.includes(kw));if(i>=0)return i;}return -1;};
  const dateC=fc("날짜","거래일","일자","date");
  const descC=fc("내용","적요","거래내용","가맹점","상호","거래처");
  const outC=fc("출금","지출","출금액","결제금액","이용금액");
  const inC=fc("입금","수입","입금액");
  const amtC=fc("금액","amount");
  const pa=v=>parseFloat(String(v||"").replace(/[,\s원]/g,""))||0;
  const out=[];
  for(let i=hIdx+1;i<rows.length;i++){
    const r=rows[i];
    if(!r||r.every(c=>c===""||c===null))continue;
    let date=String(r[dateC]||"").trim()
      .replace(/\./g,"-").replace(/\//g,"-")
      .replace(/(\d{4})-(\d{1,2})-(\d{1,2}).*/,(_,y,m,d)=>`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
    if(!date.match(/^\d{4}-\d{2}-\d{2}$/))continue;
    const desc=String(r[descC]||"").trim();
    let outA=outC>=0?pa(r[outC]):0,inA=inC>=0?pa(r[inC]):0;
    if(amtC>=0&&outC<0&&inC<0){const v=pa(r[amtC]);v<0?outA=Math.abs(v):inA=v;}
    if(!desc&&outA===0&&inA===0)continue;
    const amount=inA>0?inA:-outA;
    out.push({id:Math.random().toString(36).slice(2)+Date.now(),date,desc,amount,
      type:amount>=0?"income":"expense",category:quickCat(desc)||"미확인",memo:"",evidence:null});
  }
  return out;
}

async function aiClassify(txs){
  const todo=txs.filter(t=>t.category==="미확인");
  if(!todo.length)return txs;
  const items=todo.slice(0,80).map(t=>`${t.id}|${t.desc}|${t.amount}`).join("\n");
  try{
    const res=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2000,
        messages:[{role:"user",content:`거래내역 계정과목 분류.\n계정: ${ACCOUNT_CATEGORIES.join(",")}\n형식(JSON배열만): [{"id":"...","category":"..."}]\n규칙: 양수=수입(매출), 음수=지출, 모르면 미확인\n\n${items}`}]})
    });
    const d=await res.json();
    const map={};
    JSON.parse((d.content?.[0]?.text||"[]").replace(/```json|```/g,"").trim()).forEach(r=>{map[r.id]=r.category;});
    return txs.map(t=>({...t,category:map[t.id]||t.category}));
  }catch{return txs;}
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt  = n => Math.abs(n||0).toLocaleString();
const fmtW = n => { const v=Math.abs(n||0); return v>=100000000?`${(v/100000000).toFixed(1)}억`:(v>=10000?`${Math.round(v/10000)}만`:`${v.toLocaleString()}`); };
const pct  = n => `${n.toFixed(1)}%`;
const today= ()=>new Date().toISOString().slice(0,10);
const BANK_COLORS=["#60a5fa","#34d399","#f59e0b","#a78bfa","#f87171","#38bdf8","#fb923c","#e879f9","#a3e635","#2dd4bf"];

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function exportTx(txs,name){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["날짜","거래내용","입금","출금","계정과목","메모"],
    ...txs.map(t=>[t.date,t.desc,t.amount>0?t.amount:"",t.amount<0?Math.abs(t.amount):"",t.category,t.memo||""])
  ]),"거래내역");
  XLSX.writeFile(wb,`FitBear_${name}.xlsx`);
}

function exportPL(pl, label){
  const wb=XLSX.utils.book_new();
  const rows=[
    ["손익계산서",""],["기간",label],["",""],
    ["항목","금액(원)"],
    ["매출액", pl.revenue],
    ["매출원가", -pl.cogs],
    ["매출총이익", pl.grossProfit],
    [`  매출총이익률`, `${pl.grossMargin.toFixed(1)}%`],
    ["판매관리비합계", -pl.totalSGA],
    ...Object.entries(pl.sgaByLabel).map(([l,v])=>[`  ${l}`,-v]),
    ["영업이익", pl.operatingProfit],
    [`  영업이익률`, `${pl.opMargin.toFixed(1)}%`],
  ];
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=[{wch:24},{wch:16}];
  XLSX.utils.book_append_sheet(wb,ws,"손익계산서");
  XLSX.writeFile(wb,`FitBear_손익계산서_${label}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL UI
// ─────────────────────────────────────────────────────────────────────────────
function Chip({label,active,color="#8b5cf6",onClick}){
  return <button onClick={onClick} style={{padding:"4px 13px",borderRadius:20,fontSize:11,fontWeight:600,
    cursor:"pointer",border:`1px solid ${active?color:"rgba(255,255,255,.1)"}`,
    background:active?`${color}22`:"transparent",color:active?color:"#6b7280",transition:"all .13s"}}>
    {label}</button>;
}

function PLRow({label,value,level=0,bold,tag,color,indent}){
  const isPos = value>=0;
  return <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
    padding:`${bold?"11px":"8px"} 20px`,
    background:bold?"rgba(255,255,255,.025)":"transparent",
    borderBottom:"1px solid rgba(255,255,255,.04)"}}>
    <span style={{fontSize:bold?13:12,color:bold?"#e5e7eb":"#9ca3af",fontWeight:bold?700:400,
      paddingLeft:(level||0)*14}}>{label}</span>
    {tag!=null
      ? <span style={{fontSize:11,color,fontWeight:700,padding:"2px 10px",borderRadius:20,background:`${color}15`}}>{tag}</span>
      : value!=null
        ? <span style={{fontSize:bold?14:12,fontWeight:bold?800:600,color:isPos?"#34d399":"#f87171"}}>
            {isPos?"+":""}{fmt(value)}원
          </span>
        : null}
  </div>;
}

function BSSection({title,color,items,total}){
  return <div style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,overflow:"hidden",marginBottom:12}}>
    <div style={{padding:"11px 16px",background:`${color}12`,borderBottom:"1px solid rgba(255,255,255,.06)",
      display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span style={{fontSize:12,fontWeight:700,color}}>{title}</span>
      <span style={{fontSize:13,fontWeight:800,color}}>{fmt(total)}원</span>
    </div>
    {items.map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"9px 16px",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
      <div>
        <span style={{fontSize:12,color:"#d1d5db"}}>{r.name}</span>
        {r.note&&<span style={{fontSize:10,color:"#4b5563",marginLeft:8}}>{r.note}</span>}
      </div>
      <span style={{fontSize:12,fontWeight:600,color}}>{fmt(r.value)}원</span>
    </div>)}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD ACCOUNT MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AddAccModal({onAdd,onClose}){
  const [name,setName]=useState(""); const [bank,setBank]=useState("");
  const [no,setNo]=useState(""); const [type,setType]=useState("checking");
  const [color,setColor]=useState(BANK_COLORS[0]);
  const TYPES=[{v:"checking",l:"보통예금",i:"🏦"},{v:"savings",l:"정기예금",i:"💰"},
    {v:"foreign",l:"외화예금",i:"💱"},{v:"retirement",l:"퇴직연금",i:"🏖"},
    {v:"loan",l:"대출",i:"📋"},{v:"card",l:"법인카드",i:"💳"},
    {v:"personal_card",l:"개인카드",i:"💳"},{v:"corporate",l:"법인계좌",i:"🏢"}];
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,
    display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#131826",border:"1px solid rgba(139,92,246,.35)",
      borderRadius:20,padding:32,width:460,boxShadow:"0 24px 60px rgba(0,0,0,.6)"}}>
      <h3 style={{margin:"0 0 22px",fontSize:16,fontWeight:800,color:"#fff"}}>🏦 계좌 / 카드 등록</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{gridColumn:"1/-1"}}>
          <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:8,fontWeight:600}}>종류</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {TYPES.map(t=><button key={t.v} onClick={()=>setType(t.v)} style={{
              padding:"6px 12px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",
              background:type===t.v?"rgba(139,92,246,.2)":"rgba(255,255,255,.04)",
              border:`1px solid ${type===t.v?"#8b5cf6":"rgba(255,255,255,.1)"}`,
              color:type===t.v?"#c4b5fd":"#6b7280"}}>{t.i} {t.l}</button>)}
          </div>
        </div>
        {[{l:"계좌명",v:name,sv:setName,ph:"예: 신한 보통예금"},
          {l:"은행/카드사",v:bank,sv:setBank,ph:"예: 신한은행"},
        ].map(f=><div key={f.l}>
          <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:6,fontWeight:600}}>{f.l}</label>
          <input value={f.v} onChange={e=>f.sv(e.target.value)} placeholder={f.ph}
            style={{width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
              borderRadius:8,padding:"9px 12px",color:"#fff",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>)}
        <div style={{gridColumn:"1/-1"}}>
          <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:6,fontWeight:600}}>계좌번호 (선택)</label>
          <input value={no} onChange={e=>setNo(e.target.value)} placeholder="예: 110-123-456789"
            style={{width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
              borderRadius:8,padding:"9px 12px",color:"#fff",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:8,fontWeight:600}}>색상</label>
          <div style={{display:"flex",gap:8}}>
            {BANK_COLORS.map(c=><button key={c} onClick={()=>setColor(c)} style={{
              width:24,height:24,borderRadius:"50%",background:c,border:"none",cursor:"pointer",
              boxShadow:color===c?`0 0 0 3px rgba(255,255,255,.15),0 0 0 5px ${c}`:"none",transition:"box-shadow .15s"}}/>)}
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginTop:24}}>
        <button onClick={onClose} style={{flex:1,padding:"11px 0",borderRadius:10,cursor:"pointer",
          background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",color:"#9ca3af",fontWeight:600,fontSize:13}}>취소</button>
        <button onClick={()=>{if(!name.trim())return;onAdd({id:"acc_"+Date.now(),name:name.trim(),bank:bank.trim(),
          accNo:no.trim(),type,color,txs:[]});onClose();}}
          style={{flex:2,padding:"11px 0",borderRadius:10,cursor:"pointer",
            background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",border:"none",color:"#fff",fontWeight:700,fontSize:13}}>
          ✓ 등록하기
        </button>
      </div>
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION TABLE
// ─────────────────────────────────────────────────────────────────────────────
function TxTable({txs,onUpdate,projects=[],onTagTx}){
  const [editCell,setEditCell]=useState(null);
  const fileRefs=useRef({});
  if(!txs.length)return <div style={{padding:"56px 0",textAlign:"center",color:"#4b5563"}}>
    <div style={{fontSize:36,marginBottom:10}}>📭</div><div style={{fontSize:13}}>내역 없음</div></div>;

  const cols = projects.length>0
    ? "36px 106px minmax(160px,1fr) 120px 130px 58px 120px minmax(120px,1fr) 70px"
    : "36px 106px minmax(180px,1fr) 120px 130px 58px minmax(140px,1fr) 70px";

  return <div>
    <div style={{display:"grid",gridTemplateColumns:cols,
      padding:"8px 14px",background:"rgba(255,255,255,.025)",borderBottom:"1px solid rgba(255,255,255,.07)",
      fontSize:10,color:"#4b5563",fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",
      position:"sticky",top:0,zIndex:2}}>
      <div>#</div><div>날짜</div><div>거래내용</div><div>금액</div><div>계정과목</div><div>구분</div>
      {projects.length>0&&<div>프로젝트</div>}
      <div>메모</div><div>증빙</div>
    </div>
    {txs.map((t,i)=>{
      const isCat =editCell?.id===t.id&&editCell?.field==="category";
      const isMemo=editCell?.id===t.id&&editCell?.field==="memo";
      return <div key={t.id} style={{display:"grid",
        gridTemplateColumns:cols,
        padding:"10px 14px",alignItems:"center",
        borderBottom:"1px solid rgba(255,255,255,.04)",
        background:i%2===0?"transparent":"rgba(255,255,255,.008)",transition:"background .1s"}}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(139,92,246,.06)"}
        onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"rgba(255,255,255,.008)"}>
        <div style={{fontSize:10,color:"#374151",textAlign:"center"}}>{i+1}</div>
        <div style={{fontSize:12,color:"#6b7280"}}>{t.date}</div>
        <div style={{fontSize:13,color:"#d1d5db",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}} title={t.desc}>{t.desc}</div>
        <div style={{fontSize:13,fontWeight:800,whiteSpace:"nowrap",color:t.amount>0?"#34d399":"#f87171"}}>
          {t.amount>0?"+":"-"}{fmt(Math.abs(t.amount))}원</div>
        <div>
          {isCat
            ? <select autoFocus defaultValue={t.category}
                onChange={e=>{onUpdate(t.id,"category",e.target.value);setEditCell(null);}}
                onBlur={()=>setEditCell(null)}
                style={{background:`${cc(t.category)}18`,border:`1px solid ${cc(t.category)}55`,
                  color:cc(t.category),borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,cursor:"pointer",outline:"none",minWidth:110}}>
                {ACCOUNT_CATEGORIES.map(a=><option key={a} value={a} style={{background:"#1a1f2e",color:"#e5e7eb"}}>{a}</option>)}
              </select>
            : <span onClick={()=>setEditCell({id:t.id,field:"category"})} title="클릭해서 변경"
                style={{fontSize:11,padding:"3px 10px",borderRadius:20,cursor:"pointer",fontWeight:700,
                  display:"inline-flex",alignItems:"center",gap:4,
                  background:`${cc(t.category)}18`,border:`1px solid ${cc(t.category)}44`,color:cc(t.category)}}>
                {t.category}<span style={{fontSize:9,opacity:.6}}>✎</span>
              </span>}
        </div>
        <div><span style={{fontSize:10,padding:"3px 8px",borderRadius:10,fontWeight:700,
          background:t.amount>0?"rgba(52,211,153,.12)":"rgba(248,113,113,.12)",
          color:t.amount>0?"#34d399":"#f87171"}}>{t.amount>0?"입금":"출금"}</span></div>
        {projects.length>0&&<div>
          <ProjectTag projects={projects} value={t.projectId||""} onChange={v=>onTagTx&&onTagTx(t.id,v)}/>
        </div>}
        <div>
          {isMemo
            ? <input autoFocus defaultValue={t.memo}
                onBlur={e=>{onUpdate(t.id,"memo",e.target.value);setEditCell(null);}}
                onKeyDown={e=>e.key==="Enter"&&e.target.blur()} placeholder="입력 후 Enter"
                style={{width:"92%",background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.4)",
                  borderRadius:6,padding:"4px 9px",color:"#e5e7eb",fontSize:12,outline:"none"}}/>
            : <span onClick={()=>setEditCell({id:t.id,field:"memo"})}
                style={{fontSize:12,color:t.memo?"#9ca3af":"#374151",cursor:"text",padding:"4px 8px",borderRadius:6,
                  border:"1px solid transparent",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(139,92,246,.3)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="transparent"}>
                {t.memo||<span style={{color:"#374151",fontStyle:"italic",fontSize:11}}>+ 메모</span>}
              </span>}
        </div>
        <div>
          <input ref={el=>{if(el)fileRefs.current[t.id]=el;}} type="file" accept="image/*,.pdf"
            style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)onUpdate(t.id,"evidence",{name:f.name});}}/>
          {t.evidence
            ? <span style={{fontSize:10,color:"#34d399",cursor:"pointer",padding:"3px 7px",borderRadius:6,
                background:"rgba(52,211,153,.1)",border:"1px solid rgba(52,211,153,.3)"}}
                onClick={()=>fileRefs.current[t.id]?.click()} title={t.evidence.name}>📎증빙</span>
            : <button onClick={()=>fileRefs.current[t.id]?.click()}
                style={{fontSize:10,color:"#4b5563",cursor:"pointer",padding:"3px 8px",borderRadius:6,
                  background:"transparent",border:"1px dashed rgba(255,255,255,.12)"}}>+증빙</button>}
        </div>
      </div>;
    })}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT DETAIL PAGE
// ─────────────────────────────────────────────────────────────────────────────
function AccountPage({acc,onUpdate,onUpload,projects=[],onTagTx}){
  const [dateFrom,setDateFrom]=useState(""); const [dateTo,setDateTo]=useState("");
  const [typeF,setTypeF]=useState("전체"); const [search,setSearch]=useState("");
  const txs=acc.txs||[];
  const filtered=useMemo(()=>{
    let r=txs;
    if(dateFrom)r=r.filter(t=>t.date>=dateFrom);
    if(dateTo)  r=r.filter(t=>t.date<=dateTo);
    if(typeF==="입금")r=r.filter(t=>t.amount>0);
    if(typeF==="출금")r=r.filter(t=>t.amount<0);
    if(search)r=r.filter(t=>t.desc.toLowerCase().includes(search.toLowerCase())||(t.memo||"").toLowerCase().includes(search.toLowerCase()));
    return [...r].sort((a,b)=>b.date.localeCompare(a.date));
  },[txs,dateFrom,dateTo,typeF,search]);
  const totIn =filtered.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
  const totOut=filtered.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
  const QRANGE=[
    {l:"이번달",fn:()=>{const m=today().slice(0,7);setDateFrom(`${m}-01`);setDateTo(today());}},
    {l:"지난달",fn:()=>{const d=new Date();d.setMonth(d.getMonth()-1);const m=d.toISOString().slice(0,7);const ld=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();setDateFrom(`${m}-01`);setDateTo(`${m}-${ld}`);}},
    {l:"3개월", fn:()=>{const d=new Date();d.setMonth(d.getMonth()-3);setDateFrom(d.toISOString().slice(0,10));setDateTo(today());}},
    {l:"올해",  fn:()=>{setDateFrom(`${new Date().getFullYear()}-01-01`);setDateTo(today());}},
    {l:"전체",  fn:()=>{setDateFrom("");setDateTo("");}},
  ];
  const TICON={checking:"🏦",savings:"💰",foreign:"💱",retirement:"🏖",loan:"📋",card:"💳",personal_card:"💳",corporate:"🏢"};
  const TNAME={checking:"보통예금",savings:"정기예금",foreign:"외화예금",retirement:"퇴직연금",loan:"대출",card:"법인카드",personal_card:"개인카드",corporate:"법인계좌"};

  return <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
    {/* Header */}
    <div style={{padding:"18px 22px",borderBottom:"1px solid rgba(255,255,255,.07)",
      background:`linear-gradient(135deg,${acc.color}10,transparent)`,flexShrink:0}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:44,height:44,borderRadius:11,background:`${acc.color}20`,
            border:`1px solid ${acc.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>
            {TICON[acc.type]||"🏦"}
          </div>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:17,fontWeight:900,color:"#fff"}}>{acc.name}</span>
              <span style={{fontSize:10,padding:"2px 9px",borderRadius:20,fontWeight:700,
                background:`${acc.color}20`,color:acc.color}}>{TNAME[acc.type]||"계좌"}</span>
            </div>
            {acc.bank&&<div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{acc.bank}{acc.accNo&&` · ${acc.accNo}`}</div>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {/* 재무제표 연동 배지 */}
          <div style={{padding:"5px 12px",borderRadius:20,fontSize:11,fontWeight:700,
            background:"rgba(52,211,153,.1)",border:"1px solid rgba(52,211,153,.25)",color:"#34d399"}}>
            ✓ 재무제표 자동 연동
          </div>
          <button onClick={onUpload} style={{padding:"8px 16px",borderRadius:9,fontSize:12,fontWeight:700,
            cursor:"pointer",background:`${acc.color}18`,border:`1px solid ${acc.color}40`,color:acc.color}}>
            📂 내역 업로드
          </button>
        </div>
      </div>
      {/* Stats */}
      <div style={{display:"flex",gap:10}}>
        {[{l:"총 거래",v:`${txs.length}건`,c:"#9ca3af"},
          {l:"총 수입",v:`${fmtW(txs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0))}원`,c:"#34d399"},
          {l:"총 지출",v:`${fmtW(txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0))}원`,c:"#f87171"},
          {l:"미확인",v:`${txs.filter(t=>t.category==="미확인").length}건`,c:"#fb923c"},
        ].map(s=><div key={s.l} style={{padding:"7px 13px",borderRadius:8,
          background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)"}}>
          <div style={{fontSize:9,color:"#4b5563",textTransform:"uppercase",letterSpacing:".05em",marginBottom:2}}>{s.l}</div>
          <div style={{fontSize:13,fontWeight:800,color:s.c}}>{s.v}</div>
        </div>)}
      </div>
    </div>
    {/* Filters */}
    <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.06)",
      display:"flex",flexDirection:"column",gap:8,flexShrink:0}}>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:"#4b5563",fontWeight:600,marginRight:2}}>기간</span>
        {QRANGE.map(q=><button key={q.l} onClick={q.fn} style={{padding:"4px 10px",borderRadius:7,fontSize:11,
          fontWeight:600,cursor:"pointer",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",color:"#9ca3af"}}>{q.l}</button>)}
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
          style={{marginLeft:8,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",
            borderRadius:7,padding:"4px 10px",color:"#e5e7eb",fontSize:11,outline:"none"}}/>
        <span style={{color:"#4b5563",fontSize:11}}>~</span>
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
          style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",
            borderRadius:7,padding:"4px 10px",color:"#e5e7eb",fontSize:11,outline:"none"}}/>
      </div>
      <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
        {["전체","입금","출금"].map(tp=><button key={tp} onClick={()=>setTypeF(tp)} style={{
          padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",
          border:`1px solid ${typeF===tp?(tp==="입금"?"#34d399":tp==="출금"?"#f87171":"#8b5cf6"):"rgba(255,255,255,.1)"}`,
          background:typeF===tp?(tp==="입금"?"rgba(52,211,153,.15)":tp==="출금"?"rgba(248,113,113,.15)":"rgba(139,92,246,.15)"):"transparent",
          color:typeF===tp?(tp==="입금"?"#34d399":tp==="출금"?"#f87171":"#a78bfa"):"#6b7280"}}>{tp}</button>)}
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 검색"
          style={{marginLeft:"auto",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.09)",
            borderRadius:8,padding:"5px 11px",color:"#e5e7eb",fontSize:12,outline:"none",width:180}}/>
        <span style={{fontSize:11,color:"#4b5563"}}>{filtered.length}건</span>
        <button onClick={()=>exportTx(filtered,acc.name)} style={{padding:"5px 11px",borderRadius:7,fontSize:11,
          fontWeight:600,cursor:"pointer",background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",color:"#34d399",whiteSpace:"nowrap"}}>📥 엑셀</button>
      </div>
    </div>
    {/* Table */}
    <div style={{flex:1,overflowY:"auto"}}>
      <TxTable txs={filtered} onUpdate={(id,field,val)=>onUpdate(acc.id,id,field,val)} projects={projects} onTagTx={onTagTx?((txId,projId)=>onTagTx(acc.id,txId,projId)):null}/>
    </div>
    {/* Footer */}
    <div style={{padding:"8px 14px",borderTop:"1px solid rgba(255,255,255,.07)",
      display:"flex",justifyContent:"space-between",fontSize:12,
      background:"rgba(255,255,255,.015)",flexShrink:0}}>
      <div style={{display:"flex",gap:18}}>
        <span>입금: <strong style={{color:"#34d399"}}>{fmt(totIn)}원</strong></span>
        <span>출금: <strong style={{color:"#f87171"}}>{fmt(totOut)}원</strong></span>
        <span>순손익: <strong style={{color:totIn>=totOut?"#60a5fa":"#fb923c"}}>{totIn>=totOut?"+":"-"}{fmt(Math.abs(totIn-totOut))}원</strong></span>
      </div>
      <span style={{color:"#4b5563",fontSize:11}}>전체 {txs.length}건 · 표시 {filtered.length}건</span>
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 손익계산서 프린트 리포트 생성
// ─────────────────────────────────────────────────────────────────────────────
function printPLReport(pl, allTxs, dateFrom, dateTo, label) {
  const fmt  = n => Math.abs(n||0).toLocaleString();
  const pct  = n => (n||0).toFixed(1)+"%";
  const sign = n => n>=0?"+":"";

  // 기간 필터된 거래
  const txs = allTxs.filter(t => (!dateFrom||t.date>=dateFrom) && (!dateTo||t.date<=dateTo));

  // 계정별 거래 상세
  const byCategory = {};
  txs.forEach(t => {
    const cat = t.category || "미확인";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(t);
  });

  // 매출 거래 목록
  const revTxs = (byCategory["매출"]||[]).sort((a,b)=>b.date.localeCompare(a.date));
  // 매출원가 거래 목록
  const cogsTxs = (byCategory["매출원가"]||[]).sort((a,b)=>b.date.localeCompare(a.date));
  // 판관비 계정별 그룹
  const sgaCats = Object.keys(ACC_MAP).filter(k=>ACC_MAP[k].plGroup==="sga");
  const sgaGroups = sgaCats.map(cat => ({
    cat, label: ACC_MAP[cat].label,
    txs: (byCategory[cat]||[]).sort((a,b)=>b.date.localeCompare(a.date)),
    total: (byCategory[cat]||[]).reduce((s,t)=>s+Math.abs(t.amount),0),
  })).filter(g=>g.txs.length>0).sort((a,b)=>b.total-a.total);

  const txRow = (t,i) => `
    <tr style="background:${i%2===0?"#ffffff":"#f9fafb"}">
      <td style="padding:5px 8px;font-size:11px;color:#6b7280;white-space:nowrap">${t.date}</td>
      <td style="padding:5px 8px;font-size:12px;color:#111827;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.desc||""}</td>
      <td style="padding:5px 8px;font-size:12px;color:#6b7280">${t.memo||""}</td>
      <td style="padding:5px 8px;font-size:12px;font-weight:700;text-align:right;white-space:nowrap;color:${t.amount>=0?"#059669":"#dc2626"}">${t.amount>=0?"+":""}${t.amount<0?"-":""}${fmt(Math.abs(t.amount))}원</td>
    </tr>`;

  const sectionTable = (rows) => rows.length===0 ? `<p style="color:#9ca3af;font-size:12px;padding:8px 0">거래 내역 없음</p>` : `
    <table style="width:100%;border-collapse:collapse;margin-top:6px">
      <thead><tr style="background:#f3f4f6">
        <th style="padding:5px 8px;font-size:10px;color:#6b7280;text-align:left;font-weight:700;text-transform:uppercase;letter-spacing:.04em;width:100px">날짜</th>
        <th style="padding:5px 8px;font-size:10px;color:#6b7280;text-align:left;font-weight:700;text-transform:uppercase;letter-spacing:.04em">거래내용</th>
        <th style="padding:5px 8px;font-size:10px;color:#6b7280;text-align:left;font-weight:700;text-transform:uppercase;letter-spacing:.04em">메모</th>
        <th style="padding:5px 8px;font-size:10px;color:#6b7280;text-align:right;font-weight:700;text-transform:uppercase;letter-spacing:.04em;width:130px">금액</th>
      </tr></thead>
      <tbody>${rows.map((t,i)=>txRow(t,i)).join("")}</tbody>
    </table>`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<title>손익계산서 상세 리포트 · ${label}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif; color:#111827; background:#fff; padding:32px 40px; font-size:13px; }
  h1 { font-size:22px; font-weight:900; color:#111827; margin-bottom:4px; }
  .subtitle { font-size:12px; color:#6b7280; margin-bottom:28px; }
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:28px; }
  .kpi { padding:14px 16px; border-radius:10px; border:1.5px solid #e5e7eb; }
  .kpi-label { font-size:9px; color:#9ca3af; text-transform:uppercase; letter-spacing:.06em; margin-bottom:5px; font-weight:700; }
  .kpi-value { font-size:20px; font-weight:900; }
  .kpi-sub { font-size:10px; margin-top:3px; opacity:.8; }
  .section { margin-bottom:28px; page-break-inside:avoid; }
  .section-header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-radius:8px 8px 0 0; }
  .section-title { font-size:14px; font-weight:800; }
  .section-total { font-size:14px; font-weight:900; }
  .section-body { border:1.5px solid #e5e7eb; border-top:none; border-radius:0 0 8px 8px; overflow:hidden; }
  .sub-section { padding:10px 14px; border-bottom:1px solid #f3f4f6; }
  .sub-section:last-child { border-bottom:none; }
  .sub-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
  .sub-title { font-size:12px; font-weight:700; color:#374151; }
  .sub-total { font-size:12px; font-weight:800; color:#dc2626; }
  .sub-count { font-size:10px; color:#9ca3af; margin-left:8px; }
  .pl-table { width:100%; border-collapse:collapse; margin-bottom:28px; }
  .pl-table td { padding:7px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; }
  .pl-table .bold { font-weight:800; background:#f9fafb; }
  .pl-table .total-row td { border-top:2px solid #e5e7eb; font-weight:900; font-size:14px; background:#f3f4f6; }
  .footer { margin-top:32px; padding-top:14px; border-top:1px solid #e5e7eb; display:flex; justify-content:space-between; font-size:10px; color:#9ca3af; }
  @media print {
    body { padding:16px 20px; }
    .no-print { display:none; }
    .section { page-break-inside:avoid; }
    @page { margin:15mm; }
  }
</style>
</head>
<body>

<div class="no-print" style="margin-bottom:20px;display:flex;gap:10px">
  <button onclick="window.print()" style="padding:10px 24px;background:#111827;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">🖨 인쇄하기</button>
  <span style="font-size:12px;color:#6b7280;align-self:center">인쇄 시 배경색 포함 설정 권장</span>
</div>

<h1>📊 손익계산서 상세 리포트</h1>
<p class="subtitle">기간: ${label} &nbsp;·&nbsp; 생성일: ${new Date().toLocaleDateString("ko-KR")} &nbsp;·&nbsp; 거래 ${txs.length}건 기준</p>

<!-- 핵심 지표 -->
<div class="kpi-grid">
  <div class="kpi" style="border-color:#d1fae5">
    <div class="kpi-label">매출액</div>
    <div class="kpi-value" style="color:#059669">+${fmt(pl.revenue)}원</div>
  </div>
  <div class="kpi" style="border-color:#dbeafe">
    <div class="kpi-label">매출총이익</div>
    <div class="kpi-value" style="color:#2563eb">${sign(pl.grossProfit)}${fmt(Math.abs(pl.grossProfit))}원</div>
    <div class="kpi-sub" style="color:#2563eb">총이익률 ${pct(pl.grossMargin)}</div>
  </div>
  <div class="kpi" style="border-color:#fef3c7">
    <div class="kpi-label">판매관리비</div>
    <div class="kpi-value" style="color:#d97706">${fmt(pl.totalSGA)}원</div>
  </div>
  <div class="kpi" style="border-color:${pl.operatingProfit>=0?"#ede9fe":"#fee2e2"}">
    <div class="kpi-label">영업이익</div>
    <div class="kpi-value" style="color:${pl.operatingProfit>=0?"#7c3aed":"#dc2626"}">${sign(pl.operatingProfit)}${fmt(Math.abs(pl.operatingProfit))}원</div>
    <div class="kpi-sub" style="color:${pl.operatingProfit>=0?"#7c3aed":"#dc2626"}">이익률 ${pct(pl.opMargin)}</div>
  </div>
</div>

<!-- 손익계산서 요약표 -->
<table class="pl-table">
  <tbody>
    <tr class="bold"><td>Ⅰ. 매출액</td><td style="text-align:right;color:#059669">+${fmt(pl.revenue)}원</td><td style="text-align:right;color:#6b7280;font-size:11px">${revTxs.length}건</td></tr>
    <tr class="bold"><td>Ⅱ. 매출원가</td><td style="text-align:right;color:#dc2626">-${fmt(pl.cogs)}원</td><td style="text-align:right;color:#6b7280;font-size:11px">${cogsTxs.length}건</td></tr>
    <tr class="bold"><td style="padding-left:24px">매출총이익 (Ⅰ-Ⅱ)</td><td style="text-align:right;color:${pl.grossProfit>=0?"#2563eb":"#dc2626"}">${sign(pl.grossProfit)}${fmt(Math.abs(pl.grossProfit))}원</td><td style="text-align:right;color:#6b7280;font-size:11px">총이익률 ${pct(pl.grossMargin)}</td></tr>
    <tr class="bold"><td>Ⅲ. 판매관리비</td><td style="text-align:right;color:#d97706">-${fmt(pl.totalSGA)}원</td><td style="text-align:right;color:#6b7280;font-size:11px">${sgaGroups.reduce((s,g)=>s+g.txs.length,0)}건</td></tr>
    ${sgaGroups.map(g=>`<tr><td style="padding-left:32px;color:#6b7280">· ${g.label}</td><td style="text-align:right;color:#374151">-${fmt(g.total)}원</td><td style="text-align:right;color:#9ca3af;font-size:11px">${g.txs.length}건</td></tr>`).join("")}
    <tr class="total-row"><td>Ⅴ. 영업이익</td><td style="text-align:right;color:${pl.operatingProfit>=0?"#7c3aed":"#dc2626"}">${sign(pl.operatingProfit)}${fmt(Math.abs(pl.operatingProfit))}원</td><td style="text-align:right;font-size:11px;color:#6b7280">이익률 ${pct(pl.opMargin)}</td></tr>
  </tbody>
</table>

<!-- 매출 상세 -->
<div class="section">
  <div class="section-header" style="background:#d1fae5">
    <span class="section-title" style="color:#065f46">📈 Ⅰ. 매출 상세 내역</span>
    <span class="section-total" style="color:#059669">+${fmt(pl.revenue)}원 · ${revTxs.length}건</span>
  </div>
  <div class="section-body">${sectionTable(revTxs)}</div>
</div>

<!-- 매출원가 상세 -->
<div class="section">
  <div class="section-header" style="background:#fee2e2">
    <span class="section-title" style="color:#991b1b">📦 Ⅱ. 매출원가 상세 내역</span>
    <span class="section-total" style="color:#dc2626">-${fmt(pl.cogs)}원 · ${cogsTxs.length}건</span>
  </div>
  <div class="section-body">${sectionTable(cogsTxs)}</div>
</div>

<!-- 판관비 계정별 상세 -->
<div class="section">
  <div class="section-header" style="background:#fef3c7">
    <span class="section-title" style="color:#92400e">📋 Ⅲ. 판매관리비 계정별 상세</span>
    <span class="section-total" style="color:#d97706">-${fmt(pl.totalSGA)}원</span>
  </div>
  <div class="section-body">
    ${sgaGroups.length===0
      ? `<p style="color:#9ca3af;font-size:12px;padding:12px 14px">판관비 내역 없음</p>`
      : sgaGroups.map(g=>`
      <div class="sub-section">
        <div class="sub-header">
          <div>
            <span class="sub-title">${g.label}</span>
            <span class="sub-count">${g.txs.length}건</span>
          </div>
          <span class="sub-total">-${fmt(g.total)}원</span>
        </div>
        ${sectionTable(g.txs)}
      </div>`).join("")}
  </div>
</div>

<div class="footer">
  <span>FitBear AI 경영관리 플랫폼 · 자동 생성 리포트</span>
  <span>※ 본 리포트는 업로드된 거래 내역 기반 추정치입니다. 확정 재무제표는 공인회계사 검토가 필요합니다.</span>
</div>

</body>
</html>`;

  const w = window.open("","_blank","width=1000,height=800");
  w.document.write(html);
  w.document.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L PAGE  (손익계산서)
// ─────────────────────────────────────────────────────────────────────────────
function PLPage({allTxs}){
  const years=[...new Set(allTxs.map(t=>t.date.slice(0,4)))].sort().reverse();
  const months=[...new Set(allTxs.map(t=>t.date.slice(0,7)))].sort().reverse();
  const [plYear,setPlYear]=useState("전체");
  const [plMonth,setPlMonth]=useState("전체");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [useCustom,  setUseCustom]  = useState(false);

  const filterFn = useCallback(t => {
    if (useCustom) {
      if (customFrom && t.date < customFrom) return false;
      if (customTo   && t.date > customTo)   return false;
      return true;
    }
    if (plYear!=="전체" && !t.date.startsWith(plYear))  return false;
    if (plMonth!=="전체"&& !t.date.startsWith(plMonth)) return false;
    return true;
  }, [useCustom, customFrom, customTo, plYear, plMonth]);

  const pl=useMemo(()=>calcPL(allTxs,filterFn),[allTxs,filterFn]);

  // Monthly trend (last 12)
  const trend=useMemo(()=>months.slice(0,12).reverse().map(m=>{
    const d=calcPL(allTxs,t=>t.date.startsWith(m));
    return {m,rev:d.revenue,op:d.operatingProfit};
  }),[allTxs,months]);
  const maxRev=Math.max(...trend.map(t=>t.rev),1);

  const label = useCustom
    ? `${customFrom||"시작"}~${customTo||"현재"}`
    : plMonth!=="전체"?plMonth:(plYear!=="전체"?plYear+"년":"전체기간");

  if(!allTxs.length) return <div style={{padding:"80px 0",textAlign:"center",color:"#4b5563"}}>
    <div style={{fontSize:40,marginBottom:12}}>📊</div>
    <div style={{fontSize:14,fontWeight:600,color:"#6b7280"}}>계좌를 등록하고 거래 내역을 업로드하면</div>
    <div style={{fontSize:13,color:"#374151",marginTop:4}}>손익계산서가 자동으로 생성됩니다</div>
  </div>;

  return <div style={{padding:"24px 28px",overflowY:"auto",height:"100%"}}>
    {/* Header */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
      <div style={{flex:1}}>
        <h2 style={{fontSize:20,fontWeight:900,color:"#fff",margin:"0 0 4px",letterSpacing:"-.03em"}}>📊 손익계산서</h2>
        <p style={{color:"#6b7280",margin:"0 0 14px",fontSize:12}}>
          등록된 모든 계좌·카드 거래가 자동 집계됩니다 · {allTxs.length}건 반영
        </p>

        {/* 기간 선택 탭 */}
        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
          <button onClick={()=>setUseCustom(false)} style={{
            padding:"5px 12px",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",
            background:!useCustom?"rgba(139,92,246,.2)":"rgba(255,255,255,.04)",
            border:`1px solid ${!useCustom?"rgba(139,92,246,.5)":"rgba(255,255,255,.1)"}`,
            color:!useCustom?"#c4b5fd":"#6b7280"}}>빠른 선택</button>
          <button onClick={()=>setUseCustom(true)} style={{
            padding:"5px 12px",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",
            background:useCustom?"rgba(245,158,11,.2)":"rgba(255,255,255,.04)",
            border:`1px solid ${useCustom?"rgba(245,158,11,.5)":"rgba(255,255,255,.1)"}`,
            color:useCustom?"#f59e0b":"#6b7280"}}>📅 기간 직접 설정</button>
          {useCustom&&<>
            <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
              style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.15)",
                borderRadius:8,padding:"5px 10px",color:"#e5e7eb",fontSize:12,outline:"none"}}/>
            <span style={{color:"#6b7280",fontSize:13}}>~</span>
            <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
              style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.15)",
                borderRadius:8,padding:"5px 10px",color:"#e5e7eb",fontSize:12,outline:"none"}}/>
          </>}
        </div>

        {/* 빠른 선택 칩 */}
        {!useCustom&&<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <Chip label="전체" active={plYear==="전체"&&plMonth==="전체"} color="#8b5cf6"
            onClick={()=>{setPlYear("전체");setPlMonth("전체");}}/>
          {years.map(y=><Chip key={y} label={y+"년"} active={plYear===y&&plMonth==="전체"} color="#8b5cf6"
            onClick={()=>{setPlYear(y);setPlMonth("전체");}}/>)}
          {months.slice(0,18).map(m=><Chip key={m} label={m.replace("-",".")} active={plMonth===m}
            color="#a78bfa" onClick={()=>{setPlMonth(m);setPlYear("전체");}}/>)}
        </div>}
      </div>

      {/* 버튼 그룹 */}
      <div style={{display:"flex",gap:8,marginLeft:16,flexShrink:0,alignItems:"flex-start"}}>
        <button onClick={()=>exportPL(pl,label)} style={{padding:"8px 14px",borderRadius:8,fontSize:12,
          fontWeight:600,cursor:"pointer",background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",color:"#34d399",whiteSpace:"nowrap"}}>
          📥 엑셀
        </button>
        <button onClick={()=>printPLReport(pl,allTxs,useCustom?customFrom:(plYear!=="전체"?plYear+"-01-01":""),useCustom?customTo:(plYear!=="전체"?plYear+"-12-31":""),label)}
          style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
            background:"linear-gradient(135deg,#7c3aed,#5b21b6)",border:"none",color:"#fff",
            whiteSpace:"nowrap",boxShadow:"0 4px 14px rgba(124,58,237,.4)"}}>
          🖨 상세 리포트 출력
        </button>
      </div>
    </div>

    {/* KPI */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:22}}>
      {[
        {l:"매출액",v:pl.revenue,c:"#34d399"},
        {l:"매출총이익",v:pl.grossProfit,c:pl.grossProfit>=0?"#60a5fa":"#f87171",sub:`마진 ${pct(pl.grossMargin)}`},
        {l:"영업이익",v:pl.operatingProfit,c:pl.operatingProfit>=0?"#a78bfa":"#f87171",sub:`이익률 ${pct(pl.opMargin)}`},
        {l:"판매관리비",v:-pl.totalSGA,c:"#fb923c"},
      ].map(k=><div key={k.l} style={{padding:"15px 18px",borderRadius:12,
        background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)"}}>
        <div style={{fontSize:10,color:"#6b7280",marginBottom:5,textTransform:"uppercase",letterSpacing:".05em"}}>{k.l}</div>
        <div style={{fontSize:20,fontWeight:900,color:k.c,letterSpacing:"-.02em"}}>
          {k.v>=0?"+":""}{fmtW(Math.abs(k.v))}원
        </div>
        {k.sub&&<div style={{fontSize:10,color:k.c,marginTop:3,opacity:.8}}>{k.sub}</div>}
      </div>)}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:18}}>
      {/* P&L Statement */}
      <div style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,overflow:"hidden"}}>
        <div style={{padding:"13px 20px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>손익 계산 내역</span>
          <span style={{fontSize:10,color:"#4b5563"}}>{label}</span>
        </div>
        <PLRow label="Ⅰ. 매출액"    value={pl.revenue}      bold color="#34d399"/>
        <PLRow label="Ⅱ. 매출원가"  value={-pl.cogs}        bold color="#f87171"/>
        <PLRow label="Ⅲ. 매출총이익" value={pl.grossProfit} bold color={pl.grossProfit>=0?"#60a5fa":"#f87171"}/>
        <PLRow label="  매출총이익률" value={null} tag={pct(pl.grossMargin)} color={pl.grossMargin>=0?"#60a5fa":"#f87171"}/>
        <PLRow label="Ⅳ. 판매관리비합계" value={-pl.totalSGA} bold color="#fb923c"/>
        {Object.entries(pl.sgaByLabel).sort((a,b)=>b[1]-a[1]).map(([lbl,v])=>(
          <PLRow key={lbl} label={`    ${lbl}`} value={-v} level={1} color="#9ca3af"/>
        ))}
        <PLRow label="Ⅴ. 영업이익" value={pl.operatingProfit} bold color={pl.operatingProfit>=0?"#a78bfa":"#f87171"}/>
        <PLRow label="  영업이익률" value={null} tag={pct(pl.opMargin)} color={pl.opMargin>=0?"#a78bfa":"#f87171"}/>
      </div>

      {/* Monthly trend chart */}
      <div style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:20}}>
        <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:4}}>월별 매출·영업이익 추이</div>
        <div style={{fontSize:11,color:"#4b5563",marginBottom:16}}>최근 12개월</div>
        {trend.length===0
          ? <div style={{color:"#374151",fontSize:12,textAlign:"center",paddingTop:40}}>데이터 없음</div>
          : <>
            <div style={{display:"flex",gap:4,alignItems:"flex-end",height:140,marginBottom:8}}>
              {trend.map(m=>{
                const opPositive=m.op>=0;
                return <div key={m.m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{width:"100%",display:"flex",flexDirection:"column",alignItems:"center",
                    justifyContent:"flex-end",height:120,gap:2}}>
                    <div style={{width:"80%",borderRadius:"3px 3px 0 0",minHeight:2,
                      height:`${m.rev/maxRev*110}px`,background:"rgba(52,211,153,.55)"}}/>
                    {m.op!==0&&<div style={{width:"80%",borderRadius:"3px 3px 0 0",minHeight:2,
                      height:`${Math.abs(m.op)/maxRev*80}px`,
                      background:opPositive?"rgba(139,92,246,.65)":"rgba(248,113,113,.5)"}}/>}
                  </div>
                  <span style={{fontSize:8,color:"#374151",whiteSpace:"nowrap"}}>{m.m.slice(5)}월</span>
                </div>;
              })}
            </div>
            <div style={{display:"flex",gap:14}}>
              {[{c:"rgba(52,211,153,.55)",l:"매출"},{c:"rgba(139,92,246,.65)",l:"영업이익"}].map(x=><div key={x.l} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:10,height:10,borderRadius:2,background:x.c}}/><span style={{fontSize:10,color:"#6b7280"}}>{x.l}</span>
              </div>)}
            </div>
          </>}
      </div>
    </div>

    {/* SGA breakdown */}
    {Object.keys(pl.sgaByLabel).length>0&&<div style={{background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:20}}>
      <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:16}}>판매관리비 상세 (계정별)</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
        {Object.entries(pl.sgaByLabel).sort((a,b)=>b[1]-a[1]).map(([lbl,v])=>{
          const cat=Object.keys(ACC_MAP).find(k=>ACC_MAP[k].label===lbl)||lbl;
          const share=pl.totalSGA>0?v/pl.totalSGA*100:0;
          return <div key={lbl} style={{padding:"12px 14px",borderRadius:10,
            background:`${cc(cat)}0e`,border:`1px solid ${cc(cat)}25`}}>
            <div style={{fontSize:11,color:cc(cat),fontWeight:600,marginBottom:5}}>{lbl}</div>
            <div style={{fontSize:16,fontWeight:800,color:"#fff"}}>{fmtW(v)}원</div>
            <div style={{fontSize:10,color:"#4b5563",marginTop:3}}>{share.toFixed(1)}% of 판관비</div>
            <div style={{height:3,borderRadius:2,marginTop:6,background:"rgba(255,255,255,.07)"}}>
              <div style={{height:"100%",borderRadius:2,width:`${share}%`,background:cc(cat)}}/>
            </div>
          </div>;
        })}
      </div>
    </div>}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE SHEET PAGE  (재무상태표)
// ─────────────────────────────────────────────────────────────────────────────
function BSPage({allTxs,accounts}){
  const years=[...new Set(allTxs.map(t=>t.date.slice(0,4)))].sort().reverse();
  const [bsYear,setBsYear]=useState("전체");
  const txs=useMemo(()=>bsYear==="전체"?allTxs:allTxs.filter(t=>t.date.startsWith(bsYear)),[allTxs,bsYear]);
  const bs=useMemo(()=>calcBS(txs,accounts),[txs,accounts]);
  const totalA=bs.assets.current.reduce((s,r)=>s+r.value,0)+bs.assets.noncurrent.reduce((s,r)=>s+r.value,0);
  const totalL=bs.liabilities.current.reduce((s,r)=>s+r.value,0);
  const totalE=bs.equity.reduce((s,r)=>s+r.value,0);

  if(!allTxs.length) return <div style={{padding:"80px 0",textAlign:"center",color:"#4b5563"}}>
    <div style={{fontSize:40,marginBottom:12}}>📋</div>
    <div style={{fontSize:14,fontWeight:600,color:"#6b7280"}}>거래 내역을 업로드하면</div>
    <div style={{fontSize:13,color:"#374151",marginTop:4}}>재무상태표가 자동 생성됩니다</div>
  </div>;

  return <div style={{padding:"24px 28px",overflowY:"auto",height:"100%"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
      <div>
        <h2 style={{fontSize:20,fontWeight:900,color:"#fff",margin:"0 0 4px",letterSpacing:"-.03em"}}>📋 재무상태표</h2>
        <p style={{color:"#6b7280",margin:"0 0 12px",fontSize:12}}>
          ※ 업로드 거래 기반 추정치입니다. 확정 재무제표는 공인회계사 검토가 필요합니다.
        </p>
        <div style={{display:"flex",gap:5}}>
          <Chip label="전체" active={bsYear==="전체"} color="#8b5cf6" onClick={()=>setBsYear("전체")}/>
          {years.map(y=><Chip key={y} label={y+"년"} active={bsYear===y} color="#8b5cf6" onClick={()=>setBsYear(y)}/>)}
        </div>
      </div>
    </div>

    {/* KPI */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:22}}>
      {[{l:"총 자산",v:totalA,c:"#60a5fa"},{l:"총 부채",v:totalL,c:"#f87171"},{l:"순 자산(자본)",v:totalE,c:"#34d399"}].map(k=>(
        <div key={k.l} style={{padding:"15px 18px",borderRadius:12,
          background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)"}}>
          <div style={{fontSize:10,color:"#6b7280",marginBottom:5,textTransform:"uppercase",letterSpacing:".05em"}}>{k.l}</div>
          <div style={{fontSize:22,fontWeight:900,color:k.c,letterSpacing:"-.02em"}}>{fmtW(k.v)}원</div>
        </div>
      ))}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
      {/* Assets */}
      <div>
        <div style={{fontSize:12,fontWeight:700,color:"#60a5fa",marginBottom:10,
          display:"flex",alignItems:"center",gap:6}}>
          <span>자산</span>
          <span style={{fontSize:11,color:"#4b5563",fontWeight:400}}>총 {fmt(totalA)}원</span>
        </div>
        <BSSection title="Ⅰ. 유동자산" color="#60a5fa"
          items={bs.assets.current}
          total={bs.assets.current.reduce((s,r)=>s+r.value,0)}/>
        <BSSection title="Ⅱ. 비유동자산" color="#3b82f6"
          items={bs.assets.noncurrent}
          total={bs.assets.noncurrent.reduce((s,r)=>s+r.value,0)}/>
        <div style={{padding:"10px 16px",borderRadius:10,background:"rgba(96,165,250,.1)",
          border:"1px solid rgba(96,165,250,.3)",display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:12,fontWeight:700,color:"#60a5fa"}}>자산 총계</span>
          <span style={{fontSize:13,fontWeight:900,color:"#60a5fa"}}>{fmt(totalA)}원</span>
        </div>
      </div>

      {/* Liabilities + Equity */}
      <div>
        <div style={{fontSize:12,fontWeight:700,color:"#f87171",marginBottom:10,
          display:"flex",alignItems:"center",gap:6}}>
          <span>부채 + 자본</span>
          <span style={{fontSize:11,color:"#4b5563",fontWeight:400}}>총 {fmt(totalL+totalE)}원</span>
        </div>
        <BSSection title="Ⅰ. 유동부채" color="#f87171"
          items={bs.liabilities.current}
          total={totalL}/>
        <BSSection title="Ⅱ. 자본" color="#34d399"
          items={bs.equity} total={totalE}/>
        <div style={{padding:"10px 16px",borderRadius:10,background:"rgba(52,211,153,.08)",
          border:"1px solid rgba(52,211,153,.25)",display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700,color:"#34d399"}}>부채 + 자본 총계</span>
          <span style={{fontSize:13,fontWeight:900,color:"#34d399"}}>{fmt(totalL+totalE)}원</span>
        </div>
        {/* Balance check */}
        <div style={{padding:"10px 16px",borderRadius:10,
          background:Math.abs(totalA-(totalL+totalE))<1000?"rgba(52,211,153,.06)":"rgba(251,146,60,.08)",
          border:`1px solid ${Math.abs(totalA-(totalL+totalE))<1000?"rgba(52,211,153,.2)":"rgba(251,146,60,.3)"}`}}>
          <div style={{fontSize:11,fontWeight:700,color:Math.abs(totalA-(totalL+totalE))<1000?"#34d399":"#fb923c"}}>
            {Math.abs(totalA-(totalL+totalE))<1000?"✓ 대차평균 균형":"⚠ 추정치 기반 (오차 있음)"}
          </div>
          <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>자산 - (부채+자본) = {fmt(totalA-totalL-totalE)}원</div>
        </div>
      </div>
    </div>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 거래처 관리 모듈
// ─────────────────────────────────────────────────────────────────────────────

// 홈택스 거래처 엑셀 파싱 (사업자등록증 기반 표준 포맷)
function parseClientsFromExcel(rows) {
  // 헤더 행 탐지
  let hIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i].map(c => String(c||"").replace(/\s/g,"").toLowerCase());
    if (r.some(c => c.includes("사업자") || c.includes("거래처") || c.includes("상호"))) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) throw new Error("헤더를 찾을 수 없습니다. '사업자번호' 또는 '상호' 컬럼을 확인해주세요.");

  const headers = rows[hIdx].map(c => String(c||"").trim().replace(/\s/g,"").toLowerCase());
  const getIdx = (...keys) => { for(const k of keys){ const i=headers.findIndex(h=>h.includes(k)); if(i>=0)return i; } return -1; };

  const COL = {
    bizNo:    getIdx("사업자등록번호","사업자번호","bizno","사업자"),
    name:     getIdx("상호","거래처명","법인명","업체명","name"),
    ceoName:  getIdx("대표자","대표","ceo"),
    bizType:  getIdx("업태","업종"),
    bizItem:  getIdx("종목","품목"),
    addr:     getIdx("주소","소재지","address"),
    tel:      getIdx("전화","연락처","tel","phone"),
    email:    getIdx("이메일","email","메일"),
    type:     getIdx("구분","거래유형","type"),
    bank:     getIdx("은행","계좌은행"),
    bankAcc:  getIdx("계좌번호","예금주"),
    note:     getIdx("비고","메모","note"),
  };

  const results = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c)) continue;
    const g = idx => idx >= 0 ? String(row[idx]||"").trim() : "";

    // 사업자번호 정규화 (123-45-67890 형식)
    const rawBizNo = g(COL.bizNo).replace(/[^0-9]/g,"");
    const bizNo = rawBizNo.length === 10
      ? `${rawBizNo.slice(0,3)}-${rawBizNo.slice(3,5)}-${rawBizNo.slice(5)}`
      : g(COL.bizNo);

    const name = g(COL.name);
    if (!name && !bizNo) continue;

    // 거래유형 자동 판별
    const rawType = g(COL.type).toLowerCase();
    let clientType = "both";
    if (rawType.includes("매출") || rawType.includes("고객") || rawType.includes("customer")) clientType = "customer";
    else if (rawType.includes("매입") || rawType.includes("공급") || rawType.includes("vendor") || rawType.includes("협력")) clientType = "vendor";

    results.push({
      id: "client_" + Date.now() + "_" + i,
      bizNo,
      name,
      ceoName:  g(COL.ceoName),
      bizType:  g(COL.bizType),
      bizItem:  g(COL.bizItem),
      addr:     g(COL.addr),
      tel:      g(COL.tel),
      email:    g(COL.email),
      type:     clientType,  // customer | vendor | both
      bank:     g(COL.bank),
      bankAcc:  g(COL.bankAcc),
      note:     g(COL.note),
      createdAt: new Date().toISOString().slice(0,10),
      txSummary: { totalIn:0, totalOut:0, count:0 }, // 거래내역 연동 후 채워짐
    });
  }
  return results;
}

// 거래처 유형 메타
const CLIENT_TYPE_META = {
  customer: { label:"매출처(고객)", color:"#34d399", icon:"📤", short:"매출처" },
  vendor:   { label:"매입처(협력사)", color:"#60a5fa", icon:"📥", short:"매입처" },
  both:     { label:"매출+매입",    color:"#f59e0b", icon:"🔄", short:"양방향" },
};

// 거래처 등록/수정 모달
function ClientModal({ client, onSave, onClose }) {
  const init = client || {
    id:"", bizNo:"", name:"", ceoName:"", bizType:"", bizItem:"",
    addr:"", tel:"", email:"", type:"both", bank:"", bankAcc:"", note:"",
  };
  const [form, setForm] = useState({...init});
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const fmtBizNo = v => {
    const d = v.replace(/[^0-9]/g,"");
    if (d.length<=3) return d;
    if (d.length<=5) return d.slice(0,3)+"-"+d.slice(3);
    return d.slice(0,3)+"-"+d.slice(3,5)+"-"+d.slice(5,10);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:500,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#131826",border:"1px solid rgba(96,165,250,.3)",borderRadius:20,
        width:620,maxHeight:"88vh",display:"flex",flexDirection:"column",
        boxShadow:"0 32px 80px rgba(0,0,0,.7)"}}>

        <div style={{padding:"18px 24px",borderBottom:"1px solid rgba(255,255,255,.07)",
          display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontSize:15,fontWeight:900,color:"#fff"}}>{client?"✏️ 거래처 수정":"🏢 거래처 등록"}</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>사업자 정보 입력</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#6b7280",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"20px 24px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:13}}>
          {/* 사업자번호 */}
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>사업자등록번호</label>
            <input value={form.bizNo} onChange={e=>set("bizNo",fmtBizNo(e.target.value))}
              placeholder="123-45-67890" maxLength={12}
              style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
                borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"}}/>
          </div>

          {/* 거래유형 */}
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>거래 유형</label>
            <div style={{display:"flex",gap:6}}>
              {Object.entries(CLIENT_TYPE_META).map(([v,m])=>(
                <button key={v} onClick={()=>set("type",v)} style={{
                  flex:1,padding:"8px 4px",borderRadius:8,cursor:"pointer",fontSize:10,fontWeight:700,
                  background:form.type===v?`${m.color}20`:"rgba(255,255,255,.04)",
                  border:`1px solid ${form.type===v?`${m.color}60`:"rgba(255,255,255,.1)"}`,
                  color:form.type===v?m.color:"#6b7280"}}>
                  {m.icon} {m.short}
                </button>
              ))}
            </div>
          </div>

          {[
            {k:"name",    l:"상호(거래처명) *", p:"(주)홍길동",    span:2},
            {k:"ceoName", l:"대표자명",         p:"홍길동"},
            {k:"bizType", l:"업태",             p:"제조, 도소매"},
            {k:"bizItem", l:"종목",             p:"전자부품, 소프트웨어"},
            {k:"tel",     l:"연락처",           p:"02-1234-5678"},
            {k:"email",   l:"이메일",           p:"contact@company.com"},
            {k:"bank",    l:"거래 은행",         p:"국민은행"},
            {k:"bankAcc", l:"계좌번호",          p:"123-456-789012"},
            {k:"addr",    l:"주소",             p:"서울시 강남구...", span:2},
            {k:"note",    l:"메모",             p:"특이사항...", span:2},
          ].map(f=>(
            <div key={f.k} style={{display:"flex",flexDirection:"column",gap:5,
              ...(f.span===2?{gridColumn:"1/-1"}:{})}}>
              <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>{f.l}</label>
              <input value={form[f.k]||""} onChange={e=>set(f.k,e.target.value)} placeholder={f.p}
                style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
                  borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"}}/>
            </div>
          ))}
        </div>

        <div style={{padding:"14px 24px",borderTop:"1px solid rgba(255,255,255,.07)",
          display:"flex",justifyContent:"flex-end",gap:10,flexShrink:0}}>
          <button onClick={onClose} style={{padding:"9px 20px",borderRadius:9,cursor:"pointer",
            background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
            color:"#9ca3af",fontWeight:600,fontSize:13}}>취소</button>
          <button onClick={()=>onSave({...form,id:form.id||"client_"+Date.now()})}
            disabled={!form.name} style={{padding:"9px 24px",borderRadius:9,
            cursor:form.name?"pointer":"not-allowed",
            background:form.name?"linear-gradient(135deg,#3b82f6,#1d4ed8)":"#374151",
            border:"none",color:"#fff",fontWeight:700,fontSize:13,opacity:form.name?1:.5}}>
            ✓ 저장
          </button>
        </div>
      </div>
    </div>
  );
}

// 거래처 엑셀 업로드 모달
function ClientUploadModal({ onImport, onClose }) {
  const fileRef = useRef();
  const [parsed,   setParsed]   = useState(null);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState(new Set());

  const handleFile = async file => {
    setLoading(true); setError("");
    try {
      const wb  = XLSX.read(await file.arrayBuffer(), { type:"array", codepage:949 });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:"" });
      const clients = parseClientsFromExcel(rows);
      if (!clients.length) throw new Error("거래처 데이터를 찾을 수 없습니다.");
      setParsed(clients);
      setSelected(new Set(clients.map(c=>c.id)));
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const toggle = id => setSelected(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.82)",zIndex:500,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#131826",border:"1px solid rgba(96,165,250,.3)",borderRadius:20,
        width:860,maxHeight:"88vh",display:"flex",flexDirection:"column",
        boxShadow:"0 32px 80px rgba(0,0,0,.7)"}}>

        <div style={{padding:"18px 24px",borderBottom:"1px solid rgba(255,255,255,.07)",
          display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontSize:15,fontWeight:900,color:"#fff"}}>📂 거래처 엑셀 일괄 등록</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>
              국세청 홈택스 엑셀 또는 직접 작성한 거래처 목록 업로드
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#6b7280",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
          {!parsed ? (
            <>
              <div onClick={()=>fileRef.current.click()}
                onDragOver={e=>e.preventDefault()}
                onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}
                style={{border:"2px dashed rgba(96,165,250,.4)",borderRadius:16,padding:"44px 24px",
                  textAlign:"center",cursor:"pointer",background:"rgba(96,165,250,.04)"}}>
                <div style={{fontSize:36,marginBottom:10}}>🏢</div>
                <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:6}}>
                  거래처 파일을 드래그하거나 클릭하세요
                </div>
                <div style={{fontSize:12,color:"#6b7280"}}>.xlsx / .xls / .csv 지원</div>
                {loading&&<div style={{fontSize:12,color:"#60a5fa",marginTop:8}}>⏳ 파싱 중...</div>}
                {error&&<div style={{fontSize:12,color:"#f87171",marginTop:8}}>⚠ {error}</div>}
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}}
                onChange={e=>{if(e.target.files[0])handleFile(e.target.files[0]);e.target.value="";}}/>

              {/* 지원 컬럼 안내 */}
              <div style={{marginTop:18,padding:"16px 18px",borderRadius:12,
                background:"rgba(96,165,250,.06)",border:"1px solid rgba(96,165,250,.2)"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#60a5fa",marginBottom:10}}>
                  💡 홈택스 호환 컬럼 (컬럼명만 맞으면 순서 무관)
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                  {[
                    {l:"사업자등록번호",r:"자동 포맷 (000-00-00000)"},
                    {l:"상호 / 거래처명",r:"필수"},
                    {l:"대표자",r:"선택"},
                    {l:"업태 / 종목",r:"선택"},
                    {l:"주소 / 소재지",r:"선택"},
                    {l:"전화 / 연락처",r:"선택"},
                    {l:"이메일",r:"선택"},
                    {l:"구분 / 거래유형",r:"매출처·매입처 자동"},
                    {l:"은행 / 계좌번호",r:"선택"},
                    {l:"비고 / 메모",r:"선택"},
                  ].map(c=>(
                    <div key={c.l} style={{padding:"6px 10px",borderRadius:7,
                      background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)"}}>
                      <div style={{fontSize:11,color:"#e5e7eb",fontWeight:600}}>{c.l}</div>
                      <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>{c.r}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:10,fontSize:11,color:"#6b7280"}}>
                  ※ 홈택스 → 세금계산서 → 거래처 관리 → 엑셀 저장 포맷을 그대로 업로드하면 됩니다
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>
                  ✅ {parsed.length}개 거래처 파싱 완료
                </div>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <button onClick={()=>setSelected(new Set(parsed.map(c=>c.id)))}
                    style={{fontSize:11,color:"#60a5fa",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>전체선택</button>
                  <button onClick={()=>setSelected(new Set())}
                    style={{fontSize:11,color:"#6b7280",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>전체해제</button>
                  <span style={{fontSize:11,color:"#6b7280"}}>{selected.size}개 선택</span>
                </div>
              </div>

              {/* 타입별 그룹 표시 */}
              {["customer","vendor","both"].map(type=>{
                const group = parsed.filter(c=>c.type===type);
                if (!group.length) return null;
                const meta = CLIENT_TYPE_META[type];
                return (
                  <div key={type} style={{marginBottom:16}}>
                    <div style={{fontSize:11,fontWeight:700,color:meta.color,marginBottom:8,
                      display:"flex",alignItems:"center",gap:6}}>
                      <span>{meta.icon}</span><span>{meta.label}</span>
                      <span style={{fontSize:10,color:"#4b5563"}}>({group.length}개)</span>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {group.map(c=>{
                        const isSel = selected.has(c.id);
                        return (
                          <div key={c.id} onClick={()=>toggle(c.id)} style={{
                            display:"grid",gridTemplateColumns:"24px 180px 120px 120px 1fr 120px",
                            alignItems:"center",gap:10,padding:"9px 12px",borderRadius:9,cursor:"pointer",
                            background:isSel?`${meta.color}0d`:"rgba(255,255,255,.02)",
                            border:`1px solid ${isSel?`${meta.color}35`:"rgba(255,255,255,.06)"}`,
                            transition:"all .1s"}}>
                            <div style={{width:14,height:14,borderRadius:4,
                              border:`2px solid ${isSel?meta.color:"#374151"}`,
                              background:isSel?meta.color:"transparent",
                              display:"flex",alignItems:"center",justifyContent:"center"}}>
                              {isSel&&<span style={{fontSize:9,color:"#fff",lineHeight:1}}>✓</span>}
                            </div>
                            <div>
                              <div style={{fontSize:12,fontWeight:700,color:"#e5e7eb"}}>{c.name}</div>
                              <div style={{fontSize:10,color:"#6b7280"}}>{c.bizNo||"번호없음"}</div>
                            </div>
                            <div style={{fontSize:11,color:"#9ca3af"}}>{c.ceoName||"-"}</div>
                            <div style={{fontSize:10,color:"#6b7280"}}>{c.bizType||"-"}</div>
                            <div style={{fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.addr||"-"}</div>
                            <div style={{fontSize:10,color:"#6b7280"}}>{c.tel||c.email||"-"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <button onClick={()=>{setParsed(null);setError("");}}
                style={{marginTop:8,fontSize:11,color:"#6b7280",cursor:"pointer",
                  background:"none",border:"none",textDecoration:"underline"}}>
                ← 다시 업로드
              </button>
            </>
          )}
        </div>

        <div style={{padding:"14px 24px",borderTop:"1px solid rgba(255,255,255,.07)",
          display:"flex",justifyContent:"flex-end",gap:10,flexShrink:0}}>
          <button onClick={onClose} style={{padding:"9px 20px",borderRadius:9,cursor:"pointer",
            background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
            color:"#9ca3af",fontWeight:600,fontSize:13}}>취소</button>
          {parsed&&<button onClick={()=>{onImport(parsed.filter(c=>selected.has(c.id)));onClose();}}
            disabled={!selected.size}
            style={{padding:"9px 24px",borderRadius:9,cursor:selected.size?"pointer":"not-allowed",
              background:selected.size?"linear-gradient(135deg,#3b82f6,#1d4ed8)":"#374151",
              border:"none",color:"#fff",fontWeight:700,fontSize:13,opacity:selected.size?1:.5}}>
            ✓ {selected.size}개 등록
          </button>}
        </div>
      </div>
    </div>
  );
}

// 거래처 목록/상세 페이지
function ClientsPage({ clients, allTxs, onSave, onDelete, onUpload }) {
  const [search,    setSearch]    = useState("");
  const [typeFilter,setTypeFilter]= useState("all");
  const [sortBy,    setSortBy]    = useState("name");
  const [selClient, setSelClient] = useState(null);
  const [editModal, setEditModal] = useState(null); // null | "new" | client
  const [showUpload,setShowUpload]= useState(false);

  // 거래처별 거래 집계 (desc에 거래처명 포함 여부로 연동)
  const clientStats = useMemo(() => {
    const map = {};
    clients.forEach(c => {
      const name = c.name.toLowerCase();
      const bizNo = c.bizNo?.replace(/[^0-9]/g,"");
      const matched = allTxs.filter(t =>
        t.desc?.toLowerCase().includes(name) ||
        (bizNo && t.desc?.replace(/[^0-9]/g,"").includes(bizNo))
      );
      map[c.id] = {
        count: matched.length,
        totalIn:  matched.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0),
        totalOut: matched.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0),
        lastDate: matched.sort((a,b)=>b.date.localeCompare(a.date))[0]?.date || "",
        recentTxs: matched.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5),
      };
    });
    return map;
  }, [clients, allTxs]);

  const filtered = useMemo(() => {
    let list = [...clients];
    if (typeFilter !== "all") list = list.filter(c=>c.type===typeFilter);
    if (search) list = list.filter(c=>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.bizNo?.includes(search) ||
      c.ceoName?.toLowerCase().includes(search.toLowerCase())
    );
    list.sort((a,b) => {
      if (sortBy==="name") return a.name.localeCompare(b.name);
      if (sortBy==="txCount") return (clientStats[b.id]?.count||0)-(clientStats[a.id]?.count||0);
      if (sortBy==="amount") return (clientStats[b.id]?.totalOut+clientStats[b.id]?.totalIn||0)
                                   -(clientStats[a.id]?.totalOut+clientStats[a.id]?.totalIn||0);
      return 0;
    });
    return list;
  }, [clients, typeFilter, search, sortBy, clientStats]);

  const totals = useMemo(() => ({
    customer: clients.filter(c=>c.type==="customer").length,
    vendor:   clients.filter(c=>c.type==="vendor").length,
    both:     clients.filter(c=>c.type==="both").length,
    totalIn:  Object.values(clientStats).reduce((s,v)=>s+v.totalIn,0),
    totalOut: Object.values(clientStats).reduce((s,v)=>s+v.totalOut,0),
  }), [clients, clientStats]);

  const fmt = n => Math.abs(n||0).toLocaleString();

  return (
    <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
      {showUpload&&<ClientUploadModal onImport={onUpload} onClose={()=>setShowUpload(false)}/>}
      {editModal&&<ClientModal client={editModal==="new"?null:editModal}
        onSave={c=>{onSave(c);setEditModal(null);}} onClose={()=>setEditModal(null)}/>}

      {/* 거래처 목록 패널 */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* 헤더 */}
        <div style={{padding:"18px 24px 14px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <h2 style={{fontSize:18,fontWeight:900,color:"#fff",margin:"0 0 3px",letterSpacing:"-.03em"}}>
                🏢 거래처 관리
              </h2>
              <p style={{color:"#6b7280",margin:0,fontSize:12}}>
                총 {clients.length}개 거래처 · 거래내역 자동 연동
              </p>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowUpload(true)} style={{
                padding:"8px 14px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
                background:"rgba(96,165,250,.1)",border:"1px solid rgba(96,165,250,.3)",color:"#60a5fa"}}>
                📂 엑셀 업로드
              </button>
              <button onClick={()=>setEditModal("new")} style={{
                padding:"8px 14px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
                background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",color:"#fff"}}>
                + 거래처 등록
              </button>
            </div>
          </div>

          {/* KPI 요약 */}
          {clients.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
            {[
              {l:"전체",    v:clients.length+"개",         c:"#9ca3af"},
              {l:"매출처",  v:totals.customer+"개",        c:"#34d399"},
              {l:"매입처",  v:totals.vendor+"개",          c:"#60a5fa"},
              {l:"연계 수입", v:fmt(totals.totalIn)+"원",  c:"#34d399"},
              {l:"연계 지출", v:fmt(totals.totalOut)+"원", c:"#f87171"},
            ].map(k=>(
              <div key={k.l} style={{padding:"8px 12px",borderRadius:9,
                background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)"}}>
                <div style={{fontSize:9,color:"#6b7280",textTransform:"uppercase",letterSpacing:".04em",marginBottom:3}}>{k.l}</div>
                <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>}

          {/* 검색 + 필터 */}
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{position:"relative",flex:1}}>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#4b5563"}}>🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="거래처명, 사업자번호, 대표자명 검색..."
                style={{width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
                  borderRadius:9,padding:"8px 12px 8px 32px",color:"#fff",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
            </div>
            {[{v:"all",l:"전체"},
              {v:"customer",l:"📤 매출처"},
              {v:"vendor",  l:"📥 매입처"},
              {v:"both",    l:"🔄 양방향"},
            ].map(f=>(
              <button key={f.v} onClick={()=>setTypeFilter(f.v)} style={{
                padding:"7px 12px",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",
                background:typeFilter===f.v?"rgba(96,165,250,.15)":"rgba(255,255,255,.04)",
                border:`1px solid ${typeFilter===f.v?"rgba(96,165,250,.5)":"rgba(255,255,255,.08)"}`,
                color:typeFilter===f.v?"#60a5fa":"#6b7280",whiteSpace:"nowrap"}}>
                {f.l}
              </button>
            ))}
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
              style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",
                borderRadius:8,padding:"7px 10px",color:"#9ca3af",fontSize:11,outline:"none"}}>
              <option value="name" style={{background:"#1a1f2e"}}>이름순</option>
              <option value="txCount" style={{background:"#1a1f2e"}}>거래건수순</option>
              <option value="amount" style={{background:"#1a1f2e"}}>거래금액순</option>
            </select>
          </div>
        </div>

        {/* 목록 */}
        <div style={{flex:1,overflowY:"auto"}}>
          {clients.length===0 ? (
            <div style={{padding:"80px 0",textAlign:"center"}}>
              <div style={{fontSize:48,marginBottom:14}}>🏢</div>
              <div style={{fontSize:14,fontWeight:700,color:"#6b7280",marginBottom:8}}>등록된 거래처가 없습니다</div>
              <div style={{fontSize:12,color:"#374151",marginBottom:22}}>홈택스 엑셀을 업로드하거나 직접 등록하세요</div>
              <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                <button onClick={()=>setShowUpload(true)} style={{padding:"10px 22px",borderRadius:10,cursor:"pointer",
                  background:"rgba(96,165,250,.1)",border:"1px solid rgba(96,165,250,.3)",color:"#60a5fa",fontWeight:700,fontSize:13}}>
                  📂 엑셀 업로드
                </button>
                <button onClick={()=>setEditModal("new")} style={{padding:"10px 22px",borderRadius:10,cursor:"pointer",
                  background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",color:"#fff",fontWeight:700,fontSize:13}}>
                  + 직접 등록
                </button>
              </div>
            </div>
          ) : filtered.length===0 ? (
            <div style={{padding:"60px 0",textAlign:"center",color:"#6b7280",fontSize:13}}>검색 결과 없음</div>
          ) : (
            <>
              {/* 테이블 헤더 */}
              <div style={{display:"grid",
                gridTemplateColumns:"30px 220px 110px 90px 80px 110px 110px 90px 100px",
                padding:"8px 20px",background:"rgba(255,255,255,.02)",
                borderBottom:"1px solid rgba(255,255,255,.06)",
                fontSize:9,color:"#4b5563",fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",flexShrink:0}}>
                <div/>
                <div>거래처</div><div>사업자번호</div><div>대표자</div><div>유형</div>
                <div style={{textAlign:"right"}}>연계수입</div>
                <div style={{textAlign:"right"}}>연계지출</div>
                <div style={{textAlign:"right"}}>거래건수</div>
                <div style={{textAlign:"center"}}>관리</div>
              </div>

              {filtered.map((c,i) => {
                const st = clientStats[c.id] || {};
                const meta = CLIENT_TYPE_META[c.type] || CLIENT_TYPE_META.both;
                const isSel = selClient?.id===c.id;
                return (
                  <div key={c.id}
                    onClick={()=>setSelClient(isSel?null:c)}
                    style={{display:"grid",
                      gridTemplateColumns:"30px 220px 110px 90px 80px 110px 110px 90px 100px",
                      padding:"10px 20px",alignItems:"center",cursor:"pointer",
                      borderBottom:"1px solid rgba(255,255,255,.04)",
                      background:isSel?`${meta.color}0a`:i%2===0?"transparent":"rgba(255,255,255,.008)",
                      borderLeft:`2.5px solid ${isSel?meta.color:"transparent"}`,
                      transition:"all .1s"}}
                    onMouseEnter={e=>!isSel&&(e.currentTarget.style.background="rgba(255,255,255,.03)")}
                    onMouseLeave={e=>!isSel&&(e.currentTarget.style.background=i%2===0?"transparent":"rgba(255,255,255,.008)")}>
                    {/* 아이콘 */}
                    <div style={{width:24,height:24,borderRadius:7,flexShrink:0,
                      background:`${meta.color}18`,border:`1px solid ${meta.color}30`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>
                      {meta.icon}
                    </div>
                    {/* 거래처명 */}
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:"#e5e7eb"}}>{c.name}</div>
                      <div style={{fontSize:10,color:"#4b5563"}}>{c.bizType||c.bizItem||""}</div>
                    </div>
                    <div style={{fontSize:11,color:"#6b7280",fontFamily:"monospace"}}>{c.bizNo||"-"}</div>
                    <div style={{fontSize:11,color:"#9ca3af"}}>{c.ceoName||"-"}</div>
                    {/* 유형 뱃지 */}
                    <div style={{padding:"3px 8px",borderRadius:20,fontSize:9,fontWeight:700,
                      background:`${meta.color}15`,color:meta.color,
                      border:`1px solid ${meta.color}30`,textAlign:"center",whiteSpace:"nowrap"}}>
                      {meta.short}
                    </div>
                    <div style={{fontSize:11,fontWeight:600,color:"#34d399",textAlign:"right"}}>
                      {st.totalIn>0?`+${fmt(st.totalIn)}원`:"-"}
                    </div>
                    <div style={{fontSize:11,fontWeight:600,color:"#f87171",textAlign:"right"}}>
                      {st.totalOut>0?`${fmt(st.totalOut)}원`:"-"}
                    </div>
                    <div style={{fontSize:11,color:"#6b7280",textAlign:"right"}}>
                      {st.count>0?`${st.count}건`:"-"}
                    </div>
                    {/* 버튼 */}
                    <div style={{display:"flex",gap:4,justifyContent:"center"}} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>setEditModal(c)} style={{
                        padding:"4px 8px",borderRadius:6,fontSize:9,fontWeight:700,cursor:"pointer",
                        background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"#9ca3af"}}>
                        ✏️
                      </button>
                      <button onClick={()=>{if(window.confirm(`"${c.name}" 삭제?`))onDelete(c.id);}} style={{
                        padding:"4px 8px",borderRadius:6,fontSize:9,fontWeight:700,cursor:"pointer",
                        background:"rgba(248,113,113,.08)",border:"1px solid rgba(248,113,113,.2)",color:"#f87171"}}>
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* 우측 상세 패널 */}
      {selClient && (()=>{
        const c = selClient;
        const st = clientStats[c.id] || {};
        const meta = CLIENT_TYPE_META[c.type] || CLIENT_TYPE_META.both;
        return (
          <div style={{width:300,flexShrink:0,borderLeft:"1px solid rgba(255,255,255,.07)",
            display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"16px 18px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontSize:20}}>{meta.icon}</span>
                    <span style={{fontSize:14,fontWeight:800,color:"#fff"}}>{c.name}</span>
                  </div>
                  <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,
                    background:`${meta.color}15`,color:meta.color,border:`1px solid ${meta.color}30`,fontWeight:700}}>
                    {meta.label}
                  </span>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setEditModal(c)} style={{
                    padding:"5px 10px",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",
                    background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"#9ca3af"}}>
                    ✏️ 수정
                  </button>
                  <button onClick={()=>setSelClient(null)} style={{
                    padding:"5px 10px",borderRadius:7,fontSize:11,cursor:"pointer",
                    background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",color:"#6b7280"}}>
                    ✕
                  </button>
                </div>
              </div>
              {/* 사업자 정보 */}
              {[
                {l:"사업자번호", v:c.bizNo||"-"},
                {l:"대표자",    v:c.ceoName||"-"},
                {l:"업태/종목", v:[c.bizType,c.bizItem].filter(Boolean).join(" / ")||"-"},
                {l:"연락처",    v:c.tel||"-"},
                {l:"이메일",    v:c.email||"-"},
                {l:"은행/계좌", v:[c.bank,c.bankAcc].filter(Boolean).join(" ")||"-"},
              ].map(r=>(
                <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",
                  borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                  <span style={{fontSize:10,color:"#6b7280"}}>{r.l}</span>
                  <span style={{fontSize:10,color:"#9ca3af",fontWeight:500,
                    maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right"}}>
                    {r.v}
                  </span>
                </div>
              ))}
              {c.addr&&<div style={{fontSize:10,color:"#4b5563",marginTop:6,lineHeight:1.5}}>{c.addr}</div>}
            </div>

            {/* 거래 통계 */}
            <div style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
              <div style={{fontSize:10,color:"#6b7280",fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>
                연계 거래내역
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:6}}>
                <div style={{padding:"8px 10px",borderRadius:8,background:"rgba(52,211,153,.08)",border:"1px solid rgba(52,211,153,.2)"}}>
                  <div style={{fontSize:9,color:"#34d399",marginBottom:3}}>연계 수입</div>
                  <div style={{fontSize:13,fontWeight:800,color:"#34d399"}}>+{fmt(st.totalIn)}원</div>
                </div>
                <div style={{padding:"8px 10px",borderRadius:8,background:"rgba(248,113,113,.08)",border:"1px solid rgba(248,113,113,.2)"}}>
                  <div style={{fontSize:9,color:"#f87171",marginBottom:3}}>연계 지출</div>
                  <div style={{fontSize:13,fontWeight:800,color:"#f87171"}}>{fmt(st.totalOut)}원</div>
                </div>
              </div>
              <div style={{fontSize:10,color:"#6b7280"}}>
                총 {st.count}건 · 최근 {st.lastDate||"-"}
              </div>
            </div>

            {/* 최근 거래 */}
            <div style={{flex:1,overflowY:"auto",padding:"12px 18px"}}>
              <div style={{fontSize:10,color:"#6b7280",fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>
                최근 거래
              </div>
              {(st.recentTxs||[]).length===0
                ? <div style={{fontSize:11,color:"#374151",fontStyle:"italic"}}>연계된 거래 없음</div>
                : (st.recentTxs||[]).map((tx,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",
                    borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                    <div>
                      <div style={{fontSize:11,color:"#e5e7eb",fontWeight:500}}>{tx.desc}</div>
                      <div style={{fontSize:9,color:"#4b5563"}}>{tx.date} · {tx.category}</div>
                    </div>
                    <div style={{fontSize:11,fontWeight:700,
                      color:tx.amount>=0?"#34d399":"#f87171",whiteSpace:"nowrap",marginLeft:8}}>
                      {tx.amount>=0?"+":""}{tx.amount.toLocaleString()}원
                    </div>
                  </div>
                ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 프로젝트 관리 모듈
// ─────────────────────────────────────────────────────────────────────────────
const PROJECT_COLORS = ["#8b5cf6","#3b82f6","#10b981","#f59e0b","#ef4444","#ec4899","#06b6d4","#84cc16","#f97316","#6366f1"];
const pc = i => PROJECT_COLORS[i % PROJECT_COLORS.length];
const fmtM = n => { const a=Math.abs(n||0); if(a>=100000000) return (a/100000000).toFixed(1)+"억"; if(a>=10000) return (a/10000).toFixed(0)+"만"; return a.toLocaleString(); };

function ProjectModal({ project, onSave, onClose }) {
  const init = project || { id:"", name:"", client:"", status:"active", startDate:"", endDate:"", budget:0, desc:"", color:"" };
  const [form, setForm] = useState({...init, color: init.color || PROJECT_COLORS[Math.floor(Math.random()*PROJECT_COLORS.length)]});
  const s = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#131826",border:"1px solid rgba(139,92,246,.35)",borderRadius:20,width:540,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,.7)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:900,color:"#fff"}}>{project?"✏️ 프로젝트 수정":"🗂 프로젝트 등록"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#6b7280",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:13}}>
          {/* 색상 선택 */}
          <div>
            <label style={{fontSize:11,color:"#6b7280",fontWeight:600,display:"block",marginBottom:8}}>프로젝트 색상</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {PROJECT_COLORS.map(c=>(
                <div key={c} onClick={()=>s("color",c)} style={{width:28,height:28,borderRadius:8,background:c,cursor:"pointer",
                  border:`3px solid ${form.color===c?"#fff":"transparent"}`,transition:"all .12s",
                  boxShadow:form.color===c?`0 0 10px ${c}`:"none"}}/>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[
              {k:"name",   l:"프로젝트명 *",   p:"예: 웹사이트 개발 2025",    span:2},
              {k:"client", l:"고객사",          p:"(주)ABC"},
              {k:"status", l:"상태",            type:"sel", opts:[{v:"active",l:"🟢 진행중"},{v:"done",l:"✅ 완료"},{v:"pause",l:"⏸ 보류"},{v:"plan",l:"📋 계획"}]},
              {k:"budget", l:"예산 (원)",        p:"50000000",                type:"number"},
              {k:"startDate",l:"시작일",         type:"date"},
              {k:"endDate",  l:"종료(예정)일",   type:"date"},
              {k:"desc",   l:"설명",            p:"프로젝트 설명...",           span:2},
            ].map(f=>(
              <div key={f.k} style={{display:"flex",flexDirection:"column",gap:5,...(f.span===2?{gridColumn:"1/-1"}:{})}}>
                <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>{f.l}</label>
                {f.type==="sel"
                  ? <select value={form[f.k]||""} onChange={e=>s(f.k,e.target.value)}
                      style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"}}>
                      {f.opts.map(o=><option key={o.v} value={o.v} style={{background:"#1a1f2e"}}>{o.l}</option>)}
                    </select>
                  : <input type={f.type||"text"} value={form[f.k]||""} onChange={e=>s(f.k,f.type==="number"?parseInt(e.target.value)||0:e.target.value)} placeholder={f.p}
                      style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"}}/>}
              </div>
            ))}
          </div>
        </div>
        <div style={{padding:"14px 24px",borderTop:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"flex-end",gap:10,flexShrink:0}}>
          <button onClick={onClose} style={{padding:"9px 20px",borderRadius:9,cursor:"pointer",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",color:"#9ca3af",fontWeight:600,fontSize:13}}>취소</button>
          <button onClick={()=>onSave({...form,id:form.id||"proj_"+Date.now()})} disabled={!form.name}
            style={{padding:"9px 24px",borderRadius:9,cursor:form.name?"pointer":"not-allowed",background:form.name?`linear-gradient(135deg,${form.color},${form.color}cc)`:"#374151",border:"none",color:"#fff",fontWeight:700,fontSize:13,opacity:form.name?1:.5}}>
            ✓ 저장
          </button>
        </div>
      </div>
    </div>
  );
}

// 거래에 프로젝트 태그 붙이는 인라인 셀렉터
function ProjectTag({ projects, value, onChange }) {
  const [open, setOpen] = useState(false);
  const sel = projects.find(p=>p.id===value);
  return (
    <div style={{position:"relative"}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:"2px 8px",borderRadius:8,cursor:"pointer",fontSize:10,fontWeight:700,
        background:sel?`${sel.color}20`:"rgba(255,255,255,.05)",
        border:`1px solid ${sel?`${sel.color}40`:"rgba(255,255,255,.1)"}`,
        color:sel?sel.color:"#4b5563",whiteSpace:"nowrap",minWidth:60}}>
        {sel?sel.name.slice(0,8)+(sel.name.length>8?"…":""):"프로젝트"}
      </div>
      {open&&<div style={{position:"absolute",top:"100%",left:0,zIndex:999,marginTop:4,
        background:"#1e2535",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,
        minWidth:180,boxShadow:"0 16px 40px rgba(0,0,0,.6)",overflow:"hidden"}}>
        <div onClick={()=>{onChange("");setOpen(false);}} style={{padding:"8px 12px",cursor:"pointer",fontSize:11,color:"#6b7280",
          borderBottom:"1px solid rgba(255,255,255,.06)"}}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.05)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          — 미배정
        </div>
        {projects.map(p=>(
          <div key={p.id} onClick={()=>{onChange(p.id);setOpen(false);}} style={{
            padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,fontSize:11}}
            onMouseEnter={e=>e.currentTarget.style.background=`${p.color}15`}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{width:8,height:8,borderRadius:3,background:p.color,flexShrink:0}}/>
            <span style={{color:"#e5e7eb",fontWeight:600}}>{p.name}</span>
            <span style={{fontSize:9,color:"#4b5563",marginLeft:"auto"}}>{p.status==="active"?"진행중":p.status==="done"?"완료":p.status==="pause"?"보류":"계획"}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

function ProjectsPage({ projects, allTxs, onSave, onDelete, onTagTx }) {
  const [editModal, setEditModal] = useState(null);
  const [selProj,   setSelProj]   = useState(null);
  const [tabView,   setTabView]   = useState("cards"); // cards | table

  const STATUS_META = {
    active: { l:"진행중", c:"#34d399", dot:"🟢" },
    done:   { l:"완료",   c:"#60a5fa", dot:"✅" },
    pause:  { l:"보류",   c:"#f59e0b", dot:"⏸" },
    plan:   { l:"계획",   c:"#a78bfa", dot:"📋" },
  };

  // 프로젝트별 거래 집계
  const projStats = useMemo(() => {
    const map = {};
    projects.forEach(p => {
      const txs = allTxs.filter(t=>t.projectId===p.id);
      const revenue = txs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
      const cost    = txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
      map[p.id] = { txs, revenue, cost, profit: revenue-cost,
        margin: revenue>0?(revenue-cost)/revenue*100:0,
        budgetUsed: p.budget>0?cost/p.budget*100:0 };
    });
    return map;
  }, [projects, allTxs]);

  const untaggedTxs = useMemo(()=>allTxs.filter(t=>!t.projectId),[allTxs]);
  const totalRevenue = Object.values(projStats).reduce((s,v)=>s+v.revenue,0);
  const totalCost    = Object.values(projStats).reduce((s,v)=>s+v.cost,0);
  const totalProfit  = totalRevenue - totalCost;

  const selStat = selProj ? projStats[selProj.id] : null;

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {editModal&&<ProjectModal project={editModal==="new"?null:editModal} onSave={c=>{onSave(c);setEditModal(null);}} onClose={()=>setEditModal(null)}/>}

      {/* 헤더 */}
      <div style={{padding:"18px 24px 14px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:900,color:"#fff",margin:"0 0 3px",letterSpacing:"-.03em"}}>🗂 프로젝트 관리</h2>
            <p style={{color:"#6b7280",margin:0,fontSize:12}}>프로젝트별 수익·비용·순이익 추적</p>
          </div>
          <button onClick={()=>setEditModal("new")} style={{padding:"8px 16px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",border:"none",color:"#fff"}}>
            + 프로젝트 등록
          </button>
        </div>

        {/* KPI */}
        {projects.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
          {[
            {l:"전체 프로젝트", v:`${projects.length}개`, c:"#9ca3af"},
            {l:"진행중",        v:`${projects.filter(p=>p.status==="active").length}개`, c:"#34d399"},
            {l:"총 수익",       v:`+${fmtM(totalRevenue)}원`, c:"#34d399"},
            {l:"총 비용",       v:`${fmtM(totalCost)}원`, c:"#f87171"},
            {l:"총 순이익",     v:`${totalProfit>=0?"+":""}${fmtM(totalProfit)}원`, c:totalProfit>=0?"#a78bfa":"#f87171"},
          ].map(k=>(
            <div key={k.l} style={{padding:"9px 12px",borderRadius:9,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{fontSize:9,color:"#6b7280",textTransform:"uppercase",letterSpacing:".04em",marginBottom:3}}>{k.l}</div>
              <div style={{fontSize:13,fontWeight:800,color:k.c}}>{k.v}</div>
            </div>
          ))}
        </div>}
      </div>

      {/* 메인 */}
      <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
        {/* 프로젝트 카드/테이블 */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
          {projects.length===0 ? (
            <div style={{padding:"80px 0",textAlign:"center"}}>
              <div style={{fontSize:48,marginBottom:14}}>🗂</div>
              <div style={{fontSize:14,fontWeight:700,color:"#6b7280",marginBottom:8}}>등록된 프로젝트가 없습니다</div>
              <button onClick={()=>setEditModal("new")} style={{padding:"10px 24px",borderRadius:10,cursor:"pointer",background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",border:"none",color:"#fff",fontWeight:700,fontSize:13}}>
                + 첫 프로젝트 등록
              </button>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:14}}>
              {projects.map((p,i)=>{
                const st = projStats[p.id]||{};
                const meta = STATUS_META[p.status]||STATUS_META.active;
                const isSel = selProj?.id===p.id;
                const budgetPct = Math.min(st.budgetUsed||0, 100);
                const overBudget = p.budget>0 && st.cost>p.budget;
                return (
                  <div key={p.id} onClick={()=>setSelProj(isSel?null:p)}
                    style={{borderRadius:16,padding:18,cursor:"pointer",
                      background:isSel?`${p.color}12`:`${p.color}08`,
                      border:`1.5px solid ${isSel?`${p.color}60`:`${p.color}25`}`,
                      transition:"all .16s"}}
                    onMouseEnter={e=>!isSel&&(e.currentTarget.style.background=`${p.color}10`)}
                    onMouseLeave={e=>!isSel&&(e.currentTarget.style.background=`${p.color}08`)}>
                    {/* 헤더 */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <div style={{width:10,height:10,borderRadius:3,background:p.color,flexShrink:0}}/>
                          <span style={{fontSize:13,fontWeight:800,color:"#fff"}}>{p.name}</span>
                        </div>
                        {p.client&&<div style={{fontSize:10,color:"#6b7280"}}>{p.client}</div>}
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:700,
                          background:`${meta.c}18`,color:meta.c,border:`1px solid ${meta.c}35`}}>
                          {meta.dot} {meta.l}
                        </span>
                        <button onClick={e=>{e.stopPropagation();setEditModal(p);}} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:6,color:"#6b7280",cursor:"pointer",fontSize:11,padding:"2px 7px"}}>✏️</button>
                        <button onClick={e=>{e.stopPropagation();if(window.confirm(`"${p.name}" 삭제?`))onDelete(p.id);}} style={{background:"rgba(248,113,113,.08)",border:"1px solid rgba(248,113,113,.2)",borderRadius:6,color:"#f87171",cursor:"pointer",fontSize:11,padding:"2px 7px"}}>🗑</button>
                      </div>
                    </div>

                    {/* 수익/비용/순이익 */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                      {[
                        {l:"수익",   v:st.revenue||0, c:"#34d399", sign:"+"},
                        {l:"비용",   v:st.cost||0,    c:"#f87171", sign:"-"},
                        {l:"순이익", v:st.profit||0,  c:(st.profit||0)>=0?"#a78bfa":"#f87171", sign:(st.profit||0)>=0?"+":""},
                      ].map(k=>(
                        <div key={k.l} style={{padding:"8px 10px",borderRadius:9,background:"rgba(0,0,0,.2)"}}>
                          <div style={{fontSize:9,color:"#6b7280",marginBottom:3}}>{k.l}</div>
                          <div style={{fontSize:12,fontWeight:800,color:k.c}}>
                            {k.sign}{fmtM(k.v)}원
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 예산 게이지 */}
                    {p.budget>0&&(
                      <div style={{marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{fontSize:9,color:"#6b7280"}}>예산 사용률</span>
                          <span style={{fontSize:9,fontWeight:700,color:overBudget?"#f87171":"#9ca3af"}}>
                            {budgetPct.toFixed(0)}% {overBudget?"⚠ 초과!":""}
                          </span>
                        </div>
                        <div style={{height:5,borderRadius:3,background:"rgba(255,255,255,.08)"}}>
                          <div style={{height:"100%",borderRadius:3,width:`${Math.min(budgetPct,100)}%`,
                            background:overBudget?"#f87171":budgetPct>80?"#f59e0b":p.color,
                            transition:"width .3s"}}/>
                        </div>
                        <div style={{fontSize:9,color:"#4b5563",marginTop:3}}>
                          예산 {fmtM(p.budget)}원 · 사용 {fmtM(st.cost||0)}원
                        </div>
                      </div>
                    )}

                    {/* 기간 + 거래건수 */}
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#4b5563"}}>
                      <span>{p.startDate||"-"} ~ {p.endDate||"진행중"}</span>
                      <span style={{color:p.color}}>{st.txs?.length||0}건 태깅됨</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 미배정 거래 안내 */}
          {projects.length>0&&untaggedTxs.length>0&&(
            <div style={{marginTop:20,padding:"12px 16px",borderRadius:12,
              background:"rgba(245,158,11,.06)",border:"1px solid rgba(245,158,11,.2)"}}>
              <div style={{fontSize:11,color:"#f59e0b",fontWeight:700,marginBottom:4}}>
                ⚠ 프로젝트 미배정 거래 {untaggedTxs.length}건
              </div>
              <div style={{fontSize:11,color:"#6b7280"}}>
                계좌 내역 페이지에서 거래 행의 프로젝트 컬럼을 클릭해 프로젝트를 태깅하세요.
              </div>
            </div>
          )}
        </div>

        {/* 우측 상세 패널 */}
        {selProj&&selStat&&(
          <div style={{width:320,flexShrink:0,borderLeft:"1px solid rgba(255,255,255,.07)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"16px 18px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <div style={{width:12,height:12,borderRadius:4,background:selProj.color}}/>
                <span style={{fontSize:14,fontWeight:800,color:"#fff"}}>{selProj.name}</span>
                <button onClick={()=>setSelProj(null)} style={{marginLeft:"auto",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:6,color:"#6b7280",cursor:"pointer",fontSize:12,padding:"3px 8px"}}>✕</button>
              </div>
              {/* 수익 구조 */}
              {[
                {l:"총 수익",   v:selStat.revenue,  c:"#34d399", sign:"+"},
                {l:"총 비용",   v:selStat.cost,     c:"#f87171", sign:"-"},
                {l:"순 이익",   v:selStat.profit,   c:selStat.profit>=0?"#a78bfa":"#f87171", sign:selStat.profit>=0?"+":"", bold:true},
                {l:"이익률",    v:null, tag:`${selStat.margin.toFixed(1)}%`, c:selStat.margin>20?"#34d399":selStat.margin>0?"#f59e0b":"#f87171"},
              ].map(r=>(
                <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:`${r.bold?"8px":"5px"} 8px`,
                  borderRadius:r.bold?8:0, marginBottom:r.bold?8:0,
                  background:r.bold?"rgba(255,255,255,.04)":"transparent"}}>
                  <span style={{fontSize:11,color:r.bold?"#e5e7eb":"#6b7280",fontWeight:r.bold?700:400}}>{r.l}</span>
                  <span style={{fontSize:r.bold?14:11,fontWeight:r.bold?900:600,color:r.c}}>
                    {r.tag||(r.sign+fmtM(Math.abs(r.v))+"원")}
                  </span>
                </div>
              ))}
            </div>

            {/* 계정별 비용 분류 */}
            <div style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0}}>
              <div style={{fontSize:10,color:"#6b7280",fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>비용 분류</div>
              {(()=>{
                const bycat = {};
                selStat.txs.filter(t=>t.amount<0).forEach(t=>{
                  bycat[t.category||"미확인"]=(bycat[t.category||"미확인"]||0)+Math.abs(t.amount);
                });
                return Object.entries(bycat).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([cat,amt])=>(
                  <div key={cat} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                    <span style={{fontSize:10,color:"#9ca3af"}}>{cat}</span>
                    <span style={{fontSize:10,fontWeight:600,color:"#f87171"}}>{fmtM(amt)}원</span>
                  </div>
                ));
              })()}
            </div>

            {/* 최근 거래 */}
            <div style={{flex:1,overflowY:"auto",padding:"12px 18px"}}>
              <div style={{fontSize:10,color:"#6b7280",fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>
                태깅된 거래 ({selStat.txs.length}건)
              </div>
              {selStat.txs.length===0
                ? <div style={{fontSize:11,color:"#374151",fontStyle:"italic"}}>태깅된 거래 없음</div>
                : selStat.txs.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map((tx,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                      <div>
                        <div style={{fontSize:11,color:"#e5e7eb",fontWeight:500}}>{tx.desc}</div>
                        <div style={{fontSize:9,color:"#4b5563"}}>{tx.date} · {tx.category}</div>
                      </div>
                      <div style={{fontSize:11,fontWeight:700,color:tx.amount>=0?"#34d399":"#f87171",whiteSpace:"nowrap",marginLeft:8}}>
                        {tx.amount>=0?"+":""}{Math.abs(tx.amount).toLocaleString()}원
                      </div>
                    </div>
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 캐시플로우 예측 모듈
// ─────────────────────────────────────────────────────────────────────────────
const REPEAT_OPTIONS = [
  {v:"once",   l:"일회성"},
  {v:"weekly", l:"매주"},
  {v:"monthly",l:"매월"},
  {v:"yearly", l:"매년"},
];

function CashflowPage({ accounts, allTxs, plans, onSavePlan, onDeletePlan }) {
  const [editPlan, setEditPlan] = useState(null); // null | "new" | plan
  const [horizon,  setHorizon]  = useState(90);    // 예측 기간 (일)
  const [selPlan,  setSelPlan]  = useState(null);

  const fmtDate = d => d ? d.slice(5).replace("-","/") : "";
  const today = new Date().toISOString().slice(0,10);

  // 현재 총 잔고 (모든 계좌 실제 거래 합산)
  const currentBalance = useMemo(() => {
    return allTxs.reduce((s,t)=>s+t.amount, 0);
  }, [allTxs]);

  // 예측 기간 날짜 배열 생성
  const dateRange = useMemo(() => {
    const dates = [];
    for (let i=0; i<=horizon; i++) {
      const d = new Date(today);
      d.setDate(d.getDate()+i);
      dates.push(d.toISOString().slice(0,10));
    }
    return dates;
  }, [today, horizon]);

  // 예정 이벤트 확장 (반복 포함)
  const expandedPlans = useMemo(() => {
    const events = [];
    const end = dateRange[dateRange.length-1];
    plans.forEach(p => {
      const addIfInRange = date => {
        if (date >= today && date <= end) events.push({...p, _date: date});
      };
      if (p.repeat==="once") {
        addIfInRange(p.date);
      } else if (p.repeat==="monthly") {
        let d = new Date(p.date);
        while (d.toISOString().slice(0,10) <= end) {
          addIfInRange(d.toISOString().slice(0,10));
          d.setMonth(d.getMonth()+1);
        }
      } else if (p.repeat==="weekly") {
        let d = new Date(p.date);
        while (d.toISOString().slice(0,10) <= end) {
          addIfInRange(d.toISOString().slice(0,10));
          d.setDate(d.getDate()+7);
        }
      } else if (p.repeat==="yearly") {
        let d = new Date(p.date);
        while (d.toISOString().slice(0,10) <= end) {
          addIfInRange(d.toISOString().slice(0,10));
          d.setFullYear(d.getFullYear()+1);
        }
      }
    });
    return events.sort((a,b)=>a._date.localeCompare(b._date));
  }, [plans, dateRange, today]);

  // 일별 잔고 시뮬레이션
  const simulation = useMemo(() => {
    let balance = currentBalance;
    const result = [];
    let minBalance = balance;
    let minDate = today;
    let danger = false;

    dateRange.forEach(date => {
      const dayEvents = expandedPlans.filter(e=>e._date===date);
      const dayDelta = dayEvents.reduce((s,e)=>s+e.amount, 0);
      balance += dayDelta;
      if (balance < minBalance) { minBalance=balance; minDate=date; }
      if (balance < 0) danger=true;
      result.push({ date, balance, delta:dayDelta, events:dayEvents });
    });
    return { days: result, minBalance, minDate, danger };
  }, [currentBalance, dateRange, expandedPlans]);

  // 차트 데이터 (30일 단위 샘플링)
  const chartData = useMemo(() => {
    const step = Math.max(1, Math.floor(simulation.days.length/30));
    return simulation.days.filter((_,i)=>i%step===0||i===simulation.days.length-1);
  }, [simulation]);

  const chartMax = Math.max(...chartData.map(d=>d.balance), 1);
  const chartMin = Math.min(...chartData.map(d=>d.balance), 0);
  const chartRange = chartMax - chartMin || 1;

  // 예정 항목 등록 모달
  const PlanModal = ({plan, onSave, onClose}) => {
    const init = plan || {id:"",name:"",amount:0,date:today,repeat:"once",category:"지출예정",note:"",color:"#f87171"};
    const [f, setF] = useState({...init});
    const sf = (k,v) => setF(p=>({...p,[k]:v}));
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#131826",border:"1px solid rgba(248,113,113,.3)",borderRadius:20,width:480,display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,.7)"}}>
          <div style={{padding:"18px 24px",borderBottom:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
            <div style={{fontSize:15,fontWeight:900,color:"#fff"}}>{plan?"✏️ 예정 항목 수정":"📅 예정 수입/지출 등록"}</div>
            <button onClick={onClose} style={{background:"none",border:"none",color:"#6b7280",fontSize:20,cursor:"pointer"}}>✕</button>
          </div>
          <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:13}}>
            {/* 수입/지출 토글 */}
            <div>
              <label style={{fontSize:11,color:"#6b7280",fontWeight:600,display:"block",marginBottom:8}}>유형</label>
              <div style={{display:"flex",gap:8}}>
                {[{v:1,l:"💰 수입 예정",c:"#34d399"},{v:-1,l:"💸 지출 예정",c:"#f87171"}].map(t=>{
                  const isSel = (f.amount>=0?1:-1)===t.v;
                  return <button key={t.v} onClick={()=>sf("amount",Math.abs(f.amount)*t.v)} style={{
                    flex:1,padding:"9px 0",borderRadius:9,cursor:"pointer",fontSize:12,fontWeight:700,
                    background:isSel?`${t.c}18`:"rgba(255,255,255,.04)",
                    border:`1.5px solid ${isSel?`${t.c}60`:"rgba(255,255,255,.1)"}`,
                    color:isSel?t.c:"#6b7280"}}>
                    {t.l}
                  </button>;
                })}
              </div>
            </div>
            {[
              {k:"name",  l:"항목명 *",    p:"예: 임차료, 직원급여, 프로젝트 수금"},
              {k:"note",  l:"메모",         p:"비고 사항..."},
            ].map(fi=>(
              <div key={fi.k} style={{display:"flex",flexDirection:"column",gap:5}}>
                <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>{fi.l}</label>
                <input value={f[fi.k]||""} onChange={e=>sf(fi.k,e.target.value)} placeholder={fi.p}
                  style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"}}/>
              </div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>금액 *</label>
                <input type="number" value={Math.abs(f.amount)||""} onChange={e=>sf("amount",parseInt(e.target.value)||0 * (f.amount<0?-1:1))}
                  placeholder="1500000"
                  style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"}}/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>날짜 *</label>
                <input type="date" value={f.date} onChange={e=>sf("date",e.target.value)}
                  style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,outline:"none"}}/>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              <label style={{fontSize:11,color:"#6b7280",fontWeight:600}}>반복 주기</label>
              <div style={{display:"flex",gap:6}}>
                {REPEAT_OPTIONS.map(r=>(
                  <button key={r.v} onClick={()=>sf("repeat",r.v)} style={{
                    flex:1,padding:"7px 0",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:700,
                    background:f.repeat===r.v?"rgba(139,92,246,.18)":"rgba(255,255,255,.04)",
                    border:`1px solid ${f.repeat===r.v?"rgba(139,92,246,.5)":"rgba(255,255,255,.1)"}`,
                    color:f.repeat===r.v?"#c4b5fd":"#6b7280"}}>
                    {r.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{padding:"14px 24px",borderTop:"1px solid rgba(255,255,255,.07)",display:"flex",justifyContent:"flex-end",gap:10,flexShrink:0}}>
            <button onClick={onClose} style={{padding:"9px 20px",borderRadius:9,cursor:"pointer",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",color:"#9ca3af",fontWeight:600,fontSize:13}}>취소</button>
            <button onClick={()=>onSave({...f,id:f.id||"plan_"+Date.now(),amount:parseInt(f.amount)||0})} disabled={!f.name||!f.amount}
              style={{padding:"9px 24px",borderRadius:9,cursor:f.name&&f.amount?"pointer":"not-allowed",background:f.amount>=0?"linear-gradient(135deg,#34d399,#059669)":"linear-gradient(135deg,#f87171,#dc2626)",border:"none",color:"#fff",fontWeight:700,fontSize:13,opacity:f.name&&f.amount?1:.5}}>
              ✓ 저장
            </button>
          </div>
        </div>
      </div>
    );
  };

  const fmt = n => Math.abs(n||0).toLocaleString();

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {editPlan&&<PlanModal plan={editPlan==="new"?null:editPlan} onSave={p=>{onSavePlan(p);setEditPlan(null);}} onClose={()=>setEditPlan(null)}/>}

      {/* 헤더 */}
      <div style={{padding:"18px 24px 14px",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,.06)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:900,color:"#fff",margin:"0 0 3px"}}>💰 캐시플로우 예측</h2>
            <p style={{color:"#6b7280",margin:0,fontSize:12}}>예정 수입·지출 입력 → 잔고 시뮬레이션</p>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {/* 예측 기간 */}
            <div style={{display:"flex",gap:5}}>
              {[30,60,90,180].map(d=>(
                <button key={d} onClick={()=>setHorizon(d)} style={{
                  padding:"6px 12px",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",
                  background:horizon===d?"rgba(139,92,246,.2)":"rgba(255,255,255,.04)",
                  border:`1px solid ${horizon===d?"rgba(139,92,246,.5)":"rgba(255,255,255,.1)"}`,
                  color:horizon===d?"#c4b5fd":"#6b7280"}}>
                  {d}일
                </button>
              ))}
            </div>
            <button onClick={()=>setEditPlan("new")} style={{padding:"8px 16px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
              background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",border:"none",color:"#fff"}}>
              + 예정 항목 등록
            </button>
          </div>
        </div>

        {/* 상단 KPI */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {[
            {l:"현재 잔고",    v:currentBalance,       c:currentBalance>=0?"#60a5fa":"#f87171", sign:""},
            {l:`${horizon}일 후 예상 잔고`,v:simulation.days[simulation.days.length-1]?.balance||currentBalance, c:(simulation.days[simulation.days.length-1]?.balance||currentBalance)>=0?"#34d399":"#f87171", sign:""},
            {l:"최저 잔고 예상", v:simulation.minBalance, c:simulation.minBalance<0?"#f87171":simulation.minBalance<currentBalance*0.2?"#f59e0b":"#9ca3af", sign:"", sub:fmtDate(simulation.minDate)},
            {l:"예정 지출 합계", v:expandedPlans.filter(e=>e.amount<0).reduce((s,e)=>s+Math.abs(e.amount),0), c:"#f87171", sign:"-", sub:`${expandedPlans.filter(e=>e.amount<0).length}건`},
          ].map(k=>(
            <div key={k.l} style={{padding:"12px 16px",borderRadius:12,
              background:simulation.danger&&k.l==="최저 잔고 예상"?"rgba(248,113,113,.08)":"rgba(255,255,255,.03)",
              border:`1px solid ${simulation.danger&&k.l==="최저 잔고 예상"?"rgba(248,113,113,.3)":"rgba(255,255,255,.07)"}`}}>
              <div style={{fontSize:9,color:"#6b7280",textTransform:"uppercase",letterSpacing:".04em",marginBottom:4}}>{k.l}</div>
              <div style={{fontSize:16,fontWeight:900,color:k.c,letterSpacing:"-.02em"}}>
                {k.sign}{(k.v<0?"-":"")}{fmtM(Math.abs(k.v))}원
              </div>
              {k.sub&&<div style={{fontSize:9,color:"#6b7280",marginTop:2}}>{k.sub}</div>}
            </div>
          ))}
        </div>

        {simulation.danger&&<div style={{marginTop:10,padding:"10px 14px",borderRadius:9,
          background:"rgba(248,113,113,.1)",border:"1px solid rgba(248,113,113,.35)",
          display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>⚠️</span>
          <span style={{fontSize:12,fontWeight:600,color:"#fca5a5"}}>
            {fmtDate(simulation.minDate)}에 잔고가 마이너스가 될 수 있습니다! 예정 수입을 확인하거나 지출을 조정하세요.
          </span>
        </div>}
      </div>

      <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>

        {/* 좌측: 차트 + 일정 */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>

          {/* 잔고 추이 차트 */}
          <div style={{marginBottom:24,padding:"18px 20px",borderRadius:14,
            background:"rgba(255,255,255,.025)",border:"1px solid rgba(255,255,255,.07)"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:16}}>잔고 추이 시뮬레이션</div>
            <div style={{position:"relative",height:160}}>
              {/* 0선 */}
              {chartMin<0&&<div style={{position:"absolute",left:0,right:0,
                bottom:`${(-chartMin/chartRange)*100}%`,
                borderTop:"1px dashed rgba(248,113,113,.4)",zIndex:1}}/>}
              {/* 영역 차트 */}
              <svg width="100%" height="100%" style={{overflow:"visible"}} preserveAspectRatio="none">
                {chartData.length>1&&(()=>{
                  const pts = chartData.map((d,i)=>{
                    const x = i/(chartData.length-1)*100;
                    const y = 100-((d.balance-chartMin)/chartRange*100);
                    return `${x},${y}`;
                  });
                  const zeroY = 100-((-chartMin)/chartRange*100);
                  const fill = `M0,${100-((chartData[0].balance-chartMin)/chartRange*100)} L${pts.join(" L")} L100,${Math.min(zeroY,100)} L0,${Math.min(zeroY,100)} Z`;
                  const line = `M${pts.join(" L")}`;
                  return <>
                    <defs>
                      <linearGradient id="cfgrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity=".25"/>
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity=".02"/>
                      </linearGradient>
                    </defs>
                    <path d={fill} fill="url(#cfgrad)" vectorEffect="non-scaling-stroke"/>
                    <path d={line} fill="none" stroke="#8b5cf6" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
                    {/* 위험 구간 빨간 점 */}
                    {chartData.filter(d=>d.balance<0).map((d,i)=>{
                      const idx = chartData.indexOf(d);
                      const x = idx/(chartData.length-1)*100;
                      const y = 100-((d.balance-chartMin)/chartRange*100);
                      return <circle key={i} cx={`${x}%`} cy={`${y}%`} r="4" fill="#f87171"/>;
                    })}
                  </>;
                })()}
              </svg>
              {/* X축 레이블 */}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
                {[0, Math.floor(chartData.length/2), chartData.length-1].map(i=>(
                  <span key={i} style={{fontSize:9,color:"#4b5563"}}>{fmtDate(chartData[i]?.date)}</span>
                ))}
              </div>
            </div>
          </div>

          {/* 예정 이벤트 타임라인 */}
          <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:12}}>
            예정 일정 타임라인
            <span style={{fontSize:10,color:"#6b7280",marginLeft:8}}>({expandedPlans.length}건)</span>
          </div>
          {expandedPlans.length===0
            ? <div style={{padding:"40px 0",textAlign:"center",color:"#374151",fontSize:12}}>
                우측 상단 "예정 항목 등록"으로 미래 수입·지출을 입력해 보세요
              </div>
            : (()=>{
                let runBal = currentBalance;
                return expandedPlans.slice(0,60).map((ev,i)=>{
                  runBal += ev.amount;
                  const isIn = ev.amount >= 0;
                  return (
                    <div key={i} style={{display:"grid",gridTemplateColumns:"80px 12px 1fr 110px 110px",
                      alignItems:"center",gap:10,padding:"7px 0",
                      borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                      <div style={{fontSize:10,color:"#6b7280"}}>{fmtDate(ev._date)}</div>
                      <div style={{width:10,height:10,borderRadius:"50%",
                        background:isIn?"#34d399":"#f87171",flexShrink:0}}/>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:"#e5e7eb"}}>{ev.name}</div>
                        {ev.note&&<div style={{fontSize:10,color:"#4b5563"}}>{ev.note}</div>}
                        {ev.repeat!=="once"&&<div style={{fontSize:9,color:"#6b7280"}}>{REPEAT_OPTIONS.find(r=>r.v===ev.repeat)?.l}</div>}
                      </div>
                      <div style={{fontSize:12,fontWeight:700,color:isIn?"#34d399":"#f87171",textAlign:"right"}}>
                        {isIn?"+":"-"}{fmtM(Math.abs(ev.amount))}원
                      </div>
                      <div style={{fontSize:11,fontWeight:700,color:runBal>=0?"#9ca3af":"#f87171",textAlign:"right"}}>
                        {fmtM(runBal)}원
                        {runBal<0&&<span style={{fontSize:9,color:"#f87171",display:"block"}}>⚠ 마이너스</span>}
                      </div>
                    </div>
                  );
                });
              })()}
        </div>

        {/* 우측: 등록된 예정 항목 관리 */}
        <div style={{width:300,flexShrink:0,borderLeft:"1px solid rgba(255,255,255,.07)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:"14px 18px",borderBottom:"1px solid rgba(255,255,255,.06)",flexShrink:0,
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:".05em"}}>
              등록된 항목 ({plans.length})
            </span>
            <button onClick={()=>setEditPlan("new")} style={{fontSize:11,color:"#a78bfa",cursor:"pointer",
              background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.3)",
              borderRadius:6,padding:"3px 10px",fontWeight:700}}>+ 추가</button>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {plans.length===0
              ? <div style={{padding:"32px 16px",textAlign:"center",color:"#374151",fontSize:11,fontStyle:"italic"}}>
                  예정 항목 없음
                </div>
              : plans.map((p,i)=>{
                  const isIn = p.amount>=0;
                  const repeatMeta = REPEAT_OPTIONS.find(r=>r.v===p.repeat);
                  return (
                    <div key={p.id} style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,.04)",
                      background:selPlan?.id===p.id?"rgba(139,92,246,.07)":"transparent",
                      transition:"background .1s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                            <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,
                              background:isIn?"#34d399":"#f87171"}}/>
                            <span style={{fontSize:12,fontWeight:700,color:"#e5e7eb"}}>{p.name}</span>
                          </div>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            <span style={{fontSize:10,color:"#6b7280"}}>{p.date}</span>
                            <span style={{fontSize:10,padding:"1px 7px",borderRadius:8,fontWeight:600,
                              background:"rgba(139,92,246,.1)",color:"#c4b5fd",
                              border:"1px solid rgba(139,92,246,.2)"}}>
                              {repeatMeta?.l}
                            </span>
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:12,fontWeight:800,color:isIn?"#34d399":"#f87171"}}>
                            {isIn?"+":"-"}{fmtM(Math.abs(p.amount))}원
                          </div>
                          <div style={{display:"flex",gap:4,marginTop:5}}>
                            <button onClick={()=>setEditPlan(p)} style={{padding:"2px 7px",borderRadius:5,fontSize:9,fontWeight:700,cursor:"pointer",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",color:"#9ca3af"}}>✏️</button>
                            <button onClick={()=>{if(window.confirm(`"${p.name}" 삭제?`))onDeletePlan(p.id);}} style={{padding:"2px 7px",borderRadius:5,fontSize:9,fontWeight:700,cursor:"pointer",background:"rgba(248,113,113,.08)",border:"1px solid rgba(248,113,113,.2)",color:"#f87171"}}>🗑</button>
                          </div>
                        </div>
                      </div>
                      {p.note&&<div style={{fontSize:10,color:"#4b5563",marginTop:3}}>{p.note}</div>}
                    </div>
                  );
                })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [accounts, setAccounts] = useState([]);
  const [clients,  setClients]  = useState([]);
  const [projects, setProjects] = useState([]);
  const [plans,    setPlans]    = useState([]);
  const [page, setPage]         = useState("home");
  const [showAdd, setShowAdd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [loadMsg, setLoadMsg]   = useState("");
  const [showChat, setShowChat] = useState(false);
  const fileRef   = useRef();
  const pendingId = useRef(null);

  const allTxs = useMemo(()=>accounts.flatMap(a=>a.txs||[]),[accounts]);
  const selAcc  = page.startsWith("acc:") ? accounts.find(a=>"acc:"+a.id===page) : null;

  const saveClient   = useCallback(c => setClients(p=>{const i=p.findIndex(x=>x.id===c.id);return i>=0?p.map(x=>x.id===c.id?c:x):[...p,c];}), []);
  const deleteClient = useCallback(id => setClients(p=>p.filter(c=>c.id!==id)), []);
  const importClients = useCallback(newClients => {
    setClients(p => {
      const existing = new Set(p.map(c=>c.bizNo||c.name));
      const toAdd = newClients.filter(c=>!existing.has(c.bizNo||c.name));
      const toUpdate = newClients.filter(c=>existing.has(c.bizNo||c.name));
      return [...p.map(c=>{const f=toUpdate.find(u=>(u.bizNo&&u.bizNo===c.bizNo)||u.name===c.name);return f?{...c,...f,id:c.id}:c;}), ...toAdd];
    });
  }, []);

  const saveProject   = useCallback(p => setProjects(pr=>{const i=pr.findIndex(x=>x.id===p.id);return i>=0?pr.map(x=>x.id===p.id?p:x):[...pr,p];}), []);
  const deleteProject = useCallback(id => setProjects(p=>p.filter(x=>x.id!==id)), []);
  const tagTx = useCallback((accId,txId,projectId) => {
    setAccounts(p=>p.map(a=>a.id!==accId?a:{...a,txs:a.txs.map(t=>t.id!==txId?t:{...t,projectId})}));
  }, []);
  const savePlan   = useCallback(p => setPlans(pr=>{const i=pr.findIndex(x=>x.id===p.id);return i>=0?pr.map(x=>x.id===p.id?p:x):[...pr,p];}), []);
  const deletePlan = useCallback(id => setPlans(p=>p.filter(x=>x.id!==id)), []);

  // AI 채팅에서 거래 직접 추가
  const addTxToAccount = useCallback((accId, tx) => {
    setAccounts(p => p.map(a => a.id !== accId ? a : { ...a, txs: [...(a.txs||[]), tx] }));
  }, []);

  const handleUpload = useCallback(async(files, accId)=>{
    for(const file of files){
      setLoading(true); setLoadMsg(`📂 ${file.name} 읽는 중...`);
      try{
        const rows=await parseFile(file);
        setLoadMsg(`🔍 파싱 중...`);
        let txs=normalizeRows(rows);
        if(!txs.length){alert("거래 내역을 찾을 수 없습니다.");setLoading(false);continue;}
        setLoadMsg(`🤖 AI가 ${txs.length}건 계정 분류 중...`);
        txs=await aiClassify(txs);
        setAccounts(p=>p.map(a=>a.id!==accId?a:{...a,txs:[...(a.txs||[]),...txs]}));
      }catch(e){alert("오류: "+e.message);}
      setLoading(false);
    }
  },[]);

  const updateTx = useCallback((accId,txId,field,val)=>{
    setAccounts(p=>p.map(a=>a.id!==accId?a:{...a,txs:a.txs.map(t=>t.id!==txId?t:{...t,[field]:val})}));
  },[]);

  const TICON={checking:"🏦",savings:"💰",foreign:"💱",retirement:"🏖",loan:"📋",card:"💳",personal_card:"💳",corporate:"🏢"};
  const banks=accounts.filter(a=>a.type!=="card"&&a.type!=="personal_card");
  const cards=accounts.filter(a=>a.type==="card"||a.type==="personal_card");

  return <div style={{minHeight:"100vh",background:"#0d1117",
    fontFamily:"'Apple SD Gothic Neo','Malgun Gothic',-apple-system,sans-serif",
    display:"flex",flexDirection:"column",color:"#e5e7eb"}}>

    {/* LOADING */}
    {loading&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.82)",zIndex:300,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14}}>
      <div style={{fontSize:46}}>🐻</div>
      <div style={{fontSize:15,color:"#fff",fontWeight:700}}>{loadMsg}</div>
      <div style={{display:"flex",gap:8}}>
        {[0,1,2].map(i=><div key={i} style={{width:9,height:9,borderRadius:"50%",background:"#8b5cf6",
          animation:`bb 1.2s ${i*.2}s infinite`}}/>)}
      </div>
      <style>{`@keyframes bb{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-9px)}}`}</style>
    </div>}

    {showAdd&&<AddAccModal onAdd={a=>{setAccounts(p=>[...p,a]);setPage("acc:"+a.id);}} onClose={()=>setShowAdd(false)}/>}
    {showChat&&<AIChatOverlay accounts={accounts} clients={clients} onAddTx={addTxToAccount} onClose={()=>setShowChat(false)}/>}

    {/* AI 채팅 플로팅 버튼 */}
    {!showChat&&<button onClick={()=>setShowChat(true)} style={{
      position:"fixed",bottom:28,right:28,zIndex:200,
      width:58,height:58,borderRadius:18,cursor:"pointer",
      background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",
      border:"2px solid rgba(139,92,246,.5)",
      boxShadow:"0 8px 32px rgba(139,92,246,.45), 0 2px 8px rgba(0,0,0,.4)",
      fontSize:26,display:"flex",alignItems:"center",justifyContent:"center",
      transition:"all .2s",
    }}
    onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.1)";e.currentTarget.style.boxShadow="0 12px 40px rgba(139,92,246,.6)";}}
    onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.boxShadow="0 8px 32px rgba(139,92,246,.45)";}}
    title="AI 비서에게 거래 추가 요청">
      🐻
    </button>}

    {/* TOPBAR */}
    <div style={{height:50,display:"flex",alignItems:"center",padding:"0 18px",gap:12,
      background:"#080c14",borderBottom:"1px solid rgba(255,255,255,.07)",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>setPage("home")}>
        <div style={{width:28,height:28,borderRadius:8,background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🐻</div>
        <span style={{fontSize:15,fontWeight:900,color:"#fff",letterSpacing:"-.03em"}}>FitBear</span>
      </div>
      <span style={{fontSize:12,color:"#374151",flex:1}}>AI 경영관리 플랫폼</span>
      {allTxs.length>0&&<div style={{display:"flex",gap:10,fontSize:11}}>
        <span style={{color:"#34d399"}}>↑ {fmtW(allTxs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0))}원</span>
        <span style={{color:"#f87171"}}>↓ {fmtW(allTxs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0))}원</span>
        <span style={{color:"#a78bfa"}}>전체 {allTxs.length}건</span>
      </div>}
      <button onClick={()=>setShowChat(true)} style={{
        padding:"6px 14px",borderRadius:9,cursor:"pointer",fontSize:11,fontWeight:700,
        background:"rgba(139,92,246,.15)",border:"1px solid rgba(139,92,246,.4)",color:"#c4b5fd",
        display:"flex",alignItems:"center",gap:6,
      }}>
        <span>🐻</span><span>AI 비서</span>
      </button>
    </div>

    <div style={{flex:1,display:"flex",minHeight:0}}>
      {/* SIDEBAR */}
      <div style={{width:216,flexShrink:0,background:"#080c14",
        borderRight:"1px solid rgba(255,255,255,.07)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Nav items */}
        {[{id:"home",icon:"🏠",label:"전체 현황"},
          {id:"pl",       icon:"📊",label:"손익계산서", badge:allTxs.length>0?"연동됨":null, badgeColor:"#34d399"},
          {id:"bs",       icon:"📋",label:"재무상태표",  badge:allTxs.length>0?"연동됨":null, badgeColor:"#60a5fa"},
          {id:"clients",  icon:"🏢",label:"거래처 관리", badge:clients.length>0?`${clients.length}개`:null, badgeColor:"#f59e0b"},
          {id:"projects", icon:"🗂",label:"프로젝트",    badge:projects.length>0?`${projects.length}개`:null, badgeColor:"#8b5cf6"},
          {id:"cashflow", icon:"💰",label:"캐시플로우",   badge:plans.length>0?`${plans.length}건`:null, badgeColor:"#34d399"},
        ].map(n=><button key={n.id} onClick={()=>setPage(n.id)} style={{
          width:"100%",display:"flex",alignItems:"center",gap:9,padding:"11px 14px",
          border:"none",cursor:"pointer",textAlign:"left",flexShrink:0,
          borderLeft:`2.5px solid ${page===n.id?"#8b5cf6":"transparent"}`,
          background:page===n.id?"rgba(139,92,246,.13)":"transparent",
          color:page===n.id?"#c4b5fd":"#6b7280",fontSize:12,fontWeight:page===n.id?700:400,transition:"all .12s"}}>
          <span style={{fontSize:15}}>{n.icon}</span>
          <span style={{flex:1}}>{n.label}</span>
          {n.badge&&<span style={{fontSize:9,padding:"1px 7px",borderRadius:10,fontWeight:700,
            background:`${n.badgeColor}22`,color:n.badgeColor,border:`1px solid ${n.badgeColor}44`}}>{n.badge}</span>}
        </button>)}

        <div style={{height:1,background:"rgba(255,255,255,.05)",margin:"4px 0",flexShrink:0}}/>

        {/* Account list */}
        <div style={{flex:1,overflowY:"auto"}}>
          {banks.length>0&&<>
            <div style={{padding:"8px 14px 3px",fontSize:10,color:"#374151",fontWeight:700,
              textTransform:"uppercase",letterSpacing:".08em"}}>은행 계좌</div>
            {banks.map(a=><button key={a.id} onClick={()=>setPage("acc:"+a.id)} style={{
              width:"100%",display:"flex",alignItems:"center",gap:9,padding:"9px 14px",
              border:"none",cursor:"pointer",textAlign:"left",
              borderLeft:`2.5px solid ${page==="acc:"+a.id?a.color:"transparent"}`,
              background:page==="acc:"+a.id?`${a.color}14`:"transparent",transition:"all .12s"}}>
              <div style={{width:27,height:27,borderRadius:7,flexShrink:0,
                background:`${a.color}22`,border:`1px solid ${a.color}40`,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>{TICON[a.type]||"🏦"}</div>
              <div style={{flex:1,overflow:"hidden"}}>
                <div style={{fontSize:12,fontWeight:600,color:page==="acc:"+a.id?"#e5e7eb":"#9ca3af",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</div>
                <div style={{fontSize:10,color:page==="acc:"+a.id?a.color:"#4b5563",marginTop:1,fontWeight:600}}>
                  {(a.txs||[]).length}건</div>
              </div>
              {(a.txs||[]).some(t=>t.category==="미확인")&&
                <span style={{width:6,height:6,borderRadius:"50%",background:"#fb923c",flexShrink:0}}/>}
            </button>)}
          </>}
          {cards.length>0&&<>
            <div style={{padding:"8px 14px 3px",fontSize:10,color:"#374151",fontWeight:700,
              textTransform:"uppercase",letterSpacing:".08em",marginTop:4}}>카드</div>
            {cards.map(a=><button key={a.id} onClick={()=>setPage("acc:"+a.id)} style={{
              width:"100%",display:"flex",alignItems:"center",gap:9,padding:"9px 14px",
              border:"none",cursor:"pointer",textAlign:"left",
              borderLeft:`2.5px solid ${page==="acc:"+a.id?a.color:"transparent"}`,
              background:page==="acc:"+a.id?`${a.color}14`:"transparent",transition:"all .12s"}}>
              <div style={{width:27,height:27,borderRadius:7,flexShrink:0,
                background:`${a.color}22`,border:`1px solid ${a.color}40`,
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>💳</div>
              <div style={{flex:1,overflow:"hidden"}}>
                <div style={{fontSize:12,fontWeight:600,color:page==="acc:"+a.id?"#e5e7eb":"#9ca3af",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</div>
                <div style={{fontSize:10,color:page==="acc:"+a.id?a.color:"#4b5563",marginTop:1,fontWeight:600}}>
                  {(a.txs||[]).length}건</div>
              </div>
              {(a.txs||[]).some(t=>t.category==="미확인")&&
                <span style={{width:6,height:6,borderRadius:"50%",background:"#fb923c",flexShrink:0}}/>}
            </button>)}
          </>}
          {accounts.length===0&&<div style={{padding:"20px 14px",fontSize:11,color:"#374151",
            textAlign:"center",fontStyle:"italic"}}>등록된 계좌 없음</div>}
        </div>

        {/* Add button */}
        <div style={{padding:"12px",borderTop:"1px solid rgba(255,255,255,.07)",flexShrink:0}}>
          <button onClick={()=>setShowAdd(true)} style={{width:"100%",padding:"9px 0",borderRadius:10,cursor:"pointer",
            background:"rgba(139,92,246,.1)",border:"1px dashed rgba(139,92,246,.4)",
            color:"#a78bfa",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
            <span style={{fontSize:15}}>+</span> 계좌 · 카드 추가
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
        {/* Breadcrumb */}
        {selAcc&&<div style={{padding:"8px 18px",borderBottom:"1px solid rgba(255,255,255,.06)",
          display:"flex",alignItems:"center",gap:7,background:"rgba(255,255,255,.01)",flexShrink:0}}>
          <button onClick={()=>setPage("home")} style={{fontSize:12,color:"#6b7280",cursor:"pointer",background:"none",border:"none",padding:0}}>전체 현황</button>
          <span style={{color:"#374151"}}>›</span>
          <span style={{fontSize:12,color:"#e5e7eb",fontWeight:600}}>{selAcc.name}</span>
          <span style={{fontSize:10,color:"#4b5563"}}>{(selAcc.txs||[]).length}건</span>
          <div style={{marginLeft:"auto",fontSize:11,color:"#34d399",fontWeight:600,
            padding:"3px 10px",borderRadius:20,background:"rgba(52,211,153,.08)",border:"1px solid rgba(52,211,153,.2)"}}>
            ✓ 손익계산서·재무상태표 자동 반영
          </div>
        </div>}

        {/* Content */}
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {page==="home"&&<HomeOverview accounts={accounts} allTxs={allTxs} onSelect={a=>setPage("acc:"+a.id)} onAdd={()=>setShowAdd(true)}/>}
          {page==="pl"&&<PLPage allTxs={allTxs}/>}
          {page==="bs"&&<BSPage allTxs={allTxs} accounts={accounts}/>}
          {page==="clients"&&<ClientsPage clients={clients} allTxs={allTxs}
            onSave={saveClient} onDelete={deleteClient} onUpload={importClients}/>}
          {page==="projects"&&<ProjectsPage projects={projects} allTxs={allTxs}
            onSave={saveProject} onDelete={deleteProject} onTagTx={tagTx}/>}
          {page==="cashflow"&&<CashflowPage accounts={accounts} allTxs={allTxs}
            plans={plans} onSavePlan={savePlan} onDeletePlan={deletePlan}/>}
          {selAcc&&<AccountPage acc={selAcc} onUpdate={updateTx} onUpload={()=>{pendingId.current=selAcc.id;fileRef.current.click();}} projects={projects} onTagTx={tagTx}/>}
        </div>
      </div>
    </div>

    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" multiple style={{display:"none"}}
      onChange={e=>{if(pendingId.current&&e.target.files.length)handleUpload(Array.from(e.target.files),pendingId.current);e.target.value="";}}/>
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI 비서 채팅 — 자연어 → 거래 자동 추가
// ─────────────────────────────────────────────────────────────────────────────

// Claude에게 보낼 시스템 프롬프트
function buildSystemPrompt(accounts, clients=[]) {
  const accList = accounts.map(a =>
    `- ${a.name} (id: "${a.id}", 계좌번호: "${a.accNo||""}", 유형: ${a.type==="card"||a.type==="personal_card"?"카드":"계좌"})`
  ).join("\n");

  const clientList = clients.slice(0,30).map(c =>
    `- ${c.name} (사업자번호: ${c.bizNo||"없음"}, 유형: ${c.type==="customer"?"매출처":c.type==="vendor"?"매입처":"양방향"})`
  ).join("\n");

  return `당신은 FitBear 회계 AI 비서입니다.
사용자의 자연어 메시지에서 거래 정보를 파악하여 JSON으로 반환합니다.

## 등록된 계좌/카드 목록
${accList || "등록된 계좌 없음"}

## 등록된 거래처 목록
${clientList || "등록된 거래처 없음"}

## 계정과목 목록
매출, 매출원가, 급여, 임차료, 식대, 소모품비, 광고선전비, 접대비, 차량유지비, 복리후생비, 통신비, 교육훈련비, 수수료, 세금과공과, 보험료, 여비교통비, 잡비, 미확인

## 계좌 매칭 규칙
- 계좌번호 뒷자리(예: "8023", "35504") → accNo에 포함된 계좌 매칭
- "신한카드", "국민카드" 등 카드사명 → name에 포함된 계좌 매칭
- 모호하면 type으로 추정 (카드결제→card류, 이체/계좌→checking/corporate류)

## 거래처 매칭
- 거래처명이 언급되면 등록된 거래처 목록에서 찾아 desc에 포함
- 매출처 거래 → amount 양수 고려, 매입처 거래 → amount 음수 고려

## 응답 형식
거래 정보가 명확하면 반드시 아래 JSON만 반환 (다른 텍스트 없이):
{
  "action": "add_transaction",
  "accId": "계좌id",
  "accName": "계좌명",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "desc": "거래 설명 (거래처명 포함)",
      "amount": 숫자(수입=양수, 지출=음수),
      "category": "계정과목",
      "memo": "추가메모"
    }
  ],
  "message": "사용자에게 보여줄 확인 메시지"
}

거래 정보가 불명확하거나 계좌를 특정할 수 없으면:
{"action":"ask","message":"질문"}

일반 질문이면:
{"action":"reply","message":"답변"}

## 날짜·금액 처리
- "오늘"/"방금"/"지금" → ${new Date().toISOString().slice(0,10)}
- "어제" → 어제 날짜
- 날짜 미언급 → 오늘
- "5만원"→-50000, "입금됐어"→양수, "결제/이체/냈어"→음수`;
}

async function callAI(userMsg, accounts, clients=[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: buildSystemPrompt(accounts, clients),
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  const data = await res.json();
  const text = (data.content?.[0]?.text || "").trim();
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { action: "reply", message: text || "죄송해요, 다시 말씀해 주세요." };
  }
}

// 채팅 오버레이 컴포넌트
function AIChatOverlay({ accounts, clients=[], onAddTx, onClose }) {
  const [msgs,    setMsgs]    = useState([
    { role:"ai", text:"안녕하세요! 🐻 거래 내역을 말씀해 주시면 바로 추가해 드릴게요.\n\n예시:\n• \"8023 카드로 스타벅스 4500원 결제했어\"\n• \"35504 계좌에서 임차료 150만 이체했어\"\n• \"오늘 국민카드로 점심 13000원 썼어\"" }
  ]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(null); // 확인 대기 중인 트랜잭션
  const bottomRef = useRef();
  const inputRef  = useRef();

  const scrollBottom = () => setTimeout(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}), 50);

  const addMsg = (role, text, extra={}) => {
    setMsgs(p => [...p, { role, text, ...extra }]);
    scrollBottom();
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput("");
    addMsg("user", msg);
    setLoading(true);

    try {
      const result = await callAI(msg, accounts, clients);

      if (result.action === "add_transaction") {
        // 확인 UI 표시
        setPending(result);
        addMsg("ai", result.message, { pending: true, pendingData: result });
      } else {
        addMsg("ai", result.message || "처리했습니다.");
      }
    } catch (e) {
      addMsg("ai", "⚠ 오류가 발생했어요. 다시 시도해 주세요.");
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const confirmTx = (result) => {
    result.transactions.forEach(tx => {
      const newTx = {
        id: "chat_" + Date.now() + "_" + Math.random().toString(36).slice(2),
        date: tx.date,
        desc: tx.desc,
        amount: tx.amount,
        category: tx.category,
        memo: tx.memo || "",
        type: tx.amount >= 0 ? "income" : "expense",
        source: "chat",
        evidence: null,
      };
      onAddTx(result.accId, newTx);
    });
    setPending(null);
    // 확인 메시지로 업데이트
    setMsgs(p => p.map(m =>
      m.pending && m.pendingData?.accId === result.accId
        ? { ...m, confirmed: true, pending: false }
        : m
    ));
    addMsg("ai", `✅ ${result.accName}에 ${result.transactions.length}건 추가 완료! 손익계산서에 자동 반영됐어요.`);
  };

  const rejectTx = (result) => {
    setPending(null);
    setMsgs(p => p.map(m =>
      m.pending && m.pendingData?.accId === result.accId
        ? { ...m, rejected: true, pending: false }
        : m
    ));
    addMsg("ai", "취소했습니다. 다시 말씀해 주세요.");
  };

  const today = new Date().toISOString().slice(0,10);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 400,
      display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
      padding: "0 24px 24px", pointerEvents: "none",
    }}>
      {/* 배경 클릭으로 닫기 */}
      <div onClick={onClose} style={{
        position:"absolute", inset:0, background:"rgba(0,0,0,.4)",
        pointerEvents:"all", cursor:"pointer",
      }}/>

      {/* 채팅 패널 */}
      <div style={{
        position:"relative", pointerEvents:"all",
        width: 420, height: "72vh", maxHeight: 640,
        background: "#111827",
        border: "1px solid rgba(139,92,246,.4)",
        borderRadius: 20,
        boxShadow: "0 32px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(139,92,246,.15)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* 헤더 */}
        <div style={{
          padding: "14px 18px", flexShrink: 0,
          background: "linear-gradient(135deg,rgba(139,92,246,.15),rgba(109,40,217,.08))",
          borderBottom: "1px solid rgba(139,92,246,.2)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "linear-gradient(135deg,#8b5cf6,#6d28d9)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🐻</div>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>FitBear AI 비서</div>
            <div style={{fontSize:10,color:"#a78bfa",marginTop:1}}>
              {accounts.length}개 계좌 연결됨 · 자연어로 거래 추가
            </div>
          </div>
          <button onClick={onClose} style={{
            background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",
            borderRadius:8,color:"#9ca3af",fontSize:16,width:30,height:30,
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
          }}>✕</button>
        </div>

        {/* 메시지 영역 */}
        <div style={{flex:1, overflowY:"auto", padding:"16px 14px", display:"flex", flexDirection:"column", gap:10}}>
          {msgs.map((m, i) => (
            <div key={i}>
              {/* 메시지 버블 */}
              <div style={{
                display: "flex",
                justifyContent: m.role==="user" ? "flex-end" : "flex-start",
                gap: 8, alignItems: "flex-end",
              }}>
                {m.role==="ai" && (
                  <div style={{width:26,height:26,borderRadius:8,flexShrink:0,
                    background:"linear-gradient(135deg,#7c3aed,#5b21b6)",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🐻</div>
                )}
                <div style={{
                  maxWidth: "82%",
                  padding: "10px 14px",
                  borderRadius: m.role==="user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background: m.role==="user"
                    ? "linear-gradient(135deg,#7c3aed,#5b21b6)"
                    : m.confirmed ? "rgba(52,211,153,.1)"
                    : m.rejected  ? "rgba(255,255,255,.04)"
                    : "rgba(255,255,255,.06)",
                  border: m.role!=="user"
                    ? `1px solid ${m.confirmed?"rgba(52,211,153,.3)":m.rejected?"rgba(255,255,255,.08)":"rgba(255,255,255,.08)"}`
                    : "none",
                  fontSize: 13, color: "#e5e7eb", lineHeight: 1.55,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {m.text}
                </div>
              </div>

              {/* 거래 확인 카드 */}
              {m.pending && m.pendingData && (
                <div style={{
                  marginTop: 10, marginLeft: 34,
                  padding: "14px 16px", borderRadius: 14,
                  background: "rgba(245,158,11,.07)",
                  border: "1.5px solid rgba(245,158,11,.35)",
                }}>
                  <div style={{fontSize:11,fontWeight:700,color:"#f59e0b",marginBottom:10}}>
                    📋 아래 내역을 추가할까요?
                  </div>
                  {m.pendingData.transactions.map((tx, ti) => {
                    const acc = accounts.find(a=>a.id===m.pendingData.accId);
                    return (
                      <div key={ti} style={{
                        padding:"10px 12px", borderRadius:10, marginBottom:6,
                        background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",
                      }}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                          <div style={{display:"flex",alignItems:"center",gap:7}}>
                            <div style={{width:8,height:8,borderRadius:"50%",background:acc?.color||"#8b5cf6"}}/>
                            <span style={{fontSize:12,fontWeight:700,color:"#e5e7eb"}}>{tx.desc}</span>
                          </div>
                          <span style={{fontSize:13,fontWeight:800,
                            color:tx.amount>=0?"#34d399":"#f87171"}}>
                            {tx.amount>=0?"+":""}{Math.abs(tx.amount).toLocaleString()}원
                          </span>
                        </div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,
                            background:`${acc?.color||"#8b5cf6"}20`,color:acc?.color||"#a78bfa",
                            border:`1px solid ${acc?.color||"#8b5cf6"}35`,fontWeight:600}}>
                            {m.pendingData.accName}
                          </span>
                          <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,
                            background:"rgba(139,92,246,.15)",color:"#c4b5fd",
                            border:"1px solid rgba(139,92,246,.3)",fontWeight:600}}>
                            {tx.category}
                          </span>
                          <span style={{fontSize:10,color:"#6b7280"}}>{tx.date}</span>
                        </div>
                        {tx.memo&&<div style={{fontSize:10,color:"#6b7280",marginTop:4}}>{tx.memo}</div>}
                      </div>
                    );
                  })}
                  <div style={{display:"flex",gap:8,marginTop:10}}>
                    <button onClick={()=>rejectTx(m.pendingData)} style={{
                      flex:1,padding:"8px 0",borderRadius:9,cursor:"pointer",fontSize:12,fontWeight:700,
                      background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",color:"#9ca3af",
                    }}>✕ 취소</button>
                    <button onClick={()=>confirmTx(m.pendingData)} style={{
                      flex:2,padding:"8px 0",borderRadius:9,cursor:"pointer",fontSize:12,fontWeight:700,
                      background:"linear-gradient(135deg,#34d399,#059669)",border:"none",color:"#fff",
                    }}>✓ 추가하기</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{display:"flex",alignItems:"center",gap:8,paddingLeft:34}}>
              <div style={{padding:"10px 14px",borderRadius:"16px 16px 16px 4px",
                background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.08)",
                display:"flex",gap:4}}>
                {[0,1,2].map(i=><div key={i} style={{
                  width:7,height:7,borderRadius:"50%",background:"#8b5cf6",
                  animation:`pulse 1.2s ${i*.2}s infinite ease-in-out`,
                }}/>)}
              </div>
              <style>{`@keyframes pulse{0%,60%,100%{transform:scale(1);opacity:.5}30%{transform:scale(1.3);opacity:1}}`}</style>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* 빠른 예시 버튼 */}
        {msgs.length <= 1 && accounts.length > 0 && (
          <div style={{padding:"0 14px 8px",display:"flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
            {[
              accounts[0] && `${accounts[0].accNo?.slice(-4)||accounts[0].name.slice(0,4)} 카드로 점심 12000원 결제했어`,
              accounts[0] && `오늘 ${accounts[0].name}에서 임차료 150만 이체했어`,
              "어제 스타벅스 4500원 썼어",
            ].filter(Boolean).slice(0,3).map((ex,i)=>(
              <button key={i} onClick={()=>{setInput(ex);inputRef.current?.focus();}} style={{
                padding:"5px 10px",borderRadius:20,fontSize:10,fontWeight:600,cursor:"pointer",
                background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.25)",color:"#c4b5fd",
                whiteSpace:"nowrap",maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",
              }}>
                {ex.length>30?ex.slice(0,30)+"...":ex}
              </button>
            ))}
          </div>
        )}

        {/* 입력창 */}
        <div style={{
          padding:"12px 14px",
          borderTop:"1px solid rgba(255,255,255,.07)",
          background:"rgba(0,0,0,.2)",
          flexShrink:0,
        }}>
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend();}}}
              placeholder="거래 내역을 자연어로 입력해 주세요... (Enter 전송)"
              rows={2}
              disabled={loading}
              style={{
                flex:1, background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(139,92,246,.3)",
                borderRadius:12, padding:"10px 14px",
                color:"#fff", fontSize:13, outline:"none",
                resize:"none", fontFamily:"inherit", lineHeight:1.5,
                opacity:loading?.6:1,
              }}
            />
            <button onClick={handleSend} disabled={loading||!input.trim()} style={{
              width:42,height:42,borderRadius:12,cursor:loading||!input.trim()?"not-allowed":"pointer",
              background:loading||!input.trim()?"rgba(255,255,255,.06)":"linear-gradient(135deg,#8b5cf6,#6d28d9)",
              border:"none",color:"#fff",fontSize:18,
              display:"flex",alignItems:"center",justifyContent:"center",
              opacity:loading||!input.trim()?.5:1,transition:"all .15s",flexShrink:0,
            }}>
              {loading ? "⏳" : "➤"}
            </button>
          </div>
          <div style={{fontSize:10,color:"#374151",marginTop:6,textAlign:"center"}}>
            Shift+Enter 줄바꿈 · Enter 전송
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
function HomeOverview({accounts,allTxs,onSelect,onAdd}){
  const pl=useMemo(()=>calcPL(allTxs),[allTxs]);
  const isEmpty=accounts.length===0;
  return <div style={{padding:"28px 32px",overflowY:"auto",flex:1}}>
    <div style={{marginBottom:24}}>
      <h2 style={{fontSize:22,fontWeight:900,color:"#fff",margin:"0 0 5px",letterSpacing:"-.03em"}}>전체 현황</h2>
      <p style={{color:"#6b7280",margin:0,fontSize:13}}>계좌 내역이 손익계산서와 재무상태표에 자동으로 반영됩니다</p>
    </div>

    {/* Financial summary */}
    {allTxs.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
      {[{l:"매출액",v:pl.revenue,c:"#34d399",icon:"📈"},
        {l:"매출총이익",v:pl.grossProfit,c:pl.grossProfit>=0?"#60a5fa":"#f87171",icon:"💹",sub:`마진 ${pct(pl.grossMargin)}`},
        {l:"영업이익",v:pl.operatingProfit,c:pl.operatingProfit>=0?"#a78bfa":"#f87171",icon:"📊",sub:`이익률 ${pct(pl.opMargin)}`},
        {l:"총 거래건수",v:null,tag:`${allTxs.length}건`,c:"#9ca3af",icon:"📋"},
      ].map(k=><div key={k.l} style={{padding:"15px 18px",borderRadius:12,
        background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)"}}>
        <div style={{fontSize:10,color:"#6b7280",marginBottom:5,textTransform:"uppercase",letterSpacing:".04em"}}>{k.icon} {k.l}</div>
        {k.tag?<div style={{fontSize:20,fontWeight:900,color:k.c}}>{k.tag}</div>:
          <div style={{fontSize:20,fontWeight:900,color:k.c,letterSpacing:"-.02em"}}>
            {k.v>=0?"+":""}{fmtW(Math.abs(k.v))}원
          </div>}
        {k.sub&&<div style={{fontSize:10,color:k.c,marginTop:2,opacity:.8}}>{k.sub}</div>}
      </div>)}
    </div>}

    {isEmpty
      ? <div style={{padding:"80px 0",textAlign:"center"}}>
          <div style={{fontSize:52,marginBottom:16}}>🏦</div>
          <div style={{fontSize:16,fontWeight:700,color:"#6b7280",marginBottom:8}}>계좌를 등록해주세요</div>
          <div style={{fontSize:13,color:"#374151",marginBottom:24}}>계좌 등록 → 거래 내역 업로드 → 재무제표 자동 생성</div>
          <button onClick={onAdd} style={{padding:"12px 28px",borderRadius:12,cursor:"pointer",
            background:"linear-gradient(135deg,#8b5cf6,#6d28d9)",border:"none",color:"#fff",fontWeight:700,fontSize:14}}>
            + 첫 계좌 등록하기
          </button>
        </div>
      : <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
          {accounts.map(a=>{
            const txs=a.txs||[];
            const aIn=txs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
            const aOut=txs.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
            const TICON={checking:"🏦",savings:"💰",foreign:"💱",retirement:"🏖",loan:"📋",card:"💳",personal_card:"💳",corporate:"🏢"};
            return <button key={a.id} onClick={()=>onSelect(a)}
              style={{padding:"18px",borderRadius:14,cursor:"pointer",textAlign:"left",
                background:`${a.color}0e`,border:`1px solid ${a.color}28`,transition:"all .16s"}}
              onMouseEnter={e=>{e.currentTarget.style.background=`${a.color}18`;e.currentTarget.style.borderColor=`${a.color}55`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=`${a.color}0e`;e.currentTarget.style.borderColor=`${a.color}28`;}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <div>
                  <div style={{fontSize:10,color:a.color,fontWeight:700,marginBottom:3}}>{a.bank||"계좌"}</div>
                  <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{a.name}</div>
                </div>
                <span style={{fontSize:20}}>{TICON[a.type]||"🏦"}</span>
              </div>
              {txs.length>0
                ? <div style={{display:"flex",gap:12,paddingTop:10,borderTop:`1px solid ${a.color}20`}}>
                    <div><div style={{fontSize:9,color:"#4b5563",marginBottom:1}}>거래</div>
                      <div style={{fontSize:12,fontWeight:700,color:"#9ca3af"}}>{txs.length}건</div></div>
                    <div><div style={{fontSize:9,color:"#4b5563",marginBottom:1}}>수입</div>
                      <div style={{fontSize:12,fontWeight:700,color:"#34d399"}}>{fmtW(aIn)}원</div></div>
                    <div><div style={{fontSize:9,color:"#4b5563",marginBottom:1}}>지출</div>
                      <div style={{fontSize:12,fontWeight:700,color:"#f87171"}}>{fmtW(aOut)}원</div></div>
                  </div>
                : <div style={{paddingTop:10,borderTop:`1px solid ${a.color}20`,fontSize:11,color:"#374151",fontStyle:"italic"}}>
                    내역 업로드 대기
                  </div>}
            </button>;
          })}
        </div>}
  </div>;
}
