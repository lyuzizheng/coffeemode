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



describe("CheckinPhotos maxPhotos bound (BRAWUKA-461)", () => {
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
    // Simulate the reported race: the first pick's state update has not
    // committed when the second pick runs, so both see the same headroom.
    // The functional update must re-check capacity against `prev`.
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

    // Another path filled the array between the pick and this update's
    // application: every staged entry is dropped and its URL released.
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
      // Out of 4 picked, only 1 slot was available (MAX 6 - existing 5).
      // The other 3 must be dropped without calling uploadPhoto.
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
});
