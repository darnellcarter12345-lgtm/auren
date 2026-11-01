// AUREN v2.10.0 — date-specific Open-Meteo forecasts, no location permission.
const weatherCache = new Map();
const CONDITIONS = {0:'clear skies',1:'mostly clear skies',2:'partly cloudy skies',3:'cloudy skies',45:'fog',48:'fog',51:'light drizzle',53:'drizzle',55:'drizzle',56:'freezing drizzle',57:'freezing drizzle',61:'light rain',63:'rain',65:'heavy rain',66:'freezing rain',67:'freezing rain',71:'light snow',73:'snow',75:'heavy snow',77:'snow grains',80:'scattered showers',81:'showers',82:'heavy showers',85:'snow showers',86:'heavy snow showers',95:'thunderstorms',96:'thunderstorms',99:'thunderstorms'};
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const nice = v => v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));
async function readJSON(url) {
 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),9000);
 try {const r=await fetch(url,{signal:controller.signal}); if(!r.ok)throw Error('Weather service error '+r.status); return await r.json();}
 finally {clearTimeout(timer);}
}
function weekday(date) {return new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'});}
function selectIndex(scope, dates) {
 const mode=String(scope||'day').toLowerCase();
 if(mode==='tomorrow')return 1;
 if(mode==='day after tomorrow')return 2;
 const wanted=DAYS.indexOf(mode);
 if(wanted<0)return 0;
 // Named weekday means the next occurrence, including today if today matches.
 return dates.findIndex(d => new Date(d+'T12:00:00Z').getUTCDay()===wanted);
}
export async function getWeatherBriefing(city='Dallas',scope='day',question='') {
 const requested=String(city||'Dallas').trim().slice(0,80)||'Dallas';
 const key=requested.toLowerCase()+':'+String(scope).toLowerCase();
 const hit=weatherCache.get(key);
 if(hit&&Date.now()-hit.at<600000)return hit.result;
 try {
  const geo=new URL('https://geocoding-api.open-meteo.com/v1/search');
  geo.searchParams.set('name',requested);geo.searchParams.set('count','1');geo.searchParams.set('language','en');
  const places=await readJSON(geo);const place=places.results?.[0];if(!place)throw Error('City not found');
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude',String(place.latitude));url.searchParams.set('longitude',String(place.longitude));
  url.searchParams.set('timezone','auto');url.searchParams.set('temperature_unit','fahrenheit');
  url.searchParams.set('daily','weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('forecast_days','16');
  const forecast=await readJSON(url);const d=forecast.daily;
  if(!d?.time?.length)throw Error('Forecast unavailable');
  if(String(scope).toLowerCase()==='week') {
    const rainDays=d.time.slice(0,7).map((date,i)=>({date,chance:nice(d.precipitation_probability_max?.[i])})).filter(x=>x.chance!==null&&x.chance>=50);
    const spoken=rainDays.length ? `In ${place.name} over the coming week, rain is more likely on ${rainDays.slice(0,4).map(x=>weekday(x.date)).join(', ')}.` : `In ${place.name}, none of the next seven days currently shows a precipitation chance of 50 percent or higher.`;
    const result={success:true,spoken,display:spoken,city:place.name,label:'this week',date:d.time[0],high:null,low:null,rainChance:null};
    weatherCache.set(key,{at:Date.now(),result});return result;
  }
  const i=selectIndex(scope,d.time);
  if(i<0||!d.time[i])return {success:false,spoken:'That day is beyond the available forecast. Please ask again closer to the date.',display:'Date outside forecast'};
  const condition=CONDITIONS[d.weather_code?.[i]]||'mixed conditions';
  const high=nice(d.temperature_2m_max?.[i]),low=nice(d.temperature_2m_min?.[i]),rainChance=nice(d.precipitation_probability_max?.[i]);
  if(high===null||low===null)throw Error('Temperature missing');
  const label=scope==='day'?'today':scope==='tomorrow'?'tomorrow':scope==='day after tomorrow'?'the day after tomorrow':weekday(d.time[i]);
  const askRain=/\b(rain|raining|wet|showers|precipitation)\b/i.test(question);
  const rainText=rainChance===null?'Rain probability is unavailable.':`The chance of precipitation is ${rainChance} percent.`;
  const spoken=askRain?`For ${label} in ${place.name}, ${rainText} Expect ${condition}, with a high of ${high} degrees and a low of ${low}.`:`In ${place.name} ${label}, expect ${condition}, with a high of ${high} degrees and a low of ${low}. ${rainText}`;
  const result={success:true,spoken,display:`${place.name} · ${label} · ${condition} · ${high}°F`,date:d.time[i],label,high,low,rainChance,city:place.name};
  weatherCache.set(key,{at:Date.now(),result});return result;
 } catch(error) {console.warn('AUREN weather unavailable',error);return {success:false,spoken:'The live forecast is unavailable just now. Please try again shortly.',display:'Weather unavailable',error:error.message};}
}
