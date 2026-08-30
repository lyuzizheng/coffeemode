import pg from "pg";
import { checkUploadIntent, consumeUploadIntent } from "@/lib/db/image-uploads";
import type { ProcessUrls } from "@/lib/images/image-service-client";
import type { ProcessedImage } from "@/lib/images/processor";
import type { ProvisionPhotosDeps } from "@/lib/images/provision-photos";

// Fixed UUIDs so tests are self-describing.
export const U1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"; // author / creator
export const U2 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"; // second user
export const CAFE_A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";
export const CHECKIN_A1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";
export const TESTER_ID = U1;

export async function seedBaseData(dbClient: pg.Client): Promise<void> {
  await dbClient.query(`insert into profiles (id, display_name) values ($1, 'u1'), ($2, 'u2')`, [U1, U2]);
  await dbClient.query(
    `insert into cafes (id, name, location, city, created_by, tz)
     values ($1, 'Seed Cafe', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography,
             'singapore', $2, 'Asia/Singapore')`,
    [CAFE_A, U1],
  );
  await dbClient.query(
    `insert into checkins (id, cafe_id, user_id, is_creation, scores)
     values ($1, $2, $3, true, '{"wifi": 80}'::jsonb)`,
    [CHECKIN_A1, CAFE_A, U1],
  );
}

export function fakeProcessUrls(imageUuid: string): ProcessUrls {
  const keys = {
    original: `original/${imageUuid}.webp`,
    card: `card/${imageUuid}.webp`,
    thumbnail: `thumbnail/${imageUuid}.webp`,
  };
  const signed = (key: string) => ({ url: `http://images.test/${key}`, headers: {} });
  return {
    imageUuid,
    original: signed(keys.original),
    originalPut: signed(keys.original),
    card: signed(keys.card),
    thumbnail: signed(keys.thumbnail),
    publicUrls: {
      original: `http://images.test/${keys.original}`,
      card: `http://images.test/${keys.card}`,
      thumbnail: `http://images.test/${keys.thumbnail}`,
    },
    keys,
  };
}

export function fakeProvisionPhotosDeps(): ProvisionPhotosDeps {
  return {
    checkUploadIntent,
    consumeUploadIntent,
    getProcessUrls: async ({ imageUuid }) => fakeProcessUrls(imageUuid),
    processImage: async (imageUuid: string): Promise<ProcessedImage> => ({
      imageUuid,
      publicUrls: fakeProcessUrls(imageUuid).publicUrls,
      width: 800,
      height: 600,
    }),
  };
}

export interface WorkStatsShape {
  n_users: number;
  n_checkins: number;
  dims: Record<string, { sum: number; n: number }>;
  policies: { max_stay: Record<string, number> };
  experience_score: number | null;
}

export async function cafeWorkStats(dbClient: pg.Client, cafeId: string): Promise<WorkStatsShape> {
  const { rows } = await dbClient.query("select work_stats from cafes where id = $1", [cafeId]);
  return rows[0].work_stats as WorkStatsShape;
}

/** Representative invalid payload fixtures for HTTP route boundary translation tests. */
export const INVALID_CAFE_PAYLOADS = {
  empty: {},
  nonObject: "invalid-json-body",
  missingName: {
    lat: 1.2789,
    lng: 103.8425,
    checkin: { scores: { wifi: 80, overall: 75 }, max_stay: "unlimited", note: "quiet", photo_ids: [U1] },
  },
  outOfRangeCoords: {
    name: "Caracara",
    lat: 999,
    lng: 103.8425,
    checkin: { scores: { wifi: 80, overall: 75 }, max_stay: "unlimited", note: "quiet", photo_ids: [U1] },
  },
  missingCheckin: {
    name: "Caracara",
    lat: 1.2789,
    lng: 103.8425,
  },
  invalidCheckinScores: {
    name: "Caracara",
    lat: 1.2789,
    lng: 103.8425,
    checkin: { scores: { wifi: 101, overall: 75 }, max_stay: "unlimited", note: "quiet", photo_ids: [U1] },
  },
};

export const INVALID_CHECKIN_PAYLOADS = {
  empty: {},
  nonObject: "invalid-json-body",
  nonUuidCafeId: {
    cafe_id: "not-a-uuid",
    scores: { wifi: 80 },
  },
  missingScores: {
    cafe_id: CAFE_A,
  },
  invalidScores: {
    cafe_id: CAFE_A,
    scores: { wifi: 101 },
  },
  futureVisitedAt: {
    cafe_id: CAFE_A,
    scores: { wifi: 80 },
    visited_at: new Date(Date.now() + 86400000).toISOString(),
  },
  invalidMaxStay: {
    cafe_id: CAFE_A,
    scores: { wifi: 80 },
    max_stay: "forever",
  },
};
