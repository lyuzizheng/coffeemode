// tz-lookup ships no type declarations.
declare module "tz-lookup" {
  /** Best-effort coordinates → IANA timezone name (polygon lookup). */
  export default function tzLookup(lat: number, lng: number): string;
}
