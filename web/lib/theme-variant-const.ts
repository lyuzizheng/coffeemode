/**
 * Server-safe constants for the design-variant axis (BRAWUKA-370). Kept out of
 * theme-variant.ts because that module is "use client" — app/layout.tsx (a
 * server component) imports VARIANT_BOOTSTRAP for the pre-paint script.
 */
export const THEME_VARIANT_STORAGE_KEY = "cm-theme-variant";

/** Inline bootstrap for <head>: applies the saved variant pre-paint. */
export const VARIANT_BOOTSTRAP = `(function(){try{var v=localStorage.getItem("${THEME_VARIANT_STORAGE_KEY}");if(v==="retro"||v==="modern")document.documentElement.setAttribute("data-variant",v);}catch(e){}})();`;
