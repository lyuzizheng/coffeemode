import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { CheckinPhotos } from "@/components/checkin/checkin-photos";
import type { PhotoUpload } from "@/components/checkin/checkin-photos";
import { uploadPhoto } from "@/lib/images/client-upload";
import messages from "../../messages/en.json";

vi.mock("@/lib/images/client-upload", () => ({
  uploadPhoto: vi.fn(),
  toWebP: vi.fn(),
}));

vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return { ...actual, toast: vi.fn() };
});

const MAX = 6;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function Harness(props?: Partial<React.ComponentProps<typeof CheckinPhotos>>) {
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  return <CheckinPhotos photos={photos} onChange={setPhotos} maxPhotos={MAX} {...props} />;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not rendered");
  return input as HTMLInputElement;
}

function pick(n: number) {
  const files = Array.from(
    { length: n },
    (_, i) => new File(["x"], `p${i}.jpg`, { type: "image/jpeg" }),
  );
  fireEvent.change(fileInput(), { target: { files } });
}

describe("CheckinPhotos maxPhotos bound (BRAWUKA-461, BRAWUKA-579, BRAWUKA-672)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(uploadPhoto).mockResolvedValue("img-uuid");
    URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`);
    URL.revokeObjectURL = vi.fn();
  });

  it("clamps a single pick larger than the remaining slots", async () => {
    render(<Harness />, { wrapper: Wrapper });
    pick(10);
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(MAX));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(MAX));
  });

  it("keeps the bound across two rapid picks", async () => {
    render(<Harness />, { wrapper: Wrapper });
    pick(4);
    pick(4);
    await waitFor(() => expect(document.querySelectorAll("img").length).toBe(MAX));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(MAX));
  });

  it("clamps the append against the committed array even when a pick slips past the reservation", async () => {
    const updaters: Array<(prev: PhotoUpload[]) => PhotoUpload[]> = [];
    const onChange = vi.fn((action: React.SetStateAction<PhotoUpload[]>) => {
      if (typeof action === "function") {
        updaters.push(action as (prev: PhotoUpload[]) => PhotoUpload[]);
      }
    });
    render(
      <CheckinPhotos photos={[]} onChange={onChange} maxPhotos={MAX} deferUpload />,
      { wrapper: Wrapper },
    );

    pick(4);
    pick(4);

    let photos: PhotoUpload[] = [];
    for (const apply of updaters) photos = apply(photos);
    expect(photos.length).toBeLessThanOrEqual(MAX);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("revokes object URLs of entries the clamp drops", () => {
    const updaters: Array<(prev: PhotoUpload[]) => PhotoUpload[]> = [];
    const onChange = vi.fn((action: React.SetStateAction<PhotoUpload[]>) => {
      if (typeof action === "function") {
        updaters.push(action as (prev: PhotoUpload[]) => PhotoUpload[]);
      }
    });
    render(
      <CheckinPhotos photos={[]} onChange={onChange} maxPhotos={MAX} deferUpload />,
      { wrapper: Wrapper },
    );

    pick(4);
    expect(updaters).toHaveLength(1);

    const full = Array.from({ length: MAX }, (_, i) => ({
      id: `ext-${i}`,
      previewUrl: `blob:ext-${i}`,
      status: "done" as const,
    }));
    const next = updaters[0](full);
    expect(next).toBe(full);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it("does not upload entries dropped by the capacity clamp (BRAWUKA-579)", async () => {
    const existing: PhotoUpload[] = Array.from({ length: 5 }, (_, i) => ({
      id: `existing-${i}`,
      previewUrl: `blob:existing-${i}`,
      status: "done" as const,
    }));

    const onChange = vi.fn((action: React.SetStateAction<PhotoUpload[]>) => {
      if (typeof action === "function") {
        return (action as (prev: PhotoUpload[]) => PhotoUpload[])(existing);
      }
      return action;
    });

    render(
      <CheckinPhotos photos={[]} onChange={onChange} maxPhotos={MAX} />,
      { wrapper: Wrapper },
    );

    pick(4);

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it("does not upload any entries when the capacity clamp drops all picked items (BRAWUKA-579)", async () => {
    const full: PhotoUpload[] = Array.from({ length: MAX }, (_, i) => ({
      id: `existing-${i}`,
      previewUrl: `blob:existing-${i}`,
      status: "done" as const,
    }));

    const onChange = vi.fn((action: React.SetStateAction<PhotoUpload[]>) => {
      if (typeof action === "function") {
        return (action as (prev: PhotoUpload[]) => PhotoUpload[])(full);
      }
      return action;
    });

    render(
      <CheckinPhotos photos={[]} onChange={onChange} maxPhotos={MAX} />,
      { wrapper: Wrapper },
    );

    pick(3);

    await waitFor(() => {
      expect(uploadPhoto).not.toHaveBeenCalled();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it("restores committedCountRef in deferUpload mode when clamp drops all picked items (BRAWUKA-672)", async () => {
    const full: PhotoUpload[] = Array.from({ length: MAX }, (_, i) => ({
      id: `existing-${i}`,
      previewUrl: `blob:existing-${i}`,
      status: "staged" as const,
    }));

    let simulateDropAll = true;
    const onChange = vi.fn((action: React.SetStateAction<PhotoUpload[]>) => {
      if (typeof action === "function") {
        if (simulateDropAll) {
          // Drops all entries because prev is full
          return (action as (prev: PhotoUpload[]) => PhotoUpload[])(full);
        }
        return (action as (prev: PhotoUpload[]) => PhotoUpload[])([]);
      }
      return action;
    });

    render(
      <CheckinPhotos photos={[]} onChange={onChange} maxPhotos={MAX} deferUpload />,
      { wrapper: Wrapper },
    );

    // Pick MAX (6) photos. The clamp drops everything because prev is full.
    pick(MAX);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    // Now permit the subsequent pick
    simulateDropAll = false;

    // Pick 3 photos.
    // If committedCountRef was permanently inflated by 6, room would be 0 and handleFiles would return early.
    // With BRAWUKA-672 fix, committedCountRef was decremented by 6, so room is 6.
    pick(3);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });
  });

  it("restores committedCountRef in deferUpload mode when clamp drops partial items (BRAWUKA-672)", async () => {
    // 4 existing items in prev, leaving 2 slots
    const partial: PhotoUpload[] = Array.from({ length: 4 }, (_, i) => ({
      id: `existing-${i}`,
      previewUrl: `blob:existing-${i}`,
      status: "staged" as const,
    }));

    let currentArray = partial;
    const onChange = vi.fn((action: React.SetStateAction<PhotoUpload[]>) => {
      if (typeof action === "function") {
        const next = (action as (prev: PhotoUpload[]) => PhotoUpload[])(currentArray);
        currentArray = next;
        return next;
      }
      return action;
    });

    render(
      <CheckinPhotos photos={[]} onChange={onChange} maxPhotos={MAX} deferUpload />,
      { wrapper: Wrapper },
    );

    // Pick 4 photos. Since prev has 4, only 2 are kept and 2 are dropped.
    pick(4);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    // currentArray now has 6 photos (4 original + 2 kept)
    expect(currentArray).toHaveLength(MAX);

    // committedCountRef was 0 + 4, then adjusted -2 => committedCountRef is 2.
    // If committedCountRef was NOT adjusted, it would stay 4, leaving room for only 2 items.
    // With BRAWUKA-672 fix, room is 6 - 2 = 4 items.
    // Let's reset currentArray to empty and pick 4 items:
    currentArray = [];
    let secondPickCount = 0;
    onChange.mockImplementation((action: React.SetStateAction<PhotoUpload[]>) => {
      if (typeof action === "function") {
        const next = (action as (prev: PhotoUpload[]) => PhotoUpload[])([]);
        secondPickCount = next.length;
        return next;
      }
      return action;
    });

    pick(4);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(secondPickCount).toBe(4);
    });
  });
});
