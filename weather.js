]
/*
 * AUREN Weather Service
 * Live weather from Open-Meteo
 * No GPS required — uses city names
 */

const weatherCache = new Map();

const CONDITIONS = {
  0: 'clear skies',
  1: 'mostly clear skies',
  2: 'partly cloudy skies',
  3: 'cloudy skies',
  45: 'fog',
  48: 'fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'drizzle',
  56: 'freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'scattered showers',
  81: 'showers',
  82: 'heavy showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorms',
  96: 'thunderstorms',
  99: 'thunderstorms'
};

async function readJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Weather service returned ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function niceNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? Math.round(number)
    : null;
}

function shortDate(date) {
  const d = new Date(`${date}T12:00:00Z`);

  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC'
  });
}

export async function getWeatherBriefing(
  city = 'Dallas',
  scope = 'day'
) {
  const requestedCity =
    String(city || 'Dallas').trim().slice(0, 80) || 'Dallas';

  const mode = ['day', 'tomorrow', 'week'].includes(scope)
    ? scope
    : 'day';

  const cacheKey = `${requestedCity.toLowerCase()}:${mode}`;

  const cached = weatherCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.at < 10 * 60 * 1000
  ) {
    return cached.result;
  }

  try {
    // Find the city
    const geoUrl = new URL(
      'https://geocoding-api.open-meteo.com/v1/search'
    );

    geoUrl.searchParams.set('name', requestedCity);
    geoUrl.searchParams.set('count', '1');
    geoUrl.searchParams.set('language', 'en');
    geoUrl.searchParams.set('format', 'json');

    const geo = await readJSON(geoUrl.toString());
    const place = geo.results?.[0];

    if (!place) {
      throw new Error('City not found');
    }

    // Retrieve forecast
    const url = new URL(
      'https://api.open-meteo.com/v1/forecast'
    );

    url.searchParams.set(
      'latitude',
      String(place.latitude)
    );

    url.searchParams.set(
      'longitude',
      String(place.longitude)
    );

    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('temperature_unit', 'fahrenheit');

    url.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    );

    url.searchParams.set(
      'forecast_days',
      mode === 'week' ? '7' : '2'
    );

    const forecast = await readJSON(url.toString());
    const daily = forecast.daily;

    if (!daily?.time?.length) {
      throw new Error('Forecast missing');
    }

    const index = mode === 'tomorrow' ? 1 : 0;

    if (!daily.time[index]) {
      throw new Error('Requested forecast unavailable');
    }

    const condition =
      CONDITIONS[daily.weather_code?.[index]] ||
      'mixed conditions';

    const high = niceNumber(
      daily.temperature_2m_max?.[index]
    );

    const low = niceNumber(
      daily.temperature_2m_min?.[index]
    );

    const rainChance = niceNumber(
      daily.precipitation_probability_max?.[index]
    );

    if (high === null || low === null) {
      throw new Error('Temperature unavailable');
    }

    const placeName = place.name;
    const label = mode === 'tomorrow' ? 'tomorrow' : 'today';

    let spoken =
      `In ${placeName} ${label}, expect ${condition}, ` +
      `with a high of ${high} degrees and a low of ${low}.`;

    if (rainChance !== null) {
      spoken +=
        ` The chance of precipitation is ${rainChance} percent.`;
    }

    // Extra information for weekly forecasts
    if (mode === 'week') {
      const rainyDays = daily.time
        .map((date, i) => ({
          date,
          chance: niceNumber(
            daily.precipitation_probability_max?.[i]
          )
        }))
        .filter(
          item =>
            item.chance !== null &&
            item.chance >= 60
        );

      if (rainyDays.length) {
        const days = rainyDays
          .slice(0, 3)
          .map(item => shortDate(item.date))
          .join(', ');

        spoken +=
          ` Rain is more likely on ${days}` +
          `${rainyDays.length > 3 ? ' and other days' : ''}` +
          ` this week.`;
      } else {
        spoken +=
          ' No days currently show a high chance of precipitation in the seven-day forecast.';
      }
    }

    const result = {
      success: true,
      spoken,
      display:
        `${placeName} · ${condition} · ${high}°F`,
      date: daily.time[index],
      rainChance,
      city: placeName
    };

    weatherCache.set(cacheKey, {
      result,
      at: Date.now()
    });

    return result;
  } catch (error) {
    console.warn(
      'AUREN weather unavailable:',
      error
    );

    return {
      success: false,
      spoken: '',
      display: 'Weather unavailable',
      error: error.message
    };
  }
}
