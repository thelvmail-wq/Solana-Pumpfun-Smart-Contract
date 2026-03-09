import { Buffer } from 'buffer';
window.Buffer = Buffer;
import { useState, useEffect, useRef } from "react";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("9cuFeeHRpr3yfjzeHLm84z95JPGaRgASwV4YY7PaMtkx");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const DISC = {
  create_token_registry: Buffer.from("ec4062c2843c7324", "hex"),
  claim_locks: Buffer.from("50ac2a7b3fc26165", "hex"),
};

async function sha256(data) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Buffer.from(await crypto.subtle.digest("SHA-256", buf));
}
async function hashTicker(t) { return sha256(t.trim().toUpperCase()); }
function deriveTickerLock(h) { return PublicKey.findProgramAddressSync([Buffer.from("ticker_lock"), h], PROGRAM_ID)[0]; }
async function checkTickerAvailable(ticker) {
  const h = await hashTicker(ticker);
  return !(await connection.getAccountInfo(deriveTickerLock(h)));
}

const TOKENS = [
  { id:1, name:"MOONROCK",    ticker:"ROCK",  mc:142000, price:0.000142,  vol:28400,  change:42.1,  holders:312,  progress:16, emoji:"🪨", prot:true  },
  { id:2, name:"SUMMIT INU",  ticker:"SINU",  mc:88500,  price:0.0000885, vol:11200,  change:-8.4,  holders:189,  progress:10, emoji:"🐕", prot:false },
  { id:3, name:"PEPE MOON",   ticker:"PMOON", mc:310000, price:0.00031,   vol:88000,  change:77.8,  holders:1040, progress:35, emoji:"🐸", prot:true  },
  { id:4, name:"ALTCOIN",     ticker:"ALT",   mc:210000, price:0.00021,   vol:54000,  change:15.3,  holders:721,  progress:24, emoji:"⛰️", prot:true  },
  { id:5, name:"ROCKETDOG",   ticker:"RDOG",  mc:55000,  price:0.000055,  vol:6200,   change:-21.2, holders:98,   progress:6,  emoji:"🚀", prot:false },
  { id:6, name:"DIAMOND PAW", ticker:"DPAW",  mc:490000, price:0.00049,   vol:120000, change:5.1,   holders:2100, progress:55, emoji:"💎", prot:true  },
];
function fmt(n) { return n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(1)}K`:`$${n}`; }

const S = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow:wght@400;700;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080b10;--s1:#0d1219;--s2:#131a24;--s3:#1a2330;--b:#1e2a38;--b2:#243040;--t:#e2eaf4;--d:#5a7090;--d2:#3a5070;--g:#1de9b6;--r:#ff4d6d;--y:#ffd166;--bl:#4cc9f0;--mono:'Space Mono',monospace;--sans:'Barlow',sans-serif}
html,body,#root{height:100%}
body{background:var(--bg);color:var(--t);font-family:var(--mono);font-size:13px;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:var(--b2)}
button{cursor:pointer;font-family:var(--mono)}input,textarea{font-family:var(--mono)}
.nav{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--b);background:rgba(8,11,16,.95);backdrop-filter:blur(12px);position:sticky;top:0;z-index:100}
.logo{font-family:var(--sans);font-size:15px;font-weight:900;letter-spacing:.08em;cursor:pointer;display:flex;align-items:center;gap:8px}
.dot{width:8px;height:8px;background:var(--g);border-radius:50%;box-shadow:0 0 8px var(--g)}
.tabs{display:flex}
.tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--d);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:0 16px;height:52px;transition:all .15s}
.tab:hover{color:var(--t)}.tab.on{color:var(--g);border-bottom-color:var(--g)}
.nr{display:flex;align-items:center;gap:10px}
.devnet{font-size:10px;color:var(--y);background:rgba(255,209,102,.08);border:1px solid rgba(255,209,102,.2);padding:3px 8px;border-radius:3px}
.wbtn{font-size:11px;font-weight:700;padding:7px 16px;border-radius:4px;border:1px solid var(--b2);background:none;color:var(--t);transition:all .15s}
.wbtn:hover{border-color:var(--g);color:var(--g)}.wbtn.on{border-color:rgba(29,233,182,.3);color:var(--g);background:rgba(29,233,182,.06)}
.tape{height:32px;border-bottom:1px solid var(--b);overflow:hidden;background:var(--s1);display:flex;align-items:center}
.track{display:flex;animation:scroll 35s linear infinite;white-space:nowrap}
@keyframes scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.ti{display:flex;align-items:center;gap:6px;padding:0 18px;border-right:1px solid var(--b);height:32px;flex-shrink:0;font-size:10px}
.up{color:var(--g)}.dn{color:var(--r)}
.page{padding:20px 24px}
.ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.pt{font-family:var(--sans);font-size:11px;font-weight:700;color:var(--d);letter-spacing:.1em;text-transform:uppercase}
.fltrs{display:flex;gap:4px}
.fb{background:none;border:1px solid transparent;color:var(--d);font-size:11px;font-weight:700;padding:4px 12px;border-radius:3px;transition:all .12s}
.fb:hover{color:var(--t)}.fb.on{color:var(--t);border-color:var(--b2);background:var(--s2)}
table{width:100%;border-collapse:collapse}
th{font-size:10px;font-weight:700;color:var(--d2);text-align:left;padding:8px 12px;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid var(--b)}
th.r,td.r{text-align:right}
td{padding:12px;border-bottom:1px solid var(--b);vertical-align:middle}
tr.row{cursor:pointer;transition:background .1s}tr.row:hover{background:var(--s1)}
.tc{display:flex;align-items:center;gap:10px}
.ico{width:36px;height:36px;background:var(--s2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.tn{font-family:var(--sans);font-size:14px;font-weight:700}
.tk{font-size:10px;color:var(--d);margin-top:1px}
.sh{display:inline-flex;font-size:9px;font-weight:700;color:var(--g);background:rgba(29,233,182,.08);border:1px solid rgba(29,233,182,.2);padding:1px 5px;border-radius:2px;margin-left:6px;vertical-align:middle}
.v{font-size:13px;font-weight:700}.v.d{color:var(--d);font-weight:400}
.pb{width:60px;height:3px;background:var(--b2);border-radius:2px;overflow:hidden}
.pf{height:100%;background:var(--g);border-radius:2px;opacity:.6}
.dg{display:grid;grid-template-columns:1fr 340px;gap:20px;max-width:1100px}
.card{background:var(--s1);border:1px solid var(--b);border-radius:8px;padding:20px}
.ct{font-size:10px;font-weight:700;color:var(--d);letter-spacing:.1em;text-transform:uppercase;margin-bottom:16px}
.f{margin-bottom:14px}
.fl{font-size:10px;font-weight:700;color:var(--d);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}
.inp{width:100%;background:var(--s2);border:1px solid var(--b2);border-radius:5px;padding:9px 12px;color:var(--t);font-size:13px;outline:none;transition:border-color .15s}
.inp:focus{border-color:var(--d)}.inp.ok{border-color:rgba(29,233,182,.4)}.inp.er{border-color:rgba(255,77,109,.4)}
.ts{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;margin-top:6px;height:18px}
.ts.free{color:var(--g)}.ts.taken{color:var(--r)}.ts.checking{color:var(--d)}
.iu{width:100%;height:120px;background:var(--s2);border:1px dashed var(--b2);border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden}
.iu:hover{border-color:var(--d)}.iup{width:100%;height:100%;object-fit:cover}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cr{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--b);font-size:12px}
.cl{color:var(--d)}.cv{font-weight:700}
.ctot{display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid var(--b2)}
.ctotl{font-size:11px;font-weight:700;color:var(--d);text-transform:uppercase}
.ctotv{font-family:var(--sans);font-size:20px;font-weight:900}
.dbtn{width:100%;padding:14px;border-radius:6px;border:none;font-family:var(--sans);font-size:15px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;background:var(--g);color:#080b10;transition:all .15s;margin-top:16px}
.dbtn:hover:not(:disabled){opacity:.85;transform:translateY(-1px)}.dbtn:disabled{opacity:.35;cursor:not-allowed}
.vs{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:5px;font-size:11px;font-weight:700;margin-bottom:14px}
.vs.free{background:rgba(29,233,182,.06);border:1px solid rgba(29,233,182,.2);color:var(--g)}
.vs.taken{background:rgba(255,77,109,.06);border:1px solid rgba(255,77,109,.2);color:var(--r)}
.vs.idle{background:var(--s2);border:1px solid var(--b2);color:var(--d)}
.tg{display:grid;grid-template-columns:1fr 320px;height:calc(100vh - 85px)}
.cp{border-right:1px solid var(--b);display:flex;flex-direction:column}
.ch{padding:16px 20px;border-bottom:1px solid var(--b);display:flex;align-items:center;justify-content:space-between}
.ctk{display:flex;align-items:center;gap:12px}
.ctn{font-family:var(--sans);font-size:16px;font-weight:900}
.ctt{font-size:11px;color:var(--d);margin-top:2px}
.cmc{text-align:right}.cmcv{font-family:var(--sans);font-size:16px;font-weight:700}
.cmcs{font-size:10px;color:var(--d);margin-top:2px}
.ca{flex:1;padding:20px;display:flex;align-items:center;justify-content:center}
.cf{padding:12px 20px;border-top:1px solid var(--b)}
.gr{display:flex;justify-content:space-between;margin-bottom:6px}
.gl{font-size:10px;color:var(--d);font-weight:700;text-transform:uppercase}
.gv{font-size:10px;font-weight:700}
.gb{height:4px;background:var(--b2);border-radius:2px;overflow:hidden}
.gf{height:100%;background:linear-gradient(90deg,var(--g),var(--bl));border-radius:2px}
.sp{display:flex;flex-direction:column}
.stabs{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--b)}
.stab{background:none;border:none;border-bottom:2px solid transparent;color:var(--d);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:14px;transition:all .12s}
.stab.on.buy{color:var(--g);border-bottom-color:var(--g);background:rgba(29,233,182,.03)}
.stab.on.sell{color:var(--r);border-bottom-color:var(--r);background:rgba(255,77,109,.03)}
.sf{padding:16px;flex:1;display:flex;flex-direction:column;gap:10px}
.ab{background:var(--s2);border:1px solid var(--b2);border-radius:6px;padding:12px}
.ab:focus-within{border-color:var(--d)}
.at{display:flex;justify-content:space-between;margin-bottom:8px}
.al{font-size:10px;color:var(--d);font-weight:700;text-transform:uppercase}
.abal{font-size:10px;color:var(--d)}
.ar{display:flex;align-items:center;gap:8px}
.ai{flex:1;background:none;border:none;color:var(--t);font-family:var(--sans);font-size:22px;font-weight:700;outline:none;min-width:0}
.atok{font-size:11px;font-weight:700;color:var(--d);background:var(--s3);border:1px solid var(--b2);padding:4px 10px;border-radius:3px;white-space:nowrap}
.qb{display:flex;gap:4px}
.qbtn{flex:1;background:var(--s2);border:1px solid var(--b2);color:var(--d);font-size:11px;font-weight:700;padding:5px;border-radius:3px;transition:all .1s}
.qbtn:hover{color:var(--t);border-color:var(--d)}
.fb2{background:var(--s2);border-radius:5px;padding:10px 12px}
.fr{display:flex;justify-content:space-between;font-size:11px;padding:2px 0}
.frl{color:var(--d)}.frv{font-weight:700}
.sbtn{width:100%;padding:13px;border-radius:6px;border:none;font-family:var(--sans);font-size:14px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;transition:all .15s;margin-top:auto}
.sbtn.buy{background:var(--g);color:#080b10}.sbtn.sell{background:var(--r);color:#fff}
.sbtn:hover:not(:disabled){opacity:.85;transform:translateY(-1px)}.sbtn:disabled{opacity:.3;cursor:not-allowed}
.toast{position:fixed;bottom:24px;right:24px;background:var(--s2);border:1px solid var(--b2);border-radius:6px;padding:12px 16px;font-size:12px;max-width:360px;z-index:999;animation:su .2s ease}
@keyframes su{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}
.toast.ok{border-color:rgba(29,233,182,.3);color:var(--g)}.toast.er{border-color:rgba(255,77,109,.3);color:var(--r)}
`;

