import type pg from "pg";
import type { CheckInScores, MaxStay } from "@/types/checkins";
import type { StoredImage } from "@/types/images";

/**
 * Shared multi-city mock dataset for the E2E backend user-journey matrix
 * (spec 0007). Single source for journey seeding and local-dev hydration.
 *
 * Deterministic fixed UUIDs; real lat/lng + IANA tz per city. `work_stats`
 * is intentionally NOT seeded — it must be derived by the normal
 * recompute path after check-ins land.
 *
 * Cafe `scores` / `tags` are archetype metadata (representative work profile
 * + descriptive labels), NOT database columns — `cafes` has no tags column.
 * They drive filter-choice and seed-payload construction in Stage-2 tests.
 * Likewise `MOCK_CHECKINS` are `createCheckIn` input payloads (normal service
 * path with recompute), not rows: `seedMockDataset` inserts profiles + cafes
 * only, so journey `n_checkins` transition assertions stay exact.
 */

export const JOURNEY_U1 = "b0000000-0000-4000-a000-0000000000a1"; // creator
export const JOURNEY_U2 = "b0000000-0000-4000-a000-0000000000a2"; // visitor
export const JOURNEY_U3 = "b0000000-0000-4000-a000-0000000000a3"; // solo deleter
export const JOURNEY_SERVICE_ACCOUNT_ID = "00000000-0000-4000-a000-000000000001";

export interface MockUser {
  id: string;
  displayName: string;
  currentCity: string;
}

export const MOCK_USERS: MockUser[] = [
  { id: JOURNEY_U1, displayName: "Journey Ann", currentCity: "singapore" },
  { id: JOURNEY_U2, displayName: "Journey Ben", currentCity: "singapore" },
  { id: JOURNEY_U3, displayName: "Journey Cat", currentCity: "tokyo" },
];

export type MockDayHours = { open: string; close: string } | null;

export interface MockCafe {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  city: string;
  tz: string;
  priceRange: number;
  createdBy: string;
  openingHours: Record<string, MockDayHours>;
  /** Representative work profile, 0-100 per WORK_DIM (wifi/outlets/seats/temp/coffee/overall). */
  scores: CheckInScores;
  /** Descriptive archetype labels (filter vocabulary: wifi/outlets/quiet/natural_light/spacious). */
  tags: string[];
}

const WEEKDAY_HOURS: Record<string, MockDayHours> = {
  mon: { open: "08:00", close: "22:00" },
  tue: { open: "08:00", close: "22:00" },
  wed: { open: "08:00", close: "22:00" },
  thu: { open: "08:00", close: "22:00" },
  fri: { open: "08:00", close: "23:00" },
  sat: { open: "09:00", close: "23:00" },
  sun: { open: "09:00", close: "21:00" },
};

/** Slow-bar hours: late open, closed Sundays (null = explicit closed day). */
const SLOW_BAR_HOURS: Record<string, MockDayHours> = {
  mon: null,
  tue: { open: "10:00", close: "20:00" },
  wed: { open: "10:00", close: "20:00" },
  thu: { open: "10:00", close: "20:00" },
  fri: { open: "10:00", close: "22:00" },
  sat: { open: "10:00", close: "22:00" },
  sun: { open: "11:00", close: "18:00" },
};

