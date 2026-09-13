import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function renderTabs() {
  render(<ProfileTabs activeTab="checkins" onTabChange={vi.fn()} baseId="p" />, {
    wrapper: Wrapper,
  });
  return screen.getByRole("tablist");
}

/** jsdom has no layout — stub the scroll metrics the fade logic reads. */
function stubScrollMetrics(el: HTMLElement, metrics: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(el, key, { configurable: true, value });
  }
}

describe("ProfileTabs scroll-edge fade (BRAWUKA-247)", () => {
  it("fades the right edge while the 4th tab is clipped", () => {
    const tablist = renderTabs();
    // 390px viewport: 4 × 90px tabs overflow the ~358px strip.
    stubScrollMetrics(tablist, { scrollLeft: 0, clientWidth: 358, scrollWidth: 400 });
    fireEvent.scroll(tablist);
    expect(tablist.className).toContain("scroll-fade-end");
  });

  it("fades both edges mid-scroll and none when fully scrolled", () => {
    const tablist = renderTabs();
    stubScrollMetrics(tablist, { scrollLeft: 20, clientWidth: 358, scrollWidth: 400 });
    fireEvent.scroll(tablist);
    expect(tablist.className).toContain("scroll-fade-x");

    stubScrollMetrics(tablist, { scrollLeft: 42, clientWidth: 358, scrollWidth: 400 });
    fireEvent.scroll(tablist);
    expect(tablist.className).toContain("scroll-fade-start");
  });

  it("shows no fade when everything fits", () => {
    const tablist = renderTabs();
    stubScrollMetrics(tablist, { scrollLeft: 0, clientWidth: 640, scrollWidth: 400 });
    fireEvent.scroll(tablist);
    expect(tablist.className).not.toContain("scroll-fade");
  });
});
