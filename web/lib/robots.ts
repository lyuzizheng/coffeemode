/**
 * robots.txt policy (spec 0001 §Rendering; DG105 SEO half, DG154 AI half).
 *
 * DG105 keeps cafe pages crawlable for classic search engines; DG154 closes
 * the site to AI crawlers, AI training, and AI answer use while the product
 * is immature. The named agents below get `Disallow: /`; the `*` group stays
 * unchanged so Googlebot/Bingbot can still index the public shell.
 *
 * Import-free like `lib/cache-policy.ts`: `next.config.ts` and the robots
 * route import this module, and the config transpiler cannot resolve imports
 * inside it.
 */

/**
 * Crawlers owned by AI model, AI search, or AI-agent vendors. Kept as an
 * explicit list (not a pattern) so adding one is a reviewable decision.
 */
export const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "PerplexityBot",
  "Perplexity-User",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "YouBot",
  "ImagesiftBot",
  "Omgilibot",
  "Timpibot",
  "PanguBot",
  "Webzio-Extended",
  "iaskspider",
  "Ai2Bot",
] as const;

/**
 * Cloudflare Content Signals preference (contentsignals.org): classic search
 * indexing is allowed; AI training and AI answer input are not.
 */
export const CONTENT_SIGNAL = "search=yes, ai-train=no, ai-input=no";

/** Directive that keeps HTML documents out of AI training/answer use. */
export const DOCUMENT_X_ROBOTS_TAG = "noai, noimageai";

/** The `*` group's public surface: cafe pages only (DG105). */
const SEARCH_ALLOW = ["/", "/cafes/*"];
const SEARCH_DISALLOW = ["/api/", "/theme-preview"];

function group(userAgents: readonly string[], directives: readonly string[]): string {
  return [...userAgents.map((agent) => `User-agent: ${agent}`), ...directives].join("\n");
}

/**
 * Render the full robots.txt body. The origin is request-derived (DG110) so
 * local dev, staging, and production never advertise another host's sitemap.
 */
export function buildRobotsTxt(origin: string): string {
  const aiGroup = group(AI_CRAWLER_USER_AGENTS, ["Disallow: /"]);
  const searchGroup = group(
    ["*"],
    [
      `Content-Signal: ${CONTENT_SIGNAL}`,
      ...SEARCH_ALLOW.map((path) => `Allow: ${path}`),
      ...SEARCH_DISALLOW.map((path) => `Disallow: ${path}`),
    ],
  );
  return `${aiGroup}\n\n${searchGroup}\n\nSitemap: ${origin}/sitemap.xml\n`;
}
