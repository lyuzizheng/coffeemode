import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useResolvePlace } from "@/hooks/googleMaps/useResolvePlace";
import { useLinkPreview } from "@/hooks/useLinkPreview";
import { extractPlaceTitleFromUrl } from "@/services/googleMaps";
import { ResolvePlaceResponseDto } from "@/types/googleMaps";
import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface GoogleMapsImportProps {
  onBack: () => void;
  onSuccess: () => void;
  initialUrl?: string;
}

export const GoogleMapsImport = ({
  onBack,
  onSuccess,
  initialUrl = "",
}: GoogleMapsImportProps) => {
  const [gmapsUrl, setGmapsUrl] = useState<string>(initialUrl);
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Update URL if initialUrl changes
  useEffect(() => {
    if (initialUrl) {
      setGmapsUrl(initialUrl);
    }
  }, [initialUrl]);

  const { resolvePlace } = useResolvePlace();
  const {
    data: previewData,
    loading: previewLoading,
    error: previewError,
  } = useLinkPreview(gmapsUrl.trim() || null);

  // Resolve Google Maps link into backend Cafe using the /resolve API.
  const resolveMutation = useMutation({
    mutationFn: async (url: string) => {
      // 1. Use preview metadata if available, otherwise fall back to title extraction
      const titleFromUrl = extractPlaceTitleFromUrl(url);
      const title = previewData?.metadata.title || titleFromUrl || "";
      const description = previewData?.metadata.description || "";
      // 2. Call backend resolve
      const res = await resolvePlace({ title, description, url });
      return res;
    },
    onSuccess: (res) => {
      const data = res.data as ResolvePlaceResponseDto | null;
      if (!data) {
        setStatusMessage("Parsed successfully, but response was empty");
        return;
      }
      setStatusMessage(
        data.skippedDetails
          ? `Already exists. Skipped details fetch: ${data.cafe.name}`
          : `Imported and created successfully: ${data.cafe.name}`
      );
      // Notify parent shortly after success
      setTimeout(onSuccess, 1200);
    },
    onError: (err: unknown) => {
      setStatusMessage(
        "Failed to create from link. Please check the URL or try again later"
      );
      console.error(err);
    },
  });

  const handleResolveClick = () => {
    if (!gmapsUrl.trim()) {
      setStatusMessage("Please paste a Google Maps link");
      return;
    }
    setStatusMessage("");
    resolveMutation.mutate(gmapsUrl.trim());
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pasted = text?.trim();
      if (!pasted) return;

      const isMapsLink =
        /^(https?:\/\/)?(maps\.google\.com|maps\.app\.goo\.gl)/i.test(pasted);

      if (isMapsLink) {
        setGmapsUrl(pasted);
        setStatusMessage("");
        toast.success("Link pasted successfully", { position: "top-right" });
        return;
      }

      setGmapsUrl("");
      setStatusMessage("");
      toast.error(
        "Failed to parse link. Please paste a Google Maps share link",
        { position: "top-right" }
      );
    } catch {
      setStatusMessage("Unable to access clipboard, please paste manually");
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 h-full flex flex-col">
      <Button
        variant="ghost"
        onClick={onBack}
        className="px-0 hover:bg-transparent hover:underline -ml-2 h-auto py-1 shrink-0 text-xs min-[400px]:text-sm"
      >
        ← Back to Options
      </Button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-12 items-start flex-1 overflow-y-auto md:overflow-visible pr-1">
        {/* Input and Actions - Moved to Left */}
        <div className="space-y-4 md:space-y-6 order-2 md:order-1 shrink-0">
          <div className="space-y-2">
            <h3 className="text-base min-[400px]:text-lg md:text-xl font-semibold tracking-tight">
              Paste Google Maps Link
            </h3>
            <p className="text-xs min-[400px]:text-sm md:text-base text-muted-foreground leading-relaxed">
              Go to Google Maps, find your cafe, click "Share", and paste the
              link here.
              <br className="hidden md:block" />
              <span className="inline-block mt-1">
                Supports{" "}
                <span className="font-mono text-[10px] min-[400px]:text-xs bg-muted px-1 rounded">
                  maps.google.com
                </span>{" "}
                or{" "}
                <span className="font-mono text-[10px] min-[400px]:text-xs bg-muted px-1 rounded">
                  maps.app.goo.gl
                </span>
              </span>
            </p>
          </div>

          <div className="space-y-3 md:space-y-4">
            <div className="flex gap-2">
              <Input
                value={gmapsUrl}
                onChange={(e) => setGmapsUrl(e.target.value.trim())}
                placeholder="https://maps.app.goo.gl/..."
                aria-label="Google Maps link input"
                className="flex-1 text-sm min-[400px]:text-base h-9 min-[400px]:h-10 md:h-11"
                autoFocus
              />
              <Button
                onClick={handlePasteFromClipboard}
                variant="outline"
                size="icon"
                aria-label="Paste from clipboard"
                title="Paste from clipboard"
                className="h-9 w-9 min-[400px]:h-10 min-[400px]:w-10 md:h-11 md:w-11 shrink-0"
              >
                <ClipboardPaste className="w-4 h-4 min-[400px]:w-5 min-[400px]:h-5" />
              </Button>
            </div>

            <Button
              onClick={handleResolveClick}
              aria-label="Parse and create"
              className="w-full sm:w-auto min-w-[120px] md:min-w-[140px] h-9 min-[400px]:h-10 md:h-11 text-sm min-[400px]:text-base"
              disabled={
                resolveMutation.isPending ||
                previewLoading ||
                !previewData ||
                !!previewError
              }
            >
              {resolveMutation.isPending ? "Parsing..." : "Create Cafe"}
            </Button>
          </div>
        </div>

        {/* Preview Panel - Moved to Right */}
        <div className="space-y-2 md:space-y-3 order-1 md:order-2 shrink-0 md:h-auto">
          <div className="text-xs min-[400px]:text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Preview
          </div>
          <div className="w-full aspect-video md:aspect-square max-h-[200px] min-[400px]:max-h-[240px] md:max-h-none rounded-xl border bg-muted/50 flex items-center justify-center p-4 overflow-hidden relative group">
            {previewLoading && (
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground animate-pulse">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                Loading preview...
              </div>
            )}
            {!previewLoading && !previewData && (
              <div className="text-sm text-muted-foreground text-center p-4">
                <div className="mb-2 text-4xl opacity-20">🗺️</div>
                Paste a valid link to see preview
              </div>
            )}
            {previewData && (
              <div className="w-full h-full flex flex-col">
                {previewData.metadata.imageUrl ? (
                  <div className="relative w-full h-full">
                    <img
                      src={previewData.metadata.imageUrl}
                      alt="Preview"
                      className="w-full h-full object-cover rounded-lg shadow-sm"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent rounded-lg" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                      <div className="font-semibold line-clamp-1">
                        {previewData.metadata.title ?? "Google Maps"}
                      </div>
                      <div className="text-xs opacity-90 line-clamp-1">
                        {previewData.metadata.siteName ?? "Google Maps"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center p-4 space-y-2">
                    {previewData.metadata.logoUrl && (
                      <img
                        src={previewData.metadata.logoUrl}
                        alt="Logo"
                        className="w-16 h-16 rounded-full shadow-sm mb-2"
                      />
                    )}
                    <div className="font-semibold text-foreground">
                      {previewData.metadata.title ?? "Google Maps"}
                    </div>
                    {previewData.metadata.description && (
                      <div className="text-xs text-muted-foreground line-clamp-3">
                        {previewData.metadata.description}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div
          className="mt-4 text-sm text-primary text-center"
          aria-live="polite"
        >
          {statusMessage}
        </div>
      )}
    </div>
  );
};
