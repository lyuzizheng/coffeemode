/**
 * Navigation return-prompt DTO — the single source of truth shared by the
 * server queue (`web/lib/db/navigations.ts`) and the client hook
 * (`web/components/discovery/use-nav-prompt.ts`).
 *
 * Both sides must stay field-identical: drift here is a compile error, not a
 * silent `as` cast (BRAWUKA-280). Keep this file free of runtime dependencies
 * so every package can import it (Next.js web app, vitest).
 */
export interface NavPromptItemDto {
  id: string;
  created_at: string;
  cafe: { id: string; name: string; cover: string | null };
}
