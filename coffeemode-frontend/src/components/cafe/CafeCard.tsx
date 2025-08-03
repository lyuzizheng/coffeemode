import { cn } from "@/lib/utils";
import { Amenity } from "@/types/cafe";
import { Heart, Star } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

// Define types directly here for now, will refactor later
export type AmenityStatus = "available" | "limited" | "unavailable" | "unknown";
export type PriceRange = "$" | "$$" | "$$$" | "Free" | "Unknown";
export type OpenStatus = "Open" | "Closed" | "Opening Soon" | "Closing Soon";

export interface CafeData {
  id: string;
  name: string;
  imageUrl: string;
  distance: number;
  priceRange: PriceRange;
  rating: number;
  isOpen: boolean;
  openStatusLabel: OpenStatus;
  isFavorite: boolean;
  amenities: Amenity[];
}

interface CafeCardProps {
  cafe: CafeData;
  className?: string;
}

const CafeCard = ({ cafe, className }: CafeCardProps) => {
  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click when clicking favorite
    // TODO: Implement favorite toggle logic
    console.log("Toggle favorite for:", cafe.id);
  };

  const handleCardClick = () => {
    // TODO: Implement navigation to cafe detail page or open detail view
    console.log("Card clicked:", cafe.id);
  };

  const getStatusColor = (status: OpenStatus) => {
    switch (status) {
      case "Open":
        return "bg-green-100 text-green-800";
      case "Closed":
        return "bg-red-100 text-red-800";
      case "Opening Soon":
        return "bg-yellow-100 text-yellow-800";
      case "Closing Soon":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div
      className={cn(
        "flex-shrink-0 w-72 bg-card rounded-lg shadow-md cursor-pointer transform transition hover:scale-[1.03] hover:shadow-lg",
        className
      )}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${cafe.name}`}
      onKeyDown={(e) => e.key === "Enter" && handleCardClick()}
    >
      <div className="relative h-32 rounded-t-lg overflow-hidden">
        {/* TODO: Replace with actual image component if needed */}
        <img
          // src={cafe.imageUrl || '/api/placeholder/400/320'} // Use actual image URL
          src={"/api/placeholder/400/320"}
          alt={`Image of ${cafe.name}`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 bg-white/80 hover:bg-white rounded-full h-8 w-8 shadow"
          onClick={handleFavoriteClick}
          aria-label={
            cafe.isFavorite ? "Remove from favorites" : "Add to favorites"
          }
        >
          <Heart
            className={cn(
              "w-4 h-4",
              cafe.isFavorite ? "text-red-500 fill-red-500" : "text-gray-600"
            )}
          />
        </Button>
      </div>
      <div className="p-3">
        <div className="flex justify-between items-start mb-1">
          <h3 className="font-semibold text-sm text-card-foreground truncate mr-2">
            {cafe.name}
          </h3>
          <Badge
            variant="outline"
            className={cn(
              "text-xs px-2 py-0.5 whitespace-nowrap",
              getStatusColor(cafe.openStatusLabel)
            )}
          >
            {cafe.openStatusLabel}
          </Badge>
        </div>
        <p className="text-gray-500 text-xs mb-2">
          {cafe.distance}km away · {cafe.priceRange}
        </p>
        <div className="flex items-center">
          {/* Rating */}
          <div className="flex items-center mr-2">
            <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-400 mr-0.5" />
            <span className="text-xs font-medium">
              {cafe.rating.toFixed(1)}
            </span>
          </div>

          {/* Amenities */}
          <div className="flex space-x-1.5 overflow-hidden">
            <TooltipProvider delayDuration={200}>
              {cafe.amenities.slice(0, 4).map((amenity, index) => {
                // Show max 4 icons
                const IconComponent = amenity.icon;
                // TODO: Define more nuanced color/styles based on status
                const iconColor =
                  amenity.status === "available"
                    ? "text-green-600"
                    : "text-gray-400";
                const bgColor =
                  amenity.status === "available"
                    ? "bg-green-100"
                    : "bg-gray-100";
                return (
                  <Tooltip key={index}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "rounded-full p-1 w-5 h-5 flex items-center justify-center",
                          amenity.colorClass || bgColor // Use provided color or default
                        )}
                      >
                        <IconComponent className={cn("w-3 h-3", iconColor)} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">
                        {amenity.label}:{" "}
                        <span className="capitalize">{amenity.status}</span>
                      </p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </TooltipProvider>
            {cafe.amenities.length > 4 && (
              <div className="text-xs text-gray-400 self-center ml-1">...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CafeCard;
