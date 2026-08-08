import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

interface ManualCreationProps {
  onBack: () => void;
}

export const ManualCreation = ({ onBack }: ManualCreationProps) => {
  return (
    <div className="text-center py-8">
      <Button variant="ghost" onClick={onBack} className="mb-4">
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
  );
};
