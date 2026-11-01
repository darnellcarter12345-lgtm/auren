// City-level weather only: no GPS access and no exact user location.
// Data: Open-Meteo public geocoding + forecast APIs.
const weatherCache=new Map();
const CONDITION={0:'clear skies',1:'mostly clear skies',2:'partly cloudy skies',3:'cloudy skies',45:'fog',48:'fog',51:'light drizzle',53:'drizzle',55:'drizzle',61:'light rain',63:'rain',65:'heavy rain',71:'light snow',73:'snow',75:'heavy snow',80:'scattered showers',81:'showers',82:'heavy showers',95:'thunderstorms',96:'thunderstorms',99:'thunderstorms'};
async function json(url){const c=new AbortController();const timeout=setTimeout(()=>c.abort(),6500);try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw Error('Weather service unavailable');return await r.json();}finally{clearTimeout(timeout);}}
export async function getWeatherBriefing(city='Dallas',scope='day'){
  city=String(city||'Dallas').trim().slice(0,80);
  const key=city.toLowerCase()+':'+scope;
  const hit=weatherCache.get(key);if(hit && Date.now()-hit.at<10*60*1000)return hit.result;
  try{
    const geo=await json('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(city)+'&count=1&language=en&format=json');
    const place=geo.results?.[0];if(!place)throw Error('City not found');
    const u=new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude',place.latitude);u.searchParams.set('longitude',place.longitude);
    u.searchParams.set('timezone','auto');u.searchParams.set('temperature_unit','fahrenheit');
    u.searchParams.set('daily','weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
    u.searchParams.set('forecast_days',scope==='week'?'7':'2');
    const forecast=await json(u.toString());const d=forecast.daily;
    if(!d?.time?.length)throw Error('No forecast');
    const cityName=place.name;
    const condition=CONDITION[d.weather_code[0]]||'mixed conditions';
    const hi=Math.round(d.temperature_2m_max[0]);const lo=Math.round(d.temperature_2m_min[0]);
    const chance=Math.round(d.precipitation_probability_max?.[0]||0);
    let spoken=`In ${cityName}, expect ${condition}, with a high of ${hi} degrees and a low of ${lo}.`;
    if(chance>=40)spoken+=` The chance of precipitation is around ${chance} percent.`;
    if(scope==='week'){
      const rainy=d.time.reduce((n,_,i)=>n+((d.precipitation_probability_max?.[i]||0)>=60?1:0),0);
      if(rainy)spoken+=` Rain is more likely on ${rainy} day${rainy===1?'':'s'} this week.`;
    }
    const result={success:true,spoken,display:`${cityName} · ${condition} · ${hi}°F`};
    weatherCache.set(key,{result,at:Date.now()});return result;
  }catch(err){return {success:false,spoken:'',display:'Weather unavailable'};}
}
