import { WidgetRegistry } from './registry';

export function registerBuiltinWidgets(): void {
  // ── Color Distribution ──────────────────────────────────────────────────────
  WidgetRegistry.register({
    id: 'color-distribution',
    name: 'Color Distribution',
    description: 'Cards per color (W/U/B/R/G/Colorless)',
    icon: 'palette',
    readonly: true,
    width: 210,
    params: [
      { key: 'show_pct', label: 'Show %', type: 'boolean', default: true },
      { key: 'use_all', label: 'Include sideboard', type: 'boolean', default: false },
    ],
    code: `
const CM={W:{bg:'#f0d870',fg:'#1a1a00'},U:{bg:'#4a7cc9',fg:'#fff'},B:{bg:'#4a4040',fg:'#ccc'},R:{bg:'#c0392b',fg:'#fff'},G:{bg:'#27ae60',fg:'#fff'},C:{bg:'#7c7c7c',fg:'#fff'}};
const source=params.use_all?data.allCards:data.cards;
if(!source.length)return'<p style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;padding:10px 0">No cards</p>';
const cnt={W:0,U:0,B:0,R:0,G:0,C:0};
source.forEach(({colorIdentity,qty})=>{
  if(!colorIdentity.length)cnt.C+=qty;
  else colorIdentity.forEach(c=>{if(c in cnt)cnt[c]+=qty;});
});
const entries=Object.entries(cnt).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
const maxV=Math.max(1,...entries.map(([,v])=>v));
const total=source.reduce((s,c)=>s+c.qty,0)||1;
const rows=entries.map(([col,v])=>{
  const m=CM[col],pct=Math.round(v/total*100),w=Math.round(v/maxV*100);
  return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'
    +'<div style="width:16px;height:16px;border-radius:50%;background:'+m.bg+';color:'+m.fg+';display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;flex-shrink:0">'+col+'</div>'
    +'<div style="flex:1;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+w+'%;background:'+m.bg+';opacity:0.8;border-radius:3px"></div></div>'
    +'<span style="font-size:11px;font-weight:700;color:#fff;width:18px;text-align:right">'+v+'</span>'
    +(params.show_pct?'<span style="font-size:9px;color:rgba(255,255,255,0.3);width:26px;text-align:right">'+pct+'%</span>':'')
    +'</div>';
}).join('');
return'<div style="font-family:-apple-system,sans-serif">'+rows+'</div>';
`,
  });

  // ── Mana Curve ─────────────────────────────────────────────────────────────
  WidgetRegistry.register({
    id: 'mana-curve',
    name: 'Mana Curve',
    description: 'Histogram of cards by mana value (lands excluded)',
    icon: 'bar_chart',
    readonly: true,
    width: 210,
    params: [
      { key: 'cap', label: 'Max CMC bucket', type: 'number', default: 6, min: 4, max: 10, step: 1 },
      { key: 'exclude_lands', label: 'Exclude lands', type: 'boolean', default: true },
    ],
    code: `
const {cards}=data;
if(!cards.length)return'<p style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;padding:10px 0">No cards</p>';
const cap=Math.max(4,Math.min(10,typeof params.cap==='number'?params.cap:6));
const curve=Array(cap+1).fill(0);
cards.forEach(({cmc,qty,typeLine})=>{
  if(params.exclude_lands&&(typeLine||'').toLowerCase().includes('land'))return;
  curve[Math.min(cap,Math.round(cmc||0))]+=qty;
});
const maxV=Math.max(1,...curve);
const H=52;
const bars=curve.map((v,i)=>{
  const h=v>0?Math.max(4,Math.round((v/maxV)*H)):0;
  return'<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">'
    +(v>0?'<span style="font-size:8px;color:rgba(242,202,131,0.65);font-weight:700;line-height:1">'+v+'</span>':'<span style="font-size:8px;color:transparent">0</span>')
    +'<div style="width:100%;height:'+H+'px;display:flex;align-items:flex-end">'
      +'<div style="width:100%;height:'+h+'px;background:rgba(242,202,131,0.38);border-radius:3px 3px 0 0"></div>'
    +'</div>'
    +'<span style="font-size:8px;color:rgba(255,255,255,0.22);line-height:1">'+(i<cap?i:cap+'+')+'</span>'
    +'</div>';
}).join('');
return'<div style="display:flex;align-items:flex-end;gap:2px;height:'+(H+28)+'px;font-family:-apple-system,sans-serif">'+bars+'</div>';
`,
  });

  // ── Draw Odds ───────────────────────────────────────────────────────────────
  WidgetRegistry.register({
    id: 'draw-odds',
    name: 'Draw Odds',
    description: 'Odds of drawing each canvas group (or card type) by opening hand and turn 5',
    icon: 'casino',
    readonly: true,
    width: 255,
    params: [
      { key: 'hand_size', label: 'Opening hand', type: 'number', default: 7, min: 1, max: 10, step: 1 },
      { key: 'show_t5',   label: 'Show Turn 5',  type: 'boolean', default: true },
    ],
    code: `
const {cards,deckSize,groups}=data;
if(!cards.length)return'<p style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;padding:10px 0">No cards</p>';

const handSize=typeof params.hand_size==='number'?Math.max(1,Math.min(10,params.hand_size)):7;
const showT5=params.show_t5!==false;

// Hypergeometric: P(draw ≥1 from K copies in deck of D in n draws)
function pDraw(D,K,n){if(K<=0||D<=0)return 0;if(K>=D)return 1;let lp=0;for(let i=0;i<n;i++){const num=D-K-i;if(num<=0)return 1;lp+=Math.log(num)-Math.log(D-i);}return 1-Math.exp(lp);}

const D=deckSize;
const pc=p=>p>=80?'#86efac':p>=50?'#f2ca83':'#7eb8f7';

// ── Build "virtual groups" ────────────────────────────────────────────────
// If the arrangement has named groups, use them. Otherwise fall back to card types.
let items; // [{name, color, qty}]

if(groups&&groups.length>0){
  items=groups.map(g=>({name:g.name,color:g.color,qty:g.totalQty}));
}else{
  // Fallback: group cards by type
  const TC={Creatures:'#f2ca83',Instants:'#7eb8f7',Sorceries:'#c084fc',Enchantments:'#86efac',Artifacts:'#c4c6cd',Planeswalkers:'#f472b6',Lands:'#d4aa7d',Other:'#6b7280'};
  const order=['Creatures','Instants','Sorceries','Enchantments','Artifacts','Planeswalkers','Lands','Other'];
  const tm={};
  cards.forEach(({typeLine,qty})=>{
    const t=(typeLine||'').toLowerCase();
    const cat=t.includes('creature')?'Creatures':t.includes('instant')?'Instants':t.includes('sorcery')?'Sorceries':t.includes('enchantment')?'Enchantments':t.includes('artifact')?'Artifacts':t.includes('planeswalker')?'Planeswalkers':t.includes('land')?'Lands':'Other';
    tm[cat]=(tm[cat]||0)+qty;
  });
  items=order.filter(n=>tm[n]>0).map(n=>({name:n,color:TC[n],qty:tm[n]}));
}

if(!items.length)return'<p style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;padding:10px 0">No data</p>';

const useGroups=groups&&groups.length>0;

const rows=items.map(({name,color,qty})=>{
  const K=qty;
  const pH=Math.round(pDraw(D,K,handSize)*100);
  const pT=Math.round(pDraw(D,K,handSize+5)*100);
  const col=pc(pH);
  const barW=60;
  return'<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px">'
    +'<div style="width:7px;height:7px;border-radius:50%;background:'+color+';flex-shrink:0"></div>'
    +'<span style="font-size:10px;color:rgba(255,255,255,0.45);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+name+'</span>'
    +'<span style="font-size:9px;color:rgba(255,255,255,0.22);width:20px;text-align:right;flex-shrink:0">'+K+'</span>'
    +'<div style="width:'+barW+'px;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;flex-shrink:0"><div style="height:100%;width:'+pH+'%;background:'+col+';border-radius:2px"></div></div>'
    +'<span style="font-size:10px;font-weight:700;color:'+col+';width:26px;text-align:right;flex-shrink:0">'+pH+'%</span>'
    +(showT5?'<span style="font-size:9px;color:rgba(255,255,255,0.3);width:26px;text-align:right;flex-shrink:0">'+pT+'%</span>':'')
    +'</div>';
}).join('');

const label=(useGroups?'Groups':'By Type')+' · Hand '+handSize+(showT5?' · T5':'');
return'<div style="font-family:-apple-system,sans-serif">'
  +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">'
    +'<p style="font-size:9px;color:rgba(255,255,255,0.22);text-transform:uppercase;letter-spacing:.07em;flex:1;margin:0">'+label+'</p>'
    +(showT5?'<span style="font-size:8px;color:rgba(255,255,255,0.18);white-space:nowrap">Hand &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; T5</span>':'')
  +'</div>'
  +rows+'</div>';
`,
  });

  // ── Type Breakdown ──────────────────────────────────────────────────────────
  WidgetRegistry.register({
    id: 'type-breakdown',
    name: 'Type Breakdown',
    description: 'Distribution of card types in the deck',
    icon: 'category',
    readonly: true,
    width: 210,
    params: [
      { key: 'use_all', label: 'Include sideboard', type: 'boolean', default: false },
    ],
    code: `
const TC={Creature:'#f2ca83',Instant:'#7eb8f7',Sorcery:'#c084fc',Enchantment:'#86efac',Artifact:'#c4c6cd',Planeswalker:'#f472b6',Land:'#d4aa7d',Other:'#6b7280'};
const source=params.use_all?data.allCards:data.cards;
if(!source.length)return'<p style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;padding:10px 0">No cards</p>';
const typeMap={};
source.forEach(({typeLine,qty})=>{
  const t=(typeLine||'').toLowerCase();
  const cat=t.includes('creature')?'Creature':t.includes('instant')?'Instant':t.includes('sorcery')?'Sorcery':t.includes('enchantment')?'Enchantment':t.includes('artifact')?'Artifact':t.includes('planeswalker')?'Planeswalker':t.includes('land')?'Land':'Other';
  typeMap[cat]=(typeMap[cat]||0)+qty;
});
const order=['Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Land','Other'];
const entries=order.map(t=>[t,typeMap[t]||0]).filter(([,v])=>v>0);
const maxV=Math.max(1,...entries.map(([,v])=>v));
const rows=entries.map(([type,v])=>{
  const col=TC[type]||'#6b7280',w=Math.round((v/maxV)*100);
  return'<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'
    +'<span style="font-size:10px;color:rgba(255,255,255,0.4);width:72px;flex-shrink:0">'+type+'</span>'
    +'<div style="flex:1;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+w+'%;background:'+col+';opacity:0.7;border-radius:3px"></div></div>'
    +'<span style="font-size:11px;font-weight:700;color:'+col+';width:22px;text-align:right">'+v+'</span>'
    +'</div>';
}).join('');
return'<div style="font-family:-apple-system,sans-serif">'+rows+'</div>';
`,
  });

  // ── Deck Stats ──────────────────────────────────────────────────────────────
  WidgetRegistry.register({
    id: 'deck-stats',
    name: 'Deck Stats',
    description: 'Quick overview: total cards, creatures, lands, avg CMC',
    icon: 'analytics',
    readonly: true,
    width: 185,
    params: [
      { key: 'show_avg_cmc', label: 'Show avg CMC', type: 'boolean', default: true },
      { key: 'show_nonlands', label: 'Show non-lands', type: 'boolean', default: true },
    ],
    code: `
const {cards,deckSize}=data;
const cmcC=cards.filter(c=>c.cmc>0&&!(c.typeLine||'').toLowerCase().includes('land'));
const avgCmc=cmcC.length?(cmcC.reduce((s,c)=>s+c.cmc*c.qty,0)/cmcC.reduce((s,c)=>s+c.qty,0)):0;
const lands=cards.filter(c=>(c.typeLine||'').toLowerCase().includes('land')).reduce((s,c)=>s+c.qty,0);
const creatures=cards.filter(c=>(c.typeLine||'').toLowerCase().includes('creature')).reduce((s,c)=>s+c.qty,0);
const allStats=[['Total',deckSize],['Creatures',creatures],['Lands',lands],params.show_nonlands?['Non-Lands',deckSize-lands]:null,params.show_avg_cmc?['Avg CMC',avgCmc.toFixed(1)]:null].filter(Boolean);
const rows=allStats.map(([l,v])=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">'
  +'<span style="font-size:11px;color:rgba(255,255,255,0.4)">'+l+'</span>'
  +'<span style="font-size:13px;font-weight:700;color:#f2ca83">'+v+'</span>'
  +'</div>').join('');
return'<div style="font-family:-apple-system,sans-serif">'+rows+'</div>';
`,
  });

  // ── Land Ratio ──────────────────────────────────────────────────────────────
  WidgetRegistry.register({
    id: 'land-ratio',
    name: 'Land Ratio',
    description: 'Visual breakdown of lands vs non-lands with recommended count',
    icon: 'terrain',
    readonly: true,
    width: 220,
    params: [
      { key: 'target_pct', label: 'Target %', type: 'number', default: 37, min: 20, max: 50, step: 1 },
    ],
    code: `
const {cards,deckSize}=data;
if(!deckSize)return'<p style="color:rgba(255,255,255,0.2);font-size:11px;text-align:center;padding:10px 0">Empty deck</p>';
const targetPct=typeof params.target_pct==='number'?Math.max(20,Math.min(50,params.target_pct)):37;
const lands=cards.filter(c=>(c.typeLine||'').toLowerCase().includes('land')).reduce((s,c)=>s+c.qty,0);
const pct=Math.round((lands/deckSize)*100);
const rec=Math.round(deckSize*(targetPct/100));
const diff=lands-rec;
const diffStr=diff===0?'on target':diff>0?'+'+diff+' over':(-diff)+' under';
const diffCol=diff===0?'#86efac':Math.abs(diff)<=3?'#f2ca83':'#f87171';
const cx=50,cy=50,r=38;
const angle=(pct/100)*2*Math.PI;
const x1=cx+r*Math.sin(angle),y1=cy-r*Math.cos(angle);
const arc=pct>50?'1 1':'0 1';
const pathD=pct===0?'':(pct>=100?'':'M '+cx+' '+(cy-r)+' A '+r+' '+r+' 0 '+arc+' '+x1+' '+y1+' L '+cx+' '+cy+' Z');
return'<div style="font-family:-apple-system,sans-serif;display:flex;gap:12px;align-items:center">'
  +'<svg width="100" height="100" viewBox="0 0 100 100">'
    +'<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>'
    +(pct>0&&pct<100?'<path d="'+pathD+'" fill="rgba(212,170,125,0.45)"/>':pct>=100?'<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="rgba(212,170,125,0.45)"/>':'')
    +'<circle cx="'+cx+'" cy="'+cy+'" r="27" fill="#12141a"/>'
    +'<text x="'+cx+'" y="'+(cy+4)+'" text-anchor="middle" fill="#f2ca83" font-size="14" font-weight="700" font-family="sans-serif">'+pct+'%</text>'
    +'<text x="'+cx+'" y="'+(cy+15)+'" text-anchor="middle" fill="rgba(255,255,255,0.28)" font-size="7" font-family="sans-serif">lands</text>'
  +'</svg>'
  +'<div style="flex:1">'
    +'<div style="margin-bottom:5px"><span style="font-size:22px;font-weight:700;color:#f2ca83">'+lands+'</span><span style="font-size:11px;color:rgba(255,255,255,0.3);margin-left:3px">/ '+deckSize+'</span></div>'
    +'<div style="font-size:11px;color:rgba(255,255,255,0.38);line-height:1.6">Non-lands: '+(deckSize-lands)+'<br>Rec. ~'+rec+' ('+targetPct+'%)</div>'
    +'<span style="font-size:10px;font-weight:700;color:'+diffCol+'">'+diffStr+'</span>'
  +'</div>'
+'</div>';
`,
  });
}
