import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { useState } from "react";
import { CreateOptions } from "./CreateOptions";
import { GoogleMapsImport } from "./GoogleMapsImport";
import { ManualCreation } from "./ManualCreation";

interface CreateCafeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CreateCafeModal = ({ open, onOpenChange }: CreateCafeModalProps) => {
  const [selectedOption, setSelectedOption] = useState<
    "google-maps" | "manual" | null
  >(null);
  const [pastedLink, setPastedLink] = useState<string>("");

  const handleBackToOptions = () => {
    setSelectedOption(null);
    setPastedLink("");
  };

  const handlePasteLink = (link: string) => {
    setPastedLink(link);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] h-[90vh] md:h-auto overflow-hidden p-0 gap-0 flex flex-col">
        <Toaster position="top-right" />
        <DialogHeader className="p-4 sm:p-6 pb-2 sm:pb-4 shrink-0">
          <DialogTitle className="text-xl md:text-2xl font-bold text-center">
            Create New Cafe
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pt-0">
          {!selectedOption ? (
            <CreateOptions
              onSelect={setSelectedOption}
              onPasteLink={handlePasteLink}
            />
          ) : selectedOption === "google-maps" ? (
            <GoogleMapsImport
              onBack={handleBackToOptions}
              onSuccess={() => onOpenChange(false)}
              initialUrl={pastedLink}
            />
          ) : (
            <ManualCreation onBack={handleBackToOptions} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateCafeModal;
