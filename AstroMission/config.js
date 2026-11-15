// ============================================================
// NASA API configuration (https://api.nasa.gov)
// WARNING: this file is downloaded by every browser that opens the game,
// so the key is visible to anyone. It is a free key, but do not reuse it
// for anything sensitive, and regenerate it if it ever gets abused.
// ============================================================
const NASA_CONFIG = {
  API_KEY: "nLcnh9LGcRH9nptGW8dTmwm9KgftgG6FHbk8DW9C",
  TIMEOUT_MS: 9000,     // give up on a NASA request after this long (the game falls back to simulated events)
  CACHE_MINUTES: 30     // reuse downloaded data in this tab to save the key's hourly quota
};
