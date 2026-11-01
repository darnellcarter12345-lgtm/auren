// AUREN live weather: city-level only. Never requests device location.
const cache = new Map();
const descriptions = {0:'clear skies',1:'mostly clear skies',2:'partly cloudy skies',3:'cloudy skies',45:'fog',48:'fog',51:'light drizzle',53:'drizzle',55:'heavy drizzle',56:'freezing drizzle',57:'freezing drizzle',61:'light rain',63:'rain',65:'heavy rain',66:'freezing rain',67:'freezing rain',71:'light snow',73:'snow',75:'heavy snow',77:'snow grains',80:'scattered showers',81:'showers',82:'heavy showers',85:'snow showers',86:'heavy snow showers',95:'thunderstorms',96:'thunderstorms',99:'thunderstorms'};
async function readJSON(url) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 8500);
  try {
    const response = await fetch(url, {signal:c.signal});
    if (!response.ok) throw new Error('Weather service returned '+response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}
const number = value => value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value));
const dayName = iso => new Date(iso+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'});
const displayHour = iso => {
  if (!iso) return '';
  const hour = Number(String(iso).slice(11,13));
  if (!Number.isFinite(hour)) return '';
  return (hour%12 || 12) + (hour<12?' AM':' PM');
};

// Third argument is optional. Existing briefing calls still work unchanged.
export async function getWeatherBriefing(city='Dallas', scope='day', question='') {
  city = String(city||'Dallas').trim().slice(0,80)||'Dallas';
  scope = ['day','tomorrow','week'].includes(scope) ? scope : 'day';
  const questionText = String(question||'').toLowerCase();
  const key = city.toLowerCase()+':'+scope;
  try {
    let data = cache.get(key);
    if (!data || Date.now()-data.at>10*60*1000) {
      const geocode = new URL('https://geocoding-api.open-meteo.com/v1/search');
      geocode.searchParams.set('name',city);
      geocode.searchParams.set('count','1');
      geocode.searchParams.set('language','en');
      geocode.searchParams.set('format','json');
      const geo = await readJSON(geocode);
      const place=geo.results?.[0];
      if (!place) throw Error('City not found');
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude',String(place.latitude));
      url.searchParams.set('longitude',String(place.longitude));
      url.searchParams.set('timezone','auto');
      url.searchParams.set('temperature_unit','fahrenheit');
      url.searchParams.set('wind_speed_unit','mph');
      url.searchParams.set('forecast_days',scope==='week'?'7':'2');
      url.searchParams.set('daily','weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
      url.searchParams.set('hourly','temperature_2m,precipitation_probability,wind_speed_10m,relative_humidity_2m');
      const forecast=await readJSON(url);
      if (!forecast.daily?.time?.length) throw Error('Forecast unavailable');
      data={at:Date.now(),place,forecast};cache.set(key,data);
    }
    const {place,forecast}=data, daily=forecast.daily, hourly=forecast.hourly||{};
    const index=scope==='tomorrow'?1:0;
    if (!daily.time[index]) throw Error('Requested date unavailable');
    const date=daily.time[index];
    const high=number(daily.temperature_2m_max?.[index]);
    const low=number(daily.temperature_2m_min?.[index]);
    const rain=number(daily.precipitation_probability_max?.[index]);
    const condition=descriptions[daily.weather_code?.[index]]||'mixed conditions';
    const label=scope==='tomorrow'?'tomorrow':scope==='week'?'today':'today';
    let spoken=`In ${place.name} ${label}, expect ${condition}`;
    if (high!==null && low!==null) spoken+=`, with a high of ${high} degrees and a low of ${low}`;
    spoken+='.';
    if (rain!==null) spoken+=` The highest forecast precipitation chance is ${rain} percent.`;
    if (scope==='week') {
      const rainy=daily.time.map((d,i)=>({d,chance:number(daily.precipitation_probability_max?.[i])})).filter(x=>x.chance!==null&&x.chance>=60);
      spoken+=rainy.length?` Higher rain chances are forecast on ${rainy.slice(0,4).map(x=>dayName(x.d)).join(', ')}.`:' No day in the seven-day forecast currently shows a precipitation chance of 60 percent or higher.';
    }
    const hours=(hourly.time||[]).map((time,i)=>({time,precip:number(hourly.precipitation_probability?.[i]),temp:number(hourly.temperature_2m?.[i]),wind:number(hourly.wind_speed_10m?.[i]),humidity:number(hourly.relative_humidity_2m?.[i])})).filter(x=>x.time.startsWith(date));
    const nowHour=new Date().toLocaleString('sv-SE',{timeZone:forecast.timezone||'UTC',hour:'2-digit',hour12:false});
    const futureHours=scope==='day'?hours.filter(x=>Number(x.time.slice(11,13))>=Number(nowHour)):hours;
    const relevant=futureHours.length?futureHours:hours;
    if (/\b(wind|windy|breez)/.test(questionText)) {
      const peak=relevant.reduce((a,b)=>b.wind!==null&&(!a||b.wind>a.wind)?b:a,null);
      spoken=peak?`In ${place.name}, winds could reach around ${peak.wind} miles per hour at ${displayHour(peak.time)} ${scope==='tomorrow'?'tomorrow':'today'}.`:'Wind information is unavailable for that period.';
    } else if (/\b(humid|humidity)/.test(questionText)) {
      const vals=relevant.filter(x=>x.humidity!==null);
      const avg=vals.length?Math.round(vals.reduce((s,x)=>s+x.humidity,0)/vals.length):null;
      spoken=avg===null?'Humidity information is unavailable.':`Average forecast relative humidity in ${place.name} is around ${avg} percent ${scope==='tomorrow'?'tomorrow':'today'}.`;
    } else if (/\b(rain|raining|precipitation|showers?|storm|snow)/.test(questionText)) {
      const likely=relevant.filter(x=>x.precip!==null&&x.precip>=40);
      if (likely.length) {
        const peak=likely.reduce((a,b)=>b.precip>a.precip?b:a);
        spoken=`In ${place.name} ${scope==='tomorrow'?'tomorrow':'today'}, the highest hourly precipitation chance is about ${peak.precip} percent around ${displayHour(peak.time)}.`;
      } else if (rain!==null) spoken=`In ${place.name} ${scope==='tomorrow'?'tomorrow':'today'}, the highest daily precipitation chance is ${rain} percent. No available hourly period shows a chance of 40 percent or higher.`;
    } else if (/\b(hour|afternoon|evening|morning|tonight|detail|more|in depth)/.test(questionText)) {
      const parts=relevant.filter(x=>x.temp!==null&&Number(x.time.slice(11,13))%3===0).slice(0,4);
      if (parts.length) spoken+=' '+parts.map(x=>`${displayHour(x.time)} around ${x.temp} degrees${x.precip!==null?', '+x.precip+' percent precipitation chance':''}`).join('; ')+'.';
    }
    return {success:true,spoken,display:`${place.name} · ${condition} · ${high??'—'}°F`,date,rainChance:rain,city:place.name};
  } catch(error) {
    console.warn('AUREN weather request failed',error);
    return {success:false,spoken:'',display:'Weather unavailable',error:String(error?.message||error)};
  }
}
