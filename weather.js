/* AUREN v2.6 — Free weather intelligence using Open-Meteo.
 * No paid search, no new AI calls, no device GPS access.
 * Preserves getWeatherBriefing(city, scope, question) API.
 */
const cache = new Map();
const conditions = {0:'clear skies',1:'mostly clear skies',2:'partly cloudy skies',3:'cloudy skies',45:'fog',48:'fog',51:'light drizzle',53:'drizzle',55:'heavy drizzle',56:'freezing drizzle',57:'freezing drizzle',61:'light rain',63:'rain',65:'heavy rain',66:'freezing rain',67:'freezing rain',71:'light snow',73:'snow',75:'heavy snow',77:'snow grains',80:'scattered showers',81:'showers',82:'heavy showers',85:'snow showers',86:'heavy snow showers',95:'thunderstorms',96:'thunderstorms',99:'thunderstorms'};
const n = value => value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value));
const clock = h => `${h % 12 || 12}${h < 12 ? ' AM' : ' PM'}`;
const dayOfWeek = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday:'long',timeZone:'UTC'});
const sentence = value => String(value).trim().replace(/\s+/g,' ');
async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetch(url, {signal:controller.signal});
    if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
    return await response.json();
  } finally {clearTimeout(timer);}
}
async function loadForecast(city) {
  const key = city.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit;
  const geo = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geo.searchParams.set('name',city);
  geo.searchParams.set('count','1');
  geo.searchParams.set('language','en');
  geo.searchParams.set('format','json');
  const place = (await getJSON(geo)).results?.[0];
  if (!place) throw new Error('City not found');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude',String(place.latitude));
  url.searchParams.set('longitude',String(place.longitude));
  url.searchParams.set('timezone','auto');
  url.searchParams.set('temperature_unit','fahrenheit');
  url.searchParams.set('wind_speed_unit','mph');
  url.searchParams.set('forecast_days','7');
  url.searchParams.set('daily','weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max');
  url.searchParams.set('hourly','temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,relative_humidity_2m,weather_code');
  const forecast = await getJSON(url);
  if (!forecast.daily?.time?.length) throw new Error('Forecast unavailable');
  const data = {at:Date.now(),place,forecast};
  cache.set(key,data);
  return data;
}
function requestedHour(question) {
  // Explicitly stated time. Never interpret an unqualified 'at 4' as AM or PM.
  const explicit = question.match(/\b(?:at|around|by|for|about)\s+(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (explicit) {
    const h = Number(explicit[1]);
    if (h < 1 || h > 12) return null;
    const pm = explicit[2].toLowerCase().startsWith('p');
    return h % 12 + (pm ? 12 : 0);
  }
  if (/\b(noon|midday)\b/i.test(question)) return 12;
  if (/\b(midnight)\b/i.test(question)) return 0;
  if (/\b(morning)\b/i.test(question)) return 9;
  if (/\b(afternoon)\b/i.test(question)) return 15;
  if (/\b(evening|tonight)\b/i.test(question)) return 19;
  const ambiguous = question.match(/\b(?:at|around|by)\s+(\d{1,2})(?::\d{2})?\b/i);
  return ambiguous ? 'ambiguous' : null;
}
function hourlyFor(forecast,date) {
  const h = forecast.hourly || {};
  return (h.time || []).flatMap((time,i) => time.startsWith(date) ? [{
    hour:Number(time.slice(11,13)),
    temp:n(h.temperature_2m?.[i]), feels:n(h.apparent_temperature?.[i]),
    rain:n(h.precipitation_probability?.[i]), wind:n(h.wind_speed_10m?.[i]),
    humidity:n(h.relative_humidity_2m?.[i]),
    condition:conditions[h.weather_code?.[i]] || 'mixed conditions'
  }] : []);
}
function detailAt(place,dateLabel,point) {
  let s = `In ${place} ${dateLabel} at ${clock(point.hour)}, expect ${point.condition}`;
  if (point.temp !== null) s += `, around ${point.temp} degrees`;
  if (point.feels !== null && Math.abs(point.feels - point.temp) >= 3) s += `, feeling closer to ${point.feels}`;
  s += '.';
  if (point.rain !== null) s += ` The precipitation chance is ${point.rain} percent.`;
  if (point.wind !== null) s += ` Wind is around ${point.wind} miles per hour.`;
  return s;
}
export async function getWeatherBriefing(city='Dallas', scope='day', question='') {
  city = String(city || 'Dallas').trim().slice(0,80) || 'Dallas';
  scope = ['day','tomorrow','week'].includes(scope) ? scope : 'day';
  const q = sentence(question).toLowerCase();
  try {
    const {place,forecast} = await loadForecast(city);
    const daily = forecast.daily;
    const date = daily.time[scope === 'tomorrow' ? 1 : 0];
    if (!date) throw new Error('Forecast for that day is unavailable');
    const label = scope === 'tomorrow' ? 'tomorrow' : 'today';
    const rows = hourlyFor(forecast,date);
    const high = n(daily.temperature_2m_max?.[scope === 'tomorrow' ? 1 : 0]);
    const low = n(daily.temperature_2m_min?.[scope === 'tomorrow' ? 1 : 0]);
    const rain = n(daily.precipitation_probability_max?.[scope === 'tomorrow' ? 1 : 0]);
    const uv = n(daily.uv_index_max?.[scope === 'tomorrow' ? 1 : 0]);
    const condition = conditions[daily.weather_code?.[scope === 'tomorrow' ? 1 : 0]] || 'mixed conditions';
    const summary = `In ${place.name} ${label}, expect ${condition}${high !== null && low !== null ? `, with a high of ${high} degrees and a low of ${low}` : ''}.${rain !== null ? ` The highest daily precipitation chance is ${rain} percent.` : ''}`;
    const result = spoken => ({success:true,spoken,display:`${place.name} · ${condition} · ${high ?? '—'}°F`,date,rainChance:rain,city:place.name});

    if (scope === 'week' && !/\b(at|around)\s+\d{1,2}/.test(q)) {
      const week = daily.time.map((d,i) => ({day:dayOfWeek(d),high:n(daily.temperature_2m_max?.[i]),rain:n(daily.precipitation_probability_max?.[i])}));
      if (/\b(rain|wet|storm|precipitation)\b/.test(q)) {
        const wet = week.filter(w => w.rain !== null && w.rain >= 40);
        return result(wet.length ? `This week in ${place.name}, higher rain chances are forecast on ${wet.map(w => `${w.day}, up to ${w.rain} percent`).join('; ')}.` : `The seven-day forecast for ${place.name} shows no day with a precipitation chance of 40 percent or more.`);
      }
      return result(`For the next seven days in ${place.name}: ${week.map(w => `${w.day}, high ${w.high ?? 'unknown'} degrees${w.rain !== null ? `, rain chance up to ${w.rain} percent` : ''}`).join('; ')}.`);
    }

    const requested = requestedHour(q);
    if (requested === 'ambiguous') return result('Was that AM or PM?');
    const point = typeof requested === 'number' ? rows.find(r => r.hour === requested) : null;
    if (point && /\b(outside|outdoors|walk|run|picnic|good time|okay to|safe to)\b/.test(q)) {
      const concerns=[];
      if (point.rain !== null && point.rain >= 50) concerns.push(`${point.rain} percent precipitation chance`);
      if (point.wind !== null && point.wind >= 25) concerns.push(`winds around ${point.wind} miles per hour`);
      if (point.temp !== null && (point.temp >= 95 || point.temp <= 32)) concerns.push(`temperature around ${point.temp} degrees`);
      return result(`${detailAt(place.name,label,point)} ${concerns.length ? `Conditions may be less comfortable outdoors because of ${concerns.join(' and ')}.` : 'Based on the available weather forecast, there are no obvious weather concerns at that hour.'} This is only a forecast, so conditions can change.`);
    }
    if (point) return result(detailAt(place.name,label,point));
    if (/\b(wind|windy|breeze|gust)\b/.test(q)) {
      const peak = rows.filter(r => r.wind !== null).sort((a,b) => b.wind - a.wind)[0];
      return result(peak ? `In ${place.name} ${label}, wind is forecast to reach around ${peak.wind} miles per hour near ${clock(peak.hour)}.` : 'Wind information is not available for that day.');
    }
    if (/\b(humid|humidity|muggy)\b/.test(q)) {
      const valid=rows.filter(r => r.humidity !== null);
      const average=valid.length ? Math.round(valid.reduce((sum,r)=>sum+r.humidity,0)/valid.length) : null;
      return result(average === null ? 'Humidity information is unavailable.' : `In ${place.name} ${label}, the average forecast relative humidity is around ${average} percent.`);
    }
    if (/\b(uv|sunburn|sun exposure)\b/.test(q)) return result(uv === null ? 'UV forecast information is unavailable.' : `The forecast peak UV index in ${place.name} ${label} is ${uv}.`);
    if (/\b(rain|raining|precipitation|showers|storm|snow|wet)\b/.test(q)) {
      const future=scope === 'day' ? rows.filter(r => r.hour >= Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hour12:false,timeZone:forecast.timezone || 'UTC'}).format(new Date()))) : rows;
      const available = future.filter(r => r.rain !== null);
      const peak=available.sort((a,b)=>b.rain-a.rain)[0];
      return result(peak ? `In ${place.name} ${label}, the highest remaining hourly precipitation chance is ${peak.rain} percent around ${clock(peak.hour)}. This is a probability, not a guarantee that rain will occur.` : `I don't have an hourly precipitation forecast for ${label}.`);
    }
    if (/\b(feel|feels like|heat index|temperature|hot|cold|warm)\b/.test(q)) {
      return result(`${place.name} ${label} has a forecast high of ${high ?? 'unknown'} degrees and low of ${low ?? 'unknown'} degrees.${rows.some(r=>r.feels !== null) ? ' The feels-like temperature varies during the day; ask me about a particular hour for a more precise answer.' : ''}`);
    }
    if (/\b(more|details|in depth|elaborate|breakdown|hourly)\b/.test(q)) {
      const sample=rows.filter(r=>[9,12,15,18,21].includes(r.hour));
      return result(`${summary} ${sample.map(r=>`${clock(r.hour)}: ${r.temp ?? 'unknown'} degrees${r.rain !== null ? `, ${r.rain} percent precipitation chance` : ''}`).join('; ')}.`);
    }
    return result(summary);
  } catch(error) {
    console.warn('AUREN weather request failed',error);
    return {success:false,spoken:'',display:'Weather unavailable',error:String(error?.message || error)};
  }
}
