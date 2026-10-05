/**
 * The subset of Cloudflare's Rules language the cafe-shell cache payload uses,
 * as a parser plus evaluator (BRAWUKA-834 / BRAWUKA-836).
 *
 * Supported: `starts_with(field, "prefix")`, `http.<field> eq|ne|contains "v"`,
 * `any(field[*] wildcard "pattern")`, `and`, `not`, parentheses, and the fields
 * `http.request.uri.path`, `http.host`, `http.cookie`,
 * `http.request.headers["accept-language"]`.
 *
 * Anything outside that subset throws instead of being skipped, so a payload
 * that grows a new predicate fails the check loudly rather than passing on a
 * partially evaluated expression.
 */

const PUNCTUATION = new Set(["(", ")", "[", "]", ",", ".", "*"]);

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"') {
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\") {
          value += source[index + 1];
          index += 2;
          continue;
        }
        value += source[index];
        index += 1;
      }
      if (source[index] !== '"') throw new Error(`unterminated string in ${source}`);
      index += 1;
      tokens.push({ kind: "string", value });
      continue;
    }
    if (PUNCTUATION.has(char)) {
      tokens.push({ kind: "punct", value: char });
      index += 1;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (!match) {
      throw new Error(`cannot tokenize ${JSON.stringify(source.slice(index, index + 16))}`);
    }
    tokens.push({ kind: "ident", value: match[0] });
    index += match[0].length;
  }
  return tokens;
}

function peek(tokens, cursor) {
  return tokens[cursor.index];
}

function take(tokens, cursor, kind, value) {
  const token = tokens[cursor.index];
  const matches =
    token && token.kind === kind && (value === undefined || token.value === value);
  if (!matches) {
    throw new Error(
      `expected ${value ?? kind} at token ${cursor.index}, got ${JSON.stringify(token)}`,
    );
  }
  cursor.index += 1;
  return token;
}

function parseField(tokens, cursor) {
  let field = take(tokens, cursor, "ident").value;
  for (;;) {
    const token = peek(tokens, cursor);
    if (token?.kind === "punct" && token.value === ".") {
      cursor.index += 1;
      field += `.${take(tokens, cursor, "ident").value}`;
      continue;
    }
    if (token?.kind === "punct" && token.value === "[") {
      cursor.index += 1;
      if (peek(tokens, cursor)?.kind === "punct" && peek(tokens, cursor).value === "*") {
        cursor.index += 1;
        take(tokens, cursor, "punct", "]");
        field += "[*]";
        continue;
      }
      field += `["${take(tokens, cursor, "string").value}"]`;
      take(tokens, cursor, "punct", "]");
      continue;
    }
    return field;
  }
}

function readField(field, request) {
  switch (field) {
    case "http.request.uri.path":
      return request.path;
    case "http.host":
      return request.host;
    case "http.cookie":
      return request.cookie;
    case 'http.request.headers["accept-language"]':
    case 'http.request.headers["accept-language"][*]':
      return request.acceptLanguage;
    default:
      throw new Error(`unsupported field ${field}`);
  }
}

function wildcard(pattern, value) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function parsePredicate(tokens, cursor) {
  const head = peek(tokens, cursor);
  if (head?.kind === "ident" && head.value === "starts_with") {
    cursor.index += 1;
    take(tokens, cursor, "punct", "(");
    const field = parseField(tokens, cursor);
    take(tokens, cursor, "punct", ",");
    const prefix = take(tokens, cursor, "string").value;
    take(tokens, cursor, "punct", ")");
    return (request) => readField(field, request).startsWith(prefix);
  }
  if (head?.kind === "ident" && head.value === "any") {
    cursor.index += 1;
    take(tokens, cursor, "punct", "(");
    const field = parseField(tokens, cursor);
    const operator = take(tokens, cursor, "ident").value;
    if (operator !== "wildcard") throw new Error(`unsupported any() operator ${operator}`);
    const pattern = take(tokens, cursor, "string").value;
    take(tokens, cursor, "punct", ")");
    return (request) =>
      readField(field, request).some((value) => wildcard(pattern, value));
  }
  if (head?.kind === "ident" && head.value === "http") {
    const field = parseField(tokens, cursor);
    const operator = take(tokens, cursor, "ident").value;
    const value = take(tokens, cursor, "string").value;
    if (operator === "eq") return (request) => readField(field, request) === value;
    if (operator === "ne") return (request) => readField(field, request) !== value;
    if (operator === "contains") return (request) => readField(field, request).includes(value);
    throw new Error(`unsupported operator ${operator}`);
  }
  throw new Error(`unsupported predicate ${JSON.stringify(head)}`);
}

function parseTerm(tokens, cursor) {
  const token = peek(tokens, cursor);
  if (token?.kind === "ident" && token.value === "not") {
    cursor.index += 1;
    take(tokens, cursor, "punct", "(");
    const inner = parseExpression(tokens, cursor);
    take(tokens, cursor, "punct", ")");
    return (request) => !inner(request);
  }
  if (token?.kind === "punct" && token.value === "(") {
    cursor.index += 1;
    const inner = parseExpression(tokens, cursor);
    take(tokens, cursor, "punct", ")");
    return inner;
  }
  return parsePredicate(tokens, cursor);
}

function parseExpression(tokens, cursor) {
  let left = parseTerm(tokens, cursor);
  while (peek(tokens, cursor)?.kind === "ident" && peek(tokens, cursor).value === "and") {
    cursor.index += 1;
    const right = parseTerm(tokens, cursor);
    const previous = left;
    left = (request) => previous(request) && right(request);
  }
  return left;
}

/** Compile one Rules-language expression into a predicate over a request. */
export function compile(expression) {
  const tokens = tokenize(expression);
  const cursor = { index: 0 };
  const predicate = parseExpression(tokens, cursor);
  if (cursor.index !== tokens.length) {
    throw new Error(`trailing tokens in ${expression}`);
  }
  return predicate;
}

/**
 * Cloudflare's request-phase semantics: rules run in order and the last
 * matching `set_cache_settings` wins. Returns the winning `cache` setting
 * (`null` when no rule matched) plus the descriptions that matched, so a
 * failure can name the rule that overrode the intended one.
 */
export function evaluateRules(rules, request) {
  const matched = [];
  let setting = null;
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!compile(rule.expression)(request)) continue;
    matched.push(rule.description);
    setting = rule.action_parameters.cache;
  }
  return { matched, setting };
}
