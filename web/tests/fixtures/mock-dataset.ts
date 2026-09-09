import type pg from "pg";

/**
 * Shared multi-city mock dataset for the E2E backend user-journey matrix
 * (spec 0007). Single source for journey seeding and local-dev hydration.
 *
 * Deterministic fixed UUIDs; real lat/lng + IANA tz per city. `work_stats`
 * is intentionally NOT seeded — it must be derived by the normal
 * recompute path after check-ins land.
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
  openingHours: Record<string, { open: string; close: string }>;
}

const WEEKDAY_HOURS = {
  mon: { open: "08:00", close: "22:00" },
  tue: { open: "08:00", close: "22:00" },
  wed: { open: "08:00", close: "22:00" },
  thu: { open: "08:00", close: "22:00" },
  fri: { open: "08:00", close: "23:00" },
  sat: { open: "09:00", close: "23:00" },
  sun: { open: "09:00", close: "21:00" },
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
    openingHours: WEEKDAY_HOURS,
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
  },
];

/** Insert all dataset profiles + cafes. Check-ins are created by the journey itself. */
export async function seedMockDataset(dbClient: pg.Client): Promise<void> {
  await dbClient.query(
    `insert into profiles (id, display_name, current_city)
     values ($1, 'Journey Ann', 'singapore'),
            ($2, 'Journey Ben', 'singapore'),
            ($3, 'Journey Cat', 'tokyo'),
            ($4, 'CoffeeMode', 'singapore')
     on conflict (id) do update set display_name = excluded.display_name,
                                    current_city = excluded.current_city`,
    [JOURNEY_U1, JOURNEY_U2, JOURNEY_U3, JOURNEY_SERVICE_ACCOUNT_ID],
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
