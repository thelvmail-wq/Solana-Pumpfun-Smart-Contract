import { buildSwapTx, buildCreateRegistryTx, buildClaimLocksTx, fetchDeployedTokens, fetchAllTokensWithPools, connection, sha256, fetchHolderCount, fetchCandles } from "./solana.js";
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
  @media (max-width: 640px) {
    .feed-row { padding: 12px 10px !important; }
    .feed-table-header { display: none !important; }
    .feed-hide-mobile { display: none !important; }
    .feed-token-name { font-size: 13px !important; }
    .nav-desktop-only { display: none !important; }
  }
`;

// ── Warm dark palette — editorial luxury ───────────────────────
const C = {
  bg:       "#0d0c0b",
  surface:  "#111009",
  card:     "#161410",
  cardUp:   "#1c1916",
  sheet:    "#201d19",
  border:   "rgba(255,248,235,0.07)",
  borderMd: "rgba(255,248,235,0.11)",
  borderHi: "rgba(255,248,235,0.18)",
  text:     "#faf6ef",
  textSec:  "rgba(250,246,239,0.58)",
  textTer:  "rgba(250,246,239,0.32)",
  textQuat: "rgba(250,246,239,0.16)",
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
  accent:   "#c9a84c",
  accentBg: "rgba(201,168,76,0.08)",
  accentBd: "rgba(201,168,76,0.2)",
  raydium:  "#9945FF",
  raydiumBg:"rgba(153,69,255,0.08)",
  raydiumBd:"rgba(153,69,255,0.18)",
  serif:    "'Instrument Serif', Georgia, serif",
  mono:     "'Geist Mono', 'SF Mono', ui-monospace, monospace",
  sans:     "'Inter', system-ui, sans-serif",
};

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

const CAP_WINDOWS = [
  {until:7,pct:"1.5%",label:"0-7 min"},{until:14,pct:"2%",label:"7-14 min"},
  {until:30,pct:"5%",label:"14-30 min"},{until:999,pct:"Open",label:"30 min+"},
];

// ===== SLOT ENGINE =====
const SLOT_FLOOR = 10;
const CAP_TIERS = [
  {vol: 0,          cap: 50,  label: "Tier 1"},
  {vol: 500000,     cap: 100, label: "Tier 2"},
  {vol: 5000000,    cap: 150, label: "Tier 3"},
  {vol: 50000000,   cap: 200, label: "Tier 4"},
  {vol: 500000000,  cap: 250, label: "Tier 5"},
];

function getCurrentTier(totalVolume) {
  for(let i = CAP_TIERS.length-1; i >= 0; i--) {
    if(totalVolume >= CAP_TIERS[i].vol) return CAP_TIERS[i];
  }
  return CAP_TIERS[0];
}

function getNextTier(totalVolume) {
  for(let i = 0; i < CAP_TIERS.length; i++) {
    if(totalVolume < CAP_TIERS[i].vol) return CAP_TIERS[i];
  }
  return null;
}

function calcSlots(totalVolume, tokensLaunched) {
  const tier     = getCurrentTier(totalVolume);
  const nextTier = getNextTier(totalVolume);
  const cap      = tier.cap;
  const per10k    = Math.floor(totalVolume / 10000);
  const per100k   = Math.floor(totalVolume / 100000);
  const per1m     = Math.floor(totalVolume / 1000000);
  const volEarned = per10k + per100k * 2 + per1m * 5;
  const totalAvailable = Math.min(cap, Math.max(SLOT_FLOOR, volEarned));
  const open     = Math.max(0, totalAvailable - tokensLaunched);
  const toNextSlot = totalAvailable < cap
    ? (Math.ceil((totalVolume + 1) / 10000) * 10000) - totalVolume
    : 0;
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
// SUMMIT.MOON — TOKENOMICS — CLEAN SIMPLE MODEL
// ═══════════════════════════════════════════════════════════════
// 1.5% fee. 0.25% → quarterly USDC airdrop pool.
// Hold more = earn more. No tiers. No sqrt math. Simple.
// ═══════════════════════════════════════════════════════════════

const TOTAL_SUPPLY        = 1_000_000_000;
const BONDING_PCT         = 0.65;
const RESERVE_PCT         = 0.10;

// Swap fee: 1.5% total
const FEE_TOTAL           = 0.0150;
const FEE_LP              = 0.0060;  // 0.60% → LP
const FEE_PROTOCOL        = 0.0040;  // 0.40% → protocol
const FEE_AIRDROP         = 0.0050;  // 0.50% → quarterly USDC airdrop pool

// Deploy fee: 1.5 SOL
const DEPLOY_LP_PCT       = 0.50;
const DEPLOY_PROTOCOL_PCT = 0.30;
const DEPLOY_BONUS_PCT    = 0.10;
const DEPLOY_INFRA_PCT    = 0.10;
const SOL_PRICE           = 180;
const DAILY_LAUNCHES      = 50;

const PLATFORM_DAILY_VOL  = 15_000_000;

const INIT_TOKENS = [];
const MY_POSITIONS = [];
const MY_TOKENS = [];
const MOCK_NOTIFS = [];
const MOCK_DEX = {};

// Smart age display: 5m, 3h, 2d, 14d
function fmtAge(ageDays, elapsedMins) {
  if (ageDays >= 1) return `${ageDays}d`;
  if (elapsedMins >= 60) return `${Math.floor(elapsedMins / 60)}h`;
  if (elapsedMins >= 1) return `${elapsedMins}m`;
  return '<1m';
}

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

function calcProtocolRevenue(dailyVol, launches) {
  return (dailyVol * FEE_PROTOCOL) + (launches * 1.5 * DEPLOY_PROTOCOL_PCT * SOL_PRICE);
}

// ===== DESIGN PRIMITIVES =====

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

function Spark({data,color,W=56,H=20}) {
  if(!data||data.length<2) return null;
  const mn=Math.min(...data),mx=Math.max(...data),rng=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*W},${H-((v-mn)/rng)*(H-2)+1}`).join(" ");
  return <svg width={W} height={H} style={{display:"block",overflow:"visible"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

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
    textTransform:"uppercase",
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

const Sep = ({my=0}) => <div style={{height:"1px",background:C.border,margin:`${my}px 0`,opacity:0.8}}/>;

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
    offset: 0,
    visible: 60,
    dragging: false,
    dragStartX: 0,
    dragStartOffset: 0,
    pinching: false,
    pinchStartDist: 0,
    pinchStartVisible: 0,
    pinchStartOffset: 0,
    pointers: {},
  });
  const [dims, setDims]   = useState({w:600, h:400});
  const [hov,  setHov]    = useState(null);
  const [,     forceRender] = useState(0);
  const redraw = () => forceRender(n => n+1);

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

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clampView = (s) => {
    const total = candles.length;
    s.visible = clamp(Math.round(s.visible), 5, total);
    s.offset  = clamp(s.offset, 0, total - s.visible);
    return s;
  };

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

  const getPointers = () => Object.values(s.pointers);

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    s.pointers[e.pointerId] = {x: e.clientX, y: e.clientY};
    const pts = getPointers();
    if (pts.length === 1) {
      s.dragging = true;
      s.dragStartX = e.clientX;
      s.dragStartOffset = s.offset;
    } else if (pts.length === 2) {
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
      const [p0, p1] = pts;
      const dx = p0.x - p1.x, dy = p0.y - p1.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const scale = s.pinchStartDist / dist;
      const newVisible = clamp(s.pinchStartVisible * scale, 5, candles.length);
      const midX = ((p0.x + p1.x) / 2) - r.left - PAD_L;
      const midFrac = midX / chartW;
      const midCandle = s.pinchStartOffset + midFrac * s.pinchStartVisible;
      s.visible = newVisible;
      s.offset  = clamp(midCandle - midFrac * newVisible, 0, candles.length - newVisible);
      clampView(s);
      redraw();
    } else if (s.dragging) {
      const dx = e.clientX - s.dragStartX;
      const candlesDragged = (dx / chartW) * visCount;
      s.offset = clamp(s.dragStartOffset - candlesDragged, 0, candles.length - visCount);
      redraw();
      const x = e.clientX - r.left - PAD_L;
      const i = Math.floor(x / cW);
      if (i >= 0 && i < vis.length) setHov({i, c: vis[i], x: PAD_L + i*cW + cW/2});
      else setHov(null);
    } else {
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
      s.dragging = true;
      s.dragStartX = pts[0].x;
      s.dragStartOffset = s.offset;
      s.pinching = false;
    }
  };

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
        {ticks.map((tk, i) => (
          <line key={i} x1={PAD_L} x2={W-PAD_R} y1={tk.y} y2={tk.y}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
        ))}
        {ticks.map((tk, i) => (
          <text key={i} x={PAD_L-6} y={tk.y+4} textAnchor="end"
            fontSize="9" fill="rgba(255,255,255,0.22)" fontFamily="monospace">
            {tk.price.toFixed(7)}
          </text>
        ))}
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
        <text x={PAD_L} y={PAD_T+priceH+14} fontSize="9"
          fill="rgba(255,255,255,0.18)" fontFamily="monospace">VOL</text>
        <rect x={W-PAD_R-52} y={PAD_T} width={50} height={16} fill="rgba(0,0,0,0.4)" rx="4"/>
        <text x={W-PAD_R-27} y={PAD_T+11} textAnchor="middle"
          fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">
          {visCount} candles
        </text>
      </svg>
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
    pending:{color:C.gold,bg:C.goldBg,bd:C.goldBd,label:"Snapshot pending",sub:"Holder snapshot locks in after anti-snipe delay — 5 min post-graduation, 1hr pre-grad"},
    live:{color:C.green,bg:C.greenBg,bd:C.greenBd,label:"Rewards live — migrated to Raydium",sub:"Quarterly USDC airdrop to all holders proportional by balance"},
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

// ===== LIVE HOLDERS TAB =====

