/**
 * Share-flow logic (spec 0001 §PWA & sharing, DG109). Pure and unit-tested;
 * the `ShareControl` component composes it. WeChat's in-app browser has no
 * Web Share API and unreliable previews, so its UA gets the copy-link
 * popover instead of a dead native-share call.
 */

/** WeChat's in-app browser identifies itself with `MicroMessenger`. */
export function isWeChatUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === "string" && /micromessenger/i.test(ua);
}

/** Payload for `navigator.share`; the title doubles as copied text context. */
export function buildShareData(url: string, title: string): ShareData {
  return { title, url };
}
