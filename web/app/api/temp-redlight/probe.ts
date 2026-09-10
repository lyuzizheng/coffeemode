// TEMPORARY red-light probe for BRAWUKA-177 (layer boundary + raw SQL). Reverted in the next commit.
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function probeRoute(id: string, a: number, b: number, c: number, d: number, e: number, f: number) {
  const rows = await pool.query(
    `select id, name from cafes where id = $1 and deleted_at is null`,
    [id],
  );
  for (const row of rows.rows) {
    for (const key of Object.keys(row)) {
      if (key) {
        for (const inner of [1, 2]) {
          if (inner && a + b > c) {
            for (const deeper of [3]) {
              if (deeper && d + e > f) {
                console.log(key, inner, deeper);
              }
            }
          }
        }
      }
    }
  }
  return rows.rows;
}
