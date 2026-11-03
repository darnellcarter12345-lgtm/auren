// AUREN v3.28 — Adaptive Daily Brain (read-only)
// Uses the existing AUREN planner data. No external AI, syncing, or calendar writes.
let recentCheck = 0;
const clean = value => String(value ?? '').trim();
const plural = (count, singular) => count + ' ' + singular + (count === 1 ? '' : 's');
const timeLabel = (ms) => new Date(ms).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});

export function adaptiveDayBrain(question, source = {}) {
  const q = clean(question).toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:(?:hey|hi)\s+)?auren[,! ]*/, '').trim();
  // Never interpret instructions to create, edit, or mark records as read-only queries.
  if (/^(?:add|save|set|create|schedule|book|cancel|delete|remove|mark|finish|complete|move|change|reschedule|remind|edit)\b/.test(q)) return null;
  if (/\b(?:tomorrow|next week|this week|yesterday)\b/.test(q)) return null;
  const explicit = /^(?:(?:is there|are there)\s+)?(?:anything|something)\s+(?:else\s+)?(?:i\s+)?(?:need|have|should)\s+to\s+(?:do|finish|take care of)(?:\s+(?:for\s+)?today)?$/.test(q)
    || /^(?:do i have anything else(?:\s+(?:to do|today))?|what(?: else)? (?:do i|should i|have i got to) (?:do|finish)(?: today)?|what(?:'s| is) left (?:for me )?to do(?: today)?|what's still (?:left|coming up) today|what is still (?:left|coming up) today|anything else (?:i should know|on my schedule)(?: today)?|(?:give me|what's|what is) (?:my )?(?:remaining|rest of the day) (?:plans?|schedule|overview)|have my meetings (?:already )?passed|did my meetings (?:already )?end|what(?:'s| is) (?:next|remaining) today)$/.test(q);
  const followup = /^(?:anything else|what else|and after that|and then|what's next|what is next|what about my tasks|what about my meetings|any meetings left|what about reminders|any reminders left)$/.test(q) && Date.now()-recentCheck < 5*60*1000;
  if (!explicit && !followup) return null;
  const date = typeof source.localDate === 'function' ? source.localDate() : [new Date().getFullYear(),String(new Date().getMonth()+1).padStart(2,'0'),String(new Date().getDate()).padStart(2,'0')].join('-');
  const now = Date.now();
  const appointments = (Array.isArray(source.plans) ? source.plans : []).filter(x => x && x.date === date && clean(x.title));
  const eventStart = (x) => typeof source.eventTimestamp === 'function' ? source.eventTimestamp(x) : new Date(`${x.date}T${x.time}:00`).getTime();
  const events = appointments.map(x => ({title: clean(x.title), start: eventStart(x), end: eventStart(x) + Math.max(1,Number(x.duration)||60)*60000}))
    .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end)).sort((a,b)=>a.start-b.start);
  const passed = events.filter(x => x.end <= now);
  const live = events.filter(x => x.start <= now && x.end > now);
  const future = events.filter(x => x.start > now);
  const reminders = (Array.isArray(source.reminders) ? source.reminders : [])
    .filter(x => x && !x.fired && clean(x.text) && Number.isFinite(Date.parse(x.at)))
    .map(x => ({title:clean(x.text),start:Date.parse(x.at)}))
    .filter(x => x.start > now && [new Date(x.start).getFullYear(),String(new Date(x.start).getMonth()+1).padStart(2,'0'),String(new Date(x.start).getDate()).padStart(2,'0')].join('-') === date)
    .sort((a,b)=>a.start-b.start);
  const openTasks = typeof source.tasksOnDate === 'function'
    ? source.tasksOnDate(date).filter(t=>!source.isTaskComplete?.(t,date))
    : (Array.isArray(source.tasks) ? source.tasks : []).filter(t => t && t.due === date && !t.done);
  const overdueTasks = (Array.isArray(source.tasks) ? source.tasks : []).filter(t => t && t.repeat === 'once' && t.due < date && !t.done).sort((a,b)=>a.due.localeCompare(b.due));
  const lines = [];
  if (passed.length) lines.push(`${plural(passed.length,'appointment')} already ${passed.length===1?'has':'have'} a scheduled end time in the past${passed.length <= 2 ? ': '+passed.map(x=>x.title).join(' and ') : ''}. That doesn't confirm attendance.`);
  if (live.length) lines.push(`Currently scheduled: ${live.slice(0,2).map(x=>x.title+ ' (until '+timeLabel(x.end)+')').join('; ')}.`);
  if (future.length) lines.push(`Still ahead: ${future.slice(0,3).map(x=>x.title+' at '+timeLabel(x.start)).join('; ')}${future.length>3?'; plus '+(future.length-3)+' more':''}.`);
  if (reminders.length) lines.push(`Upcoming saved ${plural(reminders.length,'reminder')}: ${reminders.slice(0,2).map(x=>x.title+' at '+timeLabel(x.start)).join('; ')}${reminders.length>2?'; and more':''}.`);
  if (openTasks.length) lines.push(`Unfinished ${plural(openTasks.length,'task')} today: ${openTasks.slice(0,3).map(x=>x.title).join('; ')}${openTasks.length>3?'; and more':''}.`);
  if (overdueTasks.length) lines.push(`Also, ${plural(overdueTasks.length,'older task')} still ${overdueTasks.length===1?'appears':'appear'} unfinished${overdueTasks.length===1?': '+overdueTasks[0].title:''}.`);
  if (!lines.length) lines.push('I can’t find any remaining appointments, upcoming reminders, or unfinished tasks for today in AUREN. That only reflects what is saved on this device.');
  recentCheck = now;
  return `Here’s what I can confirm for the rest of today. ${lines.join(' ')}${future.length && future[0].start-now <= 45*60000 ? ' Your next appointment starts within 45 minutes, so keep preparation time in mind.' : ''}`;
}
