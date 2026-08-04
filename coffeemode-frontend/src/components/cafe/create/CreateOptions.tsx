import createFromGoogleMap from "@/assets/create_from_googlemap.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ClipboardPaste, PlusCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface CreateOptionsProps {
  onSelect: (option: "google-maps" | "manual") => void;
  onPasteLink: (link: string) => void;
}

export const CreateOptions = ({
  onSelect,
  onPasteLink,
}: CreateOptionsProps) => {
  const [hoveredOption, setHoveredOption] = useState<
    "google-maps" | "manual" | null
  >(null);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pasted = text?.trim();
      if (!pasted) return;

      const isMapsLink =
        /^(https?:\/\/)?(maps\.google\.com|maps\.app\.goo\.gl)/i.test(pasted);

      if (isMapsLink) {
        onPasteLink(pasted);
        onSelect("google-maps");
        toast.success("Link pasted successfully", { position: "top-right" });
        return;
      }

      toast.error(
        "Failed to parse link. Please paste a Google Maps share link",
        { position: "top-right" }
      );
    } catch {
      toast.error("Unable to access clipboard, please paste manually", {
        position: "top-right",
      });
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-[400px]:gap-4 md:gap-6 mt-1 min-[400px]:mt-2 md:mt-4 h-full">
      {/* Google Maps Option - Hero Style */}
      <Card
        className={cn(
          "p-3 min-[400px]:p-5 sm:p-6 md:p-10 cursor-pointer transition-all duration-300 hover:shadow-2xl hover:scale-105",
          "border-2 hover:border-primary flex flex-col justify-between min-h-[240px] min-[400px]:min-h-[280px] md:min-h-[400px]",
          hoveredOption && hoveredOption !== "google-maps" && "opacity-40"
        )}
        onClick={() => onSelect("google-maps")}
        onMouseEnter={() => setHoveredOption("google-maps")}
        onMouseLeave={() => setHoveredOption(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect("google-maps");
          }
        }}
        tabIndex={0}
        aria-label="Create cafe from Google Maps link"
      >
        <div className="flex flex-col items-center text-center space-y-3 min-[400px]:space-y-4 md:space-y-6 flex-1 justify-center py-1">
          <div className="w-24 h-24 min-[400px]:w-32 min-[400px]:h-32 sm:w-40 sm:h-40 md:w-64 md:h-64 lg:w-72 lg:h-72 rounded-xl overflow-hidden bg-muted flex items-center justify-center shadow-lg shrink-0">
            <img
              src={createFromGoogleMap}
              alt="Create from Google Maps"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="space-y-1 min-[400px]:space-y-2 md:space-y-3">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <h3 className="text-lg min-[400px]:text-xl sm:text-2xl md:text-3xl font-bold text-foreground">
                Import from Google Maps
              </h3>
              <Badge
                variant="secondary"
                className="ml-1 text-[10px] min-[400px]:text-xs sm:text-sm"
              >
                Recommended
              </Badge>
            </div>
            <p className="text-xs min-[400px]:text-sm sm:text-base md:text-lg text-muted-foreground max-w-xs mx-auto leading-tight">
              Paste a Google Maps share link to automatically fetch cafe
              information
            </p>
          </div>
        </div>

        <div className="space-y-2 mt-2 min-[400px]:mt-4 md:mt-6 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handlePasteFromClipboard();
            }}
            className="w-full border-primary/20 hover:border-primary/40 h-9 min-[400px]:h-10 sm:h-11 text-xs min-[400px]:text-sm sm:text-base"
            aria-label="Paste Google Maps link directly"
          >
            <ClipboardPaste className="w-3 h-3 min-[400px]:w-4 min-[400px]:h-4 sm:w-5 sm:h-5 mr-2" />
            Paste Link
          </Button>
        </div>
      </Card>

      {/* Manual Creation Option - Hero Style */}
      <Card
        className={cn(
          "p-3 min-[400px]:p-5 sm:p-6 md:p-10 cursor-pointer transition-all duration-300 hover:shadow-2xl hover:scale-105",
          "border-2 hover:border-primary flex flex-col justify-between h-auto min-[400px]:min-h-[200px] md:min-h-[400px]",
          hoveredOption && hoveredOption !== "manual" && "opacity-40"
        )}
        onClick={() => onSelect("manual")}
        onMouseEnter={() => setHoveredOption("manual")}
        onMouseLeave={() => setHoveredOption(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect("manual");
          }
        }}
        tabIndex={0}
        aria-label="Create cafe manually"
      >
        <div className="flex flex-col items-center text-center space-y-3 min-[400px]:space-y-4 md:space-y-6 flex-1 justify-center py-1">
          <div className="w-16 h-16 min-[400px]:w-24 min-[400px]:h-24 sm:w-40 sm:h-40 md:w-64 md:h-64 lg:w-72 lg:h-72 bg-muted rounded-xl flex items-center justify-center shadow-lg shrink-0">
            <PlusCircle className="w-8 h-8 min-[400px]:w-10 min-[400px]:h-10 sm:w-16 sm:h-16 md:w-28 md:h-28 text-muted-foreground" />
          </div>

          <div className="space-y-1 min-[400px]:space-y-2 md:space-y-3">
            <h3 className="text-lg min-[400px]:text-xl sm:text-2xl md:text-3xl font-bold text-foreground">
              Create Manually
            </h3>
            <p className="text-xs min-[400px]:text-sm sm:text-base md:text-lg text-muted-foreground max-w-xs mx-auto leading-tight">
              Enter cafe information manually from scratch
            </p>
          </div>
        </div>

        <div className="mt-2 min-[400px]:mt-4 md:mt-6 shrink-0">
          <div className="bg-muted text-muted-foreground px-3 py-1 min-[400px]:px-3 min-[400px]:py-2 sm:px-4 sm:py-2 rounded-full text-[10px] min-[400px]:text-xs sm:text-sm font-medium text-center">
            Coming Soon
          </div>
        </div>
      </Card>
    </div>
  );
};
