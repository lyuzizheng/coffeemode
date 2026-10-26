import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_CRAWLER_USER_AGENTS, CONTENT_SIGNAL, buildRobotsTxt } from "@/lib/robots";

// BRAWUKA-966 / DG154: the site refuses AI crawlers, AI training, and AI
// answer input while the product is immature. The agent list is duplicated
// here on purpose — this is the contract, not a restatement of the
// implementation, so dropping one from `lib/robots.ts` fails the suite.
const REQUIRED_AI_AGENTS = [
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
];

const WEB_ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "https://staging.cafemood.app";
const robots = buildRobotsTxt(ORIGIN);

interface Group {
  userAgents: string[];
  directives: string[];
}

function parseGroups(text: string): Group[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const group: Group = { userAgents: [], directives: [] };
      for (const line of block.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
        if (/^user-agent:/i.test(line)) {
          group.userAgents.push(line.slice(line.indexOf(":") + 1).trim());
        } else {
          group.directives.push(line);
        }
      }
      return group;
    })
    .filter((group) => group.userAgents.length > 0 || group.directives.length > 0);
}

const groups = parseGroups(robots);

/** Exact agent match, else the `*` group a crawler falls back to. */
function groupFor(agent: string): Group | undefined {
  return (
    groups.find((group) =>
      group.userAgents.some((userAgent) => userAgent.toLowerCase() === agent.toLowerCase()),
    ) ?? groups.find((group) => group.userAgents.includes("*"))
  );
}

describe("robots.txt AI policy (DG154)", () => {
  it("disallows every named AI crawler from the whole site", () => {
    for (const agent of REQUIRED_AI_AGENTS) {
      const group = groupFor(agent);
      expect(group, `missing robots group for ${agent}`).toBeDefined();
      expect(group?.userAgents, `${agent} must match its own group`).toContain(agent);
      expect(group?.directives).toContain("Disallow: /");
      expect(group?.directives.some((line) => /^allow:/i.test(line))).toBe(false);
    }
  });

  it("lists each AI crawler once", () => {
    expect(new Set(AI_CRAWLER_USER_AGENTS).size).toBe(AI_CRAWLER_USER_AGENTS.length);
  });

  it("keeps the * group crawlable so Googlebot and Bingbot still index cafes", () => {
    for (const agent of ["Googlebot", "Bingbot"]) {
      const group = groupFor(agent);
      expect(group?.userAgents).toEqual(["*"]);
      expect(group?.directives).toContain("Allow: /");
      expect(group?.directives).toContain("Allow: /cafes/*");
      expect(group?.directives).not.toContain("Disallow: /");
    }
    expect(groups.find((group) => group.userAgents.includes("*"))?.directives).toEqual([
      `Content-Signal: ${CONTENT_SIGNAL}`,
      "Allow: /",
      "Allow: /cafes/*",
      "Disallow: /api/",
      "Disallow: /theme-preview",
    ]);
  });

  it("declares the Content-Signal AI preference", () => {
    expect(robots).toContain("Content-Signal: search=yes, ai-train=no, ai-input=no");
    expect(CONTENT_SIGNAL).toBe("search=yes, ai-train=no, ai-input=no");
  });

  it("advertises the request-time sitemap origin", () => {
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});

describe("/llms.txt is retired (DG154)", () => {
  it("has no public file and no app route, so the path 404s", () => {
    expect(fs.existsSync(path.join(WEB_ROOT, "public", "llms.txt"))).toBe(false);
    expect(fs.existsSync(path.join(WEB_ROOT, "app", "llms.txt"))).toBe(false);
  });
});