function HoldersTab({t, as}) {
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!t.mint && !t.mintAddress) { setLoading(false); return; }
    const mintStr = t.mint || t.mintAddress;
    setLoading(true);
    (async () => {
      try {
        const { PublicKey } = await import('@solana/web3.js');
        const { getAssociatedTokenAddress } = await import('@solana/spl-token');
        const { getGlobalPDA } = await import('./solana.js');
        const mint = new PublicKey(mintStr);
        const [global] = getGlobalPDA();
        const poolAta = await getAssociatedTokenAddress(mint, global, true);
        const poolAtaStr = poolAta.toBase58();

        const result = await connection.getTokenLargestAccounts(mint);
        const totalSupplyRaw = 1_000_000_000;
        const list = result.value
          .filter(a => a.uiAmount > 0)
          .map((a, i) => {
            const addr = a.address.toBase58();
            const isPool = addr === poolAtaStr;
            return {
              rank: i + 1,
              wallet: addr.slice(0, 4) + '...' + addr.slice(-4),
              walletFull: addr,
              amount: a.uiAmount,
              pct: ((a.uiAmount / totalSupplyRaw) * 100).toFixed(2),
              isPool,
              label: isPool ? 'Bonding Curve' : null,
            };
          });
        setHolders(list);
      } catch (e) {
        console.error('HoldersTab fetch error:', e);
        setHolders([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [t.mint, t.mintAddress]);

  return (
    <div style={{animation:"fadeUp 0.15s ease"}}>
      <div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <Label size={14} color={C.text} weight={600}>Top Holders</Label>
        {as.s==="live"&&<Label size={11} color={C.green}>Airdrop active</Label>}
        {as.s==="pending"&&<Label size={11} color={C.gold}>Snapshot in {as.minsLeft}m</Label>}
      </div>
      <GlassCard style={{overflow:"hidden",padding:0}} hover={false}>
        {loading && (
          <div style={{padding:"32px 16px",textAlign:"center"}}>
            <Label size={13} color={C.textQuat} style={{animation:"pulse 1.5s infinite"}}>Loading holders...</Label>
          </div>
        )}
        {!loading && holders.length === 0 && (
          <div style={{padding:"32px 16px",textAlign:"center"}}>
            <Label size={13} color={C.textQuat}>No holders found</Label>
          </div>
        )}
        {!loading && holders.map((h,i)=>(
          <div key={h.walletFull} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:i<holders.length-1?`1px solid ${C.border}`:"none",background:h.isPool?"rgba(201,168,76,0.04)":h.rank<=3?"rgba(255,159,10,0.03)":"transparent"}}>
            {/* Rank or icon */}
            {h.isPool ? (
              <div style={{width:24,height:24,borderRadius:7,background:C.accentBg,border:`1px solid ${C.accentBd}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </div>
            ) : (
              <div style={{width:24,height:24,borderRadius:7,background:h.rank===1?`linear-gradient(135deg,${C.gold},#e6960a)`:C.sheet,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Label size={10} color={h.rank===1?"#000":C.textTer} weight={700}>{h.rank}</Label>
              </div>
            )}
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <Label size={11} color={h.isPool?C.accent:C.textSec} mono weight={h.isPool?600:400}>{h.isPool?'Bonding Curve':h.wallet}</Label>
                {h.isPool&&<Tag color={C.accent}>Pool</Tag>}
              </div>
              <div style={{marginTop:2}}><Label size={10} color={C.textQuat} mono>{Number(h.amount).toLocaleString(undefined,{maximumFractionDigits:0})} tokens</Label></div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <Label size={13} color={h.isPool?C.accent:h.rank<=3?C.gold:C.text} weight={600}>{h.pct}%</Label>
            </div>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}

// ===== SWAP PANEL =====

const BONDING_SUPPLY_UI = 650_000_000;
function getLaunchCap(elapsedMins) {
  if(elapsedMins<7)  return {bps:150, pct:"1.5%", label:"0–7 min",  col:"#f43f5e", next:7};
  if(elapsedMins<14) return {bps:200, pct:"2%",   label:"7–14 min", col:"#fb923c", next:14};
  if(elapsedMins<30) return {bps:500, pct:"5%",   label:"14–30 min",col:"#facc15", next:30};
  return               {bps:10000,pct:"Open",label:"30 min+",  col:"#22c55e", next:null};
}
function capTokens(bps) { return Math.floor(BONDING_SUPPLY_UI * bps / 10000); }
function tokensToSolApprox(tokens, mcap) { return (tokens/BONDING_SUPPLY_UI) * (mcap/180) * 0.55; }

function CapBar({elapsedMins, myHolding, tokensOut, graduated}) {
  if(graduated) return null;
  return null; // disabled
}

function SwapPanel({t,connected,onConnect}) {
  const [tab,setTab]=useState("buy");
  const [amt,setAmt]=useState("");
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const [slippage,setSlippage]=useState(5); // default 5%
  const [showSettings,setShowSettings]=useState(false);
  const sol=parseFloat(amt)||0;
  const impact=sol>0?calcImpact(t.mcap,sol,tab==="buy"):null;
  const cw=getLaunchCap(t.elapsed||0);

  const tokensOut = tab==="buy"&&sol>0 ? Math.floor(sol*180/t.mcap*BONDING_SUPPLY_UI*0.55) : 0;
  const myHolding = 0;
  const capTokensMax = capTokens(cw.bps);
  const wouldExceed = tab==="buy" && !t.graduated && cw.bps<10000 && (myHolding+tokensOut)>capTokensMax;
  const highImpact = impact && parseFloat(impact.impact) > slippage;

  if(done) return (
    <div style={{textAlign:"center",padding:"32px 16px",animation:"scaleIn 0.2s ease"}}>
      <div style={{width:52,height:52,borderRadius:8,background:C.greenBg,border:`1px solid ${C.greenBd}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3.5 10L8 14.5L16.5 5.5" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
      <Label size={17} color={C.text} weight={600} style={{display:"block",marginBottom:6}}>Confirmed</Label>
      <Label size={13} color={C.textSec} style={{display:"block",lineHeight:1.6,marginBottom:20}}>Trade confirmed on-chain.</Label>
      <Btn onClick={()=>{setDone(false);setAmt("");}} full>Done</Btn>
    </div>
  );

  return (
    <div>
      {/* Buy/Sell toggle + settings gear */}
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
        <div style={{display:"flex",background:"rgba(255,255,255,0.05)",borderRadius:10,padding:2,flex:1}}>
          {["buy","sell"].map(s=>(
            <button key={s} onClick={()=>{setTab(s);setAmt("");}} style={{flex:1,height:34,borderRadius:8,border:"none",background:tab===s?"rgba(255,255,255,0.1)":"transparent",color:tab===s?(s==="buy"?C.green:C.red):C.textTer,fontSize:13,fontWeight:tab===s?600:400,cursor:"pointer",transition:"all 0.12s",textTransform:"capitalize",letterSpacing:"-0.02em"}}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={()=>setShowSettings(!showSettings)} style={{width:34,height:34,borderRadius:8,border:`1px solid ${showSettings?C.borderHi:C.border}`,background:showSettings?"rgba(255,255,255,0.06)":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={showSettings?"rgba(255,248,235,0.7)":"rgba(255,248,235,0.35)"} strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
      </div>

      {/* Slippage settings dropdown */}
      {showSettings&&(
        <div style={{background:C.sheet,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:10}}>
          <Label size={11} color={C.textTer} style={{display:"block",marginBottom:6}}>Max slippage tolerance</Label>
          <div style={{display:"flex",gap:4}}>
            {[1,3,5,10].map(v=>(
              <button key={v} onClick={()=>setSlippage(v)} style={{flex:1,height:28,borderRadius:6,border:`1px solid ${slippage===v?C.gold:C.border}`,background:slippage===v?"rgba(201,168,76,0.1)":"transparent",color:slippage===v?C.gold:C.textTer,fontSize:11,fontWeight:slippage===v?600:400,cursor:"pointer"}}>
                {v}%
              </button>
            ))}
            <input value={slippage} onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>0&&v<=50)setSlippage(v);}} style={{width:48,height:28,borderRadius:6,border:`1px solid ${C.border}`,background:"rgba(255,255,255,0.04)",color:C.text,fontSize:11,textAlign:"center",outline:"none"}}/>
          </div>
        </div>
      )}

      {/* Amount presets */}
      <div style={{display:"flex",gap:5,marginBottom:8}}>
        {(tab==="buy"?["0.1","0.5","1","5"]:["25%","50%","100%"]).map(v=>(
          <button key={v} onClick={()=>setAmt(v.replace("%",""))} style={{flex:1,height:28,borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.textTer,fontSize:11,fontWeight:500,cursor:"pointer"}}>
            {v}{tab==="buy"?" SOL":""}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{position:"relative",marginBottom:8}}>
        <input value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00"
          style={{width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${wouldExceed?C.redBd:C.border}`,borderRadius:8,padding:"12px 48px 12px 14px",color:C.text,fontSize:18,fontWeight:400,outline:"none",boxSizing:"border-box",transition:"border-color 0.15s",fontVariantNumeric:"tabular-nums"}}
          onFocus={e=>{e.target.style.borderColor=C.borderHi;}}
          onBlur={e=>{e.target.style.borderColor=wouldExceed?C.redBd:C.border;}}/>
        <div style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)"}}>
          <Label size={12} color={C.textTer} weight={500}>{tab==="buy"?"SOL":"TKN"}</Label>
        </div>
      </div>

      {/* Launch cap bar */}
      {tab==="buy"&&<CapBar elapsedMins={t.elapsed||0} myHolding={myHolding} tokensOut={tokensOut} graduated={t.graduated} t={t}/>}

      {/* Impact details */}
      {impact&&sol>0&&(
        <div style={{background:C.sheet,borderRadius:8,padding:"10px 12px",marginBottom:8,border:`1px solid ${parseFloat(impact.impact)>5?C.redBd:C.border}`}}>
          {[["Price impact",`${impact.impact}%`,parseFloat(impact.impact)>5?C.red:C.textTer],["Fee",`${impact.fee} SOL`,C.textTer],["You receive",tab==="buy"?`~${Number(impact.recv).toLocaleString()} tokens`:`~${impact.recv} SOL`,C.text]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <Label size={11} color={C.textTer}>{l}</Label>
              <Label size={11} color={c} weight={500} mono>{v}</Label>
            </div>
          ))}
        </div>
      )}

      {/* Quarterly airdrop info */}
      <div style={{display:"flex",alignItems:"flex-start",gap:7,padding:"8px 10px",background:C.goldBg,border:`1px solid ${C.goldBd}`,borderRadius:8,marginBottom:8}}>
        <div style={{width:4,height:4,borderRadius:"50%",background:C.gold,flexShrink:0,marginTop:4}}/>
        <Label size={10} color={C.gold}>0.50% of every trade → quarterly USDC airdrop. All holders earn by balance. No staking, automatic.</Label>
      </div>

      {/* High slippage warning */}
      {highImpact&&amt&&(
        <div style={{display:"flex",alignItems:"flex-start",gap:7,padding:"8px 10px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:8,marginBottom:8}}>
          <Label size={10} color={C.red}>Price impact ({impact.impact}%) exceeds your slippage tolerance ({slippage}%). Trade may result in significant loss.</Label>
        </div>
      )}

      <Btn onClick={()=>{if(!connected){onConnect();return;}if(wouldExceed)return;
        if(highImpact) {
          if(!window.confirm(`Price impact is ${impact.impact}% which exceeds your ${slippage}% slippage tolerance. Continue anyway?`)) return;
        }
        setLoading(true);(async()=>{try{
          const provider=window?.solana;
          const mintStr=t.mint||t.mintAddress;
          if(!mintStr){alert("No mint address — token not yet on-chain");setLoading(false);return;}
          const mintPk=new (await import('@solana/web3.js')).PublicKey(mintStr);
          const tx=await buildSwapTx(provider.publicKey,mintPk,parseFloat(amt),tab==="buy");
          tx.feePayer=provider.publicKey;
          const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash();
          tx.recentBlockhash=blockhash;
          const signed=await provider.signTransaction(tx);
          const sig=await connection.sendRawTransaction(signed.serialize());
          const result=await connection.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},"confirmed");
          if(result?.value?.err){
            throw new Error("Transaction failed on-chain. You may have insufficient SOL or the pool state changed.");
          }
          setDone(true);
        }catch(e){
          console.error("Swap error:",e);
          const msg=e.message||"";
          if(msg.includes("0x1")) alert("Swap failed: Insufficient balance.");
          else if(msg.includes("0x0")) alert("Swap failed: Transaction simulation failed. Try a smaller amount.");
          else if(msg.includes("User rejected")) alert("Transaction cancelled.");
          else if(msg.includes("blockhash")) alert("Transaction expired. Please try again.");
          else alert("Swap failed: "+msg.slice(0,120));
        }finally{setLoading(false);}})();}} full color={tab==="buy"?C.green:C.red} loading={loading} disabled={!amt||wouldExceed}>
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
          <div style={{width:22,flexShrink:0,textAlign:"center"}}>
            <Label size={rank<=3?15:13} color={rankColor} weight={700} mono>{rank}</Label>
          </div>
          <Avatar sym={t.sym} pi={t.pi} size={42}/>
          <div>
            <Label size={16} color={C.text} weight={600}>{t.sym}</Label>
            {t.name && t.name !== t.sym && <div style={{marginTop:2}}><Label size={12} color={C.textTer} weight={400}>{t.name}</Label></div>}
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
      <div style={{display:"flex",gap:5,marginTop:8,flexWrap:"wrap",alignItems:"center"}}>
        <Tag color={p.a}>{t.vol}</Tag>
        <Tag color={C.textTer}>{t.holders > 0 ? t.holders.toLocaleString() : "—"} holders</Tag>
        {as.s==="live"&&<Tag color={C.green}>Rewards live</Tag>}
        {as.s==="pending"&&<Tag color={C.gold}>Snapshot {as.minsLeft}m</Tag>}
        {t.graduated&&<Tag color={C.raydium}>On Raydium</Tag>}
        {t.bondingFull&&!t.graduated&&<Tag color={C.accent}>Bonded</Tag>}
        {(t.raisedSOL||0)>=60&&!t.bondingFull&&<Tag color={C.purple}>Near grad</Tag>}
      </div>
      {!t.graduated&&(
        <div style={{marginTop:12}}>
          <div style={{height:2,background:"rgba(255,255,255,0.06)",borderRadius:99,overflow:"hidden"}}>
            <div style={{width:`${Math.min(100,((t.raisedSOL||0)/85)*100)}%`,height:"100%",background:t.bondingFull?C.green:(t.raisedSOL||0)>=60?C.purple:p.a,borderRadius:99,transition:"width 1s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
            <Label size={10} color={C.textQuat} mono>{(t.raisedSOL||0).toFixed(1)} / 85 SOL</Label>
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

// ===== COMPACT TRADES TABLE (below chart) =====

function ChartTradesTable({mint}) {
  const [trades, setTrades] = useState([]);
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    if (!mint) return;
    const load = () => {
      import('./solana.js').then(({fetchRecentTrades}) => {
        fetchRecentTrades(mint, 20).then(data => {
          if (data && data.length > 0) setTrades(data);
        }).catch(() => {});
      });
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [mint]);

  if (trades.length === 0) return (
    <div style={{padding:"16px",textAlign:"center"}}>
      <Label size={11} color={C.textQuat}>No transactions yet</Label>
    </div>
  );

  const sorted = sortDesc ? trades : [...trades].reverse();

  return (
    <div>
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",padding:"6px 12px",gap:0,background:"rgba(255,255,255,0.02)",borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
        <div style={{width:60,flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",gap:3}} onClick={()=>setSortDesc(!sortDesc)}>
          <Label size={9} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Date</Label>
          <span style={{fontSize:8,color:C.textQuat}}>{sortDesc?"▼":"▲"}</span>
        </div>
        <div style={{width:42,flexShrink:0}}>
          <Label size={9} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Type</Label>
        </div>
        <div style={{flex:1,textAlign:"right"}}>
          <Label size={9} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>SOL</Label>
        </div>
        <div style={{flex:1,textAlign:"right"}}>
          <Label size={9} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Tokens</Label>
        </div>
        <div style={{flex:1,textAlign:"right"}} className="feed-hide-mobile">
          <Label size={9} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Price</Label>
        </div>
        <div style={{width:72,textAlign:"right",flexShrink:0}} className="feed-hide-mobile">
          <Label size={9} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>Maker</Label>
        </div>
        <div style={{width:28,textAlign:"center",flexShrink:0}}>
          <Label size={9} color={C.textQuat} style={{textTransform:"uppercase",letterSpacing:"0.05em"}}>TX</Label>
        </div>
      </div>
      {/* Trade rows */}
      {sorted.map((tr, i) => {
        const isBuy = tr.side === 'buy';
        const timeAgo = Math.floor((Date.now() - new Date(tr.timestamp).getTime()) / 60000);
        const timeStr = timeAgo < 1 ? 'just now' : timeAgo < 60 ? `${timeAgo}m ago` : timeAgo < 1440 ? `${Math.floor(timeAgo/60)}h ago` : `${Math.floor(timeAgo/1440)}d ago`;
        const solAmt = parseFloat(tr.sol_amount);
        const tokenAmt = parseFloat(tr.token_amount || 0);
        const price = parseFloat(tr.price || 0);
        const priceUsd = price * 180;
        const txSig = tr.tx_sig || '';
        return (
          <div key={txSig || i} style={{display:"flex",alignItems:"center",padding:"5px 12px",gap:0,
            borderBottom:`1px solid rgba(255,255,255,0.03)`,
            transition:"background 0.1s",cursor:"default"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{width:60,flexShrink:0}}>
              <Label size={10} color={C.textQuat}>{timeStr}</Label>
            </div>
            <div style={{width:42,flexShrink:0}}>
              <span style={{fontSize:10,fontWeight:700,color:isBuy?C.green:C.red,padding:"1px 6px",borderRadius:3,
                background:isBuy?"rgba(34,197,94,0.1)":"rgba(244,63,94,0.1)"}}>{isBuy?"Buy":"Sell"}</span>
            </div>
            <div style={{flex:1,textAlign:"right"}}>
              <Label size={10} color={isBuy?C.green:C.red} weight={600} mono>{solAmt < 0.01 ? "<0.01" : solAmt.toFixed(2)}</Label>
            </div>
            <div style={{flex:1,textAlign:"right"}}>
              <Label size={10} color={C.text} mono>{tokenAmt > 1000000 ? (tokenAmt/1000000).toFixed(1)+"M" : tokenAmt > 1000 ? Math.floor(tokenAmt).toLocaleString() : tokenAmt.toFixed(2)}</Label>
            </div>
            <div style={{flex:1,textAlign:"right"}} className="feed-hide-mobile">
              <Label size={10} color={C.textSec} mono>{priceUsd > 0.01 ? "$"+priceUsd.toFixed(4) : priceUsd > 0 ? "$"+priceUsd.toFixed(8) : "—"}</Label>
            </div>
            <div style={{width:72,textAlign:"right",flexShrink:0}} className="feed-hide-mobile">
              <Label size={10} color={C.textQuat} mono>{tr.wallet?.slice(0,4)}..{tr.wallet?.slice(-4)}</Label>
            </div>
            <div style={{width:28,textAlign:"center",flexShrink:0}}>
              {txSig && (
                <a href={`https://solscan.io/tx/${txSig}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
                  style={{opacity:0.3,transition:"opacity 0.15s"}}
                  onMouseEnter={e=>e.currentTarget.style.opacity="0.8"}
                  onMouseLeave={e=>e.currentTarget.style.opacity="0.3"}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textSec} strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== TRADES TAB =====

function TradesTab({t}) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mintStr = t.mint || t.mintAddress;
    if (!mintStr) return;
    import('./solana.js').then(({fetchRecentTrades}) => {
      fetchRecentTrades(mintStr, 30).then(data => {
        setTrades(data || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    });
  }, [t.mint, t.mintAddress]);

  if (loading) return (
    <div style={{padding:"24px 0",textAlign:"center"}}>
      <Label size={12} color={C.textQuat}>Loading trades...</Label>
    </div>
  );

  if (trades.length === 0) return (
    <div style={{padding:"24px 0",textAlign:"center"}}>
      <Label size={12} color={C.textQuat}>No trades yet</Label>
    </div>
  );

  return (
    <div style={{animation:"fadeUp 0.15s ease"}}>
      {trades.map((tr, i) => {
        const isBuy = tr.side === 'buy';
        const timeAgo = Math.floor((Date.now() - new Date(tr.timestamp).getTime()) / 60000);
        const timeStr = timeAgo < 1 ? 'just now' : timeAgo < 60 ? `${timeAgo}m ago` : timeAgo < 1440 ? `${Math.floor(timeAgo/60)}h ago` : `${Math.floor(timeAgo/1440)}d ago`;
        return (
          <div key={tr.tx_sig || i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:i<trades.length-1?`1px solid ${C.border}`:"none"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:isBuy?C.green:C.red,flexShrink:0}}/>
              <div>
                <Label size={12} color={isBuy?C.green:C.red} weight={600}>{isBuy?"Buy":"Sell"}</Label>
                <Label size={10} color={C.textQuat} style={{display:"block"}}>{timeStr}</Label>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <Label size={12} color={C.text} weight={500} mono>{parseFloat(tr.sol_amount).toFixed(4)} SOL</Label>
              <Label size={10} color={C.textQuat} mono style={{display:"block"}}>{tr.wallet?.slice(0,4)}...{tr.wallet?.slice(-4)}</Label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== FULL TOKEN PAGE =====

function TokenPage({t:tProp,onClose,connected,onConnect}) {
  const [tokenData, setTokenData] = useState(tProp);
  const t={...tokenData,txs:tokenData.txs||0,vol:tokenData.vol||"$0",volRaw:tokenData.volRaw||0,holders:tokenData.holders||0,prog:tokenData.prog||0,age:tokenData.age||0,raisedSOL:tokenData.raisedSOL||0,raisedSOLMax:tokenData.raisedSOLMax||85,elapsed:tokenData.elapsed||0,mcap:tokenData.mcap||0,chg:tokenData.chg||0,bondingFull:tokenData.bondingFull||false,graduated:tokenData.graduated||false,topicLocked:tokenData.topicLocked||false,sym:tokenData.sym||"???",name:tokenData.name||tokenData.sym||"Unknown",desc:tokenData.desc||"",minsAgo:tokenData.minsAgo||0,pi:tokenData.pi||0,mint:tokenData.mint||tokenData.id,mintAddress:tokenData.mintAddress||tokenData.mint||tokenData.id};
  const [range,setRange]=useState("1H");
  const [rightTab,setRightTab]=useState("swap");
  const [candles,setCandles]=useState(()=>genCandles(80,0.00004+Math.random()*0.0001));
  const [hasRealCandles,setHasRealCandles]=useState(false);

  // Fetch real holder count on page open
  useEffect(()=>{
    const mintStr = t.mint || t.mintAddress;
    if(!mintStr) return;
    fetchHolderCount(mintStr).then(count => {
      if(count > 0) setTokenData(prev => ({...prev, holders: count}));
    }).catch(()=>{});
  }, [t.mint, t.mintAddress]);

  // Map UI range to Supabase timeframe
  const tfMap = {"5M":"5m","15M":"15m","1H":"1h","4H":"4h","1D":"1d"};

  // Fetch real candles when token or range changes
  useEffect(()=>{
    const mintStr = t.mint || t.mintAddress;
    if(!mintStr) return;
    const tf = tfMap[range] || '1h';
    fetchCandles(mintStr, tf, 100).then(real => {
      if(real.length >= 2) {
        setCandles(real);
        setHasRealCandles(true);
      } else {
        // No real data yet — keep fake candles
        setCandles(genCandles(80, t.pricePerToken || 0.00004+Math.random()*0.0001));
        setHasRealCandles(false);
      }
    }).catch(()=>{});
  }, [t.mint, t.mintAddress, range]);
  const p=PALETTES[t.pi%8],up=t.chg>0,mi=getMI(t.mcap),mil=MILESTONES[mi],as=getAS(t);
  const myPos=MY_POSITIONS.find(pos=>pos.sym===t.sym);

  return (
    <div style={{height:"100vh",maxHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans,display:"flex",flexDirection:"column",overflow:"hidden",position:"fixed",inset:0,zIndex:50}}>
      <style>{FONT}{`body{overflow:hidden!important;}`}</style>
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
          {t.name && t.name !== t.sym && <Label size={12} color={C.textTer}>{t.name}</Label>}
          {t.topicLocked&&<div style={{background:C.tealBg,border:`1px solid ${C.tealBd}`,borderRadius:6,padding:"2px 8px"}}><Label size={10} color={C.teal}>{t.topicSource} -- {t.topicTitle?.slice(0,36)}</Label></div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
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
            <Label size={17} color={C.text} weight={700}>{t.pricePerToken ? (t.pricePerToken*180).toFixed(8) : "0.00000000"}</Label>
            <div><Label size={12} color={up?C.green:C.red} weight={500}>{up?"+":""}{t.chg.toFixed(1)}%</Label><Label size={12} color={C.textTer} style={{marginLeft:6}}>{fmt(t.mcap)} MC</Label></div>
          </div>
        </div>
      </div>

      {/* BODY: chart left, sidebar right */}
      <div className="tp-body">

        {/* LEFT - CHART COLUMN */}
        <div className="tp-chart">
          <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            <div>
              <Label size={26} color={C.text} weight={700}>{t.pricePerToken ? (t.pricePerToken*180).toFixed(8) : "0.00000000"}</Label>
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
          <div style={{flex:1,minHeight:0,position:"relative",padding:"0"}}>
            <div style={{position:"absolute",inset:0,padding:"8px 4px 0"}}>
              <CandleChart candles={candles} color={p.a} fullHeight/>
            </div>
            {!hasRealCandles&&(
              <div style={{position:"absolute",top:8,left:16,padding:"3px 8px",background:"rgba(255,255,255,0.06)",border:`1px solid ${C.border}`,borderRadius:4,zIndex:5}}>
                <Label size={9} color={C.textQuat}>SIMULATED — waiting for trades</Label>
              </div>
            )}
          </div>
          <div style={{borderTop:`1px solid ${C.border}`,padding:"10px 16px",display:"flex",gap:0,flexShrink:0,background:"rgba(0,0,0,0.4)"}}>
            {[["Volume",t.vol],["Txns",t.txs.toLocaleString()],["Holders",t.holders > 0 ? t.holders.toLocaleString() : "—"],["Multiplier",`${mil.multi}x`],["Age",fmtAge(t.age, t.elapsed)],["Raised",`${(t.raisedSOL||0).toFixed(1)}/${t.raisedSOLMax||85} SOL`]].map((s,i,a)=>(
              <div key={s[0]} style={{flex:1,paddingRight:i<a.length-1?12:0,borderRight:i<a.length-1?`1px solid ${C.border}`:"none",paddingLeft:i>0?12:0}}>
                <Label size={10} color={C.textTer} style={{display:"block",marginBottom:3,letterSpacing:0.3}}>{s[0]}</Label>
                <Label size={12} color={C.text} weight={500}>{s[1]}</Label>
              </div>
            ))}
          </div>
          {/* Live trades table below chart */}
          <div style={{borderTop:`1px solid ${C.border}`,flexShrink:0,background:"rgba(0,0,0,0.25)",maxHeight:220,overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:`1px solid rgba(255,255,255,0.04)`,position:"sticky",top:0,background:"rgba(13,12,11,0.95)",backdropFilter:"blur(8px)",zIndex:2}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textTer} strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <Label size={11} color={C.textSec} weight={600} style={{letterSpacing:"-0.01em"}}>Transactions</Label>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:5,height:5,borderRadius:"50%",background:C.green,animation:"pulse 2s infinite"}}/>
                <Label size={9} color={C.textQuat}>Live</Label>
              </div>
            </div>
            <ChartTradesTable mint={t.mint || t.mintAddress}/>
          </div>
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
            </div>
          )}

          {t.bondingFull&&(
            <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`,flexShrink:0,background:"rgba(255,214,10,0.04)"}}>
              <AirdropGate t={t}/>
            </div>
          )}

          {/* Right tab bar */}
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            {["swap","trades","holders"].map(tb=>(
              <button key={tb} onClick={()=>setRightTab(tb)}
                style={{flex:1,height:36,border:"none",background:"transparent",color:rightTab===tb?C.text:C.textTer,
                  fontSize:12,fontWeight:rightTab===tb?600:400,cursor:"pointer",
                  textTransform:"capitalize",letterSpacing:"-0.01em",
                  borderBottom:rightTab===tb?`2px solid ${C.accent}`:"2px solid transparent",
                  transition:"all 0.12s"}}>
                {tb}
              </button>
            ))}
          </div>

          {/* Right tab content - scrollable */}
          <div style={{flex:1,overflowY:"auto",padding:"10px 12px"}}>
            {rightTab==="swap"&&(
              <div style={{animation:"fadeUp 0.15s ease"}}>
                <SwapPanel t={t} connected={connected} onConnect={onConnect}/>
              </div>
            )}

            {rightTab==="trades"&&(
              <TradesTab t={t}/>
            )}

            {rightTab==="holders"&&(
              <HoldersTab t={t} as={as}/>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== LAUNCH MODAL =====

function LaunchModal({onClose,slotData,onDeployed}) {
  const [form,setForm]=useState({name:"",sym:"",desc:"",twitter:"",website:"",topicUrl:"",imageFile:null});
  const [state,setState]=useState("idle");
  const [topicRes,setTopicRes]=useState(null);
  const [classifying,setClassifying]=useState(false);

  function extractIdentity(raw) {
    if(!raw||raw.trim().length<2) return null;
    const s = raw.trim().toLowerCase();
    if(s.startsWith("@")) return s.slice(1).split("/")[0].replace(/[^a-z0-9_]/g,"");
    const xMatch = s.match(/(?:x\.com|twitter\.com)\/([a-z0-9_]+)/);
    if(xMatch) return xMatch[1];
    try {
      const url = s.startsWith("http") ? s : "https://"+s;
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./,"");
      const parts = host.split(".");
      const name = parts.length>=2 ? parts[0] : host;
      return name.replace(/[^a-z0-9_]/g,"");
    } catch(e) {
      return s.replace(/[^a-z0-9_]/g,"");
    }
  }

  const DEPLOYED_TOKENS = [];
  const MC_LOCK_THRESHOLD = 50000;
  const LOCK_TTL = 24*60*60*1000;

  function normaliseTicker(raw) {
    if(!raw||!raw.trim()) return null;
    return raw.trim().toUpperCase().replace(/^\$/, "").replace(/[^A-Z0-9]/g, "");
  }

  function tickerBlocked(inputTicker) {
    if(!inputTicker||inputTicker.length<2) return null;
    const t = inputTicker;
    const match = DEPLOYED_TOKENS.find(tok => {
      if(tok.marketCap < MC_LOCK_THRESHOLD) return false;
      const existing = tok.ticker;
      if(t === existing) return true;
      if(t.includes(existing) || existing.includes(t)) return true;
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

  function imageBlocked(imageFile) {
    if(!imageFile) return null;
    const name = (imageFile.name||"").toLowerCase();
    const match = DEPLOYED_TOKENS.find(tok => {
      if(tok.marketCap < MC_LOCK_THRESHOLD) return false;
      const keyword = tok.imageHash.replace("hash_","").split("_")[0];
      return name.includes(keyword);
    });
    if(!match) return null;
    return {ticker: match.ticker, marketCap: match.marketCap};
  }

  function isClaimed(identity) {
    if(!identity||identity.length<2) return null;
    const match = DEPLOYED_TOKENS.find(tok => {
      if(tok.marketCap < MC_LOCK_THRESHOLD) return false;
      return identity.includes(tok.identity)||tok.identity.includes(identity);
    });
    if(!match) return null;
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

  const ready = form.name.trim() && form.sym.trim();
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
        <Label size={13} color={C.textSec} style={{display:"block",lineHeight:1.7,marginBottom:16}}>All holders earn from the quarterly USDC airdrop — proportional by balance, automatic each quarter.</Label>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",marginBottom:16,textAlign:"left"}}>
          <Label size={11} color={C.textTer} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.4}}>Locks active on deploy</Label>
          <Label size={12} color={C.teal} style={{display:"block",marginBottom:3}}>Ticker ${form.sym.toUpperCase()} locked -- derivatives blocked</Label>
          {form.imageFile&&<Label size={12} color={C.teal} style={{display:"block",marginBottom:3}}>Image hash locked -- similar images blocked</Label>}
          {pvpProtected&&<Label size={12} color={C.teal} style={{display:"block",marginBottom:3}}>Identity locked -- all derivatives blocked ✓</Label>}
          {!hasIdentityLink&&<Label size={12} color={C.textTer} style={{display:"block",marginBottom:3}}>No identity lock — no Twitter/website was linked</Label>}
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
              {l:"Trading fee",v:"1.5%",c:C.green,rows:[["0.60%","LP auto-compound"],["0.50%","Quarterly USDC airdrop"],["0.40%","Protocol"]]},
            ].map(card=>(
              <div key={card.l} style={{background:C.card,borderRadius:8,padding:"14px",border:`1px solid ${card.l==="Trading fee"?"rgba(48,209,88,0.25)":C.border}`}}>
                <Label size={10} color={C.textTer} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>{card.l}</Label>
                <Label size={20} color={card.c} weight={700} style={{display:"block",marginBottom:8}}>{card.v}</Label>
                {card.rows.map(([pct,lbl])=>(
                  <div key={lbl} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <Label size={11} color={lbl.includes("airdrop")?C.green:card.c} weight={lbl.includes("airdrop")?700:600}>{pct}</Label>
                    <Label size={11} color={lbl.includes("airdrop")?C.green:C.textTer} weight={lbl.includes("airdrop")?600:400}>{lbl}</Label>
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

          {/* Airdrop mechanics — updated to match simple quarterly model */}
          <div style={{background:C.goldBg,border:`1px solid ${C.goldBd}`,borderRadius:8,padding:"12px 14px",marginBottom:14}}>
            <Label size={11} color={C.gold} weight={600} style={{display:"block",marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}}>Quarterly USDC airdrop</Label>
            <div style={{display:"flex",gap:4,marginBottom:8}}>
              {[["0.50%","per trade"],["All","holders"],["Quarterly","USDC"],["Proportional","by balance"],["Automatic","no claiming"]].map(([v,l])=>(
                <div key={l} style={{textAlign:"center",flex:1,background:"rgba(0,0,0,0.2)",borderRadius:7,padding:"6px 2px"}}>
                  <Label size={11} color={C.gold} weight={700} style={{display:"block"}}>{v}</Label>
                  <Label size={9} color={C.textTer} style={{display:"block",marginTop:1}}>{l}</Label>
                </div>
              ))}
            </div>
            <Label size={11} color={C.textTer} style={{lineHeight:1.5}}>0.50% of every trade accumulates in the airdrop pool. Each quarter, USDC is distributed to all holders proportional by their balance. No staking, no tiers — just hold.</Label>
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
              {slotData.nextTier&&(
                <div style={{height:2,background:"rgba(255,255,255,0.04)",borderRadius:99}}>
                  <div style={{height:"100%",background:C.blue,width:`${slotData.tierPct*100}%`,borderRadius:99,transition:"width 0.5s ease"}}/>
                </div>
              )}
            </div>
          </div>

          {deployBlocked&&!tickerBlock&&!imageBlock&&<div style={{padding:"9px 12px",background:C.redBg,border:`1px solid ${C.redBd}`,borderRadius:9,marginBottom:10}}><Label size={12} color={C.red}>Resolve all conflicts above to deploy.</Label></div>}

          <Btn onClick={()=>{if(!ready||deployBlocked)return;setState("loading");(async()=>{try{
  const provider=window?.solana;
  if(!provider?.isPhantom){window.open("https://phantom.app","_blank");setState("idle");return;}

  const{Keypair,SystemProgram,Transaction:SolTx,ComputeBudgetProgram,PublicKey:PK}=await import("@solana/web3.js");
  const{createInitializeMint2Instruction,createMintToInstruction,createAssociatedTokenAccountInstruction,getAssociatedTokenAddress,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,MINT_SIZE,getMinimumBalanceForRentExemptMint}=await import("@solana/spl-token");
  const{PROGRAM_ID,getPoolPDA,getGlobalPDA,getLiquidityProviderPDA}=await import("./solana.js");

  const TOTAL_RAW=BigInt(1000000000)*BigInt(1000000000);
  const BONDING_RAW=BigInt(650000000)*BigInt(1000000000);

  // Helper: confirm TX and verify it didn't fail
  const confirmAndVerify = async (sig, label) => {
    const bh = await connection.getLatestBlockhash("confirmed");
    const result = await connection.confirmTransaction({signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight}, "confirmed");
    if (result?.value?.err) {
      throw new Error(`${label} failed on-chain: ${JSON.stringify(result.value.err)}`);
    }
    // Double-check the tx status
    const status = await connection.getSignatureStatus(sig);
    if (status?.value?.err) {
      throw new Error(`${label} error: ${JSON.stringify(status.value.err)}`);
    }
    console.log(`${label} confirmed ✅`);
    return sig;
  };

  // ── TX1: Create mint + supply ──
  const mk=Keypair.generate();
  console.log("New mint:",mk.publicKey.toBase58());
  const lam=await getMinimumBalanceForRentExemptMint(connection);
  const userAta=await getAssociatedTokenAddress(mk.publicKey,provider.publicKey);
  const tx1=new SolTx();
  tx1.add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));
  tx1.add(SystemProgram.createAccount({fromPubkey:provider.publicKey,newAccountPubkey:mk.publicKey,space:MINT_SIZE,lamports:lam,programId:TOKEN_PROGRAM_ID}));
  tx1.add(createInitializeMint2Instruction(mk.publicKey,9,provider.publicKey,provider.publicKey));
  tx1.add(createAssociatedTokenAccountInstruction(provider.publicKey,userAta,provider.publicKey,mk.publicKey));
  tx1.add(createMintToInstruction(mk.publicKey,userAta,provider.publicKey,TOTAL_RAW));
  const bh1=await connection.getLatestBlockhash("confirmed");
  tx1.recentBlockhash=bh1.blockhash;
  tx1.feePayer=provider.publicKey;
  tx1.partialSign(mk);
  const s1=await provider.signTransaction(tx1);
  const sig1=await connection.sendRawTransaction(s1.serialize(),{skipPreflight:true,maxRetries:10});
  console.log("Mint+Supply TX:",sig1);
  await confirmAndVerify(sig1, "Mint+Supply");

  // ── TX2: Create registry ──
  const tkr=form.sym||"TEST";
  const imgHashBuf=form.imageFile?await sha256(new Uint8Array(await form.imageFile.arrayBuffer())):Buffer.alloc(32);
  const idRaw=(form.twitter||form.website||"").trim().toLowerCase();
  const idHashBuf=idRaw.length>1?await sha256(idRaw):Buffer.alloc(32);
  const{tx:tx2,tickerBuf,imgHash,idHash}=await buildCreateRegistryTx(provider.publicKey,mk.publicKey,tkr,imgHashBuf,idHashBuf);
  tx2.add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));
  tx2.add(ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}));
  const bh2=await connection.getLatestBlockhash("confirmed");
  tx2.recentBlockhash=bh2.blockhash;
  tx2.feePayer=provider.publicKey;
  const r2=await provider.signAndSendTransaction(tx2,{skipPreflight:true});
  const sig2=r2.signature||r2;
  console.log("Registry TX:",sig2);
  await confirmAndVerify(sig2, "Registry");

  // ── TX3: Add liquidity (creates pool) — with retry ──
  const[pool]=getPoolPDA(mk.publicKey);
  const globalPda=(()=>{const[g]=PK.findProgramAddressSync([Buffer.from("global")],PROGRAM_ID);return g;})();
  const[lpAccount]=PK.findProgramAddressSync([Buffer.from("LiqudityProvider"),pool.toBuffer(),provider.publicKey.toBuffer()],PROGRAM_ID);
  const poolAta=await getAssociatedTokenAddress(mk.publicKey,globalPda,true);
  const discAL=Buffer.from("b59d59438fb63448","hex");
  const dataAL=Buffer.alloc(8+8+8);
  discAL.copy(dataAL,0);
  dataAL.writeBigUInt64LE(BONDING_RAW,8);
  dataAL.writeBigUInt64LE(BigInt(0),16);
  const{TransactionInstruction:TxIx}=await import("@solana/web3.js");
  const ixAL=new TxIx({keys:[
    {pubkey:pool,isSigner:false,isWritable:true},
    {pubkey:globalPda,isSigner:false,isWritable:true},
    {pubkey:lpAccount,isSigner:false,isWritable:true},
    {pubkey:mk.publicKey,isSigner:false,isWritable:true},
    {pubkey:poolAta,isSigner:false,isWritable:true},
    {pubkey:userAta,isSigner:false,isWritable:true},
    {pubkey:provider.publicKey,isSigner:true,isWritable:true},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},
    {pubkey:ASSOCIATED_TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}
  ],programId:PROGRAM_ID,data:dataAL});

  let poolCreated = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const tx3=new SolTx();
      tx3.add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));
      tx3.add(ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}));
      tx3.add(ixAL);
      const bh3=await connection.getLatestBlockhash("confirmed");
      tx3.recentBlockhash=bh3.blockhash;
      tx3.feePayer=provider.publicKey;
      const r3=await provider.signAndSendTransaction(tx3);
      const sig3=r3.signature||r3;
      console.log(`AddLiquidity TX (attempt ${attempt}):`,sig3);
      await confirmAndVerify(sig3, "AddLiquidity");
      
      // Verify pool actually exists on-chain
      const poolCheck = await connection.getAccountInfo(pool);
      if (!poolCheck) {
        throw new Error("Pool account not found after confirmation");
      }
      console.log("Pool verified on-chain ✅ size:", poolCheck.data.length, "bytes");
      poolCreated = true;
      break;
    } catch(e3) {
      console.error(`AddLiquidity attempt ${attempt} failed:`, e3.message);
      if (attempt === 3) throw new Error(`Pool creation failed after 3 attempts: ${e3.message}`);
      console.log(`Retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!poolCreated) throw new Error("Pool creation failed");

  // ── TX4: Claim locks (non-fatal) ──
  try{
    const tx4=await buildClaimLocksTx(provider.publicKey,mk.publicKey,tickerBuf,imgHash,idHash);
    tx4.add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));
    tx4.add(ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}));
    const bh4=await connection.getLatestBlockhash("confirmed");
    tx4.recentBlockhash=bh4.blockhash;
    tx4.feePayer=provider.publicKey;
    const r4=await provider.signAndSendTransaction(tx4);
    const sig4=r4.signature||r4;
    console.log("ClaimLocks TX:",sig4);
    await confirmAndVerify(sig4, "ClaimLocks");
  }catch(lockErr){
    console.warn("claim_locks failed (non-fatal):",lockErr.message);
  }

  console.log("FULL DEPLOY COMPLETE");
  // Immediately notify parent to add token to feed
  if(onDeployed) {
    onDeployed({
      id: mk.publicKey.toBase58(),
      pubkey: mk.publicKey.toBase58(),
      mint: mk.publicKey.toBase58(),
      mintAddress: mk.publicKey.toBase58(),
      sym: tkr,
      name: tkr,
      pi: Math.abs(mk.publicKey.toBuffer()[0] + mk.publicKey.toBuffer()[1]) % 8,
      mcap: 208,
      chg: 0,
      prog: 0,
      holders: 1,
      age: 0,
      raisedSOL: 0,
      raisedSOLMax: 85,
      elapsed: 0,
      vol: "$0",
      volRaw: 0,
      txs: 0,
      desc: "Deployed on-chain",
      bondingFull: false,
      minsAgo: 0,
      graduated: false,
      hasPool: true,
      pricePerToken: 0,
      solReserve: 0.75,
      tokenReserve: 650000000,
      creator: provider.publicKey.toBase58(),
      createdAt: Math.floor(Date.now()/1000),
      launchTs: Math.floor(Date.now()/1000),
    });
  }
  setState("done");
}catch(e){console.error("Deploy error:",e);alert("Deploy failed: "+e.message);setState("idle");}})();}} full color={C.accent} loading={state==="loading"} disabled={!ready||deployBlocked||state==="loading"}>
            {`Deploy -- 1.5 SOL${pvpProtected?" + PVP Lock":""}`}
          </Btn>

        </div>
      </div>
    </div>
  );
}

// ===== NOTIFICATIONS =====

function NotifPanel({onClose}) {
  const [notifs,setNotifs]=useState([]);
  return (
    <div style={{position:"fixed",inset:0,zIndex:200}} onClick={onClose}>
      <div style={{position:"absolute",top:58,right:16,width:300,background:C.sheet,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.6)",backdropFilter:"blur(20px)",animation:"scaleIn 0.18s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <Label size={15} color={C.text} weight={600}>Notifications</Label>
          <button onClick={()=>setNotifs(n=>n.map(x=>({...x,read:true})))} style={{background:"none",border:"none",cursor:"pointer"}}><Label size={12} color={C.blue}>Mark all read</Label></button>
        </div>
        <div style={{maxHeight:"60vh",overflowY:"auto"}}>
          {notifs.length===0&&(
            <div style={{padding:"32px 16px",textAlign:"center"}}>
              <Label size={13} color={C.textQuat}>No notifications</Label>
            </div>
          )}
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
  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans}}>
      <style>{FONT}</style>
      <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(30px)",WebkitBackdropFilter:"blur(30px)",borderBottom:`1px solid ${C.border}`,padding:"12px 24px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onClose} style={{width:34,height:34,borderRadius:"50%",background:"rgba(255,255,255,0.07)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",backdropFilter:"blur(10px)"}}><svg width="10" height="17" viewBox="0 0 10 17" fill="none"><path d="M8.5 1.5L1.5 8.5L8.5 15.5" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        <Label size={18} color={C.text} weight={700}>Portfolio</Label>
      </div>
      <div style={{maxWidth:520,margin:"0 auto",padding:"20px 20px 100px"}}>
        <div style={{padding:"48px 24px",textAlign:"center"}}>
          <Label size={15} color={C.textQuat}>Connect your wallet to view positions</Label>
        </div>
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
    {id:"airdrop",  label:"Airdrop"},
    {id:"slots",    label:"Slots"},
    {id:"pvp",      label:"PVP"},
  ];

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans}}>
      <style>{FONT}</style>

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
              <Label size={14} color={C.textSec} style={{lineHeight:1.7,display:"block"}}>A token launchpad where every holder earns from every trade. 0.50% of all swap fees go to a quarterly USDC airdrop — proportional by balance, automatic, no staking.</Label>
            </div>

            <GlassCard style={{padding:"18px 20px",marginBottom:10}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.05em"}}>Token supply — 1 billion</Label>
              <div style={{display:"flex",borderRadius:8,overflow:"hidden",height:28,marginBottom:10}}>
                {[
                  {pct:65,col:C.accent,label:"Bonding curve"},
                  {pct:25,col:C.purple,label:"Reserve (25%)"},
                  {pct:10,col:C.textTer,label:"LP seed"},
                ].map(s=>(
                  <div key={s.label} style={{width:`${s.pct}%`,background:`${s.col}`,opacity:s.pct===10?0.3:0.85,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Label size={10} color="#fff" weight={700}>{s.pct}%</Label>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                {[
                  {col:C.accent, label:"650M — bonding curve"},
                  {col:C.purple, label:"250M — reserve"},
                  {col:C.textTer,label:"100M — LP seed"},
                ].map(s=>(
                  <div key={s.label} style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:s.col,flexShrink:0}}/>
                    <Label size={11} color={C.textSec}>{s.label}</Label>
                  </div>
                ))}
              </div>
            </GlassCard>

            {[
              {title:"Bonding curve → Raydium",color:C.accent,desc:"Every token launches on a bonding curve targeting 85 SOL. Once filled, LP migrates to Raydium CLMM and locks forever."},
              {title:"Quarterly USDC airdrop",color:C.gold,desc:"0.50% of every swap accumulates in an airdrop pool. Each quarter, USDC is distributed to all holders proportional by balance. No staking, no claiming — automatic."},
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

            <GlassCard style={{padding:"18px 20px",marginBottom:12,background:"rgba(255,214,10,0.04)",border:`1px solid rgba(255,214,10,0.2)`}} hover={false}>
              <Label size={12} color={C.gold} weight={700} style={{display:"block",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.04em"}}>Why 1.5% beats 1.0%</Label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                {[
                  {label:"pump.fun",fee:"1.0%",sub:"charges it, keeps all of it",col:C.textTer},
                  {label:"summit.moon",fee:"1.5%",sub:"charges it, 0.50% goes to quarterly airdrop",col:C.gold},
                ].map(p=>(
                  <div key={p.label} style={{padding:"12px 14px",background:"rgba(255,255,255,0.03)",borderRadius:10,border:`1px solid ${p.col}20`}}>
                    <Label size={10} color={p.col} style={{display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>{p.label}</Label>
                    <Label size={26} color={p.col} weight={700} style={{display:"block",lineHeight:1}}>{p.fee}</Label>
                    <Label size={11} color={p.col} style={{display:"block",marginTop:4,lineHeight:1.4}}>{p.sub}</Label>
                  </div>
                ))}
              </div>
              <Label size={11} color={C.textTer} style={{lineHeight:1.6}}>The extra 0.50% on a $1K trade is $5. No one leaves for $5. But every holder of an active token earns USDC each quarter just for holding.</Label>
            </GlassCard>

            <GlassCard style={{marginBottom:12,overflow:"hidden"}} hover={false}>
              <div style={{padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <Label size={10} color={C.textTer} style={{display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Swap fee — per trade</Label>
                  <Label size={28} color={C.green} weight={700} style={{lineHeight:1}}>1.5%</Label>
                </div>
                <div style={{textAlign:"right"}}>
                  <Label size={10} color={C.textTer} style={{display:"block",marginBottom:4}}>On $1M volume</Label>
                  <Label size={18} color={C.text} weight={600}>$15,000</Label>
                </div>
              </div>
              <div style={{borderTop:`1px solid ${C.border}`}}/>
              {[
                {pct:"0.60%",label:"LP auto-compound",detail:"Locked forever — compounds on every trade",col:C.teal,hero:false,of:"$6,000"},
                {pct:"0.50%",label:"Quarterly USDC airdrop",detail:"All holders, proportional by balance, automatic",col:C.gold,hero:true,of:"$5,000"},
                {pct:"0.40%",label:"Protocol",detail:"Platform ops + infrastructure",col:C.textSec,hero:false,of:"$4,000"},
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
                {pct:"50%",label:"LP seed",detail:"0.75 SOL — immediate liquidity",col:C.teal,of:"0.75 SOL"},
                {pct:"30%",label:"Protocol",detail:"0.45 SOL — platform revenue",col:C.textSec,of:"0.45 SOL"},
                {pct:"10%",label:"Airdrop pool",detail:"0.15 SOL — seeds first quarter",col:C.gold,of:"0.15 SOL"},
                {pct:"10%",label:"Infrastructure",detail:"0.15 SOL — indexer + infra",col:C.purple,of:"0.15 SOL"},
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
                <Label size={12} color={C.textTer}>Max % of bonding supply (650M tokens) any single wallet can hold in each time window. Enforced on-chain.</Label>
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

            {/* Protocol revenue */}
            <GlassCard style={{padding:"18px 20px"}} hover={false}>
              <Label size={13} color={C.text} weight={700} style={{display:"block",marginBottom:12}}>Protocol revenue at scale</Label>
              {[
                {src:"Deploy 30%",   note:"50 launches/day × 1.5 SOL × $180 × 0.30",  day:"$4,050/day",  yr:"$2.25M AUD/yr"},
                {src:"Swap 0.40%",   note:"$15M daily platform volume × 0.40%",        day:"$60,000/day", yr:"$32.8M AUD/yr"},
                {src:"Total",        note:"Conservative — volume scales with tokens",   day:"$64,050/day", yr:"$35M AUD/yr"},
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
            </GlassCard>
          </div>
        )}

        {/* ── AIRDROP ───────────────────────────────── */}
        {activeSection==="airdrop"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <Label size={22} color={C.text} weight={700} style={{display:"block",marginBottom:6,letterSpacing:"-0.03em"}}>Quarterly airdrop</Label>
            <Label size={14} color={C.textSec} style={{display:"block",marginBottom:18,lineHeight:1.6}}>0.50% of every swap accumulates in the airdrop pool. Each quarter, USDC is distributed to all holders proportional by their balance. No staking. No claiming. Automatic.</Label>

            <GlassCard style={{padding:"20px",marginBottom:12}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:16,textTransform:"uppercase",letterSpacing:"0.05em"}}>How it works</Label>
              {[
                {n:"1",title:"Fee accumulates",desc:"0.50% of every buy and sell is routed to the airdrop pool on-chain.",col:C.accent},
                {n:"2",title:"Quarter ends",desc:"At the end of each quarter, a snapshot of all token holders and their balances is taken.",col:C.gold},
                {n:"3",title:"Pool → USDC",desc:"Accumulated SOL in the pool is swapped to USDC.",col:C.teal},
                {n:"4",title:"Distribution",desc:"USDC is sent to every holder proportional to their % of total supply. Lands in your wallet automatically.",col:C.green},
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

            {/* Example payouts */}
            <GlassCard style={{overflow:"hidden",marginBottom:12}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Example quarterly payouts</Label>
                <Label size={12} color={C.textTer}>At different daily volumes and holding percentages. 0.50% of volume × 90 days.</Label>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:360}}>
                  <thead>
                    <tr style={{background:"rgba(255,255,255,0.03)",borderBottom:`1px solid ${C.border}`}}>
                      {["Holding %","$100K/day","$500K/day","$2M/day"].map(h=>(
                        <td key={h} style={{padding:"8px 14px"}}>
                          <Label size={10} color={C.textTer} weight={600} style={{textTransform:"uppercase",letterSpacing:"0.04em"}}>{h}</Label>
                        </td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {pct:"5.0%",  v100:"$22,500", v500:"$112,500", v2m:"$450,000"},
                      {pct:"2.0%",  v100:"$9,000",  v500:"$45,000",  v2m:"$180,000"},
                      {pct:"1.0%",  v100:"$4,500",  v500:"$22,500",  v2m:"$90,000"},
                      {pct:"0.5%",  v100:"$2,250",  v500:"$11,250",  v2m:"$45,000"},
                      {pct:"0.1%",  v100:"$450",    v500:"$2,250",   v2m:"$9,000"},
                    ].map((r,i,a)=>(
                      <tr key={r.pct} style={{background:i%2===0?"rgba(255,255,255,0.01)":"transparent",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.text} weight={600}>{r.pct}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.green}>{r.v100}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.green} weight={600}>{r.v500}</Label></td>
                        <td style={{padding:"10px 14px"}}><Label size={12} color={C.gold} weight={700}>{r.v2m}</Label></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderTop:`1px solid ${C.border}`}}>
                <Label size={11} color={C.textTer}>Formula: (daily volume × 0.50% × 90 days) × your holding %. Everyone earns. Bigger bag = bigger airdrop.</Label>
              </div>
            </GlassCard>

            <GlassCard style={{padding:"18px 20px"}} hover={false}>
              <Label size={13} color={C.text} weight={700} style={{display:"block",marginBottom:12}}>FAQ</Label>
              {[
                {q:"Who qualifies?",  a:"Every wallet holding the token at the quarterly snapshot. No minimum balance."},
                {q:"Do I need to stake?", a:"No. Just hold the token in your wallet. No staking, no locking, no claiming interface."},
                {q:"When do I get paid?", a:"Once per quarter. USDC lands in your wallet automatically."},
                {q:"What if I sell before the snapshot?", a:"You miss that quarter's airdrop. Buy back in and you're eligible for the next one."},
                {q:"Is it proportional?", a:"Yes. Your airdrop = (your balance / total supply) × total pool. Hold 1% of supply = get 1% of the quarterly pool."},
              ].map((r,i,a)=>(
                <div key={r.q} style={{padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}>
                  <Label size={12} color={C.gold} weight={600} style={{display:"block",marginBottom:3}}>{r.q}</Label>
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
            </GlassCard>
          </div>
        )}

        {/* ── PVP ────────────────────────────────────── */}
        {activeSection==="pvp"&&(
          <div style={{animation:"fadeUp 0.2s ease"}}>
            <Label size={22} color={C.text} weight={700} style={{display:"block",marginBottom:6,letterSpacing:"-0.03em"}}>Identity PVP</Label>
            <Label size={14} color={C.textSec} style={{display:"block",marginBottom:18,lineHeight:1.6}}>Link your Twitter or website at deploy. That link activates the identity lock on-chain. Without a link — no lock, no protection. With a link — first mover wins, all derivatives blocked permanently.</Label>

            <GlassCard style={{padding:"16px 20px",marginBottom:12,background:"rgba(167,139,250,0.05)",border:`1px solid rgba(167,139,250,0.2)`}} hover={false}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  {state:"No link provided",col:C.textTer,items:["No identity lock","Anyone can copy your narrative","Only image hash applied"]},
                  {state:"Link provided",col:C.purple,items:["Identity locks to your CA","All derivatives blocked on-chain","First mover wins permanently"]},
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

            <GlassCard style={{overflow:"hidden",marginBottom:12}} hover={false}>
              <div style={{padding:"14px 20px 12px"}}>
                <Label size={14} color={C.text} weight={700} style={{display:"block",marginBottom:4}}>Three on-chain locks</Label>
                <Label size={12} color={C.textTer}>All three are checked at every deploy attempt.</Label>
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

            <GlassCard style={{padding:"18px 20px",marginBottom:12}} hover={false}>
              <Label size={11} color={C.textTer} style={{display:"block",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.05em"}}>The rules</Label>
              {[
                "Token crosses $50K market cap — ticker, image, and identity all lock permanently",
                "Token drops below $50K — all locks release. Fair game to compete again",
                "Identity only locks if you provided Twitter or website at deploy. No link = no identity lock",
                "First mover with a link wins. Late arrivals with the same identity get blocked",
              ].map((t,i,a)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:i<a.length-1?10:0}}>
                  <div style={{width:4,height:4,borderRadius:"50%",background:C.purple,flexShrink:0,marginTop:6}}/>
                  <Label size={13} color={C.textSec} style={{lineHeight:1.65}}>{t}</Label>
                </div>
              ))}
            </GlassCard>

            <PvpExamples/>
          </div>
        )}

      </div>
    </div>
  );
}


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
        <div style={{display:"flex",justifyContent:"center",paddingTop:12,marginBottom:4}}>
          <div style={{width:36,height:4,borderRadius:99,background:"rgba(255,255,255,0.12)"}}/>
        </div>
        <div style={{padding:"16px 24px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <Label size={22} color={C.text} weight={700}>Launch slots</Label>
            <div style={{marginTop:3}}><Label size={13} color={C.textTer}>Volume drives availability. More trading = more launches.</Label></div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"none",borderRadius:20,width:36,height:36,cursor:"pointer",color:C.textSec,fontSize:18}}>x</button>
        </div>
        <div style={{padding:"20px 24px 0",display:"flex",flexDirection:"column",gap:14}}>
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
            </div>
          )}

          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"16px 18px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <Label size={13} color={C.text} weight={600}>Cap tier progression</Label>
              <div style={{background:C.accentBg,border:`1px solid ${C.accentBd}`,borderRadius:8,padding:"3px 10px"}}>
                <Label size={11} color={C.accent} weight={600}>{slotData.tier.label} -- {slotData.cap} cap</Label>
              </div>
            </div>
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
  t={...t,txs:t.txs||0,vol:t.vol||"$0",volRaw:t.volRaw||0,holders:t.holders||0,raisedSOL:t.raisedSOL||0,mcap:t.mcap||0,chg:t.chg||0,bondingFull:t.bondingFull||false,graduated:t.graduated||false,sym:t.sym||"???",name:t.name||t.sym||"Unknown",pi:t.pi||0,minsAgo:t.minsAgo||0,elapsed:t.elapsed||0};
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
      <div style={{width:28,flexShrink:0,textAlign:"center"}}>
        <Label size={11} color={rank<=3?C.gold:"rgba(255,255,255,0.18)"} weight={700} mono>{rank}</Label>
      </div>
      <div style={{marginRight:12,flexShrink:0}}>
        <Avatar sym={t.sym} pi={t.pi} size={36}/>
      </div>
      <div style={{width:130,flexShrink:0}}>
        <Label size={14} color={C.text} weight={700} style={{display:"block",letterSpacing:"-0.02em"}}>{t.sym}</Label>
        {t.name && t.name !== t.sym && <Label size={11} color={C.textQuat} style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>{t.name}</Label>}
      </div>
      <div className="feed-hide-mobile" style={{width:72,flexShrink:0,marginRight:16}}>
        <Spark data={spark} color={up?C.green:C.red} width={72} height={26}/>
      </div>
      <div style={{width:90,flexShrink:0}}>
        <Label size={14} color={C.text} weight={600} mono style={{display:"block"}}>{fmt(t.mcap)}</Label>
        <Label size={11} color={up?C.green:C.red} weight={500} mono>{up?"+":""}{t.chg.toFixed(1)}%</Label>
      </div>
      <div className="feed-hide-mobile" style={{width:72,flexShrink:0}}>
        <Label size={11} color={C.textQuat} style={{display:"block",marginBottom:2}}>vol</Label>
        <Label size={13} color={C.textSec} weight={500} mono>{t.vol}</Label>
      </div>
      <div className="feed-hide-mobile" style={{width:60,flexShrink:0}}>
        <Label size={11} color={C.textQuat} style={{display:"block",marginBottom:2}}>holders</Label>
        <Label size={13} color={C.textSec} weight={500} mono>{t.holders > 0 ? t.holders.toLocaleString() : "—"}</Label>
      </div>
      <div className="feed-hide-mobile" style={{flex:1,marginLeft:16}}>
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
              <Label size={10} color={C.textQuat} mono>{(t.raisedSOL||0).toFixed(1)} / 85 SOL</Label>
              <Label size={10} color={barCol}>{t.bondingFull?"bonded":(t.raisedSOL||0)>=60?"near grad":`${85-(t.raisedSOL||0)} left`}</Label>
            </div>
          </div>
        )}
      </div>
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
    {id:"new",    label:"New Pairs",   color:C.blue,   tokens: [...tokens].filter(t=>t.hasPool!==false).sort((a,b)=>(a.createdAt||a.elapsed||0)-(b.createdAt||b.elapsed||0)).reverse()},
    {id:"hot",    label:"Hot",         color:C.accent, tokens: [...tokens].filter(t=>(t.volRaw||0)>0||t.chg>0).sort((a,b)=>(b.volRaw||0)-(a.volRaw||0))},
    {id:"near",   label:"Near Grad",   color:C.purple, tokens: [...tokens].filter(t=>(t.raisedSOL||0)>=50&&!t.bondingFull).sort((a,b)=>(b.raisedSOL||0)-(a.raisedSOL||0))},
    {id:"bonded", label:"Bonded",      color:C.gold,   tokens: [...tokens].filter(t=>t.bondingFull&&!t.graduated).sort((a,b)=>(b.volRaw||0)-(a.volRaw||0))},
    {id:"grad",   label:"Graduated",   color:C.raydium,tokens: [...tokens].filter(t=>t.graduated).sort((a,b)=>(b.volRaw||0)-(a.volRaw||0))},
  ];

  const active = tabs.find(t=>t.id===tab);

  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
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
              {isActive&&<div style={{position:"absolute",bottom:0,left:8,right:8,height:2,
                background:t.color,borderRadius:"2px 2px 0 0"}}/>}
            </button>
          );
        })}
      </div>
      <div className="feed-table-header" style={{display:"flex",alignItems:"center",gap:0,padding:"0 20px",height:32,
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


// ===== MAIN APP =====

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
  const [tokens,setTokens]=useState([]);

  // Fetch tokens on load + poll every 15s for new tokens and updated data
  useEffect(()=>{
    const load = () => fetchAllTokensWithPools().then(onChain=>{
      if(onChain.length>0){
        setTokens(onChain);
        setPlatformVol(onChain.reduce((a,t)=>a+(t.volRaw||0),0));
      }
    }).catch(e=>console.error("fetch tokens error:",e));
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  },[]);

  const [notifs]=useState([]);
  const [platformVol,setPlatformVol]=useState(0);

  const unread=notifs.filter(n=>!n.read).length;
  const slotData={open:50,totalAvailable:50,cap:50,atCap:false,toNextSlot:0,tierPct:1,atFloor:false,tier:{label:"Launch"},nextTier:{cap:100,vol:100000}};

  if(selected) return <TokenPage t={selected} onClose={()=>setSelected(null)} connected={connected} onConnect={connectWallet}/>;
  if(view==="portfolio") return <Portfolio onSelectToken={t=>{setView("feed");setSelected(t);}} onClose={()=>setView("feed")}/>
  if(view==="tokenomics") return <Tokenomics onClose={()=>setView("feed")}/>;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:C.sans}}>
      <style>{FONT}</style>

      <nav style={{position:"sticky",top:0,zIndex:100,background:"rgba(13,12,11,0.92)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderBottom:`1px solid ${C.border}`,height:52,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAN80lEQVR42u2ce3Bc1X3Hv79zzt2HXrZsLMAYDJZKDuJRqJJCaOglE0hM7Vi2yTXYro3Nq01nWqBtpgXaWW9DMp1OMkPTyQyhtmnLI8AWv43tSQDf/EHdJA7GTBWwZNlyRBzkWg+vHrt7zzm//rG7siyLh1v0Ivczo5G0q9179nzP+T3PFRASEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEhLyiUOfkjFzKMAYkUxCYJ8rAGD9Pt8QnTvZzKDlyz3R0NlJuMW3qRRsuLf+nwvD8zzJfO4CcV0oz5s3beXCy6q9W+dNa2yE84HCTYEFRpNw4kU6nTalB1bffkW9isublaTPA+IzAnwRA5WgwuCZkWPmbgba2OKnOjA/OXbaHPD99mxogs7T1JRMx23XXlg+N1F5l5RiDQg3xiIyQoJgDMNYhhIEKQW0scjlbQ7ASYB7reUsg/uJqTVnzKs2q19P7D3+fqrgIyaln1CTYRCe58lUKm0AOPcuq/tjR4mHolFRywwE2iIfmIAJ7EgZEUTI5k2L1Wa7MbynL89vpfe0njz7/ebE4zY2W4Oi4Q74iOsnk6BUCnbdknlfiETVE7GIajTGQhs2hfExCyGkkoR83rwRBPaJ/z6R3bl/f8fgKDYf69eDR3PUoQAfMvlrl9U+UhZxHpeSRKCNBkgIQYIta8cRKh+YU0Eef7Nxy+ENo8SfRKObF5oKIaqY4Mnn+726TdMrot+2zAi0MQApAMJaq6MRqfJ585/dvfaGjVsOb2AGPfBAowOAVjbVXbdqQWIOuCDCB+QGk34nTIQA5HmeSKXA93+t7oWKMmddLq8DIhARyUJczzriKJUZCLYfPD7wpRf3tB5Juq4iAl/8bgUD4JjArdEy/BMReL3ryqkab4+7AEnXlel02tx3R93GqorI8mzWBETCIVBxFbOJRZXK5oLdG19uWbZ/f8eg50GmfF8Pfx/D3De9MrrsnmV1f5Dyfe15kKEAH4Hruirl+/ruJbWPVZY76wazOiCioUTKWlglpRzM6l/+5j1xJwM2mYRIp2HOGTghrhSxkvSk686NAd6ULK2MmwCeB+n7vl7bVHdzZZnzeC4AmgFVyKYABrOUYGM4dzob3LX9jXczy70zucG5HpZ0NmcoHlNX1l3g/G06nTbJKWiKxksAamgAezfOiTsONhARrIUgGh4wso0oKQcD8/gLO44eSrquGm3lD+0W2EEhCIG2uVhUPbpqUe3vTkVTNC4CJF1XplKwVbNjf1ZR7tRrY7UQJAqhCoPB1pFSDGTN0aOn8t9JJiFSvj/65N/iWwAUUfJea5kJiGrDvfGYeNJ1oaaaKRoPASjl+2blwsuqlZLfCAK2AAkwwFxY/kRgIYkCrb/r++3ZYvWTR/UhKdh7lyVWVFU4NwbaBP2Devtg1mwSgi6trU48NtIUJZMQpSRtMiLHYfUrv73dfvbqWV+vrHCWBsYaIpLD1igLQSKfN10nsvn7W1p6c357O5dKFFdd1SyamwtiHGtv5zcXz6+Uxt7Els20isiVubw50Kda/1Tlq2lGdfRbicunv/S9vb/oTCYhfB9c+pqsu2LMV8b6gikRjqJ11oLPhJuAKPxoHCnAjD27dh3v9jxvaPWn02kz3A8QwNHOfv3cjiPf7+zqW9s3GHRFI2Jx7r2ZZYjg6cxA8ENF9q8WLEhESz2ENYsTX1vVVHczAJ6M/mFMBfA8SAJ49eLE7yglrw60BQFSlCJ+PpOyBpr3AqDq6jYBAN6X58y49476f1u7pLYJAJLFsab3dwwmk8DWV399KjMQrC6LOxUXXTLzoafTrSefeunwShD9fHY5PZryfd3YCCcao3+sjInnb7v2wvKGhsm3E8ZUgIZOlwDAcfDlqCOImQ0A2GLtgAsLXWVzxuocfgaA3y1kuhCCqqdXOmscR1xddABDY02lYJOuq57Z1vZKV0/uCSXo7/7otgvLmUFPb2590hr7ydqF8+ouxsWOtnwoHpVzLk9UbSq+Tv7WCNBc4zMASKLfZwBERGd7VrJSEIyxnd3v97UPf6YsFp2T6QuyPRl+apgpGyLl+ybpumrj5paH89q+7VRWPloKaoUw3zRK3LbzwImBjiOZVf1Z3VlVFVm+dlntIynf10nXVb8NAlA6DeO6UELQldYyUGwxDrcBVLBH7+08cGKAAbqlFB0oebNl/nl6T+tJz/PkKBVPhu9bBmiwn5sE8IcrFtVfkARo0+Zj7ad7glcWLEhEbzr0/iAY2XxgMa08+u3VX61tmkwijJkApdm6dMa8GUS40FoGgwlnxZfMBFhBpAFgffKMNsymylj7AgBq6Owc1W6nALvcg3huT2uHDviRmGNXpwDruq7a5rcfu+GG1iAFWK1tOq9NXz5v3p9e5bx0zx3zPztZkraxG0AxDLymfubcqCMeKlogOrtYzCYSkWowa55/852uH9fUQJwsb0dzM/i6+hnXW9Zb33q3t6cUlo5q5poL0c3zW7pbrpk/fca1DdW9O/YczACF6wOgN9/p+lHi0qoWzfagI8UsnTezGuurW57d0n1qop3ymO2A5ubCB3OkKZeFeJPP3iGsYzHlZDLB05u2tPx1qehWCjsDrfdefl378REbalSKr6FntrW98qsuc3qoWnGmJ8Av7jmazkXbvt9xsu+BYMB+MxBYsnrJZ2aeiXAnhnGwgw7onB4h63hMqUx/8B8bNrfcU2zIn/Unz+469hZ2nb/V+6DTEMVrGOC9QwCw+Kb5P4iWD9YC6C691nWhcrk5zsh255TcAcWYG1YHueEOmJl1LKpUf3/w+i/aDq9MJiHWp0btXn2iq7JUVS3mE7T9jXcz6R+1Hxx+3RrMvaAmri4bzzrZmF2kOKnI5US3tZwVRGBmHY1INTAYvP2bztyyAwegSxnuh/jxT5TUGdM01DNOFpw/OWWytrJclhd3zNTeAaVPZ0/n/geEUyBAKaFyedNxql8v2ua393gfUu8fB3iEv+JIVNwqCbmSUlM9D+BkEiK9v2OQLR+ORgSMsT2ZTG5Remfbcc+D/LB6/zhC6TTsqgWJKiK6qYsHjhbnn6e6ACgVxLTlQ9Yyegf00ud3HXvro5ot40mxNMHxOO4RAmrnzhMDnudJjJMAYxoFlUoRgTF7T3bb5ud2HNmXLPaFJ0klgJpranjBgkRUOfKxnLb/UKhhdU7FY/sfY7V9zMZIMgkxHqWCBxobHQBYtzTx3QdXN/CdX5l7+fmMcypBH/NDUXH7D/flNJaTv7ap9isP393A991R99qndfI/FsPrMisWzqu7z6v/i/PdOR978gun63DXgrnXf/3O+V0Pr2ngu5tqlxR9wrgW6SaFrSud73TdWRX1NdMflEJ8ozyupvVm8hs2vNxyf2liPgHfQUnXlSnf16sWXfG5irLIznhM1mT6g7cPHmtpXHQAppgnfAqKcefhF77og9csmbfi4qryH5bFHM8yx7S2QXmZ87lr6qt/b/ZFVa8+te9gxvMgr7oKQz3i85x45be3W7+93a5tqr2zvMx5WUmqBoDBvF67+7XuwzXe/+m9p+4O8DxPptNps2bxvHUzp8c25QMLY60mIklEVMqc84E5nsvbhza+3LJ5+EpurvE5nR7KbEf6HCokWB5Kd9x4X0jMmjFb/H3EkX8SaGuiESn7B4IXN7zccldpLOPuHCfYMVPrfyUq4hX0Tiwia7SxTETqzNAYAIxSQhKAXN7uzgXBd/51S9tr55ixUrNnlHsDvAWJWdPKaK1S4sFYVF6SzelAOcIJAnu8q2fg+obPd/SsT4FpAk5TT5gAL3meXJ5Om3VLEt+aVhV5NJvTWggxqgPkQvOYYxEhtGEYY3+mjd2qA/t6V2bw8NZXf31q+N+7c+fGLrrSuaQsjusjjrhdEC2KRmRNYCy0toFSQoKRzwwa99+3tvx0IrPyCRGgdD/Ymq9ecW1ZWWS/EIgwF48qfjjFIy6CpCDkA4vAmC5r+ASATMGhU1wQqgFcHItKp3h8EdZawwyWQkgAON0XLH1mx5FtrusqfwITwwnpizY3ewSkwVJcoaSIW2YwWwNAntU04xEtfCLJzMgFxgqCBUg6Ss4QDmYMt1qWGcYw8toaMDOIJBispFDWcj7TH6x4ZkfbtsmQlcuJEaCZk0mI7/2g+526y6oORR1xe8SRcWOsLiVfIzcDFcrZICIQiLhY12cGWwu2zNYay8YUTFZRO8EgENhGI0ppY0/0ntbLntvVtnuylEQmLAz1/UK19J//pfuX8y+t3i4kXRePqcuZQZZZA4VbZkpCUOEWmiHDWfp92DdBRGJY9swAG0cJ6SghBrN6d0+PaXphz5G3JlM9asITsWEOUN67NPHnkaj8y2hEXmIMI9DWAoXDvEIQMTOdNfCiIFzI5JgZTGBrGcJRJKQUyOX1sWzePv705taNI66HUIARThkAVn9p9sxYdfkDJGhdxBF1UggYy7DGghmWwbZwl/wwLRhEgoSSBCkI2jBygWm2jI293Xpj+sdtvcyg9QQa70x3SggwMjErhZLzrpdflFIukpJuBijhKIpLWTRFXDrZUrh73mg7AKIWtvyTnLY73t7Suu8AEEzGVT9pBRhZrxn+4Gpv3mUqEFcIKS4lYBqIhTVsiNBjiH6lLB/dsKW146x8oBBiGkzhf2czoUJ4HuT5VieTrquKldUp0VSZKp2fodpOZ6dLtwx7Yh+AmhqfGxrA4f8JCgkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQEA/C+lMcJJ+bJASAAAAABJRU5ErkJggg==" style={{width:22,height:22,objectFit:"contain",flexShrink:0,opacity:0.55}} alt="summit.moon"/>
          <span style={{fontSize:14,fontWeight:400,color:"rgba(250,246,239,0.7)",fontFamily:C.serif,letterSpacing:"-0.01em",fontStyle:"italic"}}>summit<span style={{fontStyle:"normal",color:"rgba(201,168,76,0.7)",fontWeight:400}}>.</span>moon</span>
          <div style={{width:5,height:5,borderRadius:"50%",background:C.green,animation:"pulse 3s infinite",boxShadow:`0 0 5px ${C.green}`}}/>
          <div style={{padding:"2px 6px",background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.25)",borderRadius:3}}><span style={{fontSize:9,fontWeight:700,color:"#f59e0b",letterSpacing:"0.06em",fontFamily:C.mono}}>DEVNET</span></div>
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

        {/* Platform stats row — editorial style */}
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          <div style={{background:`linear-gradient(135deg, rgba(201,168,76,0.06), rgba(201,168,76,0.02))`,border:"1px solid rgba(201,168,76,0.15)",borderRadius:10,padding:"10px 16px",display:"flex",gap:10,alignItems:"center",flex:"1 1 auto"}}>
            <div style={{width:32,height:32,borderRadius:8,background:"rgba(201,168,76,0.1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            </div>
            <div>
              <Label size={10} color={C.textTer} style={{display:"block",letterSpacing:"0.04em",textTransform:"uppercase"}}>Platform Volume</Label>
              <Label size={16} color={C.gold} weight={700} mono>{fmtVol(platformVol)}</Label>
            </div>
          </div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 16px",display:"flex",gap:10,alignItems:"center",flex:"1 1 auto"}}>
            <div style={{width:32,height:32,borderRadius:8,background:"rgba(34,197,94,0.08)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </div>
            <div>
              <Label size={10} color={C.textTer} style={{display:"block",letterSpacing:"0.04em",textTransform:"uppercase"}}>Live Tokens</Label>
              <Label size={16} color={C.text} weight={700} mono>{tokens.filter(t=>t.hasPool!==false).length}</Label>
            </div>
          </div>
          <div style={{background:`linear-gradient(135deg, rgba(201,168,76,0.04), transparent)`,border:"1px solid rgba(201,168,76,0.12)",borderRadius:10,padding:"10px 16px",display:"flex",gap:10,alignItems:"center",flex:"1 1 auto"}}>
            <div style={{width:32,height:32,borderRadius:8,background:"rgba(201,168,76,0.08)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:C.gold,animation:"pulse 2s infinite"}}/>
            </div>
            <div>
              <Label size={10} color={C.textTer} style={{display:"block",letterSpacing:"0.04em",textTransform:"uppercase"}}>Airdrop Pool / Quarter</Label>
              <Label size={16} color={C.gold} weight={700} mono>{fmtVol((platformVol*FEE_AIRDROP)*90)}</Label>
            </div>
          </div>
          <div style={{background:C.card,border:`1px solid ${slotData.open>0?C.border:C.redBd}`,borderRadius:10,padding:"10px 16px",display:"flex",gap:10,alignItems:"center",cursor:"pointer",flex:"0 0 auto"}} onClick={()=>setShowSlots(true)}>
            <div style={{width:32,height:32,borderRadius:8,background:slotData.open>5?"rgba(34,197,94,0.08)":"rgba(244,63,94,0.08)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:slotData.open>5?C.green:slotData.open>0?C.gold:C.red}}/>
            </div>
            <div>
              <Label size={10} color={C.textTer} style={{display:"block",letterSpacing:"0.04em",textTransform:"uppercase"}}>Launch Slots</Label>
              <Label size={16} color={slotData.open>0?C.text:C.red} weight={700} mono>{slotData.open}<span style={{fontSize:11,color:C.textQuat,fontWeight:400}}>/{slotData.cap}</span></Label>
            </div>
          </div>
        </div>

        <TabFeed tokens={tokens} onSelect={setSelected}/>

      </div>

      {launching&&<LaunchModal onClose={()=>setLaunching(false)} slotData={slotData} onDeployed={(newToken)=>{
        // Immediately add new token to feed without waiting for poll
        setTokens(prev => {
          const exists = prev.find(t => t.mint === newToken.mint);
          if (exists) return prev;
          return [newToken, ...prev];
        });
      }}/>}
      {showSlots&&<SlotPanel slotData={slotData} platformVol={platformVol} tokens={tokens} onClose={()=>setShowSlots(false)} onLaunch={()=>setLaunching(true)}/>}
    </div>
  );
}
