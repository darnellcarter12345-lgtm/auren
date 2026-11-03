// AUREN v3.30 — grounded, numbered nearby place references.
// Place listings come from existing AUREN Smart Places, not invented names.
export function createPlaceBrain() {
  let last = null;
  const TTL = 12 * 60 * 1000;
  const clean = s => String(s ?? '').normalize('NFKC').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  const valid = s => s.length >= 2 && s.length <= 130 && !/[<>\r\n]/.test(s) &&
    !/^(there|here|it|that|this|somewhere|anywhere|a place|the place|a restaurant|me|you|sleep|home|my calendar|my settings)$/i.test(s);
  const isCoords = r => r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)) &&
    Math.abs(Number(r.lat)) <= 90 && Math.abs(Number(r.lon)) <= 180;
  const recent = () => last && Date.now() - last.at < TTL ? last : null;
  function remember(target, label = target) {
    target = clean(target); label = clean(label);
    if (valid(target)) last = {target, label: label || target, at: Date.now()};
  }
  function resultTarget(r) {
    const name = clean(r?.name);
    if (!valid(name)) return null;
    // Coordinates identify a branch precisely. Names alone are often ambiguous.
    return {target: isCoords(r) ? `${Number(r.lat)},${Number(r.lon)}` : name, label: name, source: 'nearby'};
  }
  function selectedPlace(raw, results) {
    const text = clean(raw).toLowerCase();
    const ordinals = {first:0, '1st':0, second:1, '2nd':1, third:2, '3rd':2, fourth:3, '4th':3,
      fifth:4, '5th':4, sixth:5, '6th':5, seventh:6, '7th':6, eighth:7, '8th':7};
    const words = text.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th)\b/);
    const number = text.match(/\b(?:number|option|place|result)\s*([1-8])\b/);
    const closest = /\b(?:closest|nearest)\s+(?:one|option|place|result)\b/.test(text);
    if (!words && !number && !closest) return null;
    const list = Array.isArray(results) ? results : [];
    let index = words ? ordinals[words[1]] : number ? Number(number[1])-1 : -1;
    if (closest) {
      let best = Infinity; index = -1;
      list.forEach((r,i) => { const distance = Number(r?.km); if(Number.isFinite(distance) && distance >= 0 && distance < best){best=distance;index=i;} });
    }
    return {reference: true, result: resultTarget(list[index])};
  }
  function interpret(raw, context = {}) {
    let text = clean(raw).replace(/^(?:(?:hey|hi|okay|ok)\s+)?auren\s*[,!:.]?\s*/i, '');
    text = text.replace(/^(?:(?:please|can you|could you|would you|will you)\s+)+/i, '')
      .replace(/[.!?]+$/, '').trim();
    if (!text) return null;
    if (/^(?:remind|remember|forget|schedule|book|cancel|delete|set an? |what is|tell me about|why |how much|my appointments|my meetings|what's my)\b/i.test(text)) return null;
    const patterns = [
      /^(?:take|bring|drive|guide|lead)\s+me\s+(?:(?:to|towards|over to)\s+)?(.+)$/i,
      /^(?:i want|i need|i'd like)\s+(?:directions|a route|to go)\s+to\s+(.+)$/i,
      /^(?:navigate|route|head|go|drive)\s+(?:me\s+)?to\s+(.+)$/i,
      /^(?:show|send|give|get|find|pull up|open)\s+(?:me\s+)?(?:the\s+)?(?:driving\s+)?(?:directions|route|map|address|location)\s+(?:to|for|of)\s+(.+)$/i,
      /^(?:where is|how do i get to|how can i get to|how would i get to)\s+(.+)$/i,
      /^(?:directions|route|navigation)\s+(?:to|for)\s+(.+)$/i,
      /^(?:show|send|give|get|open)\s+(?:me\s+)?(?:the\s+)?(?:directions|route|map|location|address)(?:\s+(?:please|now))?$/i,
      /^(?:take me there|take me to it|go there|navigate there|get me there|bring me there|drive me there|how do i get there|send it|send me there|send me (?:the )?directions(?: there)?|send (?:me )?(?:the )?directions there|open maps)$/i
    ];
    let match;
    for (const pattern of patterns) { match = text.match(pattern); if (match) break; }
    if (!match) return null;
    const query = clean((match[1] || '').replace(/^(?:the|a|an)\s+(?=(?:first|second|third|closest|nearest|[1-8](?:st|nd|rd|th)?)\b)/i, ''))
      .replace(/\s+(?:please|for me|right now)$/i,'');
    const choice = selectedPlace(query || text, context.results);
    if (choice?.reference) {
      if (!choice.result) return {type:'clarify', reason:'no-numbered-result'};
      remember(choice.result.target, choice.result.label);
      return {type:'directions', ...choice.result};
    }
    const vague = /^(?:there|that place|that one|the place|it|their location|its location|them|the one)$/i.test(query || text);
    if (vague || !query) {
      const remembered = recent();
      const fallback = clean(context.navigationTarget || '');
      const result = remembered || (valid(fallback)?{target:fallback,label:fallback}:null);
      if (!result) return {type:'clarify', reason:'no-recent-place'};
      return {type:'directions', target:result.target, label:result.label, source:'recent'};
    }
    if (!valid(query) || /^(?:to|for|me|a|an|the|some|somewhere|anything|directions)$/i.test(query)) return {type:'clarify'};
    remember(query);
    return {type:'directions', target:query, label:query, source:'named'};
  }
  return {interpret,remember};
}