function Toast({msg,type,onClose}){useEffect(()=>{const t=setTimeout(onClose,4000);return()=>clearTimeout(t)},[msg]);if(!msg)return null;return<div className={`toast ${type}`} onClick={onClose}>{msg}</div>}

function Tape(){const items=[...TOKENS,...TOKENS];return<div className="tape"><div className="track">{items.map((t,i)=><div className="ti" key={i}><b>{t.ticker}</b><span style={{color:"var(--d)"}}>{fmt(t.mc)}</span><span className={t.change>0?"up":"dn"}>{t.change>0?"+":""}{t.change}%</span></div>)}</div></div>}

function TokensPage({onTrade}){
  const[f,setF]=useState("all");
  const list=TOKENS.filter(t=>f==="all"?true:f==="prot"?t.prot:t.mc<100000);
  return<div className="page"><div className="ph"><div className="pt">Live Tokens — Devnet</div><div className="fltrs">{[["all","All"],["prot","🛡 Protected"],["new","New"]].map(([v,l])=><button key={v} className={`fb ${f===v?"on":""}`} onClick={()=>setF(v)}>{l}</button>)}</div></div>
  <table><thead><tr><th>Token</th><th className="r">Market Cap</th><th className="r">24h Vol</th><th className="r">Change</th><th className="r">Curve</th><th className="r">Holders</th></tr></thead>
  <tbody>{list.map(t=><tr key={t.id} className="row" onClick={()=>onTrade(t)}>
    <td><div className="tc"><div className="ico">{t.emoji}</div><div><div className="tn">{t.name}{t.prot&&<span className="sh">🛡</span>}</div><div className="tk">{t.ticker}</div></div></div></td>
    <td className="r"><span className="v">{fmt(t.mc)}</span></td>
    <td className="r"><span className="v d">{fmt(t.vol)}</span></td>
    <td className="r"><span className={`v ${t.change>0?"up":"dn"}`}>{t.change>0?"+":""}{t.change}%</span></td>
    <td className="r"><div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}><div className="pb"><div className="pf" style={{width:`${t.progress}%`}}/></div><span className="v d">{t.progress}%</span></div></td>
    <td className="r"><span className="v d">{t.holders.toLocaleString()}</span></td>
  </tr>)}</tbody></table></div>
}

