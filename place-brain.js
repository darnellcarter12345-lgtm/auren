// AUREN v3.29 — contextual place and directions brain.
// Uses existing AUREN verified nearby results and Google Maps; no fake business database.
export function createPlaceBrain() {
  let last={name:'',at:0};
  const TTL=12*60*1000;
  const clean=s=>String(s||'').normalize('NFKC').replace(/[’]/g,"'").replace(/\s+/g,' ').trim();
  const valid=s=>s.length>=2&&s.length<=130&&!/^(?:there|here|it|that|this|somewhere|anywhere|a place|the place|a restaurant|me|you)$/i.test(s)
    && !/^(?:my\s+(?:calendar|memories|settings|schedule)|the (?:app|screen|page)|sleep|home|a conversation)$/i.test(s)
    && !/[<>\n\r]/.test(s);
  const recent=()=>last.name&&Date.now()-last.at<TTL?last.name:'';
  function remember(name){name=clean(name);if(valid(name))last={name,at:Date.now()};}
  function resolveReference(text,results=[],fallback=''){
    const t=clean(text).toLowerCase();
    const entries=Array.isArray(results)?results.filter(p=>p&&typeof p.name==='string'):[];
    if(/\b(?:first|1st|number one|option one)\b/.test(t))return entries[0]?.name||'';
    if(/\b(?:second|2nd|number two|option two)\b/.test(t))return entries[1]?.name||'';
    if(/\b(?:third|3rd|number three|option three)\b/.test(t))return entries[2]?.name||'';
    if(/\b(?:closest|nearest) (?:one|option|place)\b/.test(t)){
      const ranked=entries.filter(p=>Number.isFinite(p.km)).sort((a,b)=>a.km-b.km);
      return ranked[0]?.name||'';
    }
    if(/\b(?:there|that place|that one|the place|it|their location|its location)\b/.test(t))return clean(fallback)||recent()||entries[0]?.name||'';
    return '';
  }
  function interpret(raw, context={}){
    let t=clean(raw).replace(/^(?:(?:hey|hi|okay|ok)\s+)?auren\s*[,!:.]?\s*/i,'');
    t=t.replace(/^(?:(?:please|can you|could you|would you|will you)\s+)+/i,'').replace(/[.!?]+$/,'').trim();
    if(!t)return null;
    // Reject unrelated, explicit application and personal-data commands.
    if(/^(?:remind|remember|forget|schedule|book|cancel|delete|set an? |what is|tell me about|why |how much|my appointments|my meetings|what's my)/i.test(t))return null;
    const patterns=[
      /^(?:take|bring|drive|guide|lead)\s+me\s+(?:(?:to|towards|over to)\s+)?(.+)$/i,
      /^(?:i want|i need|i'd like)\s+(?:directions|a route|to go)\s+to\s+(.+)$/i,
      /^(?:navigate|route|head|go|drive)\s+(?:me\s+)?to\s+(.+)$/i,
      /^(?:show|send|give|get|find|pull up|open)\s+(?:me\s+)?(?:the\s+)?(?:driving\s+)?(?:directions|route|map|address|location)\s+(?:to|for|of)\s+(.+)$/i,
      /^(?:where is|how do i get to|how can i get to|how would i get to)\s+(.+)$/i,
      /^(?:directions|route|navigation)\s+(?:to|for)\s+(.+)$/i,
      /^(?:show|send|give|get|open)\s+(?:me\s+)?(?:the\s+)?(?:directions|route|map|location|address)(?:\s+(?:please|now))?$/i,
      /^(?:take me there|take me to it|go there|navigate there|get me there|bring me there|drive me there|how do i get there|send it|send me there|send me (?:the )?directions(?: there)?|open maps)$/i
    ];
    let m=null;for(const p of patterns){m=t.match(p);if(m)break;}
    if(!m)return null;
    const rawTarget=clean((m[1]||'').replace(/^(?:the|a|an)\s+(?=(?:first|second|third|closest|nearest)\b)/i,''));
    const refer=resolveReference(rawTarget||t,context.results,context.navigationTarget);
    let target=refer||rawTarget;
    target=target.replace(/\s+(?:please|for me|right now)$/i,'').replace(/^(?:the)\s+(?=[A-Z])/,'').trim();
    if(!target||!valid(target))return {type:'clarify'};
    // Protect against voice-transcription fragments and abstract queries.
    if(/^(?:to|for|me|a|an|the|some|somewhere|anything|directions)$/i.test(target))return {type:'clarify'};
    remember(target);
    return {type:'directions',target};
  }
  return {interpret,remember};
}
