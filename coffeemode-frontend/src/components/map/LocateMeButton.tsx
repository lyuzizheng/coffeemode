import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LocateFixed } from "lucide-react";

interface LocateMeButtonProps {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}

const LocateMeButton = ({
  onClick,
  className,
  disabled = false,
}: LocateMeButtonProps) => {
  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn(
        "rounded-full h-10 w-10 shadow-md border border-border", // Added shadow and border for visibility
        className
      )}
      onClick={onClick}
      aria-label="Center map on my location"
      disabled={disabled}
    >
      <LocateFixed className="w-5 h-5" />
    </Button>
  );
};

export default LocateMeButton;
