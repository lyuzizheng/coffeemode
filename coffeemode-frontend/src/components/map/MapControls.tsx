import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Crosshair, Minus, Plus } from "lucide-react";

interface MapControlsProps {
  className?: string;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onLocateUser?: () => void;
}

const MapControls = ({
  className,
  onZoomIn,
  onZoomOut,
  onLocateUser,
}: MapControlsProps) => {
  const handleZoomIn = () => {
    // TODO: Implement map zoom in logic
    onZoomIn?.();
    console.log("Zoom In clicked");
  };

  const handleZoomOut = () => {
    // TODO: Implement map zoom out logic
    onZoomOut?.();
    console.log("Zoom Out clicked");
  };

  const handleLocate = () => {
    // TODO: Implement map locate user logic
    onLocateUser?.();
    console.log("Locate User clicked");
  };

  return (
    <div className={cn("flex flex-col space-y-2", className)}>
      <Button
        variant="outline"
        size="icon"
        className="bg-card p-2 rounded-full shadow-md hover:bg-accent h-10 w-10"
        onClick={handleZoomIn}
        aria-label="Zoom in"
      >
        <Plus className="w-5 h-5 text-foreground" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="bg-card p-2 rounded-full shadow-md hover:bg-accent h-10 w-10"
        onClick={handleZoomOut}
        aria-label="Zoom out"
      >
        <Minus className="w-5 h-5 text-foreground" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="bg-card p-2 rounded-full shadow-md hover:bg-accent h-10 w-10"
        onClick={handleLocate}
        aria-label="Locate me"
      >
        <Crosshair className="w-5 h-5 text-foreground" />
      </Button>
    </div>
  );
};

export default MapControls;
