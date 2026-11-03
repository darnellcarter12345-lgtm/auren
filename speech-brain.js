// AUREN v3.33 — context-aware sound-alike interpretation (non-destructive)
// Does not start a microphone or change voice settings. Runs on transcribed text.
const PLACE_NAMES = ['Whataburger','Chipotle','McDonald\'s','Chick-fil-A','Starbucks','Taco Bell','Burger King','Wendy\'s','Subway','Dunkin','Walmart','Target','Costco','CVS','Walgreens','Home Depot','Best Buy','Whole Foods'];
const COMMON_SOUNDS = new Map([
 ['water burger','Whataburger'],['waterburgrther','Whataburger'],['water burgrther','Whataburger'],
 ['what a burger','Whataburger'],['watta burger','Whataburger'],['wata burger','Whataburger'],
 ['chip oltay','Chipotle'],['chipolte','Chipotle'],['chipolay','Chipotle'],
 ['chick filet','Chick-fil-A'],['chick fill a','Chick-fil-A']
]);
const cleanup = s => String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const compact = s => cleanup(s).replace(/\s+/g,'');
function soundKey(s) {
 let v = compact(s).replace(/ph/g,'f').replace(/ck/g,'k').replace(/qu/g,'kw')
   .replace(/gh(?=[^aeiou]|$)/g,'').replace(/tch/g,'ch').replace(/dg(?=[ei])/g,'j')
   .replace(/c(?=[eiy])/g,'s').replace(/c/g,'k').replace(/x/g,'ks')
   .replace(/([a-z])\1+/g,'$1');
 if(!v)return '';
 return v[0] + v.slice(1).replace(/[aeiouy]/g,'').replace(/([a-z])\1+/g,'$1');
}
function distance(a,b){
 if(a===b)return 0;
 if(!a || !b)return Math.max(a.length,b.length);
 const row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
   let previous=row[0];row[0]=i;
   for(let j=1;j<=b.length;j++){
     const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=old;
   }
 }
 return row[b.length];
}
function likeness(a,b){
 const x=compact(a), y=compact(b);
 if(!x||!y)return 0;
 if(x===y)return 1;
 const lexical=1-distance(x,y)/Math.max(x.length,y.length);
 const sx=soundKey(x),sy=soundKey(y);
 const phonic=sx&&sy?1-distance(sx,sy)/Math.max(sx.length,sy.length):0;
 return Math.max(lexical,0.62*lexical+0.38*phonic);
}
const navigation = /\b(?:take me|send me|drive me|bring me|navigate|directions|route|how do i get|go to|head to|find|search|show me|where is|nearest|closest)\b/i;
const placeHint = /\b(?:to|for|near|at|the|a|an|me|my|directions|route|go|please|in|around|nearby)\b/gi;
function candidatePhrase(raw){
 const s=String(raw||'').trim().replace(/[.!?]+$/,'');
 let phrase=s.replace(/^(?:hey\s+)?(?:auren|aaron)[,: ]*/i,'')
  .replace(/^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:take|send|drive|bring|guide)\s+me\s+(?:to|toward)\s+/i,'')
  .replace(/^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:(?:get|give|show|send)\s+(?:me\s+)?(?:directions|a route|the route)|directions|route)\s+(?:to|for)\s+/i,'')
  .replace(/^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:navigate|go|head|drive)\s+(?:me\s+)?to\s+/i,'')
  .replace(/^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:find|search for|show me|locate)\s+(?:the\s+|a\s+)?/i,'')
  .replace(/\s+(?:near me|nearby|around here|please)$/i,'').trim();
 return phrase;
}
/**
 * Interpret a transcript in context. It never edits stored records.
 * names: actual places in the visible results or user-approved names.
 * Returns { text, correction, suggestion, confidence, original }.
 * If correction is null, keep the original or ask about suggestion.
 */
export function interpretSpokenText(raw,{domain='auto', names=[]}={}){
 const original=String(raw||'').trim();
 if(!original)return {text:original,correction:null,suggestion:null,confidence:0,original};
 const isPlace=domain==='place'||(domain==='auto'&&navigation.test(original));
 if(!isPlace)return {text:original,correction:null,suggestion:null,confidence:0,original};
 const phrase=candidatePhrase(original);
 if(!phrase||phrase.length<3||phrase.length>80)return {text:original,correction:null,suggestion:null,confidence:0,original};
 const pool=[...new Set([...names,...PLACE_NAMES].filter(v=>typeof v==='string'&&v.trim().length>2))];
 const alias=COMMON_SOUNDS.get(cleanup(phrase));
 if(alias && pool.includes(alias)){
   return {text:original.slice(0,original.length-phrase.length)+alias,correction:alias,suggestion:null,confidence:1,original};
 }
 const ranked=pool.map(name=>({name,score:likeness(phrase,name)})).sort((a,b)=>b.score-a.score);
 const top=ranked[0],runner=ranked[1];
 if(!top)return {text:original,correction:null,suggestion:null,confidence:0,original};
 const gap=top.score-(runner?.score||0);
 // Exact names and strong distinctive matches are safe to normalize only in a place context.
 if(top.score>=0.88 && gap>=0.09){
   return {text:original.slice(0,original.length-phrase.length)+top.name,correction:top.name,suggestion:null,confidence:top.score,original};
 }
 // Moderate matches ask instead of silently searching the wrong business.
 if(top.score>=0.67 && gap>=0.07){
   return {text:original,correction:null,suggestion:top.name,confidence:top.score,original};
 }
 return {text:original,correction:null,suggestion:null,confidence:top.score,original};
}
export function spokenMatchCandidates(raw,names=[]){
 return [...names].filter(x=>typeof x==='string').map(name=>({name,score:likeness(raw,name)}))
  .filter(x=>x.score>=0.5).sort((a,b)=>b.score-a.score).slice(0,3);
}
