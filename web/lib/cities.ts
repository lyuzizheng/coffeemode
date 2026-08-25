export interface Coordinates {
  lat: number;
  lng: number;
}

export interface CityInfo {
  id: string;
  name: string;
  nameZh: string;
  code: string;
  center: Coordinates;
  tz: string;
}

/**
 * Launch cities (DG50): ~10 cities where specialty coffee culture is strong.
 * Codes use ISO 3166-1 alpha-2 + IATA metropolitan code (spec 0001 §Onboarding & city model).
 */
export const LAUNCH_CITIES: readonly CityInfo[] = [
  {
    id: "singapore",
    name: "Singapore",
    nameZh: "新加坡",
    code: "SG/SIN",
    center: { lat: 1.3521, lng: 103.8198 },
    tz: "Asia/Singapore",
  },
  {
    id: "tokyo",
    name: "Tokyo",
    nameZh: "东京",
    code: "JP/TYO",
    center: { lat: 35.6762, lng: 139.6503 },
    tz: "Asia/Tokyo",
  },
  {
    id: "seoul",
    name: "Seoul",
    nameZh: "首尔",
    code: "KR/SEL",
    center: { lat: 37.5665, lng: 126.978 },
    tz: "Asia/Seoul",
  },
  {
    id: "taipei",
    name: "Taipei",
    nameZh: "台北",
    code: "TW/TPE",
    center: { lat: 25.033, lng: 121.5654 },
    tz: "Asia/Taipei",
  },
  {
    id: "shanghai",
    name: "Shanghai",
    nameZh: "上海",
    code: "CN/SHA",
    center: { lat: 31.2304, lng: 121.4737 },
    tz: "Asia/Shanghai",
  },
  {
    id: "bangkok",
    name: "Bangkok",
    nameZh: "曼谷",
    code: "TH/BKK",
    center: { lat: 13.7563, lng: 100.5018 },
    tz: "Asia/Bangkok",
  },
  {
    id: "hongkong",
    name: "Hong Kong",
    nameZh: "香港",
    code: "HK/HKG",
    center: { lat: 22.3193, lng: 114.1694 },
    tz: "Asia/Hong_Kong",
  },
  {
    id: "melbourne",
    name: "Melbourne",
    nameZh: "墨尔本",
    code: "AU/MEL",
    center: { lat: -37.8136, lng: 144.9631 },
    tz: "Australia/Melbourne",
  },
  {
    id: "berlin",
    name: "Berlin",
    nameZh: "柏林",
    code: "DE/BER",
    center: { lat: 52.52, lng: 13.405 },
    tz: "Europe/Berlin",
  },
  {
    id: "london",
    name: "London",
    nameZh: "伦敦",
    code: "GB/LON",
    center: { lat: 51.5074, lng: -0.1278 },
    tz: "Europe/London",
  },
];

export const DEFAULT_CITY = LAUNCH_CITIES[0];

function normalizeCityKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s\-_/]/g, "");
}

/** Look up a city by id, code, or name. Returns null if unknown. */
export function findCity(query: string | null | undefined): CityInfo | null {
  if (!query) return null;
  const normalized = normalizeCityKey(query);
  if (!normalized) return null;

  for (const city of LAUNCH_CITIES) {
    if (
      normalizeCityKey(city.id) === normalized ||
      normalizeCityKey(city.code) === normalized ||
      normalizeCityKey(city.name) === normalized ||
      normalizeCityKey(city.nameZh) === normalized
    ) {
      return city;
    }
  }
  return null;
}
