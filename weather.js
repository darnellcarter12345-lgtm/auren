/*
 * AUREN Weather Service
 * Live forecasts powered by Open-Meteo
 * No GPS required.
 */


const weatherCache = new Map();

const CONDITIONS = {
  0: "clear skies",
  1: "mostly clear skies",
  2: "partly cloudy skies",
  3: "cloudy skies",
  45: "fog",
  48: "fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "freezing drizzle",
  57: "freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "scattered showers",
  81: "showers",
  82: "heavy showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorms",
  96: "thunderstorms",
  99: "thunderstorms"
};

async function readJSON(url) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Weather service unavailable");
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function roundNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? Math.round(number)
    : null;
}

function weekday(dateString) {
  const date = new Date(dateString + "T12:00:00Z");

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC"
  });
}

export async function getWeatherBriefing(
  city = "Dallas",
  scope = "day"
) {
  const requestedCity =
    String(city || "Dallas").trim().slice(0, 80) || "Dallas";

  const mode = ["day", "tomorrow", "week"].includes(scope)
    ? scope
    : "day";

  const cacheKey =
    requestedCity.toLowerCase() + ":" + mode;

  const cached = weatherCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.at < 10 * 60 * 1000
  ) {
    return cached.result;
  }

  try {
    // Step 1: Find the requested city.
    const geoURL = new URL(
      "https://geocoding-api.open-meteo.com/v1/search"
    );

    geoURL.searchParams.set("name", requestedCity);
    geoURL.searchParams.set("count", "1");
    geoURL.searchParams.set("language", "en");
    geoURL.searchParams.set("format", "json");

    const geo = await readJSON(geoURL.toString());

    const place = geo.results?.[0];

    if (!place) {
      throw new Error("City not found");
    }

    // Step 2: Request live forecast data.
    const forecastURL = new URL(
      "https://api.open-meteo.com/v1/forecast"
    );

    forecastURL.searchParams.set(
      "latitude",
      String(place.latitude)
    );

    forecastURL.searchParams.set(
      "longitude",
      String(place.longitude)
    );

    forecastURL.searchParams.set("timezone", "auto");

    forecastURL.searchParams.set(
      "temperature_unit",
      "fahrenheit"
    );

    forecastURL.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
    );

    forecastURL.searchParams.set(
      "forecast_days",
      mode === "week" ? "7" : "2"
    );

    const forecast = await readJSON(
      forecastURL.toString()
    );

    const daily = forecast.daily;

    if (!daily?.time?.length) {
      throw new Error("Forecast data unavailable");
    }

    // Step 3: Select today or tomorrow.
    const index = mode === "tomorrow" ? 1 : 0;

    if (!daily.time[index]) {
      throw new Error("Requested day unavailable");
    }

    const condition =
      CONDITIONS[daily.weather_code?.[index]] ||
      "mixed conditions";

    const high = roundNumber(
      daily.temperature_2m_max?.[index]
    );

    const low = roundNumber(
      daily.temperature_2m_min?.[index]
    );

    const rainChance = roundNumber(
      daily.precipitation_probability_max?.[index]
    );

    if (high === null || low === null) {
      throw new Error("Temperature data unavailable");
    }

    const cityName = place.name;

    const dayLabel =
      mode === "tomorrow" ? "tomorrow" : "today";

    // Step 4: Compose the spoken response.
    let spoken =
      `In ${cityName} ${dayLabel}, expect ${condition}, ` +
      `with a high of ${high} degrees ` +
      `and a low of ${low}.`;

    if (rainChance !== null) {
      spoken +=
        ` The chance of precipitation is ` +
        `${rainChance} percent.`;
    }

    if (mode === "week") {
      const rainyDays = daily.time
        .map((date, i) => ({
          date,
          chance: roundNumber(
            daily.precipitation_probability_max?.[i]
          )
        }))
        .filter(item =>
          item.chance !== null && item.chance >= 60
        );

      if (rainyDays.length > 0) {
        const days = rainyDays
          .slice(0, 3)
          .map(item => weekday(item.date))
          .join(", ");

        spoken +=
          ` Rain is more likely on ${days}` +
          `${rainyDays.length > 3 ? " and other days" : ""} ` +
          `during the next seven days.`;
      } else {
        spoken +=
          " No days currently show a high chance " +
          "of precipitation in the next seven days.";
      }
    }

    // Step 5: Return the forecast to AUREN.
    const result = {
      success: true,
      spoken,
      display: `${cityName} · ${condition} · ${high}°F`,
      date: daily.time[index],
      rainChance,
      city: cityName
    };

    weatherCache.set(cacheKey, {
      result,
      at: Date.now()
    });

    return result;
  } catch (error) {
    console.error("AUREN weather error:", error);

    return {
      success: false,
      spoken: "",
      display: "Weather unavailable",
      error: error.message
    };
  }
}
