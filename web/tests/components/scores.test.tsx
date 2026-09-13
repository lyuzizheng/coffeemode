import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ScorePair, WorkProfile } from "@/components/discovery/scores";
import { emptyWorkStats, type WorkStats } from "@/lib/stats/work-stats";
import messages from "../../messages/en.json";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

/** Shell cafe: zero check-ins, every dimension empty. */
const SHELL_STATS = emptyWorkStats();

function statsWithWifi(): WorkStats {
  const stats = emptyWorkStats();
  stats.n_checkins = 3;
  stats.dims.wifi = { sum: 240, n: 3 };
  stats.composite_score = 80;
  return stats;
}

describe("ScorePair + WorkProfile empty states (BRAWUKA-247)", () => {
  it("renders 'Not enough check-ins' exactly once for a shell cafe", () => {
    render(
      <>
        <ScorePair stats={SHELL_STATS} />
        <WorkProfile stats={SHELL_STATS} animated={false} />
      </>,
      { wrapper: Wrapper },
    );
    expect(screen.getAllByText("Not enough check-ins")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Work profile" })).not.toBeInTheDocument();
  });

  it("keeps per-dimension 'Not enough' rows when some dims have data", () => {
    render(<WorkProfile stats={statsWithWifi()} animated={false} />, { wrapper: Wrapper });
    // wifi has a bar; the other four dims honestly report no responses.
    expect(screen.getAllByText("Not enough check-ins")).toHaveLength(4);
    expect(screen.getByText("80")).toBeInTheDocument();
  });
});