export const MOCK_CAFES: MockCafe[] = [
  // ——— Singapore (Orchard cluster; ~1.30, 103.83) ———
  {
    id: "b0000000-0000-4000-a000-0000000000c1",
    name: "Orchard Nomad Roasters",
    lat: 1.3048,
    lng: 103.8318,
    address: "1 Orchard Rd, Singapore",
    city: "singapore",
    tz: "Asia/Singapore",
    priceRange: 2,
    createdBy: JOURNEY_U1,
    openingHours: WEEKDAY_HOURS,
    scores: { wifi: 92, outlets: 88, seats: 85, temp: 80, coffee: 90, overall: 88 },
    tags: ["wifi", "outlets", "spacious", "natural_light"],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000c2",
    name: "Bugis Outlet Haven",
    lat: 1.2996,
    lng: 103.8552,
    address: "244 Beach Rd, Singapore",
    city: "singapore",
    tz: "Asia/Singapore",
    priceRange: 1,
    createdBy: JOURNEY_U1,
    openingHours: WEEKDAY_HOURS,
    scores: { wifi: 85, outlets: 96, seats: 62, temp: 74, coffee: 78, overall: 80 },
    tags: ["outlets", "wifi"],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000c3",
    name: "Tiong Bahru Quiet Corner",
    lat: 1.2856,
    lng: 103.827,
    address: "55 Tiong Bahru Rd, Singapore",
    city: "singapore",
    tz: "Asia/Singapore",
    priceRange: 3,
    createdBy: JOURNEY_U2,
    openingHours: WEEKDAY_HOURS,
    scores: { wifi: 78, outlets: 70, seats: 88, temp: 86, coffee: 92, overall: 86 },
    tags: ["quiet", "natural_light", "spacious"],
  },
  // ——— Tokyo (Shibuya cluster; ~35.66, 139.70) ———
  {
    id: "b0000000-0000-4000-a000-0000000000c4",
    name: "Shibuya Deep Work Coffee",
    lat: 35.6595,
    lng: 139.7005,
    address: "2-11-3 Meguro, Tokyo",
    city: "tokyo",
    tz: "Asia/Tokyo",
    priceRange: 2,
    createdBy: JOURNEY_U2,
    openingHours: WEEKDAY_HOURS,
    scores: { wifi: 90, outlets: 82, seats: 80, temp: 78, coffee: 88, overall: 85 },
    tags: ["wifi", "quiet"],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000c5",
    name: "Shimokitazawa Slow Bar",
    lat: 35.6612,
    lng: 139.668,
    address: "5-36-14 Daita, Tokyo",
    city: "tokyo",
    tz: "Asia/Tokyo",
    priceRange: 3,
    createdBy: JOURNEY_U3,
    openingHours: SLOW_BAR_HOURS,
    scores: { wifi: 70, outlets: 64, seats: 90, temp: 84, coffee: 95, overall: 84 },
    tags: ["quiet", "natural_light"],
  },
  // ——— London (Soho cluster; ~51.51, -0.13) ———
  {
    id: "b0000000-0000-4000-a000-0000000000c6",
    name: "Soho Laptop Loft",
    lat: 51.5136,
    lng: -0.1365,
    address: "12 Greek St, London",
    city: "london",
    tz: "Europe/London",
    priceRange: 3,
    createdBy: JOURNEY_U3,
    openingHours: WEEKDAY_HOURS,
    scores: { wifi: 88, outlets: 90, seats: 76, temp: 72, coffee: 84, overall: 83 },
    tags: ["outlets", "wifi", "spacious"],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000c7",
    name: "Shoreditch Long Stay",
    lat: 51.5247,
    lng: -0.0785,
    address: "88 Redchurch St, London",
    city: "london",
    tz: "Europe/London",
    priceRange: 2,
    createdBy: JOURNEY_U1,
    openingHours: WEEKDAY_HOURS,
    scores: { wifi: 82, outlets: 78, seats: 92, temp: 80, coffee: 82, overall: 84 },
    tags: ["spacious", "natural_light", "quiet"],
  },
];

/**
 * Historical check-in seeds: `createCheckIn` input payloads, one per journey
 * persona across all three cities. `visitedDaysAgo` keeps seeds clear of the
 * DG64 same-window revisit conflict when Stage-2 tests insert them through
 * the normal service path. `photoIds` reference `MOCK_PHOTOS` image UUIDs.
 */
export interface MockCheckinSeed {
  id: string;
  cafeId: string;
  userId: string;
  scores: CheckInScores;
  maxStay: MaxStay;
  note: string;
  /** Days before "now" the visit is backdated to on insert. */
  visitedDaysAgo: number;
  photoIds: string[];
}

export const MOCK_PHOTO_E1 = "b0000000-0000-4000-a000-0000000000e1";
export const MOCK_PHOTO_E2 = "b0000000-0000-4000-a000-0000000000e2";
export const MOCK_PHOTO_E3 = "b0000000-0000-4000-a000-0000000000e3";

