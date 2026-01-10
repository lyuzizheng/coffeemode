import createFromGoogleMap from "@/assets/create_from_googlemap.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { useResolvePlace } from "@/hooks/googleMaps/useResolvePlace";
import { useLinkPreview } from "@/hooks/useLinkPreview";
import { cn } from "@/lib/utils";
import { extractPlaceTitleFromUrl } from "@/services/googleMaps";
import { ResolvePlaceResponseDto } from "@/types/googleMaps";
import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste, PlusCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface CreateCafeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CreateCafeModal = ({ open, onOpenChange }: CreateCafeModalProps) => {
  const [gmapsUrl, setGmapsUrl] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [selectedOption, setSelectedOption] = useState<
    "google-maps" | "manual" | null
  >(null);
  const [hoveredOption, setHoveredOption] = useState<
    "google-maps" | "manual" | null
  >(null);

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
      // Close modal shortly after success
      setTimeout(() => onOpenChange(false), 1200);
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
      setSelectedOption("google-maps");
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

  const handleBackToOptions = () => {
    setSelectedOption(null);
    setGmapsUrl("");
    setStatusMessage("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <Toaster position="top-right" />
        <DialogHeader>
          <DialogTitle className="text-xl md:text-2xl font-bold text-center">
            Create New Cafe
          </DialogTitle>
        </DialogHeader>

        {!selectedOption ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-8">
            {/* Google Maps Option - Hero Style */}
            <Card
              className={cn(
                "p-4 sm:p-8 md:p-10 cursor-pointer transition-all duration-300 hover:shadow-2xl hover:scale-105",
                "border-2 hover:border-primary flex flex-col justify-between",
                hoveredOption && hoveredOption !== "google-maps" && "opacity-40"
              )}
              onClick={() => setSelectedOption("google-maps")}
              onMouseEnter={() => setHoveredOption("google-maps")}
              onMouseLeave={() => setHoveredOption(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedOption("google-maps");
                }
              }}
              tabIndex={0}
              aria-label="Create cafe from Google Maps link"
            >
              <div className="flex flex-col items-center text-center space-y-6 flex-1 justify-center">
                <div className="w-40 h-40 sm:w-64 sm:h-64 md:w-72 md:h-72 rounded-xl overflow-hidden bg-muted flex items-center justify-center shadow-lg">
                  <img
                    src={createFromGoogleMap}
                    alt="Create from Google Maps"
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <h3 className="text-xl md:text-2xl font-bold text-foreground">
                      Import from Google Maps
                    </h3>
                    <Badge variant="secondary" className="ml-1">
                      Recommended
                    </Badge>
                  </div>
                  <p className="text-sm md:text-base text-muted-foreground max-w-xs">
                    Paste a Google Maps share link to automatically fetch cafe
                    information
                  </p>
                </div>
              </div>

              <div className="space-y-3 mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePasteFromClipboard();
                  }}
                  className="w-full border-primary/20 hover:border-primary/40"
                  aria-label="Paste Google Maps link directly"
                >
                  <ClipboardPaste className="w-4 h-4 mr-2" />
                  Paste Link
                </Button>
              </div>
            </Card>

            {/* Manual Creation Option - Hero Style */}
            <Card
              className={cn(
                "p-4 sm:p-8 md:p-10 cursor-pointer transition-all duration-300 hover:shadow-2xl hover:scale-105",
                "border-2 hover:border-primary flex flex-col justify-between",
                hoveredOption && hoveredOption !== "manual" && "opacity-40"
              )}
              onClick={() => setSelectedOption("manual")}
              onMouseEnter={() => setHoveredOption("manual")}
              onMouseLeave={() => setHoveredOption(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedOption("manual");
                }
              }}
              tabIndex={0}
              aria-label="Create cafe manually"
            >
              <div className="flex flex-col items-center text-center space-y-6 flex-1 justify-center">
                <div className="w-40 h-40 sm:w-64 sm:h-64 md:w-72 md:h-72 bg-muted rounded-xl flex items-center justify-center shadow-lg">
                  <PlusCircle className="w-16 h-16 sm:w-28 sm:h-28 text-muted-foreground" />
                </div>

                <div className="space-y-3">
                  <h3 className="text-xl md:text-2xl font-bold text-foreground">
                    Create Manually
                  </h3>
                  <p className="text-sm md:text-base text-muted-foreground max-w-xs">
                    Enter cafe information manually from scratch
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <div className="bg-muted text-muted-foreground px-4 py-2 rounded-full text-xs font-medium text-center">
                  Coming Soon
                </div>
              </div>
            </Card>
          </div>
        ) : selectedOption === "google-maps" ? (
          <div className="space-y-6">
            <Button
              variant="ghost"
              onClick={handleBackToOptions}
              className="px-0 hover:bg-transparent hover:underline -ml-2"
            >
              ← Back to Options
            </Button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 items-start">
              {/* Input and Actions - Moved to Left */}
              <div className="space-y-6 order-2 md:order-1">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold tracking-tight">
                    Paste Google Maps Link
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Go to Google Maps, find your cafe, click "Share", and paste
                    the link here.
                    <br />
                    Supports{" "}
                    <span className="font-mono text-xs bg-muted px-1 rounded">
                      maps.google.com
                    </span>{" "}
                    or{" "}
                    <span className="font-mono text-xs bg-muted px-1 rounded">
                      maps.app.goo.gl
                    </span>
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={gmapsUrl}
                      onChange={(e) => setGmapsUrl(e.target.value.trim())}
                      placeholder="https://maps.app.goo.gl/..."
                      aria-label="Google Maps link input"
                      className="flex-1"
                      autoFocus
                    />
                    <Button
                      onClick={handlePasteFromClipboard}
                      variant="outline"
                      size="icon"
                      aria-label="Paste from clipboard"
                      title="Paste from clipboard"
                    >
                      <ClipboardPaste className="w-4 h-4" />
                    </Button>
                  </div>

                  <Button
                    onClick={handleResolveClick}
                    aria-label="Parse and create"
                    className="w-full sm:w-auto min-w-[140px]"
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
              <div className="space-y-3 order-1 md:order-2">
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider text-xs">
                  Preview
                </div>
                <div className="w-full aspect-video md:aspect-square rounded-xl border bg-muted/50 flex items-center justify-center p-4 overflow-hidden relative group">
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
          </div>
        ) : (
          // Manual creation placeholder
          <div className="text-center py-8">
            <Button
              variant="ghost"
              onClick={handleBackToOptions}
              className="mb-4"
            >
              ← Back to Options
            </Button>
            <div className="space-y-4">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
                <PlusCircle className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold">Manual Creation</h3>
              <p className="text-muted-foreground">
                This feature is under development, coming soon!
              </p>
              <p className="text-sm text-muted-foreground">
                You can use Google Maps import to create cafes for now.
              </p>
            </div>
          </div>
        )}

        {/* Status message */}
        {statusMessage && (
          <div
            className="mt-4 text-sm text-primary text-center"
            aria-live="polite"
          >
            {statusMessage}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateCafeModal;
