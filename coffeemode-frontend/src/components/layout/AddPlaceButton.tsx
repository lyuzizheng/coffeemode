import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { useState } from "react";
import CreateCafeModal from "./CreateCafeModal";

interface AddPlaceButtonProps {
  className?: string;
  onClick?: () => void;
}

const AddPlaceButton = ({ className, onClick }: AddPlaceButtonProps) => {
  const [open, setOpen] = useState<boolean>(false);
  const handleClick = () => {
    onClick?.();
    setOpen(true);
  };

  return (
    <>
      <Button
        className={cn(
          "bg-coffee-600 hover:bg-coffee-700 text-white rounded-full p-3 h-12 w-12 shadow-lg transform transition hover:scale-105",
          className
        )}
        onClick={handleClick}
        aria-label="Add new place"
      >
        <Plus className="w-6 h-6" />
      </Button>
      <CreateCafeModal open={open} onOpenChange={setOpen} />
    </>
  );
};

export default AddPlaceButton;