function DeployPage({wallet,onToast}){
  const[name,setName]=useState("");const[ticker,setTicker]=useState("");const[ts,setTs]=useState("idle");
  const[twitter,setTwitter]=useState("");const[telegram,setTelegram]=useState("");const[website,setWebsite]=useState("");
  const[desc,setDesc]=useState("");const[imgFile,setImgFile]=useState(null);const[imgPrev,setImgPrev]=useState(null);
  const[deploying,setDeploying]=useState(false);const[sig,setSig]=useState(null);
  const timer=useRef(null);const fref=useRef();

  const onTicker=val=>{const t=val.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);setTicker(t);setTs("idle");if(timer.current)clearTimeout(timer.current);if(t.length<2)return;setTs("checking");timer.current=setTimeout(async()=>{setTs(await checkTickerAvailable(t)?"free":"taken")},600)};
  const onImg=e=>{const f=e.target.files?.[0];if(!f)return;setImgFile(f);const r=new FileReader();r.onload=ev=>setImgPrev(ev.target.result);r.readAsDataURL(f)};
  const can=wallet&&name&&ticker&&ts==="free"&&!deploying;

  const deploy=async()=>{
    if(!can)return;setDeploying(true);onToast("Deploying...","info");
    try{
      const p=window.solana;if(!p?.isPhantom)throw new Error("Phantom not found");
      const th=await hashTicker(ticker);
      const ih=await sha256((twitter||telegram||website||ticker).trim().toLowerCase());
      let imh;if(imgFile){const ab=await imgFile.arrayBuffer();imh=await sha256(new Uint8Array(ab))}else{imh=await sha256(new TextEncoder().encode(ticker+name))}
      const tr=Buffer.alloc(16,0);Buffer.from(ticker.trim().toUpperCase().slice(0,16)).copy(tr);
      const{Keypair}=await import("@solana/web3.js");const mk=Keypair.generate();const mint=mk.publicKey;
      const reg=PublicKey.findProgramAddressSync([Buffer.from("token_registry"),mint.toBuffer()],PROGRAM_ID)[0];
      const tl=PublicKey.findProgramAddressSync([Buffer.from("ticker_lock"),th],PROGRAM_ID)[0];
      const il=PublicKey.findProgramAddressSync([Buffer.from("image_lock"),imh],PROGRAM_ID)[0];
      const idl=PublicKey.findProgramAddressSync([Buffer.from("identity_lock"),ih],PROGRAM_ID)[0];
      const ix1=new TransactionInstruction({keys:[{pubkey:reg,isSigner:false,isWritable:true},{pubkey:mint,isSigner:false,isWritable:true},{pubkey:wallet,isSigner:true,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}],programId:PROGRAM_ID,data:Buffer.concat([DISC.create_token_registry,th,imh,ih,tr])});
      const ix2=new TransactionInstruction({keys:[{pubkey:reg,isSigner:false,isWritable:false},{pubkey:tl,isSigner:false,isWritable:true},{pubkey:il,isSigner:false,isWritable:true},{pubkey:idl,isSigner:false,isWritable:true},{pubkey:wallet,isSigner:true,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}],programId:PROGRAM_ID,data:Buffer.concat([DISC.claim_locks,th,imh,ih])});
      const tx=new Transaction().add(ix1).add(ix2);const{blockhash}=await connection.getLatestBlockhash();tx.recentBlockhash=blockhash;tx.feePayer=wallet;
      const signed=await p.signTransaction(tx);const s=await connection.sendRawTransaction(signed.serialize());await connection.confirmTransaction(s,"confirmed");
      setSig(s);onToast(`✅ ${ticker} deployed!`,"ok");
    }catch(e){onToast(`❌ ${e.message?.slice(0,80)}`,"er")}finally{setDeploying(false)}
  };

  return<div className="page"><div className="ph" style={{marginBottom:20}}><div className="pt">Deploy Token</div></div>
  <div className="dg">
    <div>
      <div className="card" style={{marginBottom:16}}>
        <div className="ct">Token Info</div>
        <div className="f"><div className="fl">Name</div><input className="inp" placeholder="e.g. Moon Rock" value={name} onChange={e=>setName(e.target.value)} maxLength={32}/></div>
        <div className="f"><div className="fl">Ticker</div>
          <input className={`inp ${ts==="free"?"ok":ts==="taken"?"er":""}`} placeholder="ROCK" value={ticker} onChange={e=>onTicker(e.target.value)} maxLength={10}/>
          <div className={`ts ${ts}`}>{ts==="checking"&&"Checking..."}{ts==="free"&&"✅ Available — you'll be first deployer"}{ts==="taken"&&"🚫 Already claimed"}</div>
        </div>
        <div className="f"><div className="fl">Image</div>
          <div className="iu" onClick={()=>fref.current?.click()}>{imgPrev?<img src={imgPrev} className="iup" alt=""/>:<span style={{fontSize:11,color:"var(--d)"}}>Click to upload</span>}</div>
          <input ref={fref} type="file" accept="image/*" style={{display:"none"}} onChange={onImg}/>
        </div>
        <div className="f"><div className="fl">Description</div><textarea className="inp" rows={3} value={desc} onChange={e=>setDesc(e.target.value)} style={{resize:"vertical"}}/></div>
      </div>
      <div className="card"><div className="ct">Socials</div><div className="sg">
        <div className="f"><div className="fl">X / Twitter</div><input className="inp" placeholder="https://x.com/..." value={twitter} onChange={e=>setTwitter(e.target.value)}/></div>
        <div className="f"><div className="fl">Telegram</div><input className="inp" placeholder="https://t.me/..." value={telegram} onChange={e=>setTelegram(e.target.value)}/></div>
        <div className="f"><div className="fl">Website</div><input className="inp" placeholder="https://..." value={website} onChange={e=>setWebsite(e.target.value)}/></div>
      </div></div>
    </div>
    <div>
      <div className="card" style={{marginBottom:16}}>
        <div className="ct">Anti-Vamp</div>
        <div className={`vs ${ts==="free"?"free":ts==="taken"?"taken":"idle"}`}>{ts==="free"&&"🛡 First deployer — locked to you"}{ts==="taken"&&"🚫 Taken — choose another"}{ts==="idle"&&"Enter ticker to check"}{ts==="checking"&&"Checking on-chain..."}</div>
        <div style={{fontSize:11,color:"var(--d)",lineHeight:1.6}}>Ticker, image & socials locked on-chain. Protection activates at $100K MC.</div>
      </div>
      <div className="card">
        <div className="ct">Cost</div>
        <div className="cr"><span className="cl">LP seed (50%)</span><span className="cv">0.75 SOL</span></div>
        <div className="cr"><span className="cl">Protocol (30%)</span><span className="cv">0.45 SOL</span></div>
        <div className="cr"><span className="cl">Holder pool (10%)</span><span className="cv">0.15 SOL</span></div>
        <div className="cr"><span className="cl">Infrastructure (10%)</span><span className="cv">0.15 SOL</span></div>
        <div className="ctot"><span className="ctotl">Total</span><span className="ctotv">1.5 SOL</span></div>
        <button className="dbtn" disabled={!can} onClick={deploy}>{!wallet?"Connect Wallet":deploying?"Deploying...":ts!=="free"?"Check Ticker First":`Deploy ${ticker||"Token"}`}</button>
        {sig&&<div style={{marginTop:10,fontSize:10,color:"var(--g)",wordBreak:"break-all"}}>✅ <a href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`} target="_blank" style={{color:"var(--g)"}}>View on Explorer</a></div>}
      </div>
    </div>
  </div></div>
}

function TradePage({token,wallet,onToast}){
  const[side,setSide]=useState("buy");const[amount,setAmount]=useState("");const[trading,setTrading]=useState(false);
  const tok=token||TOKENS[2];
  const trade=async()=>{
    if(!wallet||!amount)return;
    setTrading(true);
    onToast(side==="buy"?"Buying...":"Selling...","info");
    try{
      const {buildSwapTx,connection} = await import('./solana.js');
      const p=window.solana;
      if(!p?.isPhantom) throw new Error("Phantom not found");
      const tx = await buildSwapTx(
        {publicKey: wallet},
        tok.mint,
        parseFloat(amount),
        side==="buy"
      );
      const signed = await p.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      onToast(`✅ ${side==="buy"?"Bought":"Sold"} ${tok.ticker} — ${sig.slice(0,8)}...`,"ok");
    }catch(e){
      onToast(`❌ ${e.message?.slice(0,80)}`,"er");
    }finally{setTrading(false)}
  };
  return<div className="tg">
    <div className="cp">
      <div className="ch"><div className="ctk"><div style={{fontSize:28}}>{tok.emoji}</div><div><div className="ctn">{tok.name}{tok.prot&&<span className="sh" style={{marginLeft:8}}>🛡</span>}</div><div className="ctt">{tok.ticker} · Devnet</div></div></div>
        <div className="cmc"><div className="cmcv">{fmt(tok.mc)}</div><div className={`cmcs ${tok.change>0?"up":"dn"}`}>{tok.change>0?"+":""}{tok.change}% 24h</div></div>
      </div>
      <div className="ca"><div style={{color:"var(--d2)",fontSize:11,textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>📈</div>Chart coming soon<br/><span style={{fontSize:10}}>Price: ${tok.price.toFixed(8)}</span></div></div>
      <div className="cf"><div className="gr"><span className="gl">Bonding Curve</span><span className="gv">{tok.progress}% · {fmt(tok.mc)} / $880K</span></div><div className="gb"><div className="gf" style={{width:`${tok.progress}%`}}/></div></div>
    </div>
    <div className="sp">
      <div className="stabs"><button className={`stab ${side==="buy"?"on buy":""}`} onClick={()=>setSide("buy")}>Buy</button><button className={`stab ${side==="sell"?"on sell":""}`} onClick={()=>setSide("sell")}>Sell</button></div>
      <div className="sf">
        <div className="ab"><div className="at"><span className="al">{side==="buy"?"You pay":"You sell"}</span><span className="abal">Bal: —</span></div>
          <div className="ar"><input className="ai" type="number" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)}/><span className="atok">{side==="buy"?"SOL":tok.ticker}</span></div>
        </div>
        {side==="buy"&&<div className="qb">{["0.1","0.5","1","5"].map(v=><button key={v} className="qbtn" onClick={()=>setAmount(v)}>{v} SOL</button>)}</div>}
        <div className="fb2"><div className="fr"><span className="frl">LP fee (0.60%)</span><span className="frv">—</span></div><div className="fr"><span className="frl">Airdrop (0.50%)</span><span className="frv">—</span></div><div className="fr"><span className="frl">Protocol (0.40%)</span><span className="frv">—</span></div></div>
        <button className={`sbtn ${side}`} disabled={!wallet||!amount||trading} onClick={trade}>{!wallet?"Connect Wallet":trading?"Confirming...":side==="buy"?`Buy ${tok.ticker}`:`Sell ${tok.ticker}`}</button>
      </div>
    </div>
  </div>
}

export default function App(){
  const[page,setPage]=useState("tokens");const[wallet,setWallet]=useState(null);const[tok,setTok]=useState(null);const[toast,setToast]=useState({msg:"",type:"info"});
  const onToast=(msg,type="info")=>setToast({msg,type});
  const connect=async()=>{try{const p=window.solana;if(!p?.isPhantom){window.open("https://phantom.app","_blank");return}const r=await p.connect();setWallet(r.publicKey);onToast(`Connected: ${r.publicKey.toBase58().slice(0,8)}...`,"ok")}catch{onToast("Cancelled","er")}};
  const disconnect=async()=>{await window.solana?.disconnect();setWallet(null)};
  return<><style>{S}</style><div>
    <nav className="nav">
      <div className="logo" onClick={()=>setPage("tokens")}><div className="dot"/>SUMMIT.MOON</div>
      <div className="tabs">{[["tokens","Tokens"],["deploy","Deploy"],["trade","Trade"]].map(([v,l])=><button key={v} className={`tab ${page===v?"on":""}`} onClick={()=>setPage(v)}>{l}</button>)}</div>
      <div className="nr"><span className="devnet">DEVNET</span>{wallet?<button className="wbtn on" onClick={disconnect}>{wallet.toBase58().slice(0,4)}...{wallet.toBase58().slice(-4)}</button>:<button className="wbtn" onClick={connect}>Connect Wallet</button>}</div>
    </nav>
    <Tape/>
    {page==="tokens"&&<TokensPage onTrade={t=>{setTok(t);setPage("trade")}}/>}
    {page==="deploy"&&<DeployPage wallet={wallet} onToast={onToast}/>}
    {page==="trade"&&<TradePage token={tok} wallet={wallet} onToast={onToast}/>}
  </div><Toast msg={toast.msg} type={toast.type} onClose={()=>setToast({msg:""})}/>
  </>
}