export const MOCK_CHECKINS: MockCheckinSeed[] = [
  {
    id: "b0000000-0000-4000-a000-0000000000d1",
    cafeId: "b0000000-0000-4000-a000-0000000000c1",
    userId: JOURNEY_U1,
    scores: { wifi: 92, outlets: 88, overall: 88 },
    maxStay: "unlimited",
    note: "Camped here all afternoon — fast wifi, plenty of plugs by the window.",
    visitedDaysAgo: 9,
    photoIds: [MOCK_PHOTO_E1],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000d2",
    cafeId: "b0000000-0000-4000-a000-0000000000c1",
    userId: JOURNEY_U2,
    scores: { wifi: 84, seats: 78, coffee: 90, overall: 84 },
    maxStay: "3h",
    note: "Great flat white, gets crowded after lunch.",
    visitedDaysAgo: 6,
    photoIds: [],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000d3",
    cafeId: "b0000000-0000-4000-a000-0000000000c3",
    userId: JOURNEY_U2,
    scores: { seats: 88, temp: 86, coffee: 92, overall: 86 },
    maxStay: "2h",
    note: "Quiet corner table, perfect for deep work.",
    visitedDaysAgo: 4,
    photoIds: [],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000d4",
    cafeId: "b0000000-0000-4000-a000-0000000000c4",
    userId: JOURNEY_U3,
    scores: { wifi: 90, outlets: 82, overall: 85 },
    maxStay: "3h",
    note: "Stable connection for video calls, order at the counter.",
    visitedDaysAgo: 7,
    photoIds: [MOCK_PHOTO_E2],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000d5",
    cafeId: "b0000000-0000-4000-a000-0000000000c5",
    userId: JOURNEY_U3,
    scores: { seats: 90, coffee: 95, overall: 84 },
    maxStay: "1h",
    note: "Slow bar — worth the wait, not a laptop factory.",
    visitedDaysAgo: 3,
    photoIds: [],
  },
  {
    id: "b0000000-0000-4000-a000-0000000000d6",
    cafeId: "b0000000-0000-4000-a000-0000000000c7",
    userId: JOURNEY_U1,
    scores: { seats: 92, wifi: 82, overall: 84 },
    maxStay: "unlimited",
    note: "Long-stay friendly, big shared table upstairs.",
    visitedDaysAgo: 5,
    photoIds: [MOCK_PHOTO_E3],
  },
];

/**
 * Gallery-shaped photo objects backing `MOCK_CHECKINS` photo references.
 * Mirrors the server-derived `StoredImage` shape (R2 keys, dimensions,
 * attribution, check-in source) without touching storage.
 */
export const MOCK_PHOTOS: StoredImage[] = [
  {
    id: MOCK_PHOTO_E1,
    original: `original/${MOCK_PHOTO_E1}.webp`,
    card: `card/${MOCK_PHOTO_E1}.webp`,
    thumbnail: `thumbnail/${MOCK_PHOTO_E1}.webp`,
    w: 1600,
    h: 1200,
    by: JOURNEY_U1,
    at: "2026-08-31T09:30:00.000Z",
    source: { type: "checkin", id: "b0000000-0000-4000-a000-0000000000d1" },
  },
  {
    id: MOCK_PHOTO_E2,
    original: `original/${MOCK_PHOTO_E2}.webp`,
    card: `card/${MOCK_PHOTO_E2}.webp`,
    thumbnail: `thumbnail/${MOCK_PHOTO_E2}.webp`,
    w: 1600,
    h: 1200,
    by: JOURNEY_U3,
    at: "2026-09-02T14:00:00.000Z",
    source: { type: "checkin", id: "b0000000-0000-4000-a000-0000000000d4" },
  },
  {
    id: MOCK_PHOTO_E3,
    original: `original/${MOCK_PHOTO_E3}.webp`,
    card: `card/${MOCK_PHOTO_E3}.webp`,
    thumbnail: `thumbnail/${MOCK_PHOTO_E3}.webp`,
    w: 1600,
    h: 1200,
    by: JOURNEY_U1,
    at: "2026-09-04T11:15:00.000Z",
    source: { type: "checkin", id: "b0000000-0000-4000-a000-0000000000d6" },
  },
];

/** Insert all dataset profiles + cafes. Check-ins are created by the journey itself. */
export async function seedMockDataset(dbClient: pg.Client): Promise<void> {
  // Single source: profile rows come from MOCK_USERS, not re-hardcoded literals.
  const users: MockUser[] = [
    ...MOCK_USERS,
    { id: JOURNEY_SERVICE_ACCOUNT_ID, displayName: "CoffeeMode", currentCity: "singapore" },
  ];
  const placeholders = users.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(",\n           ");
  await dbClient.query(
    `insert into profiles (id, display_name, current_city)
     values ${placeholders}
     on conflict (id) do update set display_name = excluded.display_name,
                                    current_city = excluded.current_city`,
    users.flatMap((u) => [u.id, u.displayName, u.currentCity]),
  );
  for (const cafe of MOCK_CAFES) {
    await dbClient.query(
      `insert into cafes (id, name, location, address, city, tz, price_range, opening_hours, created_by)
       values ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
               $5, $6, $7, $8, $9::jsonb, $10)
       on conflict (id) do nothing`,
      [
        cafe.id,
        cafe.name,
        cafe.lng,
        cafe.lat,
        cafe.address,
        cafe.city,
        cafe.tz,
        cafe.priceRange,
        JSON.stringify(cafe.openingHours),
        cafe.createdBy,
      ],
    );
  }
}
