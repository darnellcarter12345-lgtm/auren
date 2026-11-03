// AUREN v3.31 — grounded schedule follow-ups.
// Reads the existing local planner; no network or changes without explicit confirmation.
export function createScheduleFollowupBrain({ storage = globalThis.localStorage, clock = () => Date.now() } = {}) {
  const KEY = 'auren_schedule_attendance_v331';
  let focused = null; // {id, mode:'attendance'|'remove', time}
  const clean = v => String(v ?? '').trim();
  const normalize = s => clean(s).toLowerCase().replace(/[’]/g,"'").replace(/[?.!]+$/,'').replace(/^(?:hey\s+)?auren[, ]*/,'').trim();
  const yes = /^(?:yes|yeah|yep|i did|i went|i attended|i was there|that's right|correct|yes please|please do|go ahead|do it|remove it|delete it|sure)$/i;
  const no = /^(?:no|nope|i didn't|i did not|i missed it|not yet|don't|do not|leave it|keep it|no thanks|cancel|never mind)$/i;
  const dayQuery = /^(?:is there anything(?: else)? (?:i need(?: to)?|i have to|to) (?:do|finish)(?: today)?|anything else(?: i need to do)?(?: today)?|what(?:'s| is) (?:left|still left|next|coming up) (?:for me )?(?:today|on my schedule)|what (?:else )?(?:do i need to do|have i got today)|how(?:'s| is) my day looking|what(?:'s| is) (?:on|left on) my (?:calendar|schedule)(?: today)?|have my meetings (?:already )?(?:passed|ended)|did my meetings (?:already )?end|are my meetings over|which meetings (?:already )?(?:passed|ended)|what meetings did i have today)$/i;
  const read = () => { try {const v=JSON.parse(storage?.getItem(KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};} catch {return {};} };
  const write = obj => {try {storage?.setItem(KEY,JSON.stringify(obj));return true;}catch{return false;}};
  const statusFor = id => read()[id]?.status || null;
  const eventTime = p => {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(clean(p?.date)) || !/^\d{1,2}:\d{2}$/.test(clean(p?.time))) return NaN;
    const [y,m,d]=p.date.split('-').map(Number),[h,min]=p.time.split(':').map(Number);
    const dt=new Date(y,m-1,d,h,min);
    return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d&&dt.getHours()===h&&dt.getMinutes()===min?dt.getTime():NaN;
  };
  function note(p, status) {
    const data=read(); data[p.id]={title:clean(p.title),date:p.date,time:p.time,status,at:new Date(clock()).toISOString()};
    return write(data);
  }
  const timeText = ms => new Date(ms).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  function current(items, id) {return (Array.isArray(items)?items:[]).find(p=>p?.id===id);}
  function isFresh(){return focused && clock()-focused.time < 5*60000;}
  function nextPast(items, now) {
    return items.filter(e=>e.end<=now&&!statusFor(e.p.id)).sort((a,b)=>b.end-a.end)[0];
  }
  async function handle(raw, {plans=[], localDate, removePlan}={}) {
    const q=normalize(raw); if(!q) return null;
    const now=clock(), date=typeof localDate==='function'?localDate(new Date(now)):new Date(now).toLocaleDateString('en-CA');
    const all=(Array.isArray(plans)?plans:[]).filter(p=>p&&clean(p.id)&&clean(p.title));
    const today=all.filter(p=>p.date===date).map(p=>{
      const start=eventTime(p),duration=Math.max(1,Math.min(24*60,Number(p.duration)||60));
      return {p,start,end:start+duration*60000};
    }).filter(e=>Number.isFinite(e.start)).sort((a,b)=>a.start-b.start);
    const past=today.filter(e=>e.end<=now), live=today.filter(e=>e.start<=now&&e.end>now), future=today.filter(e=>e.start>now);
    if(isFresh() && (yes.test(q)||no.test(q))) {
      const f=focused, p=current(all,f.id);
      focused=null;
      if(!p) return 'That appointment is no longer on your schedule. I have not changed anything.';
      if(f.mode==='attendance') {
        const attended=yes.test(q);if(!note(p,attended?'attended':'missed'))return 'I could not save your attendance answer on this device. I have not changed your calendar.';
        if(!attended)return `Understood. I've recorded that you missed ${p.title}. It remains on your schedule. You can ask me to reschedule or remove it.`;
        focused={id:p.id,mode:'remove',time:now};
        return `I've recorded that you attended ${p.title}. Its scheduled time has passed. Would you like me to remove it from Your Day? Linked reminders will stay unless you remove them separately. Say yes to remove the appointment, or no to keep it.`;
      }
      if(no.test(q)) return `Certainly. I've kept ${p.title} on your schedule.`;
      const oldEnd=eventTime(p)+Math.max(1,Number(p.duration)||60)*60000;
      if(!(oldEnd<=now)) return 'That appointment is no longer in the past. Nothing has been removed.';
      if(typeof removePlan!=='function') return 'Removal is not connected. Your appointment remains on Your Day.';
      const ok=await removePlan(p.id);
      if(!ok) return `I couldn't verify the removal of ${p.title}. Please check Your Day; I have not claimed it was removed.`;
      note(p,'attended-and-removed');
      return `Removed ${p.title} from Your Day. Any separate reminders remain unchanged. I've kept your attendance note on this device.`;
    }
    // Never hijack other requests while a yes/no question is pending.
    if(!dayQuery.test(q)) {focused=null;return null;}
    focused=null;
    const lines=[];
    if(past.length) lines.push(`${past.length} ${past.length===1?'appointment has':'appointments have'} a scheduled end time in the past: ${past.slice(0,3).map(e=>e.p.title).join(', ')}${past.length>3?' and more':''}.`);
    if(live.length) lines.push(`Scheduled now: ${live.map(e=>e.p.title+' until '+timeText(e.end)).join('; ')}.`);
    if(future.length) lines.push(`Still upcoming: ${future.slice(0,3).map(e=>e.p.title+' at '+timeText(e.start)).join('; ')}.`);
    if(!today.length) lines.push('I see no appointments saved for today on this device.');
    const unconfirmed=nextPast(past,now);
    if(unconfirmed) {focused={id:unconfirmed.p.id,mode:'attendance',time:now};lines.push(`Did you attend ${unconfirmed.p.title}?`);}
    else if(past.length)lines.push('I have recorded the attendance answers you already gave for these appointments.');
    return lines.join(' ') || 'I could not find appointments in your saved schedule.';
  }
  return {handle, statusFor};
}
