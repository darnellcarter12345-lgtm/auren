// AUREN v3.34 — universal spoken place routing (Mac + iPhone).
// No finite restaurant-name whitelist. Location only used when user enabled AUREN GPS.
export function createUniversalPlacesBrain({addMessage, getLocation, appendLink}) {
  let recent = null;
  const TTL = 25 * 60 * 1000;
  const clean = s => String(s || '').normalize('NFKC').replace(/[’]/g,"'").replace(/\s+/g,' ').trim();
  const normalize = s => clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const forbidden = /^(?:my schedule|my calendar|my memories|my settings|the app|my projects|your day|my home screen|sleep|there|it|that|the first one|the second one)$/i;
  function distance(a,b) { // Bounded Levenshtein comparison; no automatic correction for unrelated names.
    a=normalize(a); b=normalize(b);
    if (!a || !b || a.length>90 || b.length>90) return 999;
    let prev=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      const row=[i];
      for(let j=1;j<=b.length;j++) row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      prev=row;
    }
    return prev[b.length];
  }
  function parse(raw) {
    let q=clean(raw).replace(/^(?:(?:hey|hi|okay|ok)\s+)?(?:auren|aaron|oren)[,:! ]+/i,'')
      .replace(/^(?:(?:please|can|could|would|will)\s+(?:you\s+)?)?/i,'')
      .replace(/^(?:and|then|also|okay|ok)[, ]+/i,'').replace(/[!? .]+$/,'').trim();
    if (/^(?:send (?:me )?(?:those |the |its |that )?directions again|repeat (?:the |those )?directions|take me there again|open (?:the )?route again|send me there again|directions again|go there|take me there|navigate there|send directions there)$/i.test(q))
      return {reference:true};
    const patterns=[
      /^(?:send|take|bring|drive|guide|lead)\s+me\s+(?:over\s+)?to\s+(.+)$/i,
      /^(?:get|give|send|show)\s+(?:me\s+)?(?:directions|a route|the route|the directions)\s+(?:to|for)\s+(.+)$/i,
      /^(?:navigate|route|go|drive|head)\s+(?:me\s+)?to\s+(.+)$/i,
      /^(?:open|pull up)\s+(?:google\s+)?maps\s+(?:to|for)\s+(.+)$/i,
      /^(?:how (?:do|can) i (?:get|drive|go) to)\s+(.+)$/i,
      /^directions\s+(?:to|for)\s+(.+)$/i,
      /^(?:find|locate|show me)\s+(?:the\s+)?(?:closest|nearest)\s+(.+)$/i
    ];
    let match=null;
    for(const pattern of patterns){match=q.match(pattern);if(match)break;}
    if(!match)return null;
    let term=clean(match[1]).replace(/^(?:a|an|the)\s+/i,'').replace(/\s+(?:near me|around me|nearby|please|for me)$/i,'').trim();
    if(!term||term.length<2||term.length>100||forbidden.test(term)||/^(?:a place|somewhere|anything|the restaurant|a restaurant|food|nothing)$/i.test(term))return null;
    return {term,closest:/\b(?:closest|nearest)\b/i.test(q)};
  }
  const mapURL=(destination)=>'https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',destination,travelmode:'driving',dir_action:'navigate'});
  function noteDestination(name,destination){recent={name,destination,at:Date.now()};}
  async function sendLink(name,destination){
    noteDestination(name,destination);
    await addMessage('auren',`Directions to ${name} are ready. Open the route below.`);
    appendLink(mapURL(destination),`Open directions to ${name}`);
  }
  async function lookup(name, position) {
    if(!position || !Number.isFinite(position.latitude)||!Number.isFinite(position.longitude))return null;
    const lat=position.latitude,lon=position.longitude;
    // Search nearby OSM businesses by words in the user-supplied name, not a brand allowlist.
    const tokens=clean(name).split(/\s+/).map(w=>w.replace(/[^a-z0-9]/gi,'')).filter(w=>w.length>=3);
    if(!tokens.length)return null;
    const word=tokens.sort((a,b)=>b.length-a.length)[0].replace(/[^a-z0-9]/gi,'').slice(0,32);
    if(!word)return null;
    const query=`[out:json][timeout:12];(nwr(around:8000,${lat},${lon})[name~"${word}",i];);out center 80;`;
    const endpoints=['https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];
    for(const endpoint of endpoints){
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),6500);
      try {
        const response=await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:controller.signal});
        if(!response.ok)continue;
        const payload=await response.json();
        const candidates=(payload.elements||[]).map(x=>({name:x.tags?.name||'',lat:x.lat??x.center?.lat,lon:x.lon??x.center?.lon})).filter(x=>x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon));
        const scored=candidates.map(x=>({...x,score:distance(name,x.name),length:normalize(name).length})).sort((a,b)=>a.score-b.score||((a.lat-lat)**2+(a.lon-lon)**2)-((b.lat-lat)**2+(b.lon-lon)**2));
        const best=scored[0];
        if(best && best.score<=Math.max(1,Math.floor(best.length*.22)) && (!scored[1] || scored[1].score>best.score || normalize(scored[1].name)===normalize(best.name)))return best;
      }catch(e){console.info('AUREN place matching fallback',e?.message||e);}finally{clearTimeout(timeout);}
    }
    return null;
  }
  async function handle(raw) {
    const intent=parse(raw); if(!intent)return false;
    if(intent.reference){
      if(!recent||Date.now()-recent.at>TTL)return false;
      await addMessage('user',raw);await sendLink(recent.name,recent.destination);return true;
    }
    await addMessage('user',raw);
    let name=intent.term;
    // Verified place search is optional: the actual navigation link is always available.
    const gps=typeof getLocation==='function'?getLocation():null;
    // Leave generic names uncorrected; use the map's place resolution if no verified match.
    const matched=await lookup(name,gps);
    if(matched){await sendLink(matched.name,`${matched.lat},${matched.lon}`);return true;}
    await sendLink(name,name);
    return true;
  }
  return {handle,parse,lookup};
}
