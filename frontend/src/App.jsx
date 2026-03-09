import { buildSwapTx, buildDeployTx, connection } from "./solana.js";
import { useState, useEffect, useRef } from "react";

// ── Design direction: High-end crypto editorial ─────────────────
// Inspired by Bloomberg Terminal meets Bottega Veneta.
// Near-black backgrounds with warm undertone (#0d0c0b), not cold blue-black.
// Typography: Instrument Serif for hero numbers + brand wordmark,
//             Geist Mono for data/prices, Inter for UI chrome.
// Accent: restrained champagne gold (#c9a84c) + electric green for gains.
// Surfaces: layered warm darks, hairline borders, no hard shadows.
// Motion: opacity + translate only. Nothing bounces.

const FONT = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=Geist+Mono:wght@300;400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  ::-webkit-scrollbar { display: none; }
  html { scroll-behavior: smooth; }
  body { background: #0d0c0b; }
  input::placeholder { color: rgba(255,248,235,0.2); }
  input, button, select { font-family: 'Inter', system-ui, sans-serif; }
  button { -webkit-tap-highlight-color: transparent; }
  @keyframes fadeUp   { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes fadeIn   { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse    { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
  @keyframes slideUp  { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:none; } }
  @keyframes scaleIn  { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
  @keyframes shimmer  { from { background-position: -200% 0; } to { background-position: 200% 0; } }
`;

// ── Warm dark palette — editorial luxury ───────────────────────
const C = {
  // Backgrounds — warm near-black, not cold
  bg:       "#0d0c0b",
  surface:  "#111009",
  card:     "#161410",
  cardUp:   "#1c1916",
  sheet:    "#201d19",
  // Borders — warm hairlines
  border:   "rgba(255,248,235,0.07)",
  borderMd: "rgba(255,248,235,0.11)",
  borderHi: "rgba(255,248,235,0.18)",
  // Text — warm whites
  text:     "#faf6ef",
  textSec:  "rgba(250,246,239,0.58)",
  textTer:  "rgba(250,246,239,0.32)",
  textQuat: "rgba(250,246,239,0.16)",
  // Semantic
  green:    "#22c55e",
  greenBg:  "rgba(34,197,94,0.08)",
  greenBd:  "rgba(34,197,94,0.18)",
  red:      "#f43f5e",
  redBg:    "rgba(244,63,94,0.08)",
  redBd:    "rgba(244,63,94,0.18)",
  gold:     "#c9a84c",
  goldBg:   "rgba(201,168,76,0.08)",
  goldBd:   "rgba(201,168,76,0.2)",
  blue:     "#60a5fa",
  blueBg:   "rgba(96,165,250,0.08)",
  blueBd:   "rgba(96,165,250,0.18)",
  purple:   "#a78bfa",
  purpleBg: "rgba(167,139,250,0.08)",
  purpleBd: "rgba(167,139,250,0.18)",
  teal:     "#2dd4bf",
  tealBg:   "rgba(45,212,191,0.07)",
  tealBd:   "rgba(45,212,191,0.15)",
  // Brand — champagne gold, used sparingly
  accent:   "#c9a84c",
  accentBg: "rgba(201,168,76,0.08)",
  accentBd: "rgba(201,168,76,0.2)",
  raydium:  "#9945FF",
  raydiumBg:"rgba(153,69,255,0.08)",
  raydiumBd:"rgba(153,69,255,0.18)",
  // Font stacks
  serif:    "'Instrument Serif', Georgia, serif",
  mono:     "'Geist Mono', 'SF Mono', ui-monospace, monospace",
  sans:     "'Inter', system-ui, sans-serif",
};

// Token avatar gradients — editorial, not garish
const PALETTES = [
  {a:"#c9a84c",b:"#a06830",glow:"rgba(201,168,76,0.18)"},
  {a:"#22c55e",b:"#16a34a",glow:"rgba(34,197,94,0.18)"},
  {a:"#60a5fa",b:"#3b82f6",glow:"rgba(96,165,250,0.18)"},
  {a:"#a78bfa",b:"#7c3aed",glow:"rgba(167,139,250,0.18)"},
  {a:"#f59e0b",b:"#d97706",glow:"rgba(245,158,11,0.18)"},
  {a:"#f43f5e",b:"#e11d48",glow:"rgba(244,63,94,0.18)"},
  {a:"#2dd4bf",b:"#0d9488",glow:"rgba(45,212,191,0.18)"},
  {a:"#fb923c",b:"#ea580c",glow:"rgba(251,146,60,0.18)"},
];

const MILESTONES = [
  {range:"$0-10M",multi:1.0},{range:"$10-20M",multi:1.2},{range:"$20-30M",multi:1.4},
  {range:"$30-40M",multi:1.7},{range:"$40-50M",multi:2.0},{range:"$50-75M",multi:2.5},
  {range:"$75-100M",multi:3.0},{range:"$100M+",multi:4.0},
];

const MC_MILESTONES = [
  {mc:1000000,label:"$1M",pct:3},{mc:1500000,label:"$1.5M",pct:3},
  {mc:2000000,label:"$2M",pct:3},{mc:2500000,label:"$2.5M",pct:3},
  {mc:3000000,label:"$3M",pct:3},{mc:5000000,label:"$5M",pct:4},
  {mc:7500000,label:"$7.5M",pct:4},{mc:10000000,label:"$10M",pct:4},
  {mc:15000000,label:"$15M",pct:4},{mc:20000000,label:"$20M",pct:5},
  {mc:30000000,label:"$30M",pct:5},{mc:50000000,label:"$50M",pct:5},
];

const CAP_WINDOWS = [
  {until:7,pct:"1.5%",label:"0-7 min"},{until:14,pct:"2%",label:"7-14 min"},
  {until:30,pct:"5%",label:"14-30 min"},{until:999,pct:"Open",label:"30 min+"},
];

const LOCK_OPTIONS = [
  {days:0,label:"None",boost:0},{days:7,label:"7d",boost:0.10},
  {days:30,label:"30d",boost:0.25},{days:90,label:"90d",boost:0.50},{days:180,label:"180d",boost:0.75},
];


// ===== SLOT ENGINE =====
// Slots = volume-driven with variable cap tiers
// Floor: always 10 open minimum regardless of volume
// Cap: starts at 50, expands as cumulative platform volume hits milestones
// Volume: every $10K traded earns +1 slot within the current cap
// Midnight UTC: if slots < floor, reset to floor. If >= floor, no change.

const SLOT_FLOOR = 10; // always available no matter what

// Cap tier milestones - cumulative platform volume unlocks higher caps
const CAP_TIERS = [
  {vol: 0,          cap: 50,  label: "Tier 1"},
  {vol: 500000,     cap: 100, label: "Tier 2"},
  {vol: 5000000,    cap: 150, label: "Tier 3"},
  {vol: 50000000,   cap: 200, label: "Tier 4"},
  {vol: 500000000,  cap: 250, label: "Tier 5"},
];

function getCurrentTier(totalVolume) {
  // Walk tiers in reverse to find highest unlocked
  for(let i = CAP_TIERS.length-1; i >= 0; i--) {
    if(totalVolume >= CAP_TIERS[i].vol) return CAP_TIERS[i];
  }
  return CAP_TIERS[0];
}

function getNextTier(totalVolume) {
  for(let i = 0; i < CAP_TIERS.length; i++) {
    if(totalVolume < CAP_TIERS[i].vol) return CAP_TIERS[i];
  }
  return null; // already at max tier
}

function calcSlots(totalVolume, tokensLaunched) {
  const tier     = getCurrentTier(totalVolume);
  const nextTier = getNextTier(totalVolume);
  const cap      = tier.cap;

  // Within-day slots earned by volume (same mechanic, just capped at tier cap)
  const per10k    = Math.floor(totalVolume / 10000);
  const per100k   = Math.floor(totalVolume / 100000);
  const per1m     = Math.floor(totalVolume / 1000000);
  const volEarned = per10k + per100k * 2 + per1m * 5;

  const totalAvailable = Math.min(cap, Math.max(SLOT_FLOOR, volEarned));
  const open     = Math.max(0, totalAvailable - tokensLaunched);

  // Vol to next within-day slot
  const toNextSlot = totalAvailable < cap
    ? (Math.ceil((totalVolume + 1) / 10000) * 10000) - totalVolume
    : 0;

  // Vol to next tier cap expansion
  const toNextTier = nextTier ? nextTier.vol - totalVolume : 0;
  const tierPct    = nextTier
    ? Math.min(1, (totalVolume - tier.vol) / (nextTier.vol - tier.vol))
    : 1;

  const atFloor = totalAvailable <= SLOT_FLOOR;
  const atCap   = totalAvailable >= cap;

  return {
    open, totalAvailable, cap, tier, nextTier,
    toNextSlot, toNextTier, tierPct,
    atFloor, atCap, volEarned
  };
}

function fmtVol(n) {
  if(n>=1000000) return `$${(n/1000000).toFixed(1)}M`;
  if(n>=1000)    return `$${(n/1000).toFixed(0)}K`;
  return `$${n}`;
}

// ═══════════════════════════════════════════════════════════════
// SUMMIT.MOON — TOKENOMICS v4 — CLEAN SIMPLE MODEL
// ═══════════════════════════════════════════════════════════════
// Pump.fun: 1% fee, keeps 100%. Gives holders $0.
// Summit:   1.5% fee. 0.25% → quarterly USDC airdrop pool.
// That's it. Simple. No tiers. No sqrt math. Just hold more = earn more.
// ═══════════════════════════════════════════════════════════════

// ── Supply ────────────────────────────────────────────────────
const TOTAL_SUPPLY        = 1_000_000_000;
const BONDING_PCT         = 0.65;
const RESERVE_PCT         = 0.10;

// ── Swap fee: 1.5% total ─────────────────────────────────────
const FEE_TOTAL           = 0.0150;
const FEE_LP              = 0.0090;  // 0.90% 2192 LP
const FEE_PROTOCOL        = 0.0035;  // 0.35% 2192 protocol
const FEE_AIRDROP         = 0.0025;  // 0.25% 2192 quarterly USDC airdrop pool

// ── Deploy fee: 1.5 SOL ───────────────────────────────────────
const DEPLOY_LP_PCT       = 0.50;    // 0.75 SOL seeds LP
const DEPLOY_PROTOCOL_PCT = 0.30;    // 0.45 SOL protocol
const DEPLOY_BONUS_PCT    = 0.10;    // 0.15 SOL → airdrop pool
const DEPLOY_INFRA_PCT    = 0.10;    // 0.15 SOL → LP seed
const SOL_PRICE           = 180;
const DAILY_LAUNCHES      = 50;

// ── Airdrop only ───────────────────────────────────────────────
// 100% of the 1.00% pool goes to airdrop eligible holders by balance.
// Proportional to their % of supply relative to each other.
// Snapshot each quarter. Hold rank = earn. Drop rank = stop.
// No staking. No claiming. USDC lands automatically.

// Assumed realistic top-15 distribution for projections


function calcHourlyByRank(tokenDailyVol, rank) {
  const pct = 0;
  return 0;
}


function calcDailySOL(tokenDailyVol, holdingPct) {
  return (tokenDailyVol * FEE_LP) * (holdingPct / 100);
}

function calcProtocolRevenue(dailyVol, launches) {
  return (dailyVol * FEE_PROTOCOL) + (launches * 1.5 * DEPLOY_PROTOCOL_PCT * SOL_PRICE);
}

// Legacy compat
const FEE_HOLDERS = FEE_AIRDROP;
const TIERS = [
  {id:"top15", label:"Airdrop", minPct:0.50, minUSD:500, share:1.0, col:"#ffd60a"},
];
const TIME_MULTS = [
  {from:0, to:999, mult:1.0, label:"any"},
];
function getTier(holdingPct) { return holdingPct >= 0.5 ? TIERS[0] : null; }
function getTimeMult() { return 1.0; }
function holdingMultiplier(pct) { return pct; }
function calcFeeDrip()    { return 0; }
function calcWeeklyDrop() { return 0; }
function calcUSDCHolder(volRaw, holdingPct) {
  return 0 * 24 * 7;
}

// Platform scale
const PLATFORM_DAILY_VOL  = 15_000_000;


// Weekly airdrop claim modes
const CLAIM_MODES = [
  {v:"reinject", icon:"↺", label:"Reinject",    col:C.green, desc:"USDC swapped to token via Jupiter, auto-buys the chart. +10% bonus. Your bag locks 72hrs.", lock:"72hr freeze"},
  {v:"token",    icon:"T", label:"Take tokens", col:"#ffd60a", desc:"Full amount vested over 7 days. Must maintain holding %.",    lock:"7 day vest"},
  {v:"usdc",     icon:"$", label:"USDC",        col:"#0a84ff", desc:"15% haircut: 10% burned forever, 5% back to vault pool.",     lock:"48hr lock"},
];

const INIT_TOKENS = [
  // mcap for pre-grad tokens = raisedSOL * 180 * ~1.8 (spot price × total supply on sqrt curve)
  // mcap for graduated tokens = free market post-Raydium (realistic pump-style multiples)
  {id:1,sym:"JERRY",vaultDays:156,vaultActive:true,name:"Jerry Coin",pi:0,mcap:Math.round(62*180*1.85),chg:+284,prog:42,holders:1243,age:2,raisedSOL:62,raisedSOLMax:85,elapsed:8,vol:"$182K",volRaw:182000,txs:2841,desc:"community favourite",bondingFull:false,minsAgo:73,graduated:false,topicLocked:false,topicSource:null,topicTitle:null,tw:"jerryCoinSol",tg:"jerrycoin",web:"jerrycoin.xyz"},
  {id:2,sym:"GBRAIN",vaultDays:121,vaultActive:true,name:"Gigabrain",pi:1,mcap:18700000,chg:+91,prog:71,holders:4891,age:6,raisedSOL:85,raisedSOLMax:85,elapsed:45,vol:"$1.2M",volRaw:1200000,txs:14203,desc:"big brain energy",bondingFull:true,minsAgo:210,graduated:false,topicLocked:true,topicSource:"X",topicTitle:"@naval: the only real edge is thinking",tw:"gigabrainsol",tg:"gigabrain",web:"gigabrain.io"},
  {id:3,sym:"VOID",vaultDays:0,vaultActive:false,name:"Voidwalker",pi:2,mcap:Math.round(18*180*1.85),chg:-12,prog:18,holders:312,age:9,raisedSOL:18,raisedSOLMax:85,elapsed:82,vol:"$31K",volRaw:31000,txs:412,desc:"into the void",bondingFull:false,minsAgo:38,graduated:false,topicLocked:false,topicSource:null,topicTitle:null,tw:"voidwalkerSol",tg:"voidwalker",web:null},
  {id:4,sym:"SFRG",vaultDays:89,vaultActive:true,name:"Sol Forge",pi:3,mcap:67200000,chg:+412,prog:89,holders:9234,age:1,raisedSOL:85,raisedSOLMax:85,elapsed:3,vol:"$8.4M",volRaw:8400000,txs:98231,desc:"forging the future",bondingFull:true,minsAgo:52,graduated:true,topicLocked:true,topicSource:"Bloomberg",topicTitle:"Solana hits $500 amid institutional surge",tw:"solforgeio",tg:"solforge",web:"solforge.io"},
  {id:5,sym:"MRAT",vaultDays:168,vaultActive:true,name:"Moon Rat",pi:4,mcap:Math.round(31*180*1.85),chg:+44,prog:31,holders:788,age:4,raisedSOL:31,raisedSOLMax:85,elapsed:22,vol:"$94K",volRaw:94000,txs:3201,desc:"little rat, big moon",bondingFull:false,minsAgo:18,graduated:false,topicLocked:false,topicSource:null,topicTitle:null,tw:"moonratsol",tg:"moonrat",web:null},
  {id:6,sym:"IRON",vaultDays:112,vaultActive:true,name:"Iron Hand",pi:5,mcap:31000000,chg:+178,prog:63,holders:3120,age:3,raisedSOL:85,raisedSOLMax:85,elapsed:55,vol:"$2.1M",volRaw:2100000,txs:41200,desc:"diamond hands",bondingFull:true,minsAgo:140,graduated:true,topicLocked:true,topicSource:"Reuters",topicTitle:"Iron ore futures hit 8-month high on China data",tw:"ironhandSol",tg:"ironhand",web:"ironhand.finance"},
  {id:7,sym:"PHNT",vaultDays:0,vaultActive:false,name:"Phantom",pi:6,mcap:Math.round(58*180*1.85),chg:+33,prog:55,holders:2100,age:5,raisedSOL:58,raisedSOLMax:85,elapsed:38,vol:"$340K",volRaw:340000,txs:8820,desc:"you can't catch a phantom",bondingFull:false,minsAgo:62,graduated:false,topicLocked:false,topicSource:null,topicTitle:null,tw:"phantomcoinSol",tg:"phantomcoin",web:null},
  {id:8,sym:"ECLP",vaultDays:0,vaultActive:false,name:"Eclipse",pi:7,mcap:Math.round(6*180*1.85),chg:-8,prog:9,holders:98,age:11,raisedSOL:6,raisedSOLMax:85,elapsed:90,vol:"$12K",volRaw:12000,txs:198,desc:"total eclipse incoming",bondingFull:false,minsAgo:0,graduated:false,topicLocked:false,topicSource:null,topicTitle:null,tw:null,tg:"eclipsesol",web:null},
];

const HOLDERS = Array.from({length:20},(_,i)=>({
  rank:i+1,
  wallet:`${(0xf1a2+i*317).toString(16).slice(0,4)}...${(0x9c3e+i*211).toString(16).slice(0,4)}`,
  pct:parseFloat(Math.max(0.8,(14.2-i*0.9)).toFixed(1)),
  lockDays:[180,180,90,90,90,30,30,30,7,7,7,7,0,0,0,0,0,0,0,0][i],
  streak:i<5,whitelisted:true,inTop10:true,
  dripMode:["reinject","token","reinject","usdc","token","reinject","usdc","reinject","token","reinject","usdc","reinject","reinject","token","usdc","reinject","reinject","token","reinject","reinject"][i],
  boost:[0.75,0.75,0.5,0.5,0.5,0.25,0.25,0.25,0.1,0.1,0.1,0.1,0,0,0,0,0,0,0,0][i],
}));

const MY_POSITIONS = [
  {sym:"JERRY",pi:0,held:14200,entry:0.000041,current:0.000158,pnlPct:+285,whitelisted:true,inTop10:true,pendingDrip:0.042,dripMode:"token"},
  {sym:"GBRAIN",pi:1,held:8800,entry:0.000190,current:0.000364,pnlPct:+91,whitelisted:true,inTop10:false,pendingDrip:0,dripMode:"usdc"},
  {sym:"PHNT",pi:6,held:31000,entry:0.000088,current:0.000117,pnlPct:+33,whitelisted:false,inTop10:false,pendingDrip:0,dripMode:"reinject"},
];

const MY_TOKENS = [
  {sym:"JERRY",pi:0,mcap:Math.round(62*180*1.85),chg:+284,vol:"$182K",feesEarned:0.847,holders:1243,launched:"2d ago"},
  {sym:"ECLP",pi:7,mcap:Math.round(6*180*1.85),chg:-8,vol:"$12K",feesEarned:0.031,holders:98,launched:"11d ago"},
];

const MOCK_NOTIFS = [
  {id:1,type:"whitelist",msg:"Whitelisted on JERRY -- drips active",time:"2m ago",read:false,color:C.green},
  {id:2,type:"drip",msg:"0.042 SOL drip injected into JERRY",time:"14m ago",read:false,color:C.accent},
  {id:3,type:"milestone",msg:"GBRAIN $5M milestone -- 4% pool released",time:"1h ago",read:true,color:C.gold},
  {id:4,type:"bundle",msg:"Bundle attempt blocked on MRAT",time:"3h ago",read:true,color:C.red},
  {id:5,type:"topic",msg:"SFRG topic locked -- Bloomberg article claimed",time:"1d ago",read:true,color:C.teal},
];

const MOCK_DEX = {
  "SFRG":{price:"0.000412",chg24:"+18.4",vol24:"$840K",liq:"$220K"},
  "IRON":{price:"0.000831",chg24:"+6.1",vol24:"$2.1M",liq:"$910K"},
};

const fmt = n => n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(0)}K`:`$${n}`;
const getMI = m => m>=1e8?7:m>=75e6?6:m>=5e7?5:m>=4e7?4:m>=3e7?3:m>=2e7?2:m>=1e7?1:0;
const pad2 = n => String(Math.floor(n)).padStart(2,"0");

function getAS(t) {
  if(!t.bondingFull) return {s:"locked",pct:Math.min(100,(t.raisedSOL/85)*100),minsLeft:null,solLeft:Math.max(0,85-t.raisedSOL)};
  const delay = t.graduated ? 5 : 60;
  if(t.minsAgo<delay) return {s:"pending",pct:(t.minsAgo/delay)*100,minsLeft:delay-t.minsAgo};
  return {s:"live",pct:100,minsLeft:0};
}

function calcImpact(mcap,sol,buy) {
  const usd=sol*180,pct=(usd/mcap)*100;
  const imp=Math.min(buy?pct*0.8:pct*1.1,45),fee=sol*0.010;
  const recv=buy?(usd*(1-imp/100))/(mcap/1e9):(sol*(1-imp/100)-fee);
  return {impact:imp.toFixed(2),fee:fee.toFixed(4),recv:recv.toFixed(buy?0:4)};
}

function classifyTopic(url) {
  if(!url||!url.startsWith("http")) return null;
  const domains={"x.com":"X","twitter.com":"X","reuters.com":"Reuters","bloomberg.com":"Bloomberg","coindesk.com":"CoinDesk"};
  const src=Object.entries(domains).find(([d])=>url.includes(d));
  const source=src?src[1]:"Web";
  if(url.toLowerCase().includes("elon")||url.toLowerCase().includes("musk"))
    return {entity:"Elon Musk",event:"tweet",source,claimed:true,claimedBy:"ELON"};
  if(url.toLowerCase().includes("bitcoin")||url.toLowerCase().includes("btc"))
    return {entity:"Bitcoin",event:"news",source,claimed:false};
  return {entity:"Trending topic",event:"news",source,claimed:false};
}

function genCandles(count,base) {
  const d=[];let p=base;
  for(let i=0;i<count;i++){
    const c=(Math.random()-0.46)*0.08,o=p,cl=Math.max(0.000001,p*(1+c));
    d.push({o,h:Math.max(o,cl)*(1+Math.random()*0.02),l:Math.min(o,cl)*(1-Math.random()*0.02),c:cl,v:0.3+Math.random()*1.4});
    p=cl;
  }
  return d;
}

// ===== DESIGN PRIMITIVES =====

// ── Label — editorial typography ───────────────────────────────
const Label = ({children, size=11, color, weight=400, mono=false, serif=false, style={}}) => (
  <span style={{
    fontSize:size,
    fontWeight:weight,
    color:color||C.textTer,
    letterSpacing: serif ? "-0.02em" : mono ? "0.01em" : size>=20 ? "-0.03em" : size>=15 ? "-0.025em" : size>=12 ? "-0.015em" : "-0.005em",
    fontVariantNumeric:"tabular-nums",
    lineHeight:1.35,
    fontFamily: serif ? C.serif : mono ? C.mono : C.sans,
    ...style
  }}>{children}</span>
);

// Spark line
function Spark({data,color,W=56,H=20}) {
  if(!data||data.length<2) return null;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*W},${H-((v-mn)/rng)*(H-2)+1}`).join(" ");
  return <svg width={W} height={H} style={{display:"block",overflow:"visible"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

// Token avatar — refined, subtle glow
function Avatar({sym,pi,size=36}) {
  const p=PALETTES[pi%8];
  const r = Math.round(size * 0.26);
  return (
    <div style={{
      width:size, height:size, borderRadius:r,
      background:`linear-gradient(145deg,${p.a} 0%,${p.b} 100%)`,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:Math.floor(size*0.28), fontWeight:600,
      color:"rgba(255,255,255,0.92)", flexShrink:0,
      letterSpacing:"-0.03em",
      fontFamily:C.mono,
      boxShadow:`0 1px 8px ${p.glow}, inset 0 1px 0 rgba(255,255,255,0.12)`,
    }}>
      {sym.slice(0,3)}
    </div>
  );
}

// Tag — refined pill
function Tag({children,color,filled=false}) {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center",
      height:20, padding:"0 8px", borderRadius:4,
      background: filled ? color : `${color}10`,
      border: `1px solid ${color}22`,
      fontSize:10, fontWeight:500,
      color: filled ? "#000" : color,
      letterSpacing:"0.02em",
      textTransform:"uppercase",
      whiteSpace:"nowrap",
      fontFamily:C.sans,
    }}>
      {children}
    </span>
  );
}

// Button — refined, no rounded-pill defaults
function Btn({children,onClick,variant="filled",color,full,small,disabled,loading}) {
  const h = small ? 32 : 42;
  const base = {
    display:"flex", alignItems:"center", justifyContent:"center", gap:6,
    width:full?"100%":undefined, height:h,
    padding:small?"0 14px":"0 20px",
    borderRadius:6,
    fontSize:small?12:13,
    fontWeight:500,
    cursor:disabled||loading?"not-allowed":"pointer",
    transition:"opacity 0.12s, background 0.12s",
    letterSpacing:"0.01em",
    textTransform:"uppercase" ,
    outline:"none", border:"none", whiteSpace:"nowrap",
    fontFamily:C.sans,
  };
  const variants = {
    filled:{ background:color||C.text, color:color?"#000":C.bg },
    tinted:{ background:`${color||C.accent}12`, color:color||C.accent, border:`1px solid ${color||C.accent}28` },
    ghost:{ background:"transparent", color:C.textSec, border:`1px solid ${C.border}` },
    destructive:{ background:C.redBg, color:C.red, border:`1px solid ${C.redBd}` },
  };
  return (
    <button onClick={disabled||loading?undefined:onClick}
      style={{...base,...variants[variant],opacity:disabled?0.24:1}}
      onMouseEnter={e=>{ if(!disabled&&!loading) e.currentTarget.style.opacity="0.78"; }}
      onMouseLeave={e=>{ e.currentTarget.style.opacity=disabled?"0.24":"1"; }}
      onMouseDown={e=>{ if(!disabled&&!loading) e.currentTarget.style.opacity="0.6"; }}
      onMouseUp={e=>{ e.currentTarget.style.opacity="1"; }}>
      {loading ? <span style={{opacity:0.45,letterSpacing:"0.1em",fontSize:11}}>···</span> : children}
    </button>
  );
}

// GlassCard — warm surface, hairline border
function GlassCard({children,style={},onClick,hover=true}) {
  const [hov,setHov]=useState(false);
  return (
    <div onClick={onClick}
      style={{
        background: hov&&hover&&onClick ? C.cardUp : C.card,
        borderRadius:8,
        border:`1px solid ${hov&&hover&&onClick ? C.borderMd : C.border}`,
        transition:"background 0.15s, border-color 0.15s",
        cursor:onClick?"pointer":"default",
        ...style
      }}
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}>
      {children}
    </div>
  );
}

// Separator — warm hairline
const Sep = ({my=0}) => <div style={{height:"1px",background:C.border,margin:`${my}px 0`,opacity:0.8}}/>;


// Topic verification chip
function TopicChip({source,title}) {
  if(!source) return null;
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:6,marginTop:8}}>
      <div style={{width:5,height:5,borderRadius:"50%",background:C.teal,flexShrink:0}}/>
      <Label size={10} color={C.teal} weight={600}>{source}</Label>
      <Label size={10} color={C.textTer} style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{title}</Label>
    </div>
  );
}

// ===== CANDLESTICK CHART =====

function CandleChart({candles,color,fullHeight}) {
  const ref      = useRef(null);
  const stateRef = useRef({
    // view window: index of leftmost visible candle (float)
    offset: 0,
    // how many candles visible (zoom level)
    visible: 60,
    // drag state
    dragging: false,
    dragStartX: 0,
    dragStartOffset: 0,
    // pinch state
    pinching: false,
    pinchStartDist: 0,
    pinchStartVisible: 0,
    pinchStartOffset: 0,
    // pointer tracking
    pointers: {},
  });
  const [dims, setDims]   = useState({w:600, h:400});
  const [hov,  setHov]    = useState(null);
  const [,     forceRender] = useState(0);
  const redraw = () => forceRender(n => n+1);

  // ResizeObserver
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const {width, height} = e.contentRect;
        setDims({w: Math.max(200, width), h: fullHeight ? Math.max(180, height) : 180});
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [fullHeight]);

  // Clamp helpers
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clampView = (s) => {
    const total = candles.length;
    s.visible = clamp(Math.round(s.visible), 5, total);
    s.offset  = clamp(s.offset, 0, total - s.visible);
    return s;
  };

  // Derived layout
  const PAD_L = 56, PAD_R = 8, PAD_T = 12, PAD_B = fullHeight ? 24 : 20;
  const W = dims.w, H = dims.h;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const volH   = Math.floor(chartH * (fullHeight ? 0.14 : 0.15));
  const priceH = chartH - volH - 6;

  const s = stateRef.current;
  const visCount = clamp(Math.round(s.visible), 5, candles.length);
  const startIdx = clamp(Math.floor(s.offset), 0, candles.length - visCount);
  const vis      = candles.slice(startIdx, startIdx + visCount);
  const cW       = chartW / visCount;

  const prices = vis.flatMap(c => [c.h, c.l]);
  const mn = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 1;
  const mvols = Math.max(...vis.map(c => c.v));

  const py  = price => PAD_T + priceH - ((price - mn) / rng) * priceH;
  const vy  = vol   => PAD_T + priceH + 6 + volH - (vol / mvols) * volH;

  const nTicks = fullHeight ? 6 : 3;
  const ticks  = Array.from({length: nTicks}, (_, i) => {
    const frac = i / (nTicks - 1);
    return {price: mn + frac * rng, y: py(mn + frac * rng)};
  });

  // Pointer helpers
  const getPointers = () => Object.values(s.pointers);

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    s.pointers[e.pointerId] = {x: e.clientX, y: e.clientY};
    const pts = getPointers();

    if (pts.length === 1) {
      // single finger - start drag
      s.dragging = true;
      s.dragStartX = e.clientX;
      s.dragStartOffset = s.offset;
    } else if (pts.length === 2) {
      // two fingers - start pinch
      s.dragging = false;
      s.pinching = true;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      s.pinchStartDist    = Math.sqrt(dx*dx + dy*dy);
      s.pinchStartVisible = s.visible;
      s.pinchStartOffset  = s.offset;
    }
  };

  const onPointerMove = (e) => {
    if (!s.pointers[e.pointerId]) return;
    s.pointers[e.pointerId] = {x: e.clientX, y: e.clientY};
    const pts = getPointers();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;

    if (pts.length >= 2) {
      // PINCH ZOOM
      const [p0, p1] = pts;
      const dx = p0.x - p1.x, dy = p0.y - p1.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const scale = s.pinchStartDist / dist;           // >1 = zoom in
      const newVisible = clamp(s.pinchStartVisible * scale, 5, candles.length);

      // keep midpoint candle stable
      const midX = ((p0.x + p1.x) / 2) - r.left - PAD_L;
      const midFrac = midX / chartW;
      const midCandle = s.pinchStartOffset + midFrac * s.pinchStartVisible;
      s.visible = newVisible;
      s.offset  = clamp(midCandle - midFrac * newVisible, 0, candles.length - newVisible);
      clampView(s);
      redraw();

    } else if (s.dragging) {
      // PAN
      const dx = e.clientX - s.dragStartX;
      const candlesDragged = (dx / chartW) * visCount;
      s.offset = clamp(s.dragStartOffset - candlesDragged, 0, candles.length - visCount);
      redraw();

      // update hover
      const x = e.clientX - r.left - PAD_L;
      const i = Math.floor(x / cW);
      if (i >= 0 && i < vis.length) setHov({i, c: vis[i], x: PAD_L + i*cW + cW/2});
      else setHov(null);
    } else {
      // hover only
      const x = e.clientX - r.left - PAD_L;
      const i = Math.floor(x / cW);
      if (i >= 0 && i < vis.length) setHov({i, c: vis[i], x: PAD_L + i*cW + cW/2});
      else setHov(null);
    }
  };

  const onPointerUp = (e) => {
    delete s.pointers[e.pointerId];
    const pts = getPointers();
    if (pts.length === 0) {
      s.dragging = false;
      s.pinching = false;
    } else if (pts.length === 1) {
      // one finger left after pinch - restart drag from here
      s.dragging = true;
      s.dragStartX = pts[0].x;
      s.dragStartOffset = s.offset;
      s.pinching = false;
    }
  };

  // Scroll-wheel zoom (desktop)
  const onWheel = (e) => {
    e.preventDefault();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const factor = e.deltaY > 0 ? 1.12 : 0.88;
    const mouseX = e.clientX - r.left - PAD_L;
    const mouseFrac = clamp(mouseX / chartW, 0, 1);
    const anchorCandle = s.offset + mouseFrac * s.visible;
    s.visible = clamp(s.visible * factor, 5, candles.length);
    s.offset  = clamp(anchorCandle - mouseFrac * s.visible, 0, candles.length - s.visible);
    clampView(s);
    redraw();
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, {passive: false});
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Render
  return (
    <div ref={ref}
      style={{position:"relative", userSelect:"none", width:"100%", height: fullHeight?"100%":"180px", touchAction:"none", cursor: s.dragging?"grabbing":"crosshair"}}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={e => { if (!s.pointers[e.pointerId]) setHov(null); }}
    >
      <svg width="100%" height="100%" style={{display:"block", overflow:"hidden"}}>

        {/* Grid */}
        {ticks.map((tk, i) => (
          <line key={i} x1={PAD_L} x2={W-PAD_R} y1={tk.y} y2={tk.y}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
        ))}

        {/* Y-axis labels */}
        {ticks.map((tk, i) => (
          <text key={i} x={PAD_L-6} y={tk.y+4} textAnchor="end"
            fontSize="9" fill="rgba(255,255,255,0.22)" fontFamily="monospace">
            {tk.price.toFixed(7)}
          </text>
        ))}

        {/* Candles */}
        {vis.map((c, i) => {
          const x   = PAD_L + i*cW + cW/2;
          const up  = c.c >= c.o;
          const col = up ? C.green : C.red;
          const bY  = py(Math.max(c.o, c.c));
          const bH  = Math.max(1.5, Math.abs(py(c.o) - py(c.c)));
          const bW  = Math.max(1.5, cW * 0.72);
          const isH = hov && hov.i === i;
          return (
            <g key={startIdx + i}>
              {isH && <rect x={PAD_L+i*cW} y={PAD_T} width={cW} height={priceH+volH+6}
                fill="rgba(255,255,255,0.025)" rx="1"/>}
              <line x1={x} x2={x} y1={py(c.h)} y2={py(c.l)}
                stroke={col} strokeWidth={Math.max(0.8, cW*0.07)} opacity="0.55"/>
              <rect x={x-bW/2} y={bY} width={bW} height={bH}
                fill={up ? col : "transparent"} stroke={col}
                strokeWidth={Math.max(0.7, cW*0.05)} rx="1"/>
              <rect x={PAD_L+i*cW+1} y={vy(c.v)}
                width={Math.max(1, cW-2)} height={PAD_T+priceH+6+volH - vy(c.v)}
                fill={col} opacity="0.13" rx="1"/>
            </g>
          );
        })}

        {/* Crosshair */}
        {hov && <>
          <line x1={hov.x} x2={hov.x} y1={PAD_T} y2={PAD_T+priceH}
            stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,3"/>
          <line x1={PAD_L} x2={W-PAD_R} y1={py(hov.c.c)} y2={py(hov.c.c)}
            stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3"/>
          <rect x={0} y={py(hov.c.c)-9} width={PAD_L-2} height={18}
            fill="rgba(30,30,32,0.95)" rx="3"/>
          <text x={PAD_L-6} y={py(hov.c.c)+4} textAnchor="end"
            fontSize="9" fill={hov.c.c>=hov.c.o ? C.green : C.red} fontFamily="monospace">
            {hov.c.c.toFixed(7)}
          </text>
        </>}

        {/* VOL label */}
        <text x={PAD_L} y={PAD_T+priceH+14} fontSize="9"
          fill="rgba(255,255,255,0.18)" fontFamily="monospace">VOL</text>

        {/* Candle count pill */}
        <rect x={W-PAD_R-52} y={PAD_T} width={50} height={16} fill="rgba(0,0,0,0.4)" rx="4"/>
        <text x={W-PAD_R-27} y={PAD_T+11} textAnchor="middle"
          fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">
          {visCount} candles
        </text>
      </svg>

      {/* Hover tooltip */}
      {hov && (
        <div style={{
          position:"absolute", top: fullHeight?16:8,
          left:  hov.x > W*0.6 ? undefined : hov.x+14,
          right: hov.x > W*0.6 ? (W-hov.x)+8 : undefined,
          background:"rgba(18,18,20,0.97)", backdropFilter:"blur(20px)",
          border:`1px solid ${C.border}`, borderRadius:10,
          padding:"10px 14px", pointerEvents:"none", zIndex:10, minWidth:116,
        }}>
          <Label size={12} color={hov.c.c>=hov.c.o?C.green:C.red} weight={700}
            style={{display:"block",marginBottom:6}}>
            {hov.c.c>=hov.c.o?"+":""}{(((hov.c.c-hov.c.o)/hov.c.o)*100).toFixed(2)}%
          </Label>
          {[["O",hov.c.o],["H",hov.c.h],["L",hov.c.l],["C",hov.c.c]].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",gap:16,marginTop:3}}>
              <Label size={10} color={C.textTer}>{l}</Label>
              <Label size={10} color={C.textSec} mono>{v.toFixed(7)}</Label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ===== AIRDROP GATE STATUS =====

function AirdropGate({t}) {
  const as=getAS(t);
  const [secs,setSecs]=useState(as.minsLeft?as.minsLeft*60:0);
  useEffect(()=>{if(as.s!=="pending")return;const iv=setInterval(()=>setSecs(x=>Math.max(0,x-1)),1000);return()=>clearInterval(iv);},[as.s]);
  const cfg={
    locked:{color:C.red,bg:C.redBg,bd:C.redBd,label:"Bonding curve filling",sub:`${(t.raisedSOL||0).toFixed(1)} / 85 SOL raised -- rewards unlock at 85 SOL`},
    pending:{color:C.gold,bg:C.goldBg,bd:C.goldBd,label:"Snapshot pending",sub:"Top holder snapshot locks in after anti-snipe delay — 5 min post-graduation, 1hr pre-grad"},
    live:{color:C.green,bg:C.greenBg,bd:C.greenBd,label:"Rewards live — migrated to Raydium",sub:"Quarterly USDC to all holders + quarterly airdrop to all holders"},
  }[as.s];

  return (
    <div style={{background:cfg.bg,border:`1px solid ${cfg.bd}`,borderRadius:8,padding:"16px",marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:cfg.color,flexShrink:0,animation:as.s==="live"?"pulse 2.5s infinite":"none"}}/>
          <div>
            <Label size={13} color={cfg.color} weight={600}>{cfg.label}</Label>
            <div style={{marginTop:2}}><Label size={11} color={C.textTer}>{cfg.sub}</Label></div>
          </div>
        </div>
        {as.s==="pending"&&(
          <div style={{textAlign:"right"}}>
            <Label size={22} color={C.gold} weight={700} mono>{pad2(Math.floor(secs/60))}:{pad2(secs%60)}</Label>
          </div>
        )}
        {as.s==="live"&&(
          <div style={{background:C.green,borderRadius:8,padding:"4px 10px"}}>
            <Label size={11} color="#000" weight={700}>Live</Label>
          </div>
        )}
      </div>
      {as.s!=="live"&&(
        <div style={{marginTop:12}}>
          <div style={{height:2,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
            <div style={{width:`${as.s==="pending"?as.pct:Math.min(100,(t.raisedSOL/85)*100)}%`,height:"100%",borderRadius:99,background:cfg.color,transition:"width 1.5s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
            <Label size={10} color={C.textTer} mono>{as.s==="pending"?`85 SOL filled ${t.minsAgo}m ago`:fmt(t.mcap)}</Label>
            <Label size={10} color={cfg.color}>{as.s==="pending"?`${Math.round(as.pct)}%`:`${85-(t.raisedSOL||0)} SOL left`}</Label>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== WHITELIST STATUS — TOP 15 =====

function WhitelistStatus({whitelisted, inTop10, mcap, volRaw, holdingPct=1.5}) {
  const fired = MC_MILESTONES.filter(m => mcap >= m.mc);
  const next  = MC_MILESTONES.find(m => mcap < m.mc);
  const fmt   = n => n >= 1000 ? `$${(n/1000).toFixed(1)}K` : `$${n.toFixed(2)}`;
  const fmtH  = n => n >= 100 ? `$${Math.round(n)}/hr` : `$${n.toFixed(2)}/hr`;

  const hourlyUSDC = 0;
  const weeklyUSDC = hourlyUSDC * 24 * 7;
  
  const rank       = 0;
  

  if (!whitelisted) return (
    <GlassCard style={{padding:"16px", marginBottom:12}} hover={false}>
      <Label size={13} color={C.textTer} weight={500}>Not in airdrop eligible</Label>
      <div style={{marginTop:4}}>
        <Label size={11} color={C.textQuat}>Hold more to crack airdrop eligible and earn 1% of every trade in USDC each quarter.</Label>
      </div>
    </GlassCard>
  );

  return (
    <GlassCard style={{marginBottom:12, overflow:"hidden"}} hover={false}>
      <div style={{padding:"16px 16px 14px", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <div style={{width:8, height:8, borderRadius:"50%", background:C.gold, animation:"pulse 2s infinite"}}/>
          <Label size={14} color={C.gold} weight={700}>Airdrop</Label>
          {rank <= 15 && <Label size={12} color={C.textTer}>rank #{rank}</Label>}
        </div>
        <div style={{background:"rgba(255,214,10,0.1)", border:"1px solid rgba(255,214,10,0.3)", borderRadius:8, padding:"4px 10px"}}>
          <Label size={11} color={C.gold} weight={600}>{"Earning points"}</Label>
        </div>
      </div>
      <Sep/>
      <div style={{padding:"14px 16px"}}>
        <Label size={11} color={C.textTer} style={{display:"block", marginBottom:10, textTransform:"uppercase", letterSpacing:0.5}}>Your earnings at {holdingPct}% supply</Label>

        {/* Hero hourly */}
        <div style={{padding:"16px", background:"rgba(255,214,10,0.08)", border:"1px solid rgba(255,214,10,0.25)", borderRadius:12, marginBottom:8}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
            <div>
              <Label size={12} color={C.gold} weight={700}>Quarterly USDC</Label>
              <div style={{marginTop:3}}><Label size={10} color={C.textTer}>1% of all trades on this token → airdrop eligible</Label></div>
              <div style={{marginTop:2}}><Label size={10} color={C.textTer}>proportional by holding % · auto each quarter</Label></div>
            </div>
            <div style={{textAlign:"right"}}>
              <Label size={24} color={C.gold} weight={700} style={{display:"block"}}>{fmtH(hourlyUSDC)}</Label>
              <Label size={11} color={C.textTer}>{fmt(hourlyUSDC*24)}/day</Label>
            </div>
          </div>
        </div>

        {/* Vault + weekly */}
        <div style={{display:"flex", gap:8}}>
          <div style={{flex:1, padding:"10px 12px", background:"rgba(255,159,10,0.06)", border:"1px solid rgba(255,159,10,0.2)", borderRadius:10}}>
            <Label size={10} color={C.accent} style={{display:"block", marginBottom:3}}>Vault tokens/day</Label>
            <Label size={15} color={C.accent} weight={700}>{"0.00"}</Label>
          </div>
          <div style={{flex:1, padding:"10px 12px", background:"rgba(255,214,10,0.06)", border:"1px solid rgba(255,214,10,0.2)", borderRadius:10}}>
            <Label size={10} color={C.gold} style={{display:"block", marginBottom:3}}>Weekly USDC</Label>
            <Label size={15} color={C.gold} weight={700}>{fmt(weeklyUSDC)}</Label>
          </div>
        </div>
      </div>
      <Sep/>
      <div style={{padding:"10px 16px"}}>
        <div style={{display:"flex", gap:2, height:3, borderRadius:99, overflow:"hidden", marginBottom:5}}>
          {MC_MILESTONES.map((m,i) => (
            <div key={i} style={{flex:1, background:mcap>=m.mc?C.gold:"rgba(255,255,255,0.08)", borderRadius:1, transition:"background 0.3s"}}/>
          ))}
        </div>
        <div style={{display:"flex", justifyContent:"space-between"}}>
          <Label size={10} color={C.textTer} mono>{fired.length}/{MC_MILESTONES.length} milestones</Label>
          {next && <Label size={10} color={C.textTer}>Next: <span style={{color:C.text}}>{next.label}</span></Label>}
        </div>
      </div>
    </GlassCard>
  );
}


// ===== TOP 15 EARNINGS PANEL =====

function CommunityEarnings({mcap, volRaw, holdingPct}) {
  const fmt  = n => n >= 1000 ? `$${(n/1000).toFixed(1)}K` : `$${n.toFixed(2)}`;
  const fmtH = n => n >= 100 ? `$${Math.round(n)}/hr` : n >= 1 ? `$${n.toFixed(2)}/hr` : `$${n.toFixed(3)}/hr`;
  const hourlyPool = ((volRaw||0) * FEE_AIRDROP) / 24;
  const myHourly   = 0;
  

  return (
    <div style={{marginBottom:12}}>
      {/* Hero pool size */}
      <div style={{padding:"14px 16px", background:"rgba(255,214,10,0.06)", border:"1px solid rgba(255,214,10,0.25)", borderRadius:8, marginBottom:8}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <Label size={12} color={C.gold} weight={700}>Quarterly Airdrop Pool</Label>
            <Label size={11} color={C.textTer} style={{display:"block", marginTop:2}}>1% of every trade → 15 wallets · each quarter · automatic</Label>
          </div>
          <div style={{textAlign:"right"}}>
            <Label size={22} color={C.gold} weight={700} style={{display:"block"}}>{fmtH(hourlyPool)}</Label>
            <Label size={10} color={C.textTer}>{fmt(hourlyPool*24)}/day</Label>
          </div>
        </div>
      </div>

      {/* Airdrop leaderboard */}
      <div style={{background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden", marginBottom:8}}>
        <div style={{padding:"12px 16px 10px", display:"flex", justifyContent:"space-between"}}>
          <Label size={12} color={C.text} weight={600}>Live earnings — airdrop eligible</Label>
          <Label size={11} color={C.textTer}>at current volume</Label>
        </div>
        <div style={{borderTop:`1px solid ${C.border}`}}>
        </div>
      </div>

      {/* Your position callout */}
      {false ? (
        <div style={{padding:"10px 14px", background:"rgba(255,59,48,0.06)", border:"1px solid rgba(255,59,48,0.2)", borderRadius:10}}>
          <Label size={12} color={C.red} weight={600}>Not in airdrop eligible</Label>
          <Label size={11} color={C.textTer} style={{display:"block", marginTop:2}}>
          </Label>
        </div>
      ) : (
        <div style={{padding:"10px 14px", background:"rgba(255,214,10,0.06)", border:"1px solid rgba(255,214,10,0.2)", borderRadius:10}}>
          <div style={{display:"flex", justifyContent:"space-between"}}>
            <Label size={12} color={C.gold} weight={600}>Your cut each quarter</Label>
            <Label size={14} color={C.gold} weight={700}>{fmtH(myHourly)}</Label>
          </div>
          <Label size={11} color={C.textTer} style={{display:"block", marginTop:2}}>{fmt(myHourly*24)}/day · {fmt(myHourly*24*7)}/week · no action needed</Label>
        </div>
      )}
    </div>
  );
}


// ===== DRIP CONFIG =====

function DripConfig({t}) {
  const [mode,setMode]=useState("token");
  const [freq,setFreq]=useState("4h");
  const [lock,setLock]=useState(0);
  const lb=LOCK_OPTIONS.find(o=>o.days===lock)?.boost||0;
  const mil=MILESTONES[getMI(t.mcap)];

  const MODES=[
    {v:"token",   l:"Receive token",  sub:"Get paid in the coin you hold. Stack compounds.",         c:C.accent,  icon:"[token]"},
    {v:"reinject",l:"Reinject (USDC→token)",       sub:"USDC swapped via Jupiter, auto-buys the chart. +10% bonus. Creates real buy pressure.",          c:C.green,   icon:"↺"},
    {v:"usdc",    l:"USDC",           sub:"Take stable profit without selling your position.",        c:C.purple,  icon:"[usdc]"},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Reward mode */}
      <GlassCard hover={false}>
        <div style={{padding:"14px 16px 12px"}}>
          <Label size={13} color={C.text} weight={600}>Payout mode</Label>
          <div style={{marginTop:2}}><Label size={11} color={C.textTer}>How your daily drip is paid -- snapshot every 24hrs</Label></div>
        </div>
        <Sep/>
        <div style={{padding:"12px",display:"flex",flexDirection:"column",gap:8}}>
          {MODES.map(opt=>(
            <button key={opt.v} onClick={()=>setMode(opt.v)} style={{width:"100%",padding:"12px 14px",borderRadius:11,border:`1.5px solid ${mode===opt.v?opt.c+"66":C.border}`,background:mode===opt.v?`${opt.c}12`:"transparent",cursor:"pointer",textAlign:"left",transition:"all 0.15s",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:28,height:28,borderRadius:8,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Label size={11} color={opt.c} weight={700}>{opt.v==="token"?"T":opt.v==="reinject"?"R":"$"}</Label></div>
              <div style={{flex:1}}>
                <Label size={13} color={mode===opt.v?opt.c:C.textSec} weight={600}>{opt.l}</Label>
                <div style={{marginTop:2}}><Label size={10} color={C.textTer}>{opt.sub}</Label></div>
              </div>
              {mode===opt.v&&<div style={{width:8,height:8,borderRadius:"50%",background:opt.c,flexShrink:0}}/>}
            </button>
          ))}
        </div>
        {mode==="usdc"&&<div style={{margin:"0 12px 12px",padding:"10px 12px",background:C.purpleBg,border:`1px solid ${C.purpleBd}`,borderRadius:10}}><Label size={11} color={C.purple}>15% haircut: 10% burned forever, 5% back to weekly pool. 48hr lock. Reduces token supply permanently.</Label></div>}
        {mode==="reinject"&&<div style={{margin:"0 12px 12px",padding:"10px 12px",background:C.greenBg,border:`1px solid ${C.greenBd}`,borderRadius:10}}><Label size={11} color={C.green}>Your USDC drip is swapped to {t.sym} via Jupiter — real market buy, pushes the chart. +10% bonus on top. Your bag locks 72hrs.</Label></div>}
        {mode==="token"&&<div style={{margin:"0 12px 12px",padding:"10px 12px",background:C.accentBg,border:`1px solid ${C.accentBd}`,borderRadius:10}}><Label size={11} color={C.accent}>You receive {t.sym} tokens directly. Your % of supply increases every day you stay in top 10.</Label></div>}
      </GlassCard>

      {/* Claim rules info */}
      <GlassCard hover={false}>
        <div style={{padding:"14px 16px 12px"}}>
          <Label size={13} color={C.text} weight={600}>Claim rules</Label>
          <div style={{marginTop:2}}><Label size={11} color={C.textTer}>Weekly snapshot every 7 days -- must hold top 10 all week</Label></div>
        </div>
        <Sep/>
        <div style={{padding:"12px",display:"flex",flexDirection:"column",gap:6}}>
          {CLAIM_MODES.map(o=>(
            <div key={o.v} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`}}>
              <div style={{width:24,height:24,borderRadius:7,background:`${o.col}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Label size={10} color={o.col} weight={700}>{o.icon}</Label>
              </div>
              <div style={{flex:1}}>
                <Label size={12} color={C.text} weight={600}>{o.label}</Label>
                <div style={{marginTop:2}}><Label size={10} color={C.textTer}>{o.desc}</Label></div>
              </div>
              <div style={{padding:"2px 8px",borderRadius:20,background:`${o.col}18`,border:`1px solid ${o.col}33`}}>
                <Label size={9} color={o.col} weight={600}>{o.lock}</Label>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Lockup */}
      <GlassCard hover={false}>
        <div style={{padding:"14px 16px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <Label size={13} color={C.text} weight={600}>Lockup boost</Label>
            <div style={{marginTop:2}}><Label size={11} color={C.textTer}>Lock longer to earn more</Label></div>
          </div>
          {lock>0&&<Label size={13} color={C.accent} weight={600}>+{(lb*100).toFixed(0)}%</Label>}
        </div>
        <Sep/>
        <div style={{padding:"12px",display:"flex",gap:6}}>
          {LOCK_OPTIONS.map(o=>(
            <button key={o.days} onClick={()=>setLock(o.days)} style={{flex:1,padding:"10px 4px",borderRadius:10,border:`1px solid ${lock===o.days?C.accent+"55":C.border}`,background:lock===o.days?C.accentBg:"transparent",cursor:"pointer",textAlign:"center",transition:"all 0.15s"}}>
              <Label size={12} color={lock===o.days?C.accent:C.textSec} weight={600}>{o.label}</Label>
              {o.boost>0&&<div style={{marginTop:2}}><Label size={9} color={C.textTer}>+{(o.boost*100).toFixed(0)}%</Label></div>}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Summary */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",background:C.card,borderRadius:8,border:`1px solid ${C.border}`}}>
        <Label size={13} color={C.textSec}>Your effective multiplier</Label>
        <Label size={22} color={C.accent} weight={700}>{(mil.multi+lb).toFixed(2)}x</Label>
      </div>
    </div>
  );
}

// ===== SWAP PANEL =====

// Mirrors the on-chain max_tokens_for_window from curve.rs exactly
const BONDING_SUPPLY_UI = 650_000_000; // 650M tokens (display units, no decimals)
function getLaunchCap(elapsedMins) {
  if(elapsedMins<7)  return {bps:150, pct:"1.5%", label:"0–7 min",  col:"#f43f5e", next:7};
  if(elapsedMins<14) return {bps:200, pct:"2%",   label:"7–14 min", col:"#fb923c", next:14};
  if(elapsedMins<30) return {bps:500, pct:"5%",   label:"14–30 min",col:"#facc15", next:30};
  return               {bps:10000,pct:"Open",label:"30 min+",  col:"#22c55e", next:null};
}
function capTokens(bps) { return Math.floor(BONDING_SUPPLY_UI * bps / 10000); }
// Very rough: how much SOL buys X tokens at current point on curve (linear approx for UI)
function tokensToSolApprox(tokens, mcap) { return (tokens/BONDING_SUPPLY_UI) * (mcap/180) * 0.55; }

function CapBar({elapsedMins, myHolding, tokensOut, graduated}) {
  if(graduated) return null;
  const cw = getLaunchCap(elapsedMins);
  if(cw.bps===10000) return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:8,marginBottom:10}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:C.green,flexShrink:0}}/>
      <Label size={11} color={C.green}>Launch caps lifted — open trading</Label>
    </div>
  );

  const maxTok    = capTokens(cw.bps);
  const afterBuy  = myHolding + (tokensOut||0);
  const remaining = Math.max(0, maxTok - myHolding);
  const wouldExceed = tokensOut>0 && afterBuy > maxTok;
  const usedPct   = Math.min(100, (myHolding/maxTok)*100);
  const willUsePct= Math.min(100, (afterBuy/maxTok)*100);
  const minsLeft  = cw.next ? cw.next - elapsedMins : 0;

  return (
    <div style={{background:wouldExceed?"rgba(244,63,94,0.06)":"rgba(255,255,255,0.03)",border:`1px solid ${wouldExceed?C.redBd:C.border}`,borderRadius:10,padding:"11px 14px",marginBottom:10}}>
      {/* Header row */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:cw.col,flexShrink:0}}/>
          <Label size={11} color={cw.col} weight={600}>Launch cap — {cw.pct} window</Label>
          <Label size={10} color={C.textTer}>({cw.label})</Label>
        </div>
        {minsLeft>0&&<Label size={10} color={C.textTer} mono>opens in {minsLeft}m</Label>}
      </div>

      {/* Progress bar */}
      <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden",marginBottom:7,position:"relative"}}>
        {/* current holding */}
        <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${usedPct}%`,background:cw.col,opacity:0.6,borderRadius:99,transition:"width 0.4s ease"}}/>
        {/* this buy on top */}
        {tokensOut>0&&<div style={{position:"absolute",left:0,top:0,height:"100%",width:`${Math.min(100,willUsePct)}%`,background:wouldExceed?C.red:cw.col,borderRadius:99,transition:"width 0.3s ease"}}/>}
      </div>

      {/* Stats */}
      <div style={{display:"flex",justifyContent:"space-between"}}>
        <div>
          <Label size={10} color={C.textTer} style={{display:"block",marginBottom:1}}>You hold</Label>
          <Label size={12} color={C.text} weight={500} mono>{myHolding.toLocaleString()} / {maxTok.toLocaleString()}</Label>
        </div>
        <div style={{textAlign:"right"}}>
          <Label size={10} color={C.textTer} style={{display:"block",marginBottom:1}}>Remaining cap</Label>
          <Label size={12} color={remaining===0?C.red:C.green} weight={600} mono>
            {remaining.toLocaleString()} tokens
          </Label>
        </div>
      </div>

      {/* Exceed warning */}
      {wouldExceed&&(
        <div style={{marginTop:8,padding:"7px 10px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:7}}>
          <Label size={11} color={C.red} weight={600}>
            🚫 Exceeds cap by {(afterBuy-maxTok).toLocaleString()} tokens — on-chain buy will fail
          </Label>
          <Label size={11} color={C.textTer} style={{display:"block",marginTop:2}}>
            Max you can buy right now: ~{tokensToSolApprox(remaining,t?.mcap||0).toFixed(3)} SOL worth
          </Label>
        </div>
      )}
    </div>
  );
}

function SwapPanel({t,connected,onConnect}) {
  const [tab,setTab]=useState("buy");
  const [amt,setAmt]=useState("");
  const [lock,setLock]=useState(0);
  const [showLock,setShowLock]=useState(false);
  const [done,setDone]=useState(false);
  const [loading,setLoading]=useState(false);
  const sol=parseFloat(amt)||0;
  const impact=sol>0?calcImpact(t.mcap,sol,tab==="buy"):null;
  const cw=getLaunchCap(t.elapsed||0);
  const lb=LOCK_OPTIONS.find(o=>o.days===lock)?.boost||0;

  // Simulated: how many tokens this buy would give (rough, for cap bar)
  const tokensOut = tab==="buy"&&sol>0 ? Math.floor(sol*180/t.mcap*BONDING_SUPPLY_UI*0.55) : 0;
  // Simulated: current holding (0 for demo — in prod this comes from wallet ATA)
  const myHolding = 0;
  const capTokensMax = capTokens(cw.bps);
  const wouldExceed = tab==="buy" && !t.graduated && cw.bps<10000 && (myHolding+tokensOut)>capTokensMax;

  if(done) return (
    <div style={{textAlign:"center",padding:"32px 16px",animation:"scaleIn 0.2s ease"}}>
      <div style={{width:52,height:52,borderRadius:8,background:C.greenBg,border:`1px solid ${C.greenBd}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3.5 10L8 14.5L16.5 5.5" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
      <Label size={17} color={C.text} weight={600} style={{display:"block",marginBottom:6}}>Confirmed</Label>
      <Label size={13} color={C.textSec} style={{display:"block",lineHeight:1.6,marginBottom:20}}>Hold your position. Top 10 at the $500K snapshot get whitelisted for drips.</Label>
      <Btn onClick={()=>{setDone(false);setAmt("");}} full>Done</Btn>
    </div>
  );

  return (
    <div>
      {/* Buy/Sell toggle */}
      <div style={{display:"flex",background:"rgba(255,255,255,0.05)",borderRadius:13,padding:3,marginBottom:18}}>
        {["buy","sell"].map(s=>(
          <button key={s} onClick={()=>{setTab(s);setAmt("");}} style={{flex:1,height:38,borderRadius:10,border:"none",background:tab===s?"rgba(255,255,255,0.1)":"transparent",color:tab===s?(s==="buy"?C.green:C.red):C.textTer,fontSize:14,fontWeight:tab===s?600:400,cursor:"pointer",transition:"all 0.12s",textTransform:"capitalize",letterSpacing:"-0.02em"}}>
            {s}
          </button>
        ))}
      </div>

      {/* Amount presets */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        {(tab==="buy"?["0.1","0.5","1","5"]:["25%","50%","100%"]).map(v=>(
          <button key={v} onClick={()=>setAmt(v.replace("%",""))} style={{flex:1,height:32,borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.textTer,fontSize:12,fontWeight:500,cursor:"pointer"}}>
            {v}{tab==="buy"?" SOL":""}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{position:"relative",marginBottom:10}}>
        <input value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00"
          style={{width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${wouldExceed?C.redBd:C.border}`,borderRadius:8,padding:"16px 52px 16px 18px",color:C.text,fontSize:20,fontWeight:400,outline:"none",boxSizing:"border-box",transition:"border-color 0.15s",fontVariantNumeric:"tabular-nums"}}
          onFocus={e=>{e.target.style.borderColor=C.borderHi;}}
          onBlur={e=>{e.target.style.borderColor=wouldExceed?C.redBd:C.border;}}/>
        <div style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)"}}>
          <Label size={13} color={C.textTer} weight={500}>{tab==="buy"?"SOL":"TKN"}</Label>
        </div>
      </div>

      {/* Launch cap bar */}
      {tab==="buy"&&<CapBar elapsedMins={t.elapsed||0} myHolding={myHolding} tokensOut={tokensOut} graduated={t.graduated} t={t}/>}

      {/* Impact details */}
      {impact&&sol>0&&(
        <div style={{background:C.sheet,borderRadius:12,padding:"12px 14px",marginBottom:10,border:`1px solid ${parseFloat(impact.impact)>5?C.redBd:C.border}`}}>
          {[["Price impact",`${impact.impact}%`,parseFloat(impact.impact)>5?C.red:C.textTer],["Fee",`${impact.fee} SOL`,C.textTer],["You receive",tab==="buy"?`~${Number(impact.recv).toLocaleString()} tokens`:`~${impact.recv} SOL`,C.text]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <Label size={12} color={C.textTer}>{l}</Label>
              <Label size={12} color={c} weight={500} mono>{v}</Label>
            </div>
          ))}
        </div>
      )}

      {/* Web-only notice */}
      {!t.graduated&&(
        <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",background:C.purpleBg,border:`1px solid ${C.purpleBd}`,borderRadius:10,marginBottom:10}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:C.purple,flexShrink:0,marginTop:4}}/>
          <Label size={11} color={C.purple}>Web-only swap. Jupiter and Jito bundles are blocked during the bonding curve phase.</Label>
        </div>
      )}

      {/* Lockup toggle (buy only) */}
      {tab==="buy"&&(
        <div style={{marginBottom:10}}>
          <button onClick={()=>setShowLock(x=>!x)} style={{width:"100%",background:"transparent",border:`1px solid ${C.border}`,borderRadius:11,padding:"11px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:showLock?8:0}}>
            <Label size={13} color={C.textSec}>Lockup boost</Label>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {lock>0&&<Label size={13} color={C.accent} weight={600}>+{(lb*100).toFixed(0)}%</Label>}
              <Label size={13} color={C.textTer}>{showLock?"-":"+"}</Label>
            </div>
          </button>
          {showLock&&(
            <div style={{display:"flex",gap:6}}>
              {LOCK_OPTIONS.map(o=>(
                <button key={o.days} onClick={()=>setLock(o.days)} style={{flex:1,padding:"8px 4px",borderRadius:9,border:`1px solid ${lock===o.days?C.accent+"55":C.border}`,background:lock===o.days?C.accentBg:"transparent",cursor:"pointer",textAlign:"center"}}>
                  <Label size={12} color={lock===o.days?C.accent:C.textTer} weight={600}>{o.label}</Label>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Btn onClick={()=>{if(!connected){onConnect();return;}if(wouldExceed)return;setLoading(true);(async()=>{try{const provider=window?.solana;const mintPk=new (await import('@solana/web3.js')).PublicKey(t.mint||t.id);const tx=await buildSwapTx(provider.publicKey,mintPk,parseFloat(amt),tab==="buy");tx.feePayer=provider.publicKey;const {blockhash}=await connection.getLatestBlockhash();tx.recentBlockhash=blockhash;const signed=await provider.signTransaction(tx);const sig=await connection.sendRawTransaction(signed.serialize());await connection.confirmTransaction(sig);setDone(true);}catch(e){console.error(e);alert(e.message);}finally{setLoading(false);}})();}} full color={tab==="buy"?C.green:C.red} loading={loading} disabled={!amt||wouldExceed}>
        {!connected?"Connect wallet":wouldExceed?"Exceeds launch cap":`${tab==="buy"?"Buy":"Sell"}${amt?` ${amt} ${tab==="buy"?"SOL":"tokens"}`:""}`}
      </Btn>
    </div>
  );
}

// ===== TOKEN CARD =====

function Card({t,onClick,rank}) {
  const p=PALETTES[t.pi%8],up=t.chg>0,as=getAS(t);
  const spark=Array.from({length:20},(_,i)=>Math.max(0.3,0.5+Math.sin(i*0.4+t.pi)*0.3+Math.random()*0.4));
  const rankColor = rank===1?C.gold:rank<=3?"rgba(255,255,255,0.5)":"rgba(255,255,255,0.18)";
  return (
    <GlassCard onClick={()=>onClick(t)} style={{padding:"18px 20px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          {/* Rank number */}
          <div style={{width:22,flexShrink:0,textAlign:"center"}}>
            <Label size={rank<=3?15:13} color={rankColor} weight={700} mono>{rank}</Label>
          </div>
          <Avatar sym={t.sym} pi={t.pi} size={42}/>
          <div>
            <Label size={16} color={C.text} weight={600}>{t.sym}</Label>
            <div style={{marginTop:2}}><Label size={12} color={C.textTer} weight={400}>{t.name}</Label></div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <Label size={17} color={C.text} weight={600}>{fmt(t.mcap)}</Label>
          <div style={{marginTop:3}}><Label size={13} color={up?C.green:C.red} weight={500}>{up?"+":""}{t.chg.toFixed(1)}%</Label></div>
        </div>
      </div>

      <div style={{marginBottom:10,display:"flex",justifyContent:"flex-end"}}>
        <Spark data={spark} color={up?C.green:C.red}/>
      </div>

      <Label size={12} color={C.textTer} style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:t.topicLocked?0:10}}>{t.desc}</Label>

      {t.topicLocked&&<TopicChip source={t.topicSource} title={t.topicTitle}/>}

      {(t.volRaw||0)>0&&(
        <div style={{marginTop:10,display:"flex",alignItems:"center",gap:6,padding:"6px 10px",
          background:"rgba(10,132,255,0.06)",border:`1px solid rgba(10,132,255,0.2)`,borderRadius:9}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:C.blue,flexShrink:0}}/>
          <Label size={11} color={C.blue} weight={600}>
            {"0.3% holder ~$"+((0).toFixed(2))+"/hr USDC"}
          </Label>
        </div>
      )}
      <div style={{display:"flex",gap:5,marginTop:8,flexWrap:"wrap",alignItems:"center"}}>
        <Tag color={p.a}>{t.vol}</Tag>
        <Tag color={C.textTer}>{t.holders.toLocaleString()} holders</Tag>
        {as.s==="live"&&<Tag color={C.green}>Rewards live</Tag>}
        {as.s==="pending"&&<Tag color={C.gold}>Snapshot {as.minsLeft}m</Tag>}
        {t.graduated&&<Tag color={C.raydium}>On Raydium</Tag>}
        {t.bondingFull&&!t.graduated&&<Tag color={C.accent}>Bonded</Tag>}
        {(t.raisedSOL||0)>=60&&!t.bondingFull&&<Tag color={C.purple}>Near grad</Tag>}
      </div>

      {/* Bonding bar for non-graduated tokens */}
      {!t.graduated&&(
        <div style={{marginTop:12}}>
          <div style={{height:2,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
            <div style={{width:`${Math.min(100,((t.raisedSOL||0)/85)*100)}%`,height:"100%",background:t.bondingFull?C.green:(t.raisedSOL||0)>=60?C.purple:p.a,borderRadius:99,transition:"width 1s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
            <Label size={10} color={C.textQuat} mono>{t.raisedSOL||0} / 85 SOL</Label>
            <Label size={10} color={C.textQuat}>{t.bondingFull?"bonded":`${85-(t.raisedSOL||0)} SOL left`}</Label>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

// ===== GRADUATION MODAL =====

function GraduationModal({t,onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(30px)",animation:"fadeIn 0.2s ease"}} onClick={onClose}>
      <div style={{background:C.sheet,borderRadius:10,padding:"28px 24px",textAlign:"center",maxWidth:320,width:"92%",border:`1px solid ${C.border}`,boxShadow:"0 40px 80px rgba(0,0,0,0.6)",animation:"scaleIn 0.22s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:56,height:56,borderRadius:8,background:C.raydiumBg,border:`1px solid ${C.raydiumBd}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 11L9 16L18 6" stroke={C.raydium} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
        <Label size={20} color={C.text} weight={700} style={{display:"block",marginBottom:6}}>Graduated</Label>
        <Label size={13} color={C.textSec} style={{display:"block",lineHeight:1.6,marginBottom:20}}>LP locked on Raydium. Auto-submitted to Dexscreener. All fees now compound to LP forever.</Label>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <Btn full color={C.raydium}>View on Raydium</Btn>
          <Btn full color={C.teal}>View on Dexscreener</Btn>
          <Btn full variant="ghost" onClick={onClose}>Back</Btn>
        </div>
      </div>
    </div>
  );
}

// ===== DEX BADGE =====

function DexBadge({sym}) {
  const [dex,setDex]=useState(null);
  useEffect(()=>{setTimeout(()=>setDex(MOCK_DEX[sym]||null),600);},[sym]);
  if(!dex) return null;
  const up=dex.chg24.startsWith("+");
  return (
    <GlassCard style={{padding:"14px 16px",marginBottom:12}} hover={false}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:32,height:32,borderRadius:9,background:C.tealBg,border:`1px solid ${C.tealBd}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:C.teal}}/>
        </div>
        <div style={{flex:1}}>
          <Label size={12} color={C.teal} weight={600} style={{display:"block",marginBottom:5}}>Dexscreener</Label>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            {[["Price",`$${dex.price}`],["24h",dex.chg24+"%"],["Vol",dex.vol24],["Liq",dex.liq]].map(([l,v])=>(
              <div key={l}>
                <Label size={10} color={C.textTer}>{l} </Label>
                <Label size={11} color={l==="24h"?up?C.green:C.red:C.text} weight={500} mono>{v}</Label>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ===== FULL TOKEN PAGE =====

function TokenPage({t,onClose,connected,onConnect}) {
  const [range,setRange]=useState("1H");
  const [rightTab,setRightTab]=useState("swap");
  const [candles]=useState(()=>genCandles(80,0.00004+Math.random()*0.0001));
  const p=PALETTES[t.pi%8],up=t.chg>0,mi=getMI(t.mcap),mil=MILESTONES[mi],as=getAS(t);
  const myPos=MY_POSITIONS.find(pos=>pos.sym===t.sym);

  return (
    <div style={{height:"100vh",maxHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{FONT}</style>
      <style>{`
        .tp-body { display:flex; flex:1; overflow:hidden; height:calc(100vh - 52px); }
        .tp-chart { flex:1; display:flex; flex-direction:column; overflow:hidden; border-right:1px solid ${C.border}; min-width:0; }
        .tp-sidebar { width:340px; display:flex; flex-direction:column; overflow:hidden; flex-shrink:0; }
        @media (max-width: 700px) {
          .tp-body { flex-direction:column; overflow-y:auto; height:auto; }
          .tp-chart { border-right:none; border-bottom:1px solid ${C.border}; min-height:320px; height:320px; flex-shrink:0; }
          .tp-sidebar { width:100%; }
        }
      `}</style>

      {/* TOP NAV */}
      <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(0,0,0,0.9)",backdropFilter:"blur(30px)",borderBottom:`1px solid ${C.border}`,padding:"0 20px",height:52,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,0.07)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
          <svg width="10" height="17" viewBox="0 0 10 17" fill="none"><path d="M8.5 1.5L1.5 8.5L8.5 15.5" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <Avatar sym={t.sym} pi={t.pi} size={32}/>
        <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:10}}>
          <Label size={16} color={C.text} weight={700}>{t.sym}</Label>
          <Label size={12} color={C.textTer}>{t.name}</Label>
          {t.topicLocked&&<div style={{background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:6,padding:"2px 8px"}}><Label size={10} color={C.teal}>{t.topicSource} -- {t.topicTitle?.slice(0,36)}</Label></div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          {/* Social links */}
          {t.tw&&(
            <a href={`https://x.com/${t.tw}`} target="_blank" rel="noopener noreferrer"
              style={{width:28,height:28,borderRadius:8,background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none",transition:"background 0.12s"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.12)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(255,255,255,0.6)"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          )}
          {t.tg&&(
            <a href={`https://t.me/${t.tg}`} target="_blank" rel="noopener noreferrer"
              style={{width:28,height:28,borderRadius:8,background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none",transition:"background 0.12s"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.12)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(255,255,255,0.6)"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            </a>
          )}
          {t.web&&(
            <a href={`https://${t.web}`} target="_blank" rel="noopener noreferrer"
              style={{width:28,height:28,borderRadius:8,background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",textDecoration:"none",transition:"background 0.12s"}}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.12)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </a>
          )}
          <div style={{width:1,height:24,background:C.border,marginLeft:4}}/>
          <div style={{textAlign:"right"}}>
            <Label size={17} color={C.text} weight={700}>0.000{(t.mcap/1e9).toFixed(3)}</Label>
            <div><Label size={12} color={up?C.green:C.red} weight={500}>{up?"+":""}{t.chg.toFixed(1)}%</Label><Label size={12} color={C.textTer} style={{marginLeft:6}}>{fmt(t.mcap)} MC</Label></div>
          </div>
        </div>
      </div>

      {/* BODY: chart left, sidebar right */}
      <div className="tp-body">

        {/* LEFT - CHART COLUMN */}
        <div className="tp-chart">

          {/* Chart header */}
          <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            <div>
              <Label size={26} color={C.text} weight={700}>0.000{(t.mcap/1e9).toFixed(3)}</Label>
              <Label size={13} color={up?C.green:C.red} weight={500} style={{marginLeft:8}}>{up?"+":""}{t.chg.toFixed(1)}% 24h</Label>
            </div>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              {["5M","15M","1H","4H","1D"].map(r=>(
                <button key={r} onClick={()=>setRange(r)} style={{height:26,padding:"0 8px",borderRadius:7,border:`1px solid ${range===r?C.borderMd:C.border}`,background:range===r?C.sheet:"transparent",color:range===r?C.text:C.textTer,fontSize:11,fontWeight:range===r?600:400,cursor:"pointer"}}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Big chart - fills all remaining height */}
          <div style={{flex:1,minHeight:0,position:"relative",padding:"0"}}>
            <div style={{position:"absolute",inset:0,padding:"8px 4px 0"}}>
              <CandleChart candles={candles} color={p.a} fullHeight/>
            </div>
          </div>

          {/* Chart footer stats */}
          <div style={{borderTop:`1px solid ${C.border}`,padding:"10px 16px",display:"flex",gap:0,flexShrink:0,background:"rgba(0,0,0,0.4)"}}>
            {[["Volume",t.vol],["Txns",t.txs.toLocaleString()],["Holders",t.holders.toLocaleString()],["Multiplier",`${mil.multi}x`],["Age",`${t.age}d`],["Raised",`${t.raisedSOL||0}/${t.raisedSOLMax||85} SOL`]].map((s,i,a)=>(
              <div key={s[0]} style={{flex:1,paddingRight:i<a.length-1?12:0,borderRight:i<a.length-1?`1px solid ${C.border}`:"none",paddingLeft:i>0?12:0}}>
                <Label size={10} color={C.textTer} style={{display:"block",marginBottom:3,letterSpacing:0.3}}>{s[0]}</Label>
                <Label size={12} color={C.text} weight={500}>{s[1]}</Label>
              </div>
            ))}
          </div>

          {/* Bonding bar */}
          <div style={{padding:"10px 16px",borderTop:`1px solid ${C.border}`,flexShrink:0,background:"rgba(0,0,0,0.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <Label size={11} color={C.textTer}>Bonding curve</Label>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Label size={12} color={p.a} weight={600}>{t.prog}%</Label>
                {t.graduated&&<div style={{background:C.raydiumBg,border:`1px solid ${C.raydiumBd}`,borderRadius:6,padding:"2px 8px"}}><Label size={10} color={C.raydium}>LP locked forever</Label></div>}
              </div>
            </div>
            <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
              <div style={{width:`${t.prog}%`,height:"100%",borderRadius:99,background:`linear-gradient(90deg,${p.a},${p.b})`,boxShadow:`0 0 10px ${p.glow}`,transition:"width 0.5s ease"}}/>
            </div>
          </div>
        </div>

        {/* RIGHT - SIDEBAR */}
        <div className="tp-sidebar">

          {/* Position card - always visible at top */}
          {myPos&&(
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,background:myPos.pnlPct>=0?"rgba(48,209,88,0.05)":"rgba(255,69,58,0.05)",flexShrink:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <Label size={10} color={C.textTer} style={{display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:0.4}}>Your position</Label>
                  <Label size={15} color={C.text} weight={600}>{myPos.held.toLocaleString()} {t.sym}</Label>
                </div>
                <div style={{textAlign:"right"}}>
                  <Label size={20} color={myPos.pnlPct>=0?C.green:C.red} weight={700}>{myPos.pnlPct>=0?"+":""}{myPos.pnlPct}%</Label>
                  <div><Label size={10} color={C.textTer}>P&L</Label></div>
                </div>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {myPos.whitelisted&&<Tag color={C.green}>Whitelisted</Tag>}
                {myPos.inTop10&&<Tag color={C.accent}>Top 10</Tag>}
                {myPos.pendingDrip>0&&as.s==="live"&&<Tag color={C.gold}>{myPos.pendingDrip} SOL drip pending</Tag>}
              </div>
            </div>
          )}

          {/* Airdrop gate - always visible if relevant */}
          {t.bondingFull&&(
            <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:"rgba(255,214,10,0.04)"}}>
              <AirdropGate t={t}/>
            </div>
          )}

          {/* Right tab bar */}
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            {["swap","drip","holders"].map(tb=>(
              <button key={tb} onClick={()=>setRightTab(tb)}
                style={{flex:1,height:40,border:"none",background:"transparent",color:rightTab===tb?C.text:C.textTer,
                  fontSize:12,fontWeight:rightTab===tb?600:400,cursor:"pointer",
                  textTransform:"capitalize",letterSpacing:"-0.01em",
                  borderBottom:rightTab===tb?`2px solid ${C.accent}`:"2px solid transparent",
                  transition:"all 0.12s"}}>
                {tb}
              </button>
            ))}
          </div>

          {/* Right tab content - scrollable */}
          <div style={{flex:1,overflowY:"auto",padding:"14px"}}>

            {/* SWAP */}
            {rightTab==="swap"&&(
              <div style={{animation:"fadeUp 0.15s ease"}}>
                <SwapPanel t={t} connected={connected} onConnect={onConnect}/>
                <div style={{marginTop:12,padding:"12px 14px",background:C.card,borderRadius:8,border:`1px solid ${C.border}`}}>
                  <Label size={10} color={C.textTer} style={{display:"block",marginBottom:10,letterSpacing:0.4,textTransform:"uppercase"}}>Whitelist eligibility</Label>
                  {[{n:"1",t:"Bonding curve fills at 85 SOL"},{n:"2",t:"5-min anti-snipe delay post-graduation (1hr during bonding phase)"},{n:"3",t:"LP migrates to Raydium — locked forever, compounds on every trade"},{n:"4",t:"1.5% total fee — 0.25% goes to quarterly USDC airdrop pool"},{n:"5",t:"USDC lands in your wallet automatically — no staking, no claiming"},{n:"6",t:"Points = Avg Balance x Time Multiplier + Trade Volume x 0.001"},{n:"7",t:"Top 10 above $500K: quarterly USDC airdrop based on points balance"}].map(r=>(
                    <div key={r.n} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8}}>
                      <div style={{width:18,height:18,borderRadius:5,background:C.accentBg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                        <Label size={9} color={C.accent} weight={700}>{r.n}</Label>
                      </div>
                      <Label size={12} color={C.textSec} style={{lineHeight:1.5}}>{r.t}</Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DRIP */}
            {rightTab==="drip"&&(
              <div style={{animation:"fadeUp 0.15s ease"}}>
                <CommunityEarnings mcap={t.mcap} volRaw={t.volRaw} holdingPct={myPos?((myPos.held/1e9)*100):0.08}/>
                <WhitelistStatus whitelisted={myPos?.whitelisted||false} inTop10={myPos?.inTop10||false} mcap={t.mcap} volRaw={t.volRaw} holdingPct={myPos?((myPos.held/1e9)*100):1.5}/>
                <DripConfig t={t}/>
                {as.s==="live"&&(
                  <div style={{marginTop:12,padding:"12px 14px",background:C.card,borderRadius:8,border:`1px solid ${C.border}`}}>
                    <Label size={10} color={C.textTer} style={{display:"block",marginBottom:10,letterSpacing:0.4,textTransform:"uppercase"}}>Flywheel</Label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {["Hold any token","Earn USDC each quarter","Bigger bag = more per hour","Top 10 get vault tokens","Chart stays clean","Repeat"].map((s,i,a)=>(
                        <div key={s} style={{display:"flex",alignItems:"center",gap:5}}>
                          <div style={{padding:"4px 9px",borderRadius:20,background:C.accentBg,border:`1px solid ${C.accentBd}`}}>
                            <Label size={10} color={C.accent} weight={500}>{s}</Label>
                          </div>
                          {i<a.length-1&&<svg width="7" height="7" viewBox="0 0 8 8" style={{flexShrink:0,opacity:0.2}}><path d="M1 4h6M4 1l3 3-3 3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* HOLDERS */}
            {rightTab==="holders"&&(
              <div style={{animation:"fadeUp 0.15s ease"}}>
                <div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <Label size={14} color={C.text} weight={600}>Top 10 Holders</Label>
                  {as.s==="live"?<><Label size={12} color={C.accent} weight={500}>{mil.multi}x </Label><Label size={11} color={C.textTer}>drip active</Label></>
                  :as.s==="pending"?<Label size={11} color={C.gold}>Snapshot in {as.minsLeft}m</Label>
                  :<Label size={11} color={C.red}>Unlocks at $500K</Label>}
                </div>
                <GlassCard style={{overflow:"hidden",padding:0}} hover={false}>
                  {HOLDERS.map((h,i)=>(
                    <div key={h.rank} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:i<19?`1px solid ${C.border}`:"none",background:h.rank<=3?"rgba(255,159,10,0.03)":"transparent"}}>
                      <div style={{width:24,height:24,borderRadius:7,background:h.rank===1?`linear-gradient(135deg,${C.gold},#e6960a)`:C.sheet,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <Label size={10} color={h.rank===1?"#000":C.textTer} weight={700}>{h.rank}</Label>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}>
                          <Label size={11} color={C.textSec} mono>{h.wallet}</Label>
                          {h.whitelisted&&<div style={{width:4,height:4,borderRadius:"50%",background:C.green,flexShrink:0}}/>}
                        </div>
                        <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                          {h.lockDays>0&&<Tag color={C.accent}>{h.lockDays}d</Tag>}
                          {h.streak&&<Tag color={C.green}>streak</Tag>}
                          <Tag color={h.dripMode==="reinject"?C.accent:C.purple}>{h.dripMode==="reinject"?"↺ reinject":"USDC"}</Tag>
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <Label size={13} color={C.text} weight={600}>{h.pct}%</Label>
                        <div><Label size={9} color={C.textTer} mono>{(mil.multi+h.boost).toFixed(2)}x</Label></div>
                      </div>
                    </div>
                  ))}
                </GlassCard>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ===== LAUNCH MODAL =====

function LaunchModal({onClose,slotData}) {
  const [form,setForm]=useState({name:"",sym:"",desc:"",twitter:"",website:"",topicUrl:"",imageFile:null});
  const [state,setState]=useState("idle");
  const [topicRes,setTopicRes]=useState(null);
  const [classifying,setClassifying]=useState(false);

  // Extracts the core identity from any input:
  // "@elonmusk" -> "elonmusk"
  // "https://x.com/elonmusk/status/123" -> "elonmusk"
  // "https://elonmusk.com/anything" -> "elonmusk"
  // "elonmusk.xyz" -> "elonmusk"
  function extractIdentity(raw) {
    if(!raw||raw.trim().length<2) return null;
    const s = raw.trim().toLowerCase();
    // @handle -> strip @
    if(s.startsWith("@")) return s.slice(1).split("/")[0].replace(/[^a-z0-9_]/g,"");
    // x.com/handle or twitter.com/handle URL
    const xMatch = s.match(/(?:x\.com|twitter\.com)\/([a-z0-9_]+)/);
    if(xMatch) return xMatch[1];
    // Any URL -> strip protocol, www, extract first path segment or subdomain
    try {
      const url = s.startsWith("http") ? s : "https://"+s;
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./,"");
      // subdomain.tld -> take subdomain if not generic
      const parts = host.split(".");
      const name = parts.length>=2 ? parts[0] : host;
      // strip tld noise - return the meaningful name
      return name.replace(/[^a-z0-9_]/g,"");
    } catch(e) {
      return s.replace(/[^a-z0-9_]/g,"");
    }
  }

  // == PVP LOCK ENGINE ==
  // Three lock types - all permanent while token is above $50K market cap:
  //
  // 1. TICKER LOCK  - $PUNCH locks PUNCH, PUNCHY, PUNCH2, XPUNCH (all derivatives)
  // 2. IMAGE LOCK   - perceptual hash comparison, blocks same/similar images
  // 3. IDENTITY LOCK - @handle / domain / tweet URL all extract to same identity
  //
  // Lock rules:
  //   - Token must be above $50K market cap to hold a lock
  //   - Below $50K = fair game, anyone can outcompete it
  //   - Above $50K = ticker, image, and identity are all frozen
  //   - Identity lock also has 24hr cooldown for new unlocks (on top of mc rule)
  // -------------------------------------------------------------------------

  // Simulated on-chain registry - populated at deploy time
  // Each entry: {ticker, imageHash, identity, marketCap, lockedAt}
  const DEPLOYED_TOKENS = [
    {ticker:"PUNCH",  imageHash:"hash_punch_monkey", identity:"punchthemonkey", marketCap:82000,  lockedAt: Date.now()-3600000},
    {ticker:"ELON",   imageHash:"hash_elon_photo",   identity:"elonmusk",       marketCap:148000, lockedAt: Date.now()-120000},
    {ticker:"DOGE",   imageHash:"hash_doge_shibe",   identity:"dogecoin",       marketCap:220000, lockedAt: Date.now()-7200000},
    {ticker:"PEPE",   imageHash:"hash_pepe_frog",    identity:"pepecoin",       marketCap:55000,  lockedAt: Date.now()-1800000},
  ];

  const MC_LOCK_THRESHOLD = 50000; // $50K - tokens above this hold all locks
  const LOCK_TTL = 24*60*60*1000;  // 24hr identity cooldown

  // Normalise ticker: strip $, uppercase, trim
  function normaliseTicker(raw) {
    if(!raw||!raw.trim()) return null;
    return raw.trim().toUpperCase().replace(/^\$/, "").replace(/[^A-Z0-9]/g, "");
  }

  // Ticker similarity - block exact match + close derivatives
  // "PUNCH" blocks "PUNCH", "PUNCHX", "XPUNCH", "PUNCH2", "PUNCHY", "PNCH" etc
  function tickerBlocked(inputTicker) {
    if(!inputTicker||inputTicker.length<2) return null;
    const t = inputTicker;
    const match = DEPLOYED_TOKENS.find(tok => {
      if(tok.marketCap < MC_LOCK_THRESHOLD) return false; // below $50K = not locked
      const existing = tok.ticker;
      if(t === existing) return true;                      // exact match
      if(t.includes(existing) || existing.includes(t)) return true; // substring
      // Levenshtein distance <= 1 for tickers <= 6 chars (catches typo derivatives)
      if(t.length <= 6 && existing.length <= 6) {
        let dist = 0, a = t, b = existing;
        if(a.length !== b.length) dist++;
        for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]!==b[i]) dist++;
        if(dist <= 1) return true;
      }
      return false;
    });
    if(!match) return null;
    return {ticker: match.ticker, marketCap: match.marketCap};
  }

  // Image lock - perceptual hash check (simulated)
  // In production: dhash/phash comparison server-side at upload
  function imageBlocked(imageFile) {
    if(!imageFile) return null;
    // Simulate: if filename contains a known locked hash keyword, block it
    const name = (imageFile.name||"").toLowerCase();
    const match = DEPLOYED_TOKENS.find(tok => {
      if(tok.marketCap < MC_LOCK_THRESHOLD) return false;
      const keyword = tok.imageHash.replace("hash_","").split("_")[0];
      return name.includes(keyword);
    });
    if(!match) return null;
    return {ticker: match.ticker, marketCap: match.marketCap};
  }

  // Identity lock - 24hr cooldown + $50K mc protection
  function isClaimed(identity) {
    if(!identity||identity.length<2) return null;
    const match = DEPLOYED_TOKENS.find(tok => {
      if(tok.marketCap < MC_LOCK_THRESHOLD) return false;
      return identity.includes(tok.identity)||tok.identity.includes(identity);
    });
    if(!match) return null;
    // Also check 24hr cooldown on top of mc rule
    const expired = (Date.now()-match.lockedAt) > LOCK_TTL;
    if(expired && match.marketCap < MC_LOCK_THRESHOLD) return null;
    const minsLeft = Math.ceil((LOCK_TTL-(Date.now()-match.lockedAt))/60000);
    const hrsLeft  = minsLeft>=60?Math.ceil(minsLeft/60):null;
    const timeLeft = match.marketCap >= MC_LOCK_THRESHOLD ? "permanent" :
                     hrsLeft ? `${hrsLeft}h` : `${minsLeft}m`;
    return {id:match.identity, ticker:match.ticker, marketCap:match.marketCap, timeLeft, permanent: match.marketCap >= MC_LOCK_THRESHOLD};
  }

  const inputTicker    = normaliseTicker(form.sym);
  const twitterIdentity = extractIdentity(form.twitter);
  const websiteIdentity = extractIdentity(form.website);

  const tickerBlock  = tickerBlocked(inputTicker);
  const imageBlock   = imageBlocked(form.imageFile);
  const twitterClaim = isClaimed(twitterIdentity);
  const websiteClaim = isClaimed(websiteIdentity);
  const topicIdentity = topicRes ? extractIdentity(form.topicUrl) : null;

  const ready = form.name.trim() && form.sym.trim();
  // Identity lock ONLY activates when a Twitter or website link is provided
  const hasIdentityLink = !!(form.twitter.trim().length > 1 || form.website.trim().length > 4);
  const pvpProtected = hasIdentityLink && !twitterClaim && !websiteClaim;
  const topicBlocked = (topicRes&&topicRes.claimed) || !!twitterClaim || !!websiteClaim;
  const deployBlocked = !!tickerBlock || !!imageBlock || topicBlocked;

  const handleUrl=url=>{
    setForm(p=>({...p,topicUrl:url}));
    if(!url||url.trim().length===0){setTopicRes(null);setClassifying(false);return;}
    if(!url.startsWith("http")||url.length<12){setTopicRes(null);return;}
    setClassifying(true);setTopicRes(null);
    setTimeout(()=>{setTopicRes(classifyTopic(url));setClassifying(false);},900);
  };

  if(state==="done") return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(30px)",animation:"fadeIn 0.18s ease"}} onClick={onClose}>
      <div style={{background:C.sheet,borderRadius:10,padding:"28px 24px",textAlign:"center",maxWidth:320,width:"92%",border:`1px solid ${C.border}`,boxShadow:"0 40px 80px rgba(0,0,0,0.6)",animation:"scaleIn 0.22s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:56,height:56,borderRadius:8,background:C.accentBg,border:`1px solid ${C.accentBd}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 11L9 16L18 6" stroke={C.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
        <Label size={20} color={C.text} weight={700} style={{display:"block",marginBottom:8}}>Token is live</Label>
        <Label size={13} color={C.textSec} style={{display:"block",lineHeight:1.7,marginBottom:16}}>Hit $500K market cap to open rewards. Once bonded, LP migrates to Raydium and all fees compound forever.</Label>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",marginBottom:16,textAlign:"left"}}>
          <Label size={11} color={C.textTer} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.4}}>Locks active on deploy</Label>
          <Label size={12} color={C.teal} style={{display:"block",marginBottom:3}}>Ticker ${form.sym.toUpperCase()} locked -- derivatives blocked</Label>
          {form.imageFile&&<Label size={12} color={C.teal} style={{display:"block",marginBottom:3}}>Image hash locked -- similar images blocked</Label>}
          {pvpProtected&&<Label size={12} color={C.teal} style={{display:"block",marginBottom:3}}>Identity locked -- all derivatives blocked ✓</Label>}{!hasIdentityLink&&<Label size={12} color={C.textTer} style={{display:"block",marginBottom:3}}>No identity lock — no Twitter/website was linked</Label>}
          <Label size={11} color={C.textTer} style={{display:"block",marginTop:6,lineHeight:1.5}}>All locks become permanent once you cross $50K market cap.</Label>
        </div>
        {topicRes&&!deployBlocked&&<div style={{background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:10,padding:"10px 12px",marginBottom:16,textAlign:"left"}}><Label size={12} color={C.teal} weight={600}>Verified topic locked -- {topicRes.source} / {topicRes.entity}</Label></div>}
        <Btn full color={C.accent} onClick={onClose}>Done</Btn>
      </div>
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(30px)"}} onClick={onClose}>
      <div style={{background:C.sheet,borderRadius:"10px 10px 0 0",width:"100%",maxWidth:520,border:`1px solid ${C.border}`,borderBottom:"none",maxHeight:"92vh",overflowY:"auto",animation:"slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:40,height:4,borderRadius:99,background:"rgba(255,255,255,0.15)"}}/></div>
        <div style={{padding:"10px 20px 36px"}}>

          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <Label size={18} color={C.text} weight={700}>Launch a token</Label>
            <button onClick={onClose} style={{width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,0.08)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1L9 9M9 1L1 9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round"/></svg></button>
          </div>

          {/* Fee breakdown cards */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            {[
              {l:"Deploy fee",v:"1.5 SOL",c:C.accent,rows:[["50%","Seeds LP immediately"],["30%","Protocol"],["10%","Quarterly airdrop pool"],["10%","Infrastructure"]]},
              {l:"Trading fee",v:"1.5%",c:C.green,rows:[["0.90%","LP"],["0.35%","Protocol"],["0.25%","Quarterly USDC airdrop pool"]]},
            ].map(card=>(
              <div key={card.l} style={{background:C.card,borderRadius:8,padding:"14px",border:`1px solid ${card.l==="Trading fee"?"rgba(48,209,88,0.25)":C.border}`}}>
                <Label size={10} color={C.textTer} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>{card.l}</Label>
                <Label size={20} color={card.c} weight={700} style={{display:"block",marginBottom:8}}>{card.v}</Label>
                {card.rows.map(([pct,lbl])=>(
                  <div key={lbl} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <Label size={11} color={lbl==="Holders quarterly USDC"?C.green:card.c} weight={lbl==="Holders quarterly USDC"?700:600}>{pct}</Label>
                    <Label size={11} color={lbl==="Holders quarterly USDC"?C.green:C.textTer} weight={lbl==="Holders quarterly USDC"?600:400}>{lbl}</Label>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Graduation notice */}
          <div style={{background:C.raydiumBg,border:`1px solid ${C.raydiumBd}`,borderRadius:8,padding:"12px 14px",marginBottom:14,display:"flex",alignItems:"flex-start",gap:10}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:C.raydium,flexShrink:0,marginTop:4}}/>
            <Label size={12} color={C.textSec} style={{lineHeight:1.6}}>On graduation LP migrates to Raydium and locks forever. All fees compound back into LP depth automatically on every trade.</Label>
          </div>

          {/* Airdrop mechanics */}
          <div style={{background:C.goldBg,border:`1px solid ${C.goldBd}`,borderRadius:8,padding:"12px 14px",marginBottom:14}}>
            <Label size={11} color={C.gold} weight={600} style={{display:"block",marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}}>Airdrop mechanics</Label>
            <div style={{display:"flex",gap:4,marginBottom:8}}>
              {[["85 SOL","filled"],["+5 min","snapshot"],["Top 10","only"],["daily","payout"],["Hold or","miss out"]].map(([v,l])=>(
                <div key={l} style={{textAlign:"center",flex:1,background:"rgba(0,0,0,0.2)",borderRadius:7,padding:"6px 2px"}}>
                  <Label size={11} color={C.gold} weight={700} style={{display:"block"}}>{v}</Label>
                  <Label size={9} color={C.textTer} style={{display:"block",marginTop:1}}>{l}</Label>
                </div>
              ))}
            </div>
            <Label size={11} color={C.textTer} style={{lineHeight:1.5}}>Top 10 at snapshot earn 0.15% of every trade. Pool drips 3-5% per MC milestone (7d TWAP).</Label>
          </div>

          {/* Anti-bundle caps */}
          <div style={{background:C.card,borderRadius:8,padding:"12px 14px",marginBottom:14,border:`1px solid ${C.border}`}}>
            <Label size={10} color={C.textTer} style={{display:"block",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Anti-bundle caps</Label>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              {CAP_WINDOWS.map((c,i)=>(
                <div key={i} style={{flex:1,textAlign:"center",background:C.sheet,borderRadius:8,padding:"7px 3px",border:`1px solid ${C.border}`}}>
                  <Label size={9} color={C.textTer} style={{display:"block",marginBottom:2}}>{c.label}</Label>
                  <Label size={12} color={c.pct==="Open"?C.green:C.accent} weight={600}>{c.pct}</Label>
                </div>
              ))}
            </div>
            <div style={{display:"flex",alignItems:"flex-start",gap:7,padding:"8px 10px",background:C.purpleBg,border:`1px solid ${C.purpleBd}`,borderRadius:8}}>
              <div style={{width:4,height:4,borderRadius:"50%",background:C.purple,flexShrink:0,marginTop:4}}/>
              <Label size={11} color={C.purple}>Web-only swap. Jupiter and Jito blocked during bonding curve.</Label>
            </div>
          </div>

          {/* Token fields */}
          <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Token name"
            style={{display:"block",width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:12,padding:"13px 16px",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:8,transition:"border-color 0.15s, background 0.15s"}}
            onFocus={e=>{e.target.style.borderColor=C.borderHi;e.target.style.background="rgba(255,255,255,0.06)";}}
            onBlur={e=>{e.target.style.borderColor=C.border;e.target.style.background="rgba(255,255,255,0.04)";}}/>

          {/* Ticker with lock check */}
          <div style={{marginBottom:8}}>
            <input value={form.sym} onChange={e=>setForm(p=>({...p,sym:e.target.value}))} placeholder="Ticker  e.g. PUNCH"
              style={{display:"block",width:"100%",background:"rgba(255,255,255,0.04)",border:`1.5px solid ${tickerBlock?C.redBd:inputTicker&&inputTicker.length>0?C.tealBd:C.border}`,borderRadius:12,padding:"13px 16px",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box",transition:"border-color 0.15s, background 0.15s",fontFamily:"inherit"}}
              onFocus={e=>{e.target.style.background="rgba(255,255,255,0.06)";}}
              onBlur={e=>{e.target.style.background="rgba(255,255,255,0.04)";}}/>
            {tickerBlock&&(
              <div style={{display:"flex",alignItems:"flex-start",gap:7,marginTop:6,padding:"9px 11px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.red,flexShrink:0,marginTop:4}}/>
                <Label size={11} color={C.red}><strong style={{color:C.text}}>${tickerBlock.ticker}</strong> is above $50K market cap -- ticker and all derivatives are locked. Choose a different ticker.</Label>
              </div>
            )}
            {!tickerBlock&&inputTicker&&inputTicker.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.teal,flexShrink:0}}/>
                <Label size={11} color={C.teal}><strong style={{color:C.text}}>${inputTicker}</strong> is available -- locks to this CA on deploy</Label>
              </div>
            )}
          </div>

          {/* Image upload with hash lock check */}
          <div style={{marginBottom:8}}>
            <div style={{background:"rgba(255,255,255,0.04)",border:`1.5px dashed ${imageBlock?C.redBd:form.imageFile?C.tealBd:C.border}`,borderRadius:12,padding:"14px 16px",cursor:"pointer",transition:"border-color 0.15s"}}
              onClick={()=>document.getElementById("imgUpload").click()}>
              <input id="imgUpload" type="file" accept="image/*" style={{display:"none"}}
                onChange={e=>setForm(p=>({...p,imageFile:e.target.files[0]||null}))}/>
              {form.imageFile
                ?<Label size={13} color={C.teal}>{form.imageFile.name}</Label>
                :<Label size={13} color={C.textTer}>Token image (optional) -- tap to upload</Label>
              }
            </div>
            {imageBlock&&(
              <div style={{display:"flex",alignItems:"flex-start",gap:7,marginTop:6,padding:"9px 11px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.red,flexShrink:0,marginTop:4}}/>
                <Label size={11} color={C.red}>Image matches <strong style={{color:C.text}}>${imageBlock.ticker}</strong> which is above $50K market cap. Similar images are locked. Upload an original image.</Label>
              </div>
            )}
            {!imageBlock&&form.imageFile&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.teal,flexShrink:0}}/>
                <Label size={11} color={C.teal}>Image is unique -- locks to this CA on deploy</Label>
              </div>
            )}
          </div>

          <input value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))} placeholder="Description (optional)"
            style={{display:"block",width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:12,padding:"13px 16px",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:8,transition:"border-color 0.15s, background 0.15s"}}
            onFocus={e=>{e.target.style.borderColor=C.borderHi;e.target.style.background="rgba(255,255,255,0.06)";}}
            onBlur={e=>{e.target.style.borderColor=C.border;e.target.style.background="rgba(255,255,255,0.04)";}}/>

          {/* Twitter -- PVP locked to CA */}
          <div style={{marginBottom:8}}>
            <input value={form.twitter} onChange={e=>setForm(p=>({...p,twitter:e.target.value}))} placeholder="@twitter or x.com/handle — required for PVP lock"
              style={{display:"block",width:"100%",background:"rgba(255,255,255,0.04)",border:`1.5px solid ${twitterClaim?C.redBd:form.twitter.length>1?C.tealBd:C.border}`,borderRadius:12,padding:"13px 16px",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box",transition:"border-color 0.15s, background 0.15s"}}
              onFocus={e=>{e.target.style.background="rgba(255,255,255,0.06)";}}
              onBlur={e=>{e.target.style.background="rgba(255,255,255,0.04)";}}/>
            {twitterClaim&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.red,flexShrink:0}}/>
                <Label size={11} color={C.red}>Identity <strong style={{color:C.text}}>{twitterIdentity}</strong> is locked for another <strong style={{color:C.text}}>{twitterClaim.timeLeft}</strong> -- another CA got there first.</Label>
              </div>
            )}
            {!twitterClaim&&twitterIdentity&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.teal,flexShrink:0}}/>
                <Label size={11} color={C.teal}>Identity <strong style={{color:C.text}}>{twitterIdentity}</strong> locks to this CA -- all derivatives blocked</Label>
              </div>
            )}
          </div>

          {/* Website -- PVP locked to CA */}
          <div style={{marginBottom:8}}>
            <input value={form.website} onChange={e=>setForm(p=>({...p,website:e.target.value}))} placeholder="Website URL — required for PVP lock"
              style={{display:"block",width:"100%",background:"rgba(255,255,255,0.04)",border:`1.5px solid ${websiteClaim?C.redBd:form.website.length>4?C.tealBd:C.border}`,borderRadius:12,padding:"13px 16px",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box",transition:"border-color 0.15s, background 0.15s"}}
              onFocus={e=>{e.target.style.background="rgba(255,255,255,0.06)";}}
              onBlur={e=>{e.target.style.background="rgba(255,255,255,0.04)";}}/>
            {websiteClaim&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.red,flexShrink:0}}/>
                <Label size={11} color={C.red}>Identity <strong style={{color:C.text}}>{websiteIdentity}</strong> is locked for another <strong style={{color:C.text}}>{websiteClaim.timeLeft}</strong> -- another CA got there first.</Label>
              </div>
            )}
            {!websiteClaim&&websiteIdentity&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:C.teal,flexShrink:0}}/>
                <Label size={11} color={C.teal}>Identity <strong style={{color:C.text}}>{websiteIdentity}</strong> locks to this CA -- all derivatives blocked</Label>
              </div>
            )}
          </div>

          {/* No link = no PVP protection warning */}
          {!hasIdentityLink&&form.sym.trim().length>0&&(
            <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",background:"rgba(255,248,235,0.03)",border:`1px solid ${C.border}`,borderRadius:9,marginBottom:8}}>
              <div style={{width:4,height:4,borderRadius:"50%",background:C.textQuat,flexShrink:0,marginTop:4}}/>
              <Label size={11} color={C.textTer} style={{lineHeight:1.55}}>
                <strong style={{color:C.textSec}}>No PVP protection.</strong> Add your Twitter or website to lock your identity on-chain. Without a link, anyone can deploy the same narrative.
              </Label>
            </div>
          )}
          {pvpProtected&&(
            <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:9,marginBottom:8}}>
              <div style={{width:4,height:4,borderRadius:"50%",background:C.teal,flexShrink:0,marginTop:4}}/>
              <Label size={11} color={C.teal} style={{lineHeight:1.55}}>
                <strong>PVP protection active.</strong> Your identity locks to this CA on deploy. All derivatives and copycats are blocked on-chain. First mover wins.
              </Label>
            </div>
          )}

          {/* News/tweet URL -- PVP topic lock */}
          <div style={{marginBottom:8}}>
            <input value={form.topicUrl} onChange={e=>handleUrl(e.target.value)} placeholder="News or tweet URL (locks topic)"
              style={{display:"block",width:"100%",background:"rgba(255,255,255,0.04)",border:`1.5px solid ${topicRes?.claimed?C.redBd:topicRes&&!topicRes.claimed?C.tealBd:C.border}`,borderRadius:12,padding:"13px 16px",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"inherit",transition:"border-color 0.15s, background 0.15s"}}
              onFocus={e=>{e.target.style.background="rgba(255,255,255,0.06)";}}
              onBlur={e=>{e.target.style.background="rgba(255,255,255,0.04)";}}/>
            {classifying&&form.topicUrl.length>0&&<Label size={11} color={C.textTer} style={{display:"block",marginTop:6}}>Classifying...</Label>}
            {topicRes&&!classifying&&form.topicUrl.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,padding:"8px 11px",background:topicRes.claimed?C.redBg:C.tealBg,border:`1px solid ${topicRes.claimed?C.redBd:C.tealBd}`,borderRadius:9}}>
                <div style={{width:4,height:4,borderRadius:"50%",background:topicRes.claimed?C.red:C.teal,flexShrink:0}}/>
                {topicRes.claimed
                  ?<Label size={11} color={C.red}>Topic claimed by <strong>{topicRes.claimedBy}</strong> for 24h -- use a different URL.</Label>
                  :<Label size={11} color={C.teal}>{topicRes.entity} via {topicRes.source} -- locks on deploy</Label>}
              </div>
            )}
          </div>

          <div style={{marginBottom:12,background:C.card,borderRadius:12,border:`1px solid ${slotData.open>0?C.border:C.redBd}`,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:7}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:slotData.open>5?C.green:slotData.open>0?C.gold:C.red,flexShrink:0}}/>
                <Label size={13} color={slotData.open>0?C.text:C.red} weight={600}>{slotData.open} of {slotData.totalAvailable} slots open</Label>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{background:`${C.blue}18`,border:`1px solid ${C.blue}30`,borderRadius:6,padding:"2px 8px"}}>
                  <Label size={10} color={C.blue} weight={600}>{slotData.tier.label} / cap {slotData.cap}</Label>
                </div>
              </div>
            </div>
            {/* within-day slot progress */}
            <div style={{padding:"0 14px 8px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <Label size={10} color={C.textTer}>
                  {slotData.atCap?"At daily cap":"Next slot in "+fmtVol(slotData.toNextSlot)+" vol"}
                </Label>
                <Label size={10} color={C.textTer}>
                  {slotData.nextTier?"Cap expands to "+slotData.nextTier.cap+" at "+fmtVol(slotData.nextTier.vol)+" total vol":"Max tier reached"}
                </Label>
              </div>
              <div style={{height:3,background:"rgba(255,255,255,0.05)",borderRadius:99,marginBottom:4}}>
                <div style={{height:"100%",background:slotData.atCap?C.green:C.accent,width:`${(slotData.totalAvailable/slotData.cap)*100}%`,borderRadius:99,transition:"width 0.5s ease"}}/>
              </div>
              {/* tier expansion progress */}
              {slotData.nextTier&&(
                <div style={{height:2,background:"rgba(255,255,255,0.04)",borderRadius:99}}>
                  <div style={{height:"100%",background:C.blue,width:`${slotData.tierPct*100}%`,borderRadius:99,transition:"width 0.5s ease"}}/>
                </div>
              )}
            </div>
          </div>

          {deployBlocked&&!tickerBlock&&!imageBlock&&<div style={{padding:"9px 12px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:9,marginBottom:10}}><Label size={12} color={C.red}>Resolve all conflicts above to deploy.</Label></div>}

          {/* Primary CTA - bonding curve */}
          <Btn onClick={()=>{if(!ready||deployBlocked)return;setBondMode("curve");setState("loading");(async()=>{try{const provider=window?.solana;const mint=window.crypto.getRandomValues(new Uint8Array(32));const {Keypair}=await import("@solana/web3.js");const mintKp=Keypair.generate();const tx=await buildDeployTx(provider.publicKey,mintKp.publicKey.toString(),form.ticker||"TEST",null,null);const {blockhash}=await connection.getLatestBlockhash();tx.recentBlockhash=blockhash;tx.feePayer=provider.publicKey;const signed=await provider.signTransaction(tx);const sig=await connection.sendRawTransaction(signed.serialize());await connection.confirmTransaction(sig);setState("done");}catch(e){console.error(e);alert(e.message);setState("idle");}})();}} full color={C.accent} loading={state==="loading"&&bondMode==="curve"} disabled={!ready||deployBlocked||state==="loading"}>
            {`Deploy -- 1.5 SOL${pvpProtected?" + PVP Lock":""}`}
          </Btn>



        </div>
      </div>
    </div>
  );
}

// ===== NOTIFICATIONS =====

function NotifPanel({onClose}) {
  const [notifs,setNotifs]=useState(MOCK_NOTIFS);
  return (
    <div style={{position:"fixed",inset:0,zIndex:200}} onClick={onClose}>
      <div style={{position:"absolute",top:58,right:16,width:300,background:C.sheet,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.6)",backdropFilter:"blur(20px)",animation:"scaleIn 0.18s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <Label size={15} color={C.text} weight={600}>Notifications</Label>
          <button onClick={()=>setNotifs(n=>n.map(x=>({...x,read:true})))} style={{background:"none",border:"none",cursor:"pointer"}}><Label size={12} color={C.blue}>Mark all read</Label></button>
        </div>
        <div style={{maxHeight:"60vh",overflowY:"auto"}}>
          {notifs.map(n=>(
            <div key={n.id} onClick={()=>setNotifs(ns=>ns.map(x=>x.id===n.id?{...x,read:true}:x))} style={{padding:"13px 16px",borderBottom:`1px solid ${C.border}`,background:n.read?"transparent":"rgba(255,255,255,0.02)",cursor:"pointer",transition:"background 0.1s"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:n.read?C.textQuat:n.color,marginTop:4,flexShrink:0,animation:!n.read?"pulse 2.5s infinite":"none"}}/>
                <div style={{flex:1}}>
                  <Label size={12} color={n.read?C.textTer:C.text} style={{lineHeight:1.5}}>{n.msg}</Label>
                  <div style={{marginTop:3}}><Label size={10} color={C.textQuat}>{n.time}</Label></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== PORTFOLIO =====

function Portfolio({onSelectToken,onClose}) {
  const totalPnl=MY_POSITIONS.reduce((a,p)=>a+(p.held*(p.current-p.entry)),0);
  const totalPending=MY_POSITIONS.reduce((a,p)=>{const tok=INIT_TOKENS.find(t=>t.sym===p.sym);return a+(tok&&getAS(tok).s==="live"?p.pendingDrip:0);},0);
  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans}}>
      <style>{FONT}</style>
      <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(30px)",WebkitBackdropFilter:"blur(30px)",borderBottom:`1px solid ${C.border}`,padding:"12px 24px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onClose} style={{width:34,height:34,borderRadius:"50%",background:"rgba(255,255,255,0.07)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",backdropFilter:"blur(10px)"}}><svg width="10" height="17" viewBox="0 0 10 17" fill="none"><path d="M8.5 1.5L1.5 8.5L8.5 15.5" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        <Label size={18} color={C.text} weight={700}>Portfolio</Label>
      </div>
      <div style={{maxWidth:520,margin:"0 auto",padding:"20px 20px 100px"}}>
        {/* Summary */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
          {[{l:"P&L",v:`${totalPnl>=0?"+":""}$${totalPnl.toFixed(2)}`,c:totalPnl>=0?C.green:C.red},{l:"Pending drips",v:`${totalPending.toFixed(3)} SOL`,c:C.accent},{l:"Positions",v:MY_POSITIONS.length,c:C.text}].map(s=>(
            <GlassCard key={s.l} style={{padding:"14px"}} hover={false}>
              <Label size={10} color={C.textTer} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.4}}>{s.l}</Label>
              <Label size={16} color={s.c} weight={700}>{s.v}</Label>
            </GlassCard>
          ))}
        </div>

        <Label size={11} color={C.textTer} style={{display:"block",marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>Positions</Label>
        {MY_POSITIONS.map((pos,i)=>{
          const t=INIT_TOKENS.find(t=>t.sym===pos.sym);
          return (
            <GlassCard key={pos.sym} onClick={()=>onSelectToken(t)} style={{padding:"14px 16px",marginBottom:8,animation:`fadeUp 0.25s ease ${i*0.06}s both`}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <Avatar sym={pos.sym} pi={pos.pi} size={40}/>
                <div style={{flex:1}}>
                  <Label size={15} color={C.text} weight={600}>{pos.sym}</Label>
                  <div style={{marginTop:2}}><Label size={12} color={C.textTer}>{pos.held.toLocaleString()} tokens</Label></div>
                </div>
                <div style={{textAlign:"right"}}>
                  <Label size={16} color={pos.pnlPct>=0?C.green:C.red} weight={700}>{pos.pnlPct>=0?"+":""}{pos.pnlPct}%</Label>
                  <div style={{marginTop:2}}><Label size={11} color={C.textTer} mono>${(pos.held*pos.current).toFixed(2)}</Label></div>
                </div>
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {pos.whitelisted&&<Tag color={C.green}>Whitelisted</Tag>}
                {pos.inTop10&&<Tag color={C.accent}>Top 10</Tag>}
                {!pos.inTop10&&pos.whitelisted&&<Tag color={C.textTer}>Out of top 10</Tag>}
                {pos.pendingDrip>0&&(()=>{const tok=INIT_TOKENS.find(t=>t.sym===pos.sym);return tok&&getAS(tok).s==="live";})()&&<Tag color={C.gold}>{pos.pendingDrip} SOL drip</Tag>}
                <Tag color={pos.dripMode==="reinject"?C.green:pos.dripMode==="usdc"?C.purple:C.accent}>{pos.dripMode==="reinject"?"↺ reinject":pos.dripMode}</Tag>
              </div>
            </GlassCard>
          );
        })}

        <Label size={11} color={C.textTer} style={{display:"block",marginBottom:10,marginTop:20,textTransform:"uppercase",letterSpacing:0.5}}>Deployed tokens</Label>
        {MY_TOKENS.map((tok,i)=>{
          const t=INIT_TOKENS.find(t=>t.sym===tok.sym);
          return (
            <GlassCard key={tok.sym} onClick={()=>onSelectToken(t)} style={{padding:"14px 16px",marginBottom:8,animation:`fadeUp 0.25s ease ${i*0.06}s both`}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <Avatar sym={tok.sym} pi={tok.pi} size={40}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <Label size={15} color={C.text} weight={600}>{tok.sym}</Label>
                    <Tag color={C.accent}>Creator</Tag>
                  </div>
                  <div style={{marginTop:2}}><Label size={12} color={C.textTer}>Launched {tok.launched}</Label></div>
                </div>
                <div style={{textAlign:"right"}}>
                  <Label size={15} color={C.accent} weight={600}>{tok.feesEarned} SOL</Label>
                  <div style={{marginTop:2}}><Label size={10} color={C.textTer}>fees earned</Label></div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {[["MC",fmt(tok.mcap)],["24h",`${tok.chg>=0?"+":""}${tok.chg}%`],["Holders",tok.holders]].map(([l,v])=>(
                  <div key={l} style={{background:C.sheet,borderRadius:8,padding:"8px 10px",border:`1px solid ${C.border}`}}>
                    <Label size={9} color={C.textTer} style={{display:"block",marginBottom:3}}>{l}</Label>
                    <Label size={12} color={l==="24h"?(tok.chg>=0?C.green:C.red):C.text} weight={500}>{v}</Label>
                  </div>
                ))}
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}


function PvpExamples() {
  const [pvpEx,setPvpEx]=useState("elon");
  const examples={
    elon:{
      label:"Elon tweets",
      rows:[
        {time:"14:32:01",action:"9xK2...mR4p deploys $ELON",detail:"@elonmusk linked",result:"$ELON + elonmusk identity locked",win:true},
        {time:"14:32:03",action:"7pL9...nQ2w deploys $ELON",detail:"Same ticker",result:"Blocked -- $ELON above $50K",win:false},
        {time:"14:32:04",action:"3mX1...kR7v deploys $ELONDOG",detail:"Derivative ticker",result:"Blocked -- derivative of ELON",win:false},
        {time:"14:32:09",action:"2nR8...pK3m deploys with elonmusk.com",detail:"Same identity",result:"Blocked -- elonmusk identity locked",win:false},
        {time:"14:32:14",action:"5tN7...hF2c uploads same Elon image",detail:"Perceptual hash match",result:"Blocked -- image matches $ELON",win:false},
        {time:"14:33:01",action:"8qM4...jL6b deploys $DOGELON",detail:"Different identity, original image",result:"Clear -- no lock conflict",win:true},
      ]
    },
    punch:{
      label:"Punch the Monkey",
      rows:[
        {time:"11:04:12",action:"6wQ3...aH5e deploys $PUNCH",detail:"Original monkey image",result:"$PUNCH locked at $82K MC",win:true},
        {time:"11:09:33",action:"1kP0...eG9d deploys $PUNCHY",detail:"Derivative ticker",result:"Blocked -- derivative of PUNCH",win:false},
        {time:"11:22:47",action:"4mR9...bK2n uploads cropped monkey",detail:"Perceptual hash match",result:"Blocked -- image matches $PUNCH",win:false},
        {time:"12:15:00",action:"$PUNCH volume dries up",detail:"MC drops to $38K",result:"All locks release -- fair game",win:null},
        {time:"12:16:04",action:"9xK2...mR4p deploys $PUNCH2",detail:"$PUNCH now below $50K",result:"Allowed -- lock released",win:true},
      ]
    }
  };
  const ex=examples[pvpEx];
  return (
    <GlassCard style={{padding:"20px",marginBottom:12}} hover={false}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <Label size={13} color={C.textTer} style={{textTransform:"uppercase",letterSpacing:0.5}}>Race example</Label>
        <div style={{display:"flex",gap:4}}>
          {Object.entries(examples).map(([k,v])=>(
            <button key={k} onClick={()=>setPvpEx(k)}
              style={{height:26,padding:"0 10px",borderRadius:7,border:`1px solid ${pvpEx===k?C.purple:C.border}`,background:pvpEx===k?"rgba(191,90,242,0.12)":"transparent",color:pvpEx===k?C.purple:C.textTer,fontSize:11,fontWeight:pvpEx===k?600:400,cursor:"pointer",transition:"all 0.12s"}}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {ex.rows.map((r,i,a)=>(
        <div key={i} style={{display:"flex",gap:10,padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none",alignItems:"flex-start"}}>
          <Label size={10} color={C.textQuat} mono style={{flexShrink:0,width:44,paddingTop:2}}>{r.time}</Label>
          <div style={{width:5,height:5,borderRadius:"50%",background:r.win===true?C.green:r.win===false?C.red:C.gold,flexShrink:0,marginTop:4}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:2}}>
              <Label size={12} color={C.text} weight={500}>{r.action}</Label>
              <Label size={10} color={C.textTer} mono style={{flexShrink:0}}>{r.detail}</Label>
            </div>
            <Label size={11} color={r.win===true?C.green:r.win===false?C.red:C.gold}>{r.result}</Label>
          </div>
        </div>
      ))}
    </GlassCard>
  );
}

// ===== TOKENOMICS PAGE =====

function Tokenomics({onClose}) {
  const [activeSection,setActiveSection]=useState("overview");

  const sections=[
    {id:"overview", label:"Overview"},
    {id:"fees",     label:"Fees"},
    {id:"drip",     label:"Drip"},
    {id:"vault",    label:"Vault"},
    {id:"slots",    label:"Slots"},
    {id:"pvp",      label:"PVP"},
  ];

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans}}>
      <style>{FONT}</style>

      {/* Sticky nav */}
      <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(30px)",WebkitBackdropFilter:"blur(30px)",borderBottom:`1px solid ${C.border}`}}>
        <div style={{height:52,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onClose} style={{width:34,height:34,borderRadius:"50%",background:"rgba(255,255,255,0.07)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
              <svg width="10" height="17" viewBox="0 0 10 17" fill="none"><path d="M8.5 1.5L1.5 8.5L8.5 15.5" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <Label size={17} color={C.text} weight={700}>Tokenomics</Label>
          </div>
        </div>
        <div style={{display:"flex",gap:0,padding:"0 20px",overflowX:"auto",scrollbarWidth:"none"}}>
          {sections.map(s=>(
            <button key={s.id} onClick={()=>setActiveSection(s.id)}
              style={{height:40,padding:"0 14px",background:"transparent",border:"none",borderBottom:`2px solid ${activeSection===s.id?C.accent:"transparent"}`,color:activeSection===s.id?C.text:C.textTer,fontSize:13,fontWeight:activeSection===s.id?600:400,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",letterSpacing:"-0.01em"}}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{maxWidth:640,margin:"0 auto",padding:"28px 20px 120px"}}>

        {/* ── OVERVIEW ────────────────────────────────── */}
        {activeSection==="overview"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <div style={{marginBottom:24}}>
              <Label size={26} color={C.text} weight={700} style={{display:"block",marginBottom:8,letterSpacing:"-0.04em",lineHeight:1.2}}>How summit.moon works</Label>
              <Label size={14} color={C.textSec} style={{lineHeight:1.7,display:"block"}}>A token launchpad where volume unlocks launch slots, top holders earn from every trade, and identities are race-claimed on-chain. No dev allocation. No rep system. No veto.</Label>
            </div>

            {/* Supply visual */}
            <GlassCard style={{padding:"18px 20px",marginBottom:10}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.05em"}}>Token supply — 1 billion</Label>
              <div style={{display:"flex",borderRadius:8,overflow:"hidden",height:28,marginBottom:10}}>
                {[
                  {pct:65,col:C.accent,label:"Bonding curve"},
                  {pct:25,col:C.purple,label:"Vault (25%)"},
                  {pct:10,col:C.textTer,label:"Reserve"},
                ].map(s=>(
                  <div key={s.label} style={{width:`${s.pct}%`,background:`${s.col}`,opacity:s.pct===10?0.3:0.85,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Label size={10} color="#fff" weight={700}>{s.pct}%</Label>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                {[
                  {col:C.accent, label:"650M — bonding curve"},
                  {col:C.purple, label:"250M — vault (unlocks at $500K)"},
                  {col:C.textTer,label:"100M — reserve"},
                ].map(s=>(
                  <div key={s.label} style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:s.col,flexShrink:0}}/>
                    <Label size={11} color={C.textSec}>{s.label}</Label>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Core mechanic cards */}
            {[
              {title:"Bonding curve → Raydium",color:C.accent,desc:"Every token launches on a sqrt bonding curve targeting 85 SOL. Once filled, the transfer hook is removed and LP migrates to Raydium CLMM and locks forever."},
              {title:"Airdrop earn each quarter",color:C.gold,desc:"1% of every swap accumulates in a fee vault on-chain. The keeper bot snapshots the airdrop eligible holders each quarter and distributes in USDC, tokens, or auto-reinjects back into the token."},
              {title:"$500K vault — top 10 only",color:C.purple,desc:"25% of supply (250M tokens) is locked in a PDA vault from day one. It unlocks once the token sustains $500K market cap for 1 hour, then drips to the top 10 holders over 7 days."},
              {title:"Volume opens slots",color:C.blue,desc:"There is no fixed daily launch limit. Every $10K in platform volume unlocks a new launch slot. Hot days = more launches. Dead days = fewer. The market self-regulates."},
              {title:"Identity PVP",color:C.purple,desc:"Link your Twitter or website at deploy time. That identity locks to your CA on-chain. All derivatives and copycats are blocked. First mover with a link wins the narrative permanently."},
              {title:"No dev allocation",color:C.green,desc:"Zero tokens reserved for the deployer. No insider supply. No vesting cliff to dump. You compete with everyone else from the same starting line."},
            ].map((c,i)=>(
              <GlassCard key={c.title} style={{padding:"18px 20px",marginBottom:8,animation:`fadeUp 0.25s ease ${i*0.04}s both`}} hover={false}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:c.color,flexShrink:0,boxShadow:`0 0 8px ${c.color}`}}/>
                  <Label size={14} color={C.text} weight={600}>{c.title}</Label>
                </div>
                <Label size={13} color={C.textSec} style={{lineHeight:1.7,display:"block"}}>{c.desc}</Label>
              </GlassCard>
            ))}
          </div>
        )}

        {/* ── FEES ───────────────────────────────────── */}
        {activeSection==="fees"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <Label size={22} color={C.text} weight={700} style={{display:"block",marginBottom:6,letterSpacing:"-0.03em"}}>Fee structure</Label>
            <Label size={14} color={C.textSec} style={{display:"block",marginBottom:18,lineHeight:1.6}}>Simple. On-chain. No treasury. No discretion. Fees split at the contract level on every transaction.</Label>

            {/* vs pump.fun */}
            <GlassCard style={{padding:"18px 20px",marginBottom:12,background:"rgba(255,214,10,0.04)",border:`1px solid rgba(255,214,10,0.2)`}} hover={false}>
              <Label size={12} color={C.gold} weight={700} style={{display:"block",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.04em"}}>Why 1.5% beats 1.0%</Label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                {[
                  {label:"pump.fun",fee:"1.0%",sub:"charges it, keeps all of it",col:C.textTer},
                  {label:"summit.moon",fee:"1.5%",sub:"charges it, 0.25% goes to quarterly airdrop",col:C.gold},
                ].map(p=>(
                  <div key={p.label} style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:`1px solid ${p.col}20`}}>
                    <Label size={10} color={p.col} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>{p.label}</Label>
                    <Label size={26} color={p.col} weight={700} style={{display:"block",lineHeight:1}}>{p.fee}</Label>
                    <Label size={11} color={p.col} style={{display:"block",marginTop:4,lineHeight:1.4}}>{p.sub}</Label>
                  </div>
                ))}
              </div>
              <Label size={11} color={C.textTer} style={{lineHeight:1.6}}>The extra 0.25% on a $1K trade is $2.50. No one leaves for $2.50. But a top-5 holder of a $1M/day token earns ~$70/hr back. The fee is competitive cover for a completely different model.</Label>
            </GlassCard>

            {/* Swap fee breakdown */}
            <GlassCard style={{marginBottom:12,overflow:"hidden"}} hover={false}>
              <div style={{padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <Label size={10} color={C.textTer} style={{display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Swap fee — per trade</Label>
                  <Label size={28} color={C.green} weight={700} style={{lineHeight:1}}>1.5%</Label>
                </div>
                <div style={{textAlign:"right"}}>
                  <Label size={10} color={C.textTer} style={{display:"block",marginBottom:4}}>On $1M volume</Label>
                  <Label size={18} color={C.text} weight={600}>$12,500</Label>
                </div>
              </div>
              <div style={{borderTop:`1px solid ${C.border}`}}/>
              {[
                {pct:"1.00%",label:"Airdrop holders",detail:"USDC paid hourly, proportional by balance",col:C.gold,hero:true,of:"$10,000"},
                {pct:"0.15%",label:"Raydium LP",detail:"Locked forever — compounds on every trade",col:C.teal,hero:false,of:"$1,500"},
                {pct:"0.10%",label:"Protocol",detail:"Platform ops + reinject bonus funding",col:C.textSec,hero:false,of:"$1,000"},
              ].map((r,i,a)=>(
                <div key={r.pct} style={{display:"flex",alignItems:"center",gap:14,padding:"13px 20px",background:r.hero?"rgba(255,214,10,0.04)":"transparent",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <Label size={20} color={r.col} weight={700} style={{width:52,flexShrink:0}}>{r.pct}</Label>
                  <div style={{flex:1}}>
                    <Label size={13} color={r.hero?C.text:C.textSec} weight={r.hero?600:400} style={{display:"block"}}>{r.label}</Label>
                    <Label size={11} color={C.textTer}>{r.detail}</Label>
                  </div>
                  <Label size={12} color={r.col} weight={600} style={{flexShrink:0}}>{r.of}</Label>
                </div>
              ))}
            </GlassCard>

            {/* Deploy fee */}
            <GlassCard style={{marginBottom:12,overflow:"hidden"}} hover={false}>
              <div style={{padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <Label size={10} color={C.textTer} style={{display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Deploy fee — one-time</Label>
                  <Label size={28} color={C.accent} weight={700} style={{lineHeight:1}}>1.5 SOL</Label>
                </div>
                <Label size={13} color={C.textTer}>≈ $270 at $180/SOL</Label>
              </div>
              <div style={{borderTop:`1px solid ${C.border}`}}/>
              {[
                {pct:"50%",label:"Raydium LP seed",detail:"0.75 SOL — immediate liquidity on graduation",col:C.teal,of:"0.75 SOL"},
                {pct:"30%",label:"Protocol",detail:"0.45 SOL — platform revenue",col:C.textSec,of:"0.45 SOL"},
                {pct:"10%",label:"Holder USDC pool",detail:"0.15 SOL — seeds your first hourly drip",col:C.gold,of:"0.15 SOL"},
                {pct:"10%",label:"Anti-PVP infra",detail:"0.15 SOL — identity lock + indexer ops",col:C.purple,of:"0.15 SOL"},
              ].map((r,i,a)=>(
                <div key={r.pct} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 20px",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <Label size={18} color={r.col} weight={700} style={{width:42,flexShrink:0}}>{r.pct}</Label>
                  <div style={{flex:1}}>
                    <Label size={13} color={C.text} weight={500} style={{display:"block"}}>{r.label}</Label>
                    <Label size={11} color={C.textTer}>{r.detail}</Label>
                  </div>
                  <Label size={12} color={r.col} weight={600} style={{flexShrink:0}}>{r.of}</Label>
                </div>
              ))}
            </GlassCard>

            {/* Launch caps */}
            <GlassCard style={{marginBottom:12,overflow:"hidden"}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Launch caps — anti-bundle</Label>
                <Label size={12} color={C.textTer}>Max % of bonding supply (650M tokens) any single wallet can hold in each time window. Enforced on-chain in the buy instruction.</Label>
              </div>
              <div style={{borderTop:`1px solid ${C.border}`}}/>
              {[
                {window:"0 – 7 min",   cap:"1.5%", tokens:"9.75M tokens",col:C.red},
                {window:"7 – 14 min",  cap:"2.0%", tokens:"13M tokens",  col:C.accent},
                {window:"14 – 30 min", cap:"5.0%", tokens:"32.5M tokens",col:C.gold},
                {window:"30 min+",     cap:"Open", tokens:"No cap",       col:C.textTer},
              ].map((r,i,a)=>(
                <div key={r.window} style={{display:"flex",alignItems:"center",padding:"11px 20px",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none",gap:0}}>
                  <Label size={11} color={C.textTer} style={{width:96,flexShrink:0}}>{r.window}</Label>
                  <Label size={20} color={r.cap==="Open"?C.textSec:r.col} weight={700} style={{width:56,flexShrink:0}}>{r.cap}</Label>
                  <Label size={11} color={C.textTer}>{r.tokens}</Label>
                </div>
              ))}
            </GlassCard>

            {/* Anti-snipe delays */}
            <GlassCard style={{marginBottom:12,overflow:"hidden"}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Anti-snipe delays</Label>
                <Label size={12} color={C.textTer}>Applied before the vault snapshot fires after $500K MC is hit and sustained.</Label>
              </div>
              <div style={{borderTop:`1px solid ${C.border}`}}/>
              {[
                {phase:"Pre-graduation",  delay:"1 hour",    reason:"Token is web-only — real protection needed against coordinated snapshot sniping."},
                {phase:"Post-graduation", delay:"5 minutes", reason:"Raydium is live, Jupiter bundles exist — 1hr would be security theatre at this stage."},
              ].map((r,i,a)=>(
                <div key={r.phase} style={{display:"flex",gap:14,padding:"12px 20px",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none",alignItems:"flex-start"}}>
                  <div style={{width:112,flexShrink:0}}>
                    <Label size={10} color={C.teal} weight={600} style={{display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:"0.03em"}}>{r.phase}</Label>
                    <Label size={18} color={C.text} weight={700}>{r.delay}</Label>
                  </div>
                  <Label size={12} color={C.textSec} style={{lineHeight:1.65,paddingTop:3}}>{r.reason}</Label>
                </div>
              ))}
            </GlassCard>

            {/* Protocol revenue */}
            <GlassCard style={{padding:"18px 20px"}} hover={false}>
              <Label size={13} color={C.text} weight={700} style={{display:"block",marginBottom:12}}>Protocol revenue at scale</Label>
              {[
                {src:"Deploy 30%",   note:"50 launches/day × 1.5 SOL × $180 × 0.30",  day:"$4,050/day",  yr:"$2.25M AUD/yr"},
                {src:"Swap 0.10%",   note:"$15M daily platform volume × 0.10%",        day:"$15,000/day", yr:"$8.2M AUD/yr"},
                {src:"Total",        note:"Conservative — volume scales with tokens",   day:"$19,050/day", yr:"$10.4M AUD/yr"},
              ].map((r,i)=>(
                <div key={r.src} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:i<2?`1px solid ${C.border}`:"none"}}>
                  <div>
                    <Label size={13} color={i===2?C.green:C.text} weight={i===2?700:500} style={{display:"block"}}>{r.src}</Label>
                    <Label size={10} color={C.textTer}>{r.note}</Label>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <Label size={13} color={i===2?C.green:C.text} weight={i===2?700:400} style={{display:"block"}}>{r.day}</Label>
                    <Label size={10} color={C.textTer}>{r.yr}</Label>
                  </div>
                </div>
              ))}
              <div style={{marginTop:10,padding:"8px 12px",background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:8}}>
                <Label size={11} color={C.green} style={{lineHeight:1.6}}>At $1M avg vol/token: $56M AUD/yr. You gave holders the big slice on purpose — that's what drives the volume that pays the protocol.</Label>
              </div>
            </GlassCard>
          </div>
        )}

        {/* ── DRIP ───────────────────────────────────── */}
        {activeSection==="drip"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <Label size={22} color={C.text} weight={700} style={{display:"block",marginBottom:6,letterSpacing:"-0.03em"}}>Hourly drip</Label>
            <Label size={14} color={C.textSec} style={{display:"block",marginBottom:18,lineHeight:1.6}}>1% of every swap accumulates on-chain. Every hour the keeper bot snapshots the airdrop eligible holders and distributes. No claiming. Lands in your wallet automatically.</Label>

            {/* How it works step by step */}
            <GlassCard style={{padding:"20px",marginBottom:12}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:16,textTransform:"uppercase",letterSpacing:"0.05em"}}>How it works — each quarter</Label>
              {[
                {n:"1",title:"Fee accumulates",desc:"1% of every buy and sell is routed to an on-chain fee vault (PDA) specific to that token.",col:C.accent},
                {n:"2",title:"Keeper reads airdrop eligible",desc:"The keeper bot scans all token accounts for the mint and finds the airdrop eligible wallets by balance.",col:C.gold},
                {n:"3",title:"Snapshot written on-chain",desc:"update_holder_snapshot is called — the 15 wallets and their share_bps are written to the HolderSnapshot PDA.",col:C.blue},
                {n:"4",title:"Jupiter swap: SOL → USDC",desc:"The accumulated SOL in the fee vault is swapped to USDC via Jupiter v6. Keeper signs the VersionedTransaction.",col:C.teal},
                {n:"5",title:"Distribute per drip mode",desc:"USDC splits to each holder proportionally. Paid as USDC, swapped to tokens, or reinject-bought depending on each wallet's chosen mode.",col:C.green},
                {n:"6",title:"distribute_fees on-chain",desc:"The on-chain distribute_fees instruction is called to zero out accumulated_fees_lamports. Enforces the 1hr minimum between payouts.",col:C.purple},
              ].map((s,i,a)=>(
                <div key={s.n} style={{display:"flex",gap:14,marginBottom:i<a.length-1?18:0}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
                    <div style={{width:26,height:26,borderRadius:8,background:`${s.col}18`,border:`1px solid ${s.col}35`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <Label size={11} color={s.col} weight={700}>{s.n}</Label>
                    </div>
                    {i<a.length-1&&<div style={{width:1,flex:1,background:C.border,marginTop:3,minHeight:14}}/>}
                  </div>
                  <div style={{paddingBottom:i<a.length-1?4:0,paddingTop:2}}>
                    <Label size={13} color={C.text} weight={600} style={{display:"block",marginBottom:3}}>{s.title}</Label>
                    <Label size={12} color={C.textSec} style={{lineHeight:1.65,display:"block"}}>{s.desc}</Label>
                  </div>
                </div>
              ))}
            </GlassCard>

            {/* Drip modes */}
            <GlassCard style={{overflow:"hidden",marginBottom:12}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Drip modes — your choice per token</Label>
                <Label size={12} color={C.textTer}>Set individually for each token you hold. Changes apply to the next hourly cycle. Stored off-chain, signed by your wallet.</Label>
              </div>
              <div style={{borderTop:`1px solid ${C.border}`}}/>
              {[
                {
                  mode:"USDC", icon:"◈", col:C.purple, lock:null, bonus:null,
                  desc:"Your proportional cut arrives as USDC directly in your wallet each quarter. No selling of your token position. Best for passive income off the holding.",
                  ideal:"You want stable realised income without reducing your token bag.",
                },
                {
                  mode:"Token", icon:"◎", col:C.blue, lock:null, bonus:null,
                  desc:"The USDC amount is auto-swapped to more of this token via Jupiter and sent to your wallet. Real on-chain market buy. Accumulates position size.",
                  ideal:"You want to compound into the token without manually reinvesting.",
                },
                {
                  mode:"Reinject", icon:"↺", col:C.green, lock:"72hr lock", bonus:"+10% bonus",
                  desc:"USDC → Jupiter market buy → your token ATA. Creates a visible green candle on the chart. The +10% bonus is funded by the protocol reserve. Your bag is locked for 72 hours after each reinject.",
                  ideal:"You're bullish and want to actively support price while getting a bonus for it.",
                },
              ].map((m,i,a)=>(
                <div key={m.mode} style={{padding:"16px 20px",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none",background:m.mode==="Reinject"?"rgba(34,197,94,0.035)":"transparent"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:16,color:m.col,lineHeight:1}}>{m.icon}</span>
                    <Label size={15} color={m.col} weight={700}>{m.mode}</Label>
                    {m.bonus&&<div style={{padding:"2px 9px",background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:5}}><Label size={10} color={C.green} weight={700}>{m.bonus}</Label></div>}
                    {m.lock&&<div style={{padding:"2px 9px",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:5}}><Label size={10} color={C.textTer}>{m.lock}</Label></div>}
                  </div>
                  <Label size={12} color={C.textSec} style={{lineHeight:1.7,display:"block",marginBottom:6}}>{m.desc}</Label>
                  <div style={{display:"flex",alignItems:"flex-start",gap:6}}>
                    <Label size={10} color={m.col} weight={600} style={{flexShrink:0,paddingTop:1}}>BEST IF</Label>
                    <Label size={11} color={C.textTer} style={{lineHeight:1.5}}>{m.ideal}</Label>
                  </div>
                </div>
              ))}
              <div style={{padding:"10px 16px",background:"rgba(255,255,255,0.02)",borderTop:`1px solid ${C.border}`}}>
                <Label size={11} color={C.textTer} style={{lineHeight:1.6}}>Reinject creates a real on-chain market buy — visible as a green candle on the chart. The +10% is protocol-funded, not taken from other holders.</Label>
              </div>
            </GlassCard>

            {/* Payout example table */}
            <GlassCard style={{overflow:"hidden",marginBottom:12}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Example hourly payouts</Label>
                <Label size={12} color={C.textTer}>Realistic holding distribution across airdrop eligible. 1% split proportionally.</Label>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:360}}>
                  <thead>
                    <tr style={{background:"rgba(255,255,255,0.03)",borderBottom:`1px solid ${C.border}`}}>
                      {["Rank","Holding","$300K/day","$1M/day","$5M/day"].map(h=>(
                        <td key={h} style={{padding:"8px 14px"}}>
                          <Label size={10} color={C.textTer} weight={600} style={{textTransform:"uppercase",letterSpacing:"0.04em"}}>{h}</Label>
                        </td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {rank:1,  pct:"5.0%", v300:"$21/hr", v1m:"$70/hr",  v5m:"$351/hr"},
                      {rank:3,  pct:"3.5%", v300:"$15/hr", v1m:"$49/hr",  v5m:"$246/hr"},
                      {rank:5,  pct:"2.5%", v300:"$11/hr", v1m:"$35/hr",  v5m:"$175/hr"},
                      {rank:8,  pct:"1.5%", v300:"$6/hr",  v1m:"$21/hr",  v5m:"$105/hr"},
                      {rank:11, pct:"1.0%", v300:"$4/hr",  v1m:"$14/hr",  v5m:"$70/hr"},
                      {rank:15, pct:"0.5%", v300:"$2/hr",  v1m:"$7/hr",   v5m:"$35/hr"},
                    ].map((r,i,a)=>(
                      <tr key={r.rank} style={{background:i%2===0?"rgba(255,255,255,0.01)":"transparent",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                        <td style={{padding:"10px 14px"}}><Label size={11} color={i<3?C.gold:C.textTer} weight={700}>#{r.rank}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.text}>{r.pct}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.green}>{r.v300}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.green} weight={600}>{r.v1m}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.gold} weight={700}>{r.v5m}</Label></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderTop:`1px solid ${C.border}`}}>
                <Label size={11} color={C.textTer}>$300K/day = quiet. $1M/day = solid. $5M/day = viral. Rank #1 at $351/hr on a hot token. Rank #15 earns the floor at any volume.</Label>
              </div>
            </GlassCard>

            {/* Eligibility rules */}
            <GlassCard style={{padding:"18px 20px"}} hover={false}>
              <Label size={13} color={C.text} weight={700} style={{display:"block",marginBottom:12}}>Eligibility rules</Label>
              {[
                {q:"Who qualifies?",  a:"Airdrop wallets by token balance at snapshot time. Ranked by raw amount, not % of supply."},
                {q:"When does it start?", a:"Immediately after graduation (LP migration to Raydium). No MC threshold for hourly drip — that's only the vault."},
                {q:"What if I drop out?", a:"Below rank 15 and your drips pause immediately at next snapshot. Re-enter and they resume — no penalty."},
                {q:"Anti-sybil?",     a:"Wallets with same funding source, timing pattern, or correlated buys are clustered as one entity on-chain. Splitting wallets doesn't help."},
                {q:"USDC source?",    a:"The keeper swaps accumulated SOL fees to USDC via Jupiter v6 before distributing. You receive real USDC, not wrapped SOL."},
              ].map((r,i,a)=>(
                <div key={r.q} style={{padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <Label size={12} color={C.gold} weight={600} style={{display:"block",marginBottom:3}}>{r.q}</Label>
                  <Label size={12} color={C.textSec} style={{lineHeight:1.65}}>{r.a}</Label>
                </div>
              ))}
            </GlassCard>
          </div>
        )}

        {/* ── VAULT ──────────────────────────────────── */}
        {activeSection==="vault"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <Label size={22} color={C.text} weight={700} style={{display:"block",marginBottom:6,letterSpacing:"-0.03em"}}>$500K vault</Label>
            <Label size={14} color={C.textSec} style={{display:"block",marginBottom:18,lineHeight:1.6}}>25% of supply (250M tokens) is locked in a PDA vault from the moment the token launches. It unlocks once and drips over 7 days to the top 10 holders.</Label>

            {/* Key numbers */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              {[
                {val:"250M",  sub:"tokens locked", col:C.purple},
                {val:"$500K", sub:"MC trigger",     col:C.gold},
                {val:"7 days",sub:"drip period",    col:C.teal},
              ].map(s=>(
                <GlassCard key={s.val} style={{padding:"14px 16px",textAlign:"center",border:`1px solid ${s.col}20`}} hover={false}>
                  <Label size={22} color={s.col} weight={700} style={{display:"block",lineHeight:1}}>{s.val}</Label>
                  <Label size={10} color={C.textTer} style={{display:"block",marginTop:5}}>{s.sub}</Label>
                </GlassCard>
              ))}
            </div>

            {/* Timeline */}
            <GlassCard style={{padding:"20px",marginBottom:12}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:16,textTransform:"uppercase",letterSpacing:"0.05em"}}>How the vault unlocks</Label>
              {[
                {n:"1",title:"Token hits $500K market cap",desc:"The vault gate opens. The current MC must be sustained — a flash spike does not count.",col:C.accent},
                {n:"2",title:"Hold $500K for 1 full hour",desc:"The keeper bot monitors vault_mc_first_seen on the BondingState. If MC drops before 1hr, the clock resets.",col:C.gold},
                {n:"3",title:"Anti-snipe delay",desc:"After 1hr hold confirmed: 5 min post-graduation (Raydium live), 1 hour pre-graduation (web-only, coordinated sniping is real).",col:C.blue},
                {n:"4",title:"Top 10 snapshot",desc:"The top 10 holders at this exact block are recorded. Their proportional share of the vault is fixed at this moment.",col:C.teal},
                {n:"5",title:"7-day linear drip begins",desc:"~35.7M tokens/day split proportionally across the top 10. Drip mode applies — USDC, token, or reinject.",col:C.green},
              ].map((s,i,a)=>(
                <div key={s.n} style={{display:"flex",gap:14,marginBottom:i<a.length-1?18:0}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
                    <div style={{width:26,height:26,borderRadius:8,background:`${s.col}18`,border:`1px solid ${s.col}35`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <Label size={11} color={s.col} weight={700}>{s.n}</Label>
                    </div>
                    {i<a.length-1&&<div style={{width:1,flex:1,background:C.border,marginTop:3,minHeight:14}}/>}
                  </div>
                  <div style={{paddingBottom:i<a.length-1?4:0,paddingTop:2}}>
                    <Label size={13} color={C.text} weight={600} style={{display:"block",marginBottom:3}}>{s.title}</Label>
                    <Label size={12} color={C.textSec} style={{lineHeight:1.65,display:"block"}}>{s.desc}</Label>
                  </div>
                </div>
              ))}
            </GlassCard>

            {/* Payout example */}
            <GlassCard style={{overflow:"hidden",marginBottom:12}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Example vault payout</Label>
                <Label size={12} color={C.textTer}>Token hits $500K MC, top 10 snapshot taken. 250M tokens dripped over 7 days at $2M MC.</Label>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:340}}>
                  <thead>
                    <tr style={{background:"rgba(255,255,255,0.03)",borderBottom:`1px solid ${C.border}`}}>
                      {["Rank","% held","Vault share","Tokens/day","Value/day"].map(h=>(
                        <td key={h} style={{padding:"8px 14px"}}>
                          <Label size={10} color={C.textTer} weight={600} style={{textTransform:"uppercase",letterSpacing:"0.04em"}}>{h}</Label>
                        </td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {rank:1,  pct:"5%",  share:"12.5%", day:"4.46M",  usd:"$892"},
                      {rank:2,  pct:"4%",  share:"10.0%", day:"3.57M",  usd:"$714"},
                      {rank:5,  pct:"2%",  share:"5.0%",  day:"1.79M",  usd:"$357"},
                      {rank:10, pct:"1%",  share:"2.5%",  day:"0.89M",  usd:"$178"},
                    ].map((r,i,a)=>(
                      <tr key={r.rank} style={{background:i%2===0?"rgba(255,255,255,0.01)":"transparent",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                        <td style={{padding:"10px 14px"}}><Label size={11} color={i<3?C.gold:C.textTer} weight={700}>#{r.rank}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.text}>{r.pct}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.purple}>{r.share}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.teal}>{r.day}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.gold} weight={600}>{r.usd}</Label></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderTop:`1px solid ${C.border}`}}>
                <Label size={11} color={C.textTer}>At $2M MC with 1% holder (rank 10): $178/day in tokens for 7 days = $1,246 total — on top of ongoing quarterly USDC drip.</Label>
              </div>
            </GlassCard>

            {/* FAQ */}
            <GlassCard style={{padding:"18px 20px"}} hover={false}>
              <Label size={13} color={C.text} weight={700} style={{display:"block",marginBottom:12}}>Vault FAQ</Label>
              {[
                {q:"Does it fire more than once?",       a:"No. One trigger per token, ever. Once the airdrop period completes the PDA is empty. The incentive to reach $500K is a one-time event."},
                {q:"What if I'm rank 11 at snapshot?",   a:"You miss the vault. This is intentional — top 10 only, hard cutoff, no partial eligibility."},
                {q:"Can the snapshot be gamed?",         a:"The anti-snipe delay (1hr or 5min depending on phase) exists specifically to prevent late coordinated buys. The 1hr hold requirement prevents flash-spike manipulation."},
                {q:"What's the drip mode for vault?",    a:"Same as your hourly drip setting. USDC, token, or reinject. All three apply to vault tokens equally."},
                {q:"Is it on-chain?",                    a:"Yes. The vault supply is held in a PDA vault account. The trigger, snapshot, and drip are all managed by the Anchor program and keeper bot with no admin keys."},
              ].map((r,i,a)=>(
                <div key={r.q} style={{padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <Label size={12} color={C.purple} weight={600} style={{display:"block",marginBottom:3}}>{r.q}</Label>
                  <Label size={12} color={C.textSec} style={{lineHeight:1.65}}>{r.a}</Label>
                </div>
              ))}
            </GlassCard>
          </div>
        )}

        {/* ── SLOTS ──────────────────────────────────── */}
        {activeSection==="slots"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <Label size={22} color={C.text} weight={700} style={{display:"block",marginBottom:6,letterSpacing:"-0.03em"}}>Launch slots</Label>
            <Label size={14} color={C.textSec} style={{display:"block",marginBottom:18,lineHeight:1.6}}>There is no fixed daily cap. Volume drives availability. Every $10K in platform trading volume unlocks one new slot. The market self-regulates.</Label>

            <GlassCard style={{padding:"20px",marginBottom:10}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>Slot mechanics</Label>
              {[
                {t:"Floor",              v:"10 slots/day minimum — resets to 10 at UTC midnight if below it"},
                {t:"Volume unlock",      v:"Every $10K platform volume = +1 slot added during the day"},
                {t:"Cap tier system",    v:"Platform cumulative volume expands the hard cap over time"},
                {t:"Slot consumed",      v:"Each deploy burns one slot — recovered as others are unlocked by volume"},
                {t:"No manipulation",    v:"Volume must come from real trades — wash trading penalised by anti-sybil"},
              ].map((r,i,a)=>(
                <div key={r.t} style={{display:"flex",gap:14,padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <Label size={12} color={C.accent} weight={600} style={{width:114,flexShrink:0}}>{r.t}</Label>
                  <Label size={12} color={C.textSec} style={{lineHeight:1.6}}>{r.v}</Label>
                </div>
              ))}
            </GlassCard>

            <GlassCard style={{padding:"20px",marginBottom:10}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>Cap tier progression</Label>
              {[
                {tier:"Seed",     vol:"< $500K",     cap:50,  col:C.textTer},
                {tier:"Early",    vol:"$500K",        cap:100, col:C.blue},
                {tier:"Growth",   vol:"$5M",          cap:150, col:C.accent},
                {tier:"Scale",    vol:"$50M",         cap:200, col:C.green},
                {tier:"Peak",     vol:"$500M",        cap:250, col:C.gold},
              ].map((r,i,a)=>(
                <div key={r.tier} style={{display:"flex",alignItems:"center",gap:14,padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <Label size={12} color={r.col} weight={600} style={{width:60,flexShrink:0}}>{r.tier}</Label>
                  <Label size={12} color={C.textTer} style={{width:72,flexShrink:0}}>{r.vol}</Label>
                  <div style={{flex:1,height:4,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                    <div style={{width:`${(r.cap/250)*100}%`,height:"100%",background:r.col,borderRadius:99}}/>
                  </div>
                  <Label size={12} color={r.col} weight={700} style={{width:36,textAlign:"right",flexShrink:0}}>{r.cap}</Label>
                </div>
              ))}
              <div style={{marginTop:12,padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8}}>
                <Label size={11} color={C.textTer} style={{lineHeight:1.6}}>Once the platform crosses a cumulative volume milestone, the hard cap expands permanently. You never go backwards.</Label>
              </div>
            </GlassCard>

            <GlassCard style={{padding:"20px",marginBottom:10}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>What this looks like in practice</Label>
              {[
                {day:"Dead day",    slots:"10 slots",      desc:"Sits at floor. Less launches = more attention per token.",     col:C.textTer},
                {day:"Normal day",  slots:"15 – 25 slots", desc:"Steady volume. Slots open and drain naturally all day.",       col:C.blue},
                {day:"Viral day",   slots:"Up to cap",     desc:"Volume spikes. May push through a tier milestone permanently.",col:C.green},
                {day:"Cap expands", slots:"New hard cap",  desc:"$500K → 100 slots. $5M → 150. $50M → 200. $500M → 250.",     col:C.accent},
              ].map((r,i,a)=>(
                <div key={r.day} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{flex:1}}>
                    <Label size={13} color={C.text} weight={500} style={{display:"block",marginBottom:2}}>{r.day}</Label>
                    <Label size={12} color={C.textTer}>{r.desc}</Label>
                  </div>
                  <div style={{background:`${r.col}15`,border:`1px solid ${r.col}25`,borderRadius:8,padding:"5px 12px",flexShrink:0,whiteSpace:"nowrap"}}>
                    <Label size={12} color={r.col} weight={600}>{r.slots}</Label>
                  </div>
                </div>
              ))}
            </GlassCard>

            <GlassCard style={{padding:"20px"}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>Midnight UTC reset</Label>
              <Label size={13} color={C.textSec} style={{lineHeight:1.7,display:"block"}}>At UTC midnight, if open slots are below the floor of 10, they reset to 10. If already above 10, nothing changes. No camping the clock, no big reset event — just a gentle floor that kicks in on slow days.</Label>
            </GlassCard>
          </div>
        )}

        {/* ── PVP ────────────────────────────────────── */}
        {activeSection==="pvp"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <Label size={22} color={C.text} weight={700} style={{display:"block",marginBottom:6,letterSpacing:"-0.03em"}}>Identity PVP</Label>
            <Label size={14} color={C.textSec} style={{display:"block",marginBottom:18,lineHeight:1.6}}>Link your Twitter or website at deploy. That link activates the identity lock on-chain. Without a link — no lock, no protection. With a link — first mover wins, all derivatives blocked permanently.</Label>

            {/* Link requirement callout */}
            <GlassCard style={{padding:"16px 20px",marginBottom:12,background:"rgba(167,139,250,0.05)",border:`1px solid rgba(167,139,250,0.2)`}} hover={false}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  {state:"No link provided",col:C.textTer,items:["No identity lock","Anyone can copy your narrative","No ticker protection from identity","Only image hash applied"]},
                  {state:"Link provided",col:C.purple,items:["Identity locks to your CA","All derivatives blocked on-chain","Ticker + identity + image locked","First mover wins permanently"]},
                ].map(s=>(
                  <div key={s.state} style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:`1px solid ${s.col}20`}}>
                    <Label size={11} color={s.col} weight={700} style={{display:"block",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.03em"}}>{s.state}</Label>
                    {s.items.map((item,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"flex-start",gap:6,marginBottom:5}}>
                        <span style={{color:s.col,fontSize:10,marginTop:1,flexShrink:0}}>{s.col===C.textTer?"✕":"✓"}</span>
                        <Label size={11} color={s.col===C.textTer?C.textTer:C.textSec} style={{lineHeight:1.5}}>{item}</Label>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* What gets locked */}
            <GlassCard style={{padding:"20px",marginBottom:12}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:14,textTransform:"uppercase",letterSpacing:"0.05em"}}>Identity normalisation — what gets locked</Label>
              {[
                {input:"@elonmusk",                         identity:"elonmusk",    type:"Handle",    blocked:false},
                {input:"x.com/elonmusk",                   identity:"elonmusk",    type:"X link",    blocked:false},
                {input:"https://x.com/elonmusk/status/123",identity:"elonmusk",    type:"Post URL",  blocked:false},
                {input:"elondoge.com",                      identity:"elondoge",    type:"Domain",    blocked:false},
                {input:"@elonmusk_sol",                     identity:"elonmusksol", type:"Derivative",blocked:true},
              ].map((r,i,a)=>(
                <div key={r.input} style={{padding:"11px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <Label size={12} color={C.textSec} style={{fontFamily:"monospace"}}>{r.input}</Label>
                    <Tag color={C.textTer}>{r.type}</Tag>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4h8M5 1l4 3-4 3" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <Label size={12} color={r.blocked?C.red:C.teal} weight={600}>identity: {r.identity}</Label>
                    {r.blocked&&<div style={{padding:"1px 7px",background:"rgba(244,63,94,0.12)",border:"1px solid rgba(244,63,94,0.3)",borderRadius:4}}><Label size={10} color={C.red} weight={600}>BLOCKED</Label></div>}
                    {!r.blocked&&<div style={{padding:"1px 7px",background:"rgba(45,212,191,0.1)",border:"1px solid rgba(45,212,191,0.25)",borderRadius:4}}><Label size={10} color={C.teal} weight={600}>LOCKED</Label></div>}
                  </div>
                </div>
              ))}
              <div style={{marginTop:10,padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8}}>
                <Label size={11} color={C.textTer} style={{lineHeight:1.6}}>All identity strings are normalised (lowercase, stripped) and keccak256 hashed before being written on-chain as identity_hash [u8; 32]. The hash is checked at every deploy.</Label>
              </div>
            </GlassCard>

            {/* Three locks */}
            <GlassCard style={{overflow:"hidden",marginBottom:12}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Three on-chain locks</Label>
                <Label size={12} color={C.textTer}>All three are written to the LockEntry PDA and checked at every deploy attempt.</Label>
              </div>
              <div style={{borderTop:`1px solid ${C.border}`}}/>
              {[
                {lock:"Ticker",   col:C.accent, how:"Blocks exact match + all derivatives. PUNCH blocks PUNCHY, PUNCH2, XPUNCH.",  threshold:"Active from deploy"},
                {lock:"Identity", col:C.teal,   how:"keccak256 of normalised Twitter handle or website domain. Blocks all aliases.", threshold:"Active only with link"},
                {lock:"Image",    col:C.purple, how:"64-bit perceptual dhash. Same image cropped, recoloured, or edited = blocked.",  threshold:"Active from deploy"},
              ].map((r,i,a)=>(
                <div key={r.lock} style={{padding:"13px 20px",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <Label size={13} color={r.col} weight={700}>{r.lock} lock</Label>
                    <div style={{padding:"2px 8px",background:`${r.col}12`,border:`1px solid ${r.col}25`,borderRadius:4}}>
                      <Label size={10} color={r.col}>{r.threshold}</Label>
                    </div>
                  </div>
                  <Label size={12} color={C.textSec} style={{lineHeight:1.6}}>{r.how}</Label>
                </div>
              ))}
            </GlassCard>

            {/* PVP rules */}
            <GlassCard style={{padding:"18px 20px"}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.05em"}}>The rules</Label>
              {[
                "Token crosses $50K market cap — ticker, image, and identity all lock permanently",
                "Token drops below $50K — all locks release. Fair game to compete again",
                "Locks are on-chain in LockEntry PDAs — no admin can override",
                "Identity only locks if you provided Twitter or website at deploy. No link = no identity lock",
                "First mover with a link wins. Late arrivals with the same identity get blocked at the program level",
                "Image lock uses dhash — perceptual similarity, not pixel equality. Recolours and crops are caught",
              ].map((t,i,a)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:i<a.length-1?10:0}}>
                  <div style={{width:4,height:4,borderRadius:"50%",background:C.purple,flexShrink:0,marginTop:6}}/>
                  <Label size={13} color={C.textSec} style={{lineHeight:1.65}}>{t}</Label>
                </div>
              ))}
            </GlassCard>

            {/* PVP examples */}
            <PvpExamples/>
          </div>
        )}

      </div>
    </div>
  );
}

// ===== MAIN APP =====


// ===== SLOT PANEL =====

function SlotPanel({slotData, platformVol, tokens, onClose, onLaunch}) {
  const tierColors = [C.textTer, C.blue, C.accent, C.green, C.gold];
  const curTierIdx = CAP_TIERS.findIndex(t=>t.label===slotData.tier.label);
  const totalVol24h = tokens.reduce((a,t)=>a+(t.volRaw||0),0);
  const avgVol = tokens.length ? totalVol24h/tokens.length : 0;
  const topToken = [...tokens].sort((a,b)=>(b.volRaw||0)-(a.volRaw||0))[0];
  const nearGrad = tokens.filter(t=>(t.raisedSOL||0)>=60&&!t.bondingFull).length;
  const graduated = tokens.filter(t=>t.graduated).length;
  const bonded = tokens.filter(t=>t.bondingFull&&!t.graduated).length;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(20px)",animation:"fadeIn 0.15s ease"}} onClick={onClose}>
      <div style={{background:C.sheet,borderRadius:"24px 24px 0 0",width:"100%",maxWidth:680,maxHeight:"88vh",overflowY:"auto",border:`1px solid ${C.border}`,borderBottom:"none",animation:"slideUp 0.22s ease",paddingBottom:32}} onClick={e=>e.stopPropagation()}>

        {/* Handle */}
        <div style={{display:"flex",justifyContent:"center",paddingTop:12,marginBottom:4}}>
          <div style={{width:36,height:4,borderRadius:99,background:"rgba(255,255,255,0.12)"}}/>
        </div>

        {/* Header */}
        <div style={{padding:"16px 24px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <Label size={22} color={C.text} weight={700}>Launch slots</Label>
            <div style={{marginTop:3}}><Label size={13} color={C.textTer}>Volume drives availability. More trading = more launches.</Label></div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:20,width:36,height:36,cursor:"pointer",color:C.textSec,fontSize:18}}>x</button>
        </div>

        <div style={{padding:"20px 24px 0",display:"flex",flexDirection:"column",gap:14}}>

          {/* Big slot number */}
          <div style={{display:"flex",gap:12}}>
            <div style={{flex:1,background:C.card,border:`1px solid ${slotData.open>5?C.greenBd:slotData.open>0?C.accentBd:C.redBd}`,borderRadius:8,padding:"18px 20px"}}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Open slots now</Label>
              <Label size={48} color={slotData.open>5?C.green:slotData.open>0?C.accent:C.red} weight={700} mono style={{display:"block",lineHeight:1}}>{slotData.open}</Label>
              <Label size={12} color={C.textTer} style={{display:"block",marginTop:6}}>of {slotData.totalAvailable} available / {slotData.cap} cap</Label>
            </div>
            <div style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"18px 20px"}}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Platform volume</Label>
              <Label size={32} color={C.text} weight={700} style={{display:"block",lineHeight:1}}>{fmtVol(platformVol)}</Label>
              <Label size={12} color={C.textTer} style={{display:"block",marginTop:6}}>across {tokens.length} tokens today</Label>
            </div>
          </div>

          {/* Volume bar to next slot */}
          {!slotData.atCap&&(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"16px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <Label size={13} color={C.text} weight={600}>Next slot unlocks in</Label>
                <Label size={13} color={C.accent} weight={700} mono>{fmtVol(slotData.toNextSlot)} vol</Label>
              </div>
              <div style={{height:6,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                <div style={{
                  width:`${Math.max(2,100-Math.min(100,(slotData.toNextSlot/10000)*100))}%`,
                  height:"100%",background:C.accent,borderRadius:99,
                  transition:"width 0.8s ease"
                }}/>
              </div>
              <Label size={11} color={C.textTer} style={{display:"block",marginTop:6}}>Every $10K traded = +1 slot. Keep trading.</Label>
            </div>
          )}

          {/* Tier progression */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"16px 18px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <Label size={13} color={C.text} weight={600}>Cap tier progression</Label>
              <div style={{background:C.accentBg,border:`1px solid ${C.accentBd}`,borderRadius:8,padding:"3px 10px"}}>
                <Label size={11} color={C.accent} weight={600}>{slotData.tier.label} -- {slotData.cap} cap</Label>
              </div>
            </div>
            {/* Tier bars */}
            <div style={{display:"flex",gap:4,marginBottom:10}}>
              {CAP_TIERS.map((tier,i)=>(
                <div key={i} style={{flex:1,height:4,borderRadius:99,background:i<=curTierIdx?tierColors[i]:"rgba(255,255,255,0.08)",transition:"background 0.3s"}}/>
              ))}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {CAP_TIERS.map((tier,i)=>(
                <div key={i} style={{padding:"4px 10px",borderRadius:8,background:i===curTierIdx?"rgba(255,255,255,0.08)":"transparent",border:`1px solid ${i<=curTierIdx?tierColors[i]+"33":"rgba(255,255,255,0.06)"}`}}>
                  <Label size={10} color={i<=curTierIdx?tierColors[i]:C.textQuat} weight={i===curTierIdx?700:400}>{tier.label}: {tier.cap} slots</Label>
                </div>
              ))}
            </div>
            {slotData.nextTier&&(
              <div style={{marginTop:10,padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <Label size={11} color={C.textTer}>To {slotData.nextTier.label} ({slotData.nextTier.cap} slots)</Label>
                  <Label size={11} color={C.text} mono>{fmtVol(slotData.toNextTier)} away</Label>
                </div>
                <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
                  <div style={{width:`${Math.min(100,slotData.tierPct*100)}%`,height:"100%",background:tierColors[curTierIdx+1]||C.gold,borderRadius:99,transition:"width 0.8s ease"}}/>
                </div>
              </div>
            )}
          </div>

          {/* Volume breakdown */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"16px 18px"}}>
            <Label size={13} color={C.text} weight={600} style={{display:"block",marginBottom:12}}>Volume summary</Label>
            <div style={{display:"flex",flexDirection:"column",gap:0}}>
              {[
                ["Total platform vol", fmtVol(platformVol), C.text],
                ["Avg vol per token", fmtVol(avgVol), C.textSec],
                ["Hottest token", topToken?`${topToken.sym} -- ${topToken.vol}`:"--", C.accent],
                ["Near graduation", `${nearGrad} token${nearGrad!==1?"s":""}`, C.purple],
                ["Bonded (migrating)", `${bonded} token${bonded!==1?"s":""}`, C.gold],
                ["Graduated to Raydium", `${graduated} token${graduated!==1?"s":""}`, C.green],
              ].map(([label,val,col],i,a)=>(
                <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:i<a.length-1?`1px solid rgba(255,255,255,0.05)`:"none"}}>
                  <Label size={12} color={C.textTer}>{label}</Label>
                  <Label size={12} color={col} weight={600} mono>{val}</Label>
                </div>
              ))}
            </div>
          </div>

          {/* How slots work */}
          <div style={{background:"rgba(255,159,10,0.06)",border:`1px solid rgba(255,159,10,0.15)`,borderRadius:8,padding:"16px 18px"}}>
            <Label size={13} color={C.accent} weight={600} style={{display:"block",marginBottom:10}}>How slots work</Label>
            {[
              "Platform starts with 50 launch slots per day",
              "Every $10K traded unlocks +1 slot up to the current cap",
              "Volume milestones expand the cap: $500K to Tier 2 (100), $5M to Tier 3 (150), and so on",
              "Minimum 10 slots always open regardless of volume",
              "Midnight UTC resets the day -- unused slots don't carry over",
            ].map((s,i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:i<4?8:0}}>
                <div style={{width:5,height:5,borderRadius:"50%",background:C.accent,flexShrink:0,marginTop:5}}/>
                <Label size={12} color={C.textSec}>{s}</Label>
              </div>
            ))}
          </div>

          {/* CTA */}
          <Btn full color={C.accent} onClick={()=>{onClose();onLaunch();}}>
            Launch a token -- {slotData.open} slot{slotData.open!==1?"s":""} remaining
          </Btn>

        </div>
      </div>
    </div>
  );
}


// ===== TAB FEED =====

function FeedRow({t, onClick, rank}) {
  const p = PALETTES[t.pi%8], up = t.chg>0, as = getAS(t);
  const solPct = Math.min(100,((t.raisedSOL||0)/85)*100);
  const barCol = t.bondingFull?C.green:(t.raisedSOL||0)>=60?C.purple:p.a;
  const spark = Array.from({length:16},(_,i)=>Math.max(0.2,0.5+Math.sin(i*0.5+t.pi)*0.25+Math.random()*0.35));

  return (
    <div onClick={()=>onClick(t)} style={{
      display:"flex",alignItems:"center",gap:0,
      padding:"0 20px",height:64,
      borderBottom:`1px solid rgba(255,255,255,0.04)`,
      cursor:"pointer",transition:"background 0.1s",position:"relative"
    }}
      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

      {/* Rank */}
      <div style={{width:28,flexShrink:0,textAlign:"center"}}>
        <Label size={11} color={rank<=3?C.gold:"rgba(255,255,255,0.18)"} weight={700} mono>{rank}</Label>
      </div>

      {/* Avatar */}
      <div style={{marginRight:12,flexShrink:0}}>
        <Avatar sym={t.sym} pi={t.pi} size={36}/>
      </div>

      {/* Name + desc */}
      <div style={{width:130,flexShrink:0}}>
        <Label size={14} color={C.text} weight={700} style={{display:"block",letterSpacing:"-0.02em"}}>{t.sym}</Label>
        <Label size={11} color={C.textQuat} style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>{t.name}</Label>
      </div>

      {/* Sparkline */}
      <div style={{width:72,flexShrink:0,marginRight:16}}>
        <Spark data={spark} color={up?C.green:C.red} width={72} height={26}/>
      </div>

      {/* MC */}
      <div style={{width:90,flexShrink:0}}>
        <Label size={14} color={C.text} weight={600} mono style={{display:"block"}}>{fmt(t.mcap)}</Label>
        <Label size={11} color={up?C.green:C.red} weight={500} mono>{up?"+":""}{t.chg.toFixed(1)}%</Label>
      </div>

      {/* Vol */}
      <div style={{width:72,flexShrink:0}}>
        <Label size={11} color={C.textQuat} style={{display:"block",marginBottom:2}}>vol</Label>
        <Label size={13} color={C.textSec} weight={500} mono>{t.vol}</Label>
      </div>

      {/* Holders */}
      <div style={{width:60,flexShrink:0}}>
        <Label size={11} color={C.textQuat} style={{display:"block",marginBottom:2}}>holders</Label>
        <Label size={13} color={C.textSec} weight={500} mono>{t.holders.toLocaleString()}</Label>
      </div>

      {/* Bonding bar OR raydium badge */}
      <div style={{flex:1,marginLeft:16}}>
        {t.graduated?(
          <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",
            background:C.raydiumBg,border:`1px solid ${C.raydiumBd}`,borderRadius:20}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:C.raydium}}/>
            <Label size={11} color={C.raydium} weight={600}>Raydium</Label>
          </div>
        ):(
          <div>
            <div style={{height:3,background:"rgba(255,255,255,0.05)",borderRadius:99,overflow:"hidden",marginBottom:4}}>
              <div style={{width:`${solPct}%`,height:"100%",background:barCol,borderRadius:99,transition:"width 1.2s ease"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <Label size={10} color={C.textQuat} mono>{t.raisedSOL||0} / 85 SOL</Label>
              <Label size={10} color={barCol}>{t.bondingFull?"bonded":(t.raisedSOL||0)>=60?"near grad":`${85-(t.raisedSOL||0)} left`}</Label>
            </div>
          </div>
        )}
      </div>

      {/* Status dot */}
      <div style={{width:24,flexShrink:0,display:"flex",justifyContent:"center"}}>
        {as.s==="live"&&<div style={{width:6,height:6,borderRadius:"50%",background:C.green,animation:"pulse 2s infinite"}}/>}
        {as.s==="pending"&&<div style={{width:6,height:6,borderRadius:"50%",background:C.gold}}/>}
        {t.topicLocked&&<div style={{width:6,height:6,borderRadius:"50%",background:C.teal}}/>}
      </div>
    </div>
  );
}

function TabFeed({tokens, onSelect}) {
  const [tab, setTab] = useState("new");

  const tabs = [
    {id:"new",    label:"New",         color:C.blue,   tokens: [...tokens].filter(t=>t.elapsed<=90).sort((a,b)=>a.elapsed-b.elapsed)},
    {id:"hot",    label:"Hot",         color:C.accent, tokens: [...tokens].filter(t=>t.chg>30&&!t.graduated).sort((a,b)=>(b.volRaw||0)-(a.volRaw||0))},
    {id:"near",   label:"Near Grad",   color:C.purple, tokens: [...tokens].filter(t=>(t.raisedSOL||0)>=40&&!t.bondingFull).sort((a,b)=>(b.raisedSOL||0)-(a.raisedSOL||0))},
    {id:"bonded", label:"Bonded",      color:C.gold,   tokens: [...tokens].filter(t=>t.bondingFull&&!t.graduated).sort((a,b)=>(b.volRaw||0)-(a.volRaw||0))},
    {id:"grad",   label:"Graduated",   color:C.raydium,tokens: [...tokens].filter(t=>t.graduated).sort((a,b)=>(b.volRaw||0)-(a.volRaw||0))},
  ];

  const active = tabs.find(t=>t.id===tab);

  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>

      {/* Tab bar */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,padding:"0 8px"}}>
        {tabs.map(t=>{
          const isActive = t.id===tab;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              position:"relative",height:46,padding:"0 16px",background:"transparent",border:"none",
              cursor:"pointer",display:"flex",alignItems:"center",gap:7,transition:"opacity 0.15s",
              opacity:isActive?1:0.45,
            }}
              onMouseEnter={e=>{if(!isActive)e.currentTarget.style.opacity="0.7"}}
              onMouseLeave={e=>{if(!isActive)e.currentTarget.style.opacity="0.45"}}>
              <Label size={13} color={isActive?t.color:C.textSec} weight={isActive?700:500}
                style={{letterSpacing:"-0.02em"}}>{t.label}</Label>
              <div style={{
                padding:"1px 7px",borderRadius:20,
                background:isActive?`${t.color}22`:"rgba(255,255,255,0.05)",
                border:`1px solid ${isActive?t.color+"44":C.border}`,
              }}>
                <Label size={10} color={isActive?t.color:C.textQuat} weight={600}>{t.tokens.length}</Label>
              </div>
              {/* Active indicator line */}
              {isActive&&<div style={{position:"absolute",bottom:0,left:8,right:8,height:2,
                background:t.color,borderRadius:"2px 2px 0 0"}}/>}
            </button>
          );
        })}
      </div>

      {/* Column headers */}
      <div style={{display:"flex",alignItems:"center",gap:0,padding:"0 20px",height:32,
        background:"rgba(255,255,255,0.02)",borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
        <div style={{width:28}}/>
        <div style={{width:48,marginRight:12}}/>
        <div style={{width:130}}><Label size={10} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Token</Label></div>
        <div style={{width:72,marginRight:16}}/>
        <div style={{width:90}}><Label size={10} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Market cap</Label></div>
        <div style={{width:72}}><Label size={10} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Volume</Label></div>
        <div style={{width:60}}><Label size={10} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Holders</Label></div>
        <div style={{flex:1,marginLeft:16}}><Label size={10} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Bonding</Label></div>
        <div style={{width:24}}/>
      </div>

      {/* Rows */}
      {active.tokens.length>0?(
        <div>
          {active.tokens.map((t,i)=>(
            <FeedRow key={t.id} t={t} onClick={onSelect} rank={i+1}/>
          ))}
        </div>
      ):(
        <div style={{padding:"48px 24px",textAlign:"center"}}>
          <Label size={13} color={C.textQuat}>Nothing here yet</Label>
        </div>
      )}
    </div>
  );
}


export default function SummitMoon() {
  const [selected,setSelected]=useState(null);
  const [launching,setLaunching]=useState(false);
  const [connected,setConnected]=useState(false);
  const [walletPubkey,setWalletPubkey]=useState(null);

  const connectWallet = async () => {
    try {
      const provider = window?.solana;
      if (!provider?.isPhantom) { window.open("https://phantom.app","_blank"); return; }
      const resp = await provider.connect();
      setWalletPubkey(resp.publicKey.toString());
      setConnected(true);
    } catch(e) { console.error(e); }
  };

  const disconnectWallet = async () => {
    try { await window?.solana?.disconnect(); } catch(e) {}
    setConnected(false); setWalletPubkey(null);
  };
  const [filter,setFilter]=useState("hot");
  const [view,setView]=useState("feed");
  const [showNotifs,setShowNotifs]=useState(false);
  const [showSlots,setShowSlots]=useState(false);
  const [tokens,setTokens]=useState(INIT_TOKENS);
  const [notifs]=useState(MOCK_NOTIFS);
  const [platformVol,setPlatformVol]=useState(()=>INIT_TOKENS.reduce((a,t)=>a+(t.volRaw||0),0));

  useEffect(()=>{
    const iv=setInterval(()=>{
      setTokens(prev=>{
        const updated=prev.map(t=>{
          const volDelta=Math.floor(Math.random()*2000);
          return {...t,mcap:Math.max(100000,t.mcap*(1+(Math.random()-0.49)*0.007)),chg:parseFloat((t.chg+(Math.random()-0.5)*0.4).toFixed(1)),volRaw:(t.volRaw||0)+volDelta};
        });
        setPlatformVol(updated.reduce((a,t)=>a+(t.volRaw||0),0));
        return updated;
      });
    },3000);
    return ()=>clearInterval(iv);
  },[]);

  const unread=notifs.filter(n=>!n.read).length;
  const slotData={open:50,totalAvailable:50,cap:50,atCap:false,toNextSlot:0,tierPct:1,atFloor:false,tier:{label:"Launch"},nextTier:{cap:100,vol:100000}};
  const filtered=tokens.filter(t=>{
    if(filter==="hot") return t.chg>50&&t.mcap>500000;
    if(filter==="new") return t.elapsed<=30&&t.mcap<500000;
    if(filter==="neargrad") return (t.raisedSOL||0)>=60&&!t.bondingFull;
    if(filter==="graduated") return t.graduated;
    return t.chg>50&&t.mcap>500000;
  });

  if(selected) return <TokenPage t={selected} onClose={()=>setSelected(null)} connected={connected} onConnect={connectWallet}/>;
  if(view==="portfolio") return <Portfolio onSelectToken={t=>{setView("feed");setSelected(t);}} onClose={()=>setView("feed")}/>
  if(view==="tokenomics") return <Tokenomics onClose={()=>setView("feed")}/>;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans}}>
      <style>{FONT}</style>

      {/* Nav bar — editorial, hairline bottom */}
      <nav style={{position:"sticky",top:0,zIndex:100,background:"rgba(13,12,11,0.92)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderBottom:`1px solid ${C.border}`,height:52,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAN80lEQVR42u2ce3Bc1X3Hv79zzt2HXrZsLMAYDNZKDuJRqJJCaOglE0hM7Vi2yTXYro3Nq01nWqBtpgXaWW9DMp1OMkPTyQyhtmnLI8AWv43tSQDf/EHdJA7GTBWwZNlyRBzkWg+vHrt7zzm//rG7siyLh1v0Ivczo5G0q9179nzP+T3PFRASEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhLyiUOfkjFzKMAYkUxCYJ8rAGD9Pt8QnTvZzKDlyz3R0NlJuMW3qRRsuLf+nwvD8zzJfO4CcV0oz5s3beXCy6q9W+dNa2yE84HCTYEFRpNw4kU6nTalB1bffkW9isublaTPA+IzAnwRA5WgwuCZkWPmbgba2OKnOjA/OXbaHPD99mxogs7T1JRMx23XXlg+N1F5l5RiDQg3xiIyQoJgDMNYhhIEKQW0scjlbQ7ASYB7reUsg/uJqTVnzKs2q19P7D3+fqrgIyaln1CTYRCe58lUKm0AOPcuq/tjR4mHolFRywwE2iIfmIAJ7EgZEUTI5k2L1Wa7MbynL89vpfe0njz7/ebE4zY2W4Oi4Q74iOsnk6BUCnbdknlfiETVE7GIajTGQhs2hfExCyGkkoR83rwRBPaJ/z6R3bl/f8fgKDYf69eDR3PUoQAfMvlrl9U+UhZxHpeSRKCNBkgIQYIta8cRKh+YU0Eef7Nxy+ENo8SfRKObF5oKIaqY4Mnn+726TdMrot+2zAi0MQApAMJaq6MRqfJ585/dvfaGjVsOb2AGPfBAowOAVjbVXbdqQWIOuCDCB+QGk34nTIQA5HmeSKXA93+t7oWKMmddLq8DIhARyUJczzriKJUZCLYfPD7wpRf3tB5Juq4iAl/8bgUD4JjArdEy/BMReL3ryqkab4+7AEnXlel02tx3R93GqorI8mzWBETCIVBxFbOJRZXK5oLdG19uWbZ/f8eg50GmfF8Pfx/D3De9MrrsnmV1f5Dyfe15kKEAH4Hruirl+/ruJbWPVZY76wazOiCioUTKWlglpRzM6l/+5j1xJwM2mYRIp2HOGTghrhSxkvSk686NAd6ULK2MmwCeB+n7vl7bVHdzZZnzeC4wmgFVyKYABrOUYGM4dzob3LX9jXczy70zucG5HpZ0NmcoHlNX1l3g/G06nTbJKWiKxksAamgAezfOiTsONhARrIUgGh4wso0oKQcD8/gLO44eSrquGm3lD+0W2EEhCIG2uVhUPbpqUe3vTkVTNC4CJF1XplKwVbNjf1ZR7tRrY7UQJAqhCoPB1pFSDGTN0aOn8t9JJiFSvj/65N/iWwAUUfJea5kJiGrDvfGYeNJ1oaaaKRoPASjl+2blwsuqlZLfCAK2AAkwwFxY/kRgIYkCrb/r++3ZYvWTR/UhKdh7lyVWVFU4NwbaBP2Devtg1mwSgi6trU48NtIUJZMQpSRtMiLHYfUrv73dfvbqWV+vrHCWBsYaIpLD1igLQSKfN10nsvn7W1p6c357O5dKFFdd1SyamwtiHGtv5zcXz6+Uxt7Els20isiVubw50Kda/1Tlq2lGdfRbicunv/S9vb/oTCYhfB9c+pqsu2LMV8b6gikRjqJ11oLPhJuAKPxoHCnAjD27dh3v9jxvaPWn02kz3A8QwNHOfv3cjiPf7+zqW9s3GHRFI2Jx7r2ZZYjg6cxA8ENF9q8WLEhESz2ENQsTX1vVVHczAJ6M/mFMBfA8SAJ49eLE7yglrw60BQFSlCJ+PpOyBpr3AqDq6jYBAN6X58y49476f1u7pLYJAJLFsab3dwwmk8DWV399KjMQrC6LOxUXXTLzoafTrSefeunwShD9fHY5PZryfd3YCCcao3+sjInnb7v2wvKGhsm3E8ZUgIZOlwDAcfDlqCOImQ0A2GLtgAsLXWVzxuocfgaA3y1kuhCCqqdXOmscR1xddABDY02lYJOuq57Z1vZKV0/uCSXo7/7otgvLmUFPb2590hp7ydqF8+ouxsWOtnwoHpVzLk9UbSq+Tv7WCNBc4zMASKLfZwBERGd7VrJSEIyxnd3v97UPf6YsFp2T6QuyPRl+apgpGyLl+ybpumrj5paH89q+7VRWPloKaoUw3zRK3LbzwImBjiOZVf1Z3VlVFVm+dlntIynf10nXVb8NAlA6DeO6UELQldYyUGwxDrcBVLBH7+08cGKAAbqlFB0oebNl/nl6T+tJz/PkKBVPhu9bBmiwn5sE8IcrFtVfkARo0+Zj7ad7glcWLEhEbzr0/iAY2XxgMa08+u3VX61tmkwijJkApdm6dMa8GUS40FoGgwlnxZfMBFhBpAFgffKMNsymylj7AgBq6Owc1W6nALvcg3huT2uHDviRmGNXpwDruq7a5rcfu+GG1iAFWK1tOq9NXz5v3p9e5bx0zx3zPztZkraxG0AxDLymfubcqCMeKlogOrtYzCYSkWowa55/852uH9fUQJwsb0dzM/i6+hnXW9Zb33q3t6cUlo5q5poL0c3zW7pbrpk/fca1DdW9O/YczACF6wOgN9/p+lHi0qoWzfagI8UsnTezGuurW57d0n1qop3ymO2A5ubCB3OkKZeFeJPP3iGsYzHlZDLB05u2tPx1qehWCjsDrfdefl378REbalSKr6FntrW98qsuc3qoWnGmJ8Av7jmazkXbvt9xsu+BYMB+MxBYsnrJZ2aeiXAnhnGwgw7onB4h63hMqUx/8B8bNrfcU2zIn/Unz+469hZ2nb/V+6DTEMVrGOC9QwCw+Kb5P4iWD9YC6C691nWhcrk5zsh255TcAcWYG1YHueEOmJl1LKpUf3/w+i/aDq9MJiHWp0btXn2iq7JUVS3mE7T9jXcz6R+1Hxx+3RrMvaAmri4bzzrZmF2kOKnI5US3tZwVRGBmHY1INTAYvP2bztyyAwegSxnuh/jxT5TUGdM01DNOFpw/OWWytrJclhd3zNTeAaVPZ0/n/geEUyBAKaFyedNxql8v2ua393gfUu8fB3iEv+JIVNwqCbmSUlM9D+BkEiK9v2OQLR+ORgSMsT2ZTG5Remfbcc+D/LB6/zhC6TTsqgWJKiK6qYsHjhbnn6e6ACgVxLTlQ9Yyegf00md3HXvro5ot40mxNMHxOO4RAmrnzhMDnudJjJMAYxoFlUoRgTF7T3bb5ud2HNmXLPaFJ0klgJpranjBgkRUOfKxnLb/UKhhdU7FY/sfY7V9zMZIMgkxHqWCBxobHQBYtzTx3QdXN/CdX5l7+fmMcypBH/NDUXH7D/flNJaTv7ap9isP393A991R99qndfI/FsPrMisWzqu7z6v/i/PdOR978gun63DXgrnXf/3O+V0Pr2ngu5tqlxR9wrgW6SaFrSud73TdWRX1NdMflEJ8ozyupvVm8hs2vNxyf2liPgHfQUnXlSnf16sWXfG5irLIznhM1mT6g7cPHmtpXHQAppgnfAqKcefhF77og9csmbfi4qryH5bFHM8yx7S2QXmZ87lr6qt/b/ZFVa8+te9gxvMgr7oKQz3i85x45be3W7+93a5tqr2zvMx5WUmqBoDBvF67+7XuwzXe/+m9p+4O8DxPptNps2bxvHUzp8c25QMLY60mIklEVMqc84E5nsvbhze+3LJ5+EpurvE5nR7KbEf6HCokWB5Kd9x4X0jMmjFb/H3EkX8SaGuiESn7B4IXN7zccldpLOPuHCfYMVPrfyUq4hX0Tiwia7SxTETqzNAYAIxSQhKAXN7uzgXBd/51S9tr55ixUrNnlHsDvAWJWdPKaK1S4sFYVF6SzelAOcIJAnu8q2fg+obPd/SsT4FpAk5TT5gAL3meXJ5Om3VLEt+aVhV5NJvTWggxqgPkQvOYYxEhtGEYY3+mjd2qA/t6V2bw8NZXf31q+N+7c+fGLrrSuaQsjusjjrhdEC2KRmRNYCy0toFSQoKRzwwa99+3tvx0IrPyCRGgdD/Ymq9ecW1ZWWS/EIgwF48qfjjFIy6CpCDkA4vAmC5r+ASATMGhU1wQqgFcHItKp3h8EdZawwyWQkgAON0XLH1mx5FtrusqfwITwwnpizY3ewSkwVJcoaSIW2YwWwNAntU04xEtfCLJzMgFxgqCBUg6Ss4QDmYMt1qWGcYw8toaMDOIJBispFDWcj7TH6x4ZkfbtsmQlcuJEaCZk0mI7/2g+526y6oORR1xe8SRcWOsLiVfIzcDFcrZICIQiLhY12cGWwu2zNYay8YUTFZRO8EgENhGI0ppY0/0ntbLntvVtnuylEQmLAz1/UK19J//pfuX8y+t3i4kXRePqcuZQZZZA4VbZkpCUOEWmiHDWfp92DdBRGJY9swAG0cJ6SghBrN6d0+PaXphz5G3JlM9asITsWEOUN67NPHnkaj8y2hEXmIMI9DWAoXDvEIQMTOdNfCiIFzI5JgZTGBrGcJRJKQUyOX1sWzePv705taNI66HUIARThkAVn9p9sxYdfkDJGhdxBF1UggYy7DGghmWwbZwl/wwLRhEgoSSBCkI2jBygWm2jI293Xpj+sdtvcyg9QQa70x3SggwMjErhZLzrpdflFIukpJuBijhKIpLWTRFXDrZUrh73mg7AKIWtvyTnLY73t7Suu8AEEzGVT9pBRhZrxn+4Gpv3mUqEFcIKS4lYBqIhTVsiNBjiH6lLB/dsKW146x8oBBiGkzhf2czoUJ4HuT5VieTrquKldUp0VSZKp2fodpOZ6dLtwx7Yh+AmhqfGxrA4f8JCgkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQEA/C+lMcJJ+bJASAAAAABJRU5ErkJggg==" style={{width:22,height:22,objectFit:"contain",flexShrink:0,opacity:0.55}} alt="summit.moon"/>
          <span style={{fontSize:14,fontWeight:400,color:"rgba(250,246,239,0.7)",fontFamily:C.serif,letterSpacing:"-0.01em",fontStyle:"italic"}}>summit<span style={{fontStyle:"normal",color:"rgba(201,168,76,0.7)",fontWeight:400}}>.</span>moon</span>
          <div style={{width:5,height:5,borderRadius:"50%",background:C.green,animation:"pulse 3s infinite",boxShadow:`0 0 5px ${C.green}`}}/>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {connected&&(
            <button onClick={()=>setView("portfolio")} style={{height:32,padding:"0 14px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:4,color:C.textSec,fontSize:12,fontWeight:500,cursor:"pointer",transition:"all 0.15s",letterSpacing:"0.01em",fontFamily:C.sans,textTransform:"uppercase"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.borderMd;e.currentTarget.style.color=C.text;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.textSec;}}>
              Portfolio
            </button>
          )}
          <button onClick={()=>setView("tokenomics")} style={{height:32,padding:"0 14px",background:"transparent",border:"none",color:C.textTer,fontSize:12,fontWeight:400,cursor:"pointer",transition:"color 0.15s",letterSpacing:"0.01em",fontFamily:C.sans,textTransform:"uppercase"}}
            onMouseEnter={e=>e.currentTarget.style.color=C.text}
            onMouseLeave={e=>e.currentTarget.style.color=C.textTer}>
            Tokenomics
          </button>
          <button onClick={()=>setLaunching(true)} style={{height:32,padding:"0 16px",background:C.accent,border:"none",borderRadius:4,color:"#0d0c0b",fontSize:12,fontWeight:600,cursor:"pointer",transition:"opacity 0.15s",letterSpacing:"0.04em",fontFamily:C.sans,textTransform:"uppercase"}}
            onMouseEnter={e=>e.currentTarget.style.opacity="0.85"}
            onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
            Launch
          </button>
          <button onClick={()=>setShowNotifs(x=>!x)} style={{position:"relative",width:32,height:32,background:"transparent",border:`1px solid ${C.border}`,borderRadius:4,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"border-color 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.borderMd}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5A4.5 4.5 0 0 0 3.5 6v2.5L2 10.5h12L12.5 8.5V6A4.5 4.5 0 0 0 8 1.5ZM6 12a2 2 0 0 0 4 0" stroke="rgba(250,246,239,0.45)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {unread>0&&<div style={{position:"absolute",top:6,right:6,width:5,height:5,borderRadius:"50%",background:C.red}}/>}
          </button>
          <button onClick={()=>connected?disconnectWallet():connectWallet()} style={{height:32,padding:"0 14px",background:connected?"transparent":C.accent,border:`1px solid ${connected?C.border:C.accent}`,borderRadius:4,color:connected?C.textSec:"#0d0c0b",fontSize:12,fontWeight:500,cursor:"pointer",transition:"all 0.15s",letterSpacing:"0.01em",fontFamily:C.mono}}>
            {connected?(walletPubkey?walletPubkey.slice(0,4)+"..."+walletPubkey.slice(-4):"Connected"):"Connect"}
          </button>
        </div>
      </nav>

      {showNotifs&&<NotifPanel onClose={()=>setShowNotifs(false)}/>}

      {/* Top 10 by volume bar */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        <div style={{display:"flex",alignItems:"stretch",minWidth:"max-content",padding:"0 16px"}}>
          {[...tokens].sort((a,b)=>(b.volRaw||0)-(a.volRaw||0)).slice(0,10).map((t,i)=>{
            const up=t.chg>0;
            const rankCol = i===0?C.gold:i<3?"rgba(255,255,255,0.55)":C.textQuat;
            return (
              <div key={t.id} onClick={()=>setSelected(t)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"0 14px",height:44,borderRight:`1px solid ${C.border}`,cursor:"pointer",flexShrink:0,transition:"background 0.12s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{fontSize:11,fontWeight:700,color:rankCol,fontFamily:"ui-monospace,monospace",width:14,flexShrink:0}}>{i+1}</span>
                <Avatar sym={t.sym} pi={t.pi} size={22}/>
                <span style={{fontSize:13,fontWeight:600,color:C.text,letterSpacing:"-0.01em"}}>{t.sym}</span>
                <span style={{fontSize:12,fontWeight:500,color:C.textTer,fontFamily:"ui-monospace,monospace"}}>{t.vol}</span>
                <span style={{fontSize:11,fontWeight:500,color:up?C.green:C.red,fontFamily:"ui-monospace,monospace"}}>{up?"+":""}{t.chg.toFixed(1)}%</span>
                {i===0&&<div style={{width:5,height:5,borderRadius:"50%",background:C.gold,flexShrink:0}}/>}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 20px 100px"}}>

        {/* Top bar: slots + platform vol */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,gap:10}}>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"6px 14px",display:"flex",gap:8,alignItems:"center"}}>
              <Label size={12} color={C.textTer}>Vol</Label>
              <Label size={13} color={C.text} weight={600} mono>{fmtVol(platformVol)}</Label>
            </div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"6px 14px",display:"flex",gap:8,alignItems:"center"}}>
              <Label size={12} color={C.textTer}>Tokens</Label>
              <Label size={13} color={C.text} weight={600} mono>{tokens.length}</Label>
            </div>
            <div style={{background:"rgba(48,209,88,0.08)",border:"1px solid rgba(48,209,88,0.2)",borderRadius:10,padding:"6px 14px",display:"flex",gap:6,alignItems:"center"}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:C.green,animation:"pulse 2s infinite",flexShrink:0}}/>
              <Label size={12} color={C.textTer}>Holder pool/hr</Label>
              <Label size={13} color={C.green} weight={700} mono>{fmtVol((platformVol*FEE_AIRDROP)/24)}</Label>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,background:C.card,border:`1px solid ${slotData.open>0?C.border:C.redBd}`,borderRadius:10,padding:"6px 14px",cursor:"pointer"}} onClick={()=>setShowSlots(true)}>
            <div style={{width:6,height:6,borderRadius:"50%",background:slotData.open>5?C.green:slotData.open>0?C.gold:C.red,flexShrink:0}}/>
            <Label size={12} color={slotData.open>0?C.text:C.red} weight={500}>{slotData.open} slots open</Label>
            <Label size={11} color={C.textQuat}>/ {slotData.cap} cap</Label>
          </div>
        </div>

        {/* Swim lanes */}
        <TabFeed tokens={tokens} onSelect={setSelected}/>

      </div>

      {launching&&<LaunchModal onClose={()=>setLaunching(false)} slotData={slotData}/>}
      {showSlots&&<SlotPanel slotData={slotData} platformVol={platformVol} tokens={tokens} onClose={()=>setShowSlots(false)} onLaunch={()=>setLaunching(true)}/>}
    </div>
  );
}