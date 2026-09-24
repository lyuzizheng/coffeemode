-- CoffeeMode schema v32 (BRAWUKA-661 — backfill NULL for pre-fix non-allowlisted profiles.avatar_url).
-- BRAWUKA-635 bound OAuth avatar writes to sanitizeAvatarUrl
-- (web/lib/auth/profiles.ts: AVATAR_EXACT_HOSTS + AVATAR_HOST_SUFFIXES, https
-- only, <= 2048 chars), but the upsert conflict clause deliberately never
-- rewrites avatar_url on re-login — so rows created before that fix keep
-- whatever remote avatar_url the provider supplied. One-time cleanup: NULL
-- every stored value sanitizeAvatarUrl would reject. Upsert conflict semantics
-- unchanged (user-edited names still never clobbered).
--
-- The two !~* branches mirror the sanitizer's host rules: exact hosts
-- (googleusercontent.com, apple.com, icloud.com) plus their subdomains, and
-- suffix-only hosts (supabase.co, supabase.in, cdn-apple.com) requiring at
-- least one subdomain label — the sanitizer's suffix match needs a `.`
-- boundary, so a bare `supabase.co` is rejected there and here. The optional
-- `(:[0-9]*)?` port must be digits-only: a bare `:` terminator would admit
-- `https://googleusercontent.com:443@evil.com/…` (JS parses the host as
-- evil.com via userinfo) while the regex stops at `:`. `trimmed` mirrors the
-- sanitizer's String.trim (regexp_replace strips the same \s class Postgres
-- and JS agree on); userinfo (`user@`) is admitted because the sanitizer
-- checks only `hostname`. Residual: out-of-range ports (`:99999`) still keep
-- (unrenderable, harmless), and WHATWG-normalized oddities (`a..host`,
-- backslash, tab) skew NULL — the safe direction, and the value is never
-- re-written.
update profiles
set avatar_url = null
where avatar_url is not null
  and (
    char_length(regexp_replace(avatar_url, '^\s+|\s+$', '', 'g')) > 2048
    or (
      regexp_replace(avatar_url, '^\s+|\s+$', '', 'g') !~* '^https://([^/@\s]*@)?([a-z0-9_-]+\.)*(googleusercontent\.com|apple\.com|icloud\.com)(:[0-9]*)?(/|\?|#|$)'
      and regexp_replace(avatar_url, '^\s+|\s+$', '', 'g') !~* '^https://([^/@\s]*@)?([a-z0-9_-]+\.)+(supabase\.co|supabase\.in|cdn-apple\.com)(:[0-9]*)?(/|\?|#|$)'
    )
  );
