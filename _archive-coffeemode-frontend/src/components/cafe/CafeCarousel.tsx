import { cn } from "@/lib/utils";
import {
  Coffee,
  Droplet,
  PlugZap,
  Volume1,
  Volume2,
  Wifi,
  Zap,
} from "lucide-react";
import CafeCard, { CafeData } from "./CafeCard";

// TODO: Replace with actual data fetching logic
const MOCK_CAFES: CafeData[] = [
  {
    id: "1",
    name: "Artisan Coffee Lab",
    imageUrl: "/api/placeholder/400/320?text=Cafe1",
    distance: 0.7,
    priceRange: "$$",
    rating: 4.7,
    isOpen: true,
    openStatusLabel: "Open",
    isFavorite: true,
    amenities: [
      {
        icon: Wifi,
        status: "available",
        label: "Wi-Fi",
        colorClass: "bg-green-100",
      },
      {
        icon: PlugZap,
        status: "available",
        label: "Power Plugs",
        colorClass: "bg-green-100",
      },
      {
        icon: Volume1,
        status: "limited",
        label: "Noise Level",
        colorClass: "bg-yellow-100",
      },
    ],
  },
  {
    id: "2",
    name: "Quiet Corner Cafe",
    imageUrl: "/api/placeholder/400/320?text=Cafe2",
    distance: 1.2,
    priceRange: "$",
    rating: 4.2,
    isOpen: true,
    openStatusLabel: "Open",
    isFavorite: false,
    amenities: [
      {
        icon: Wifi,
        status: "available",
        label: "Wi-Fi",
        colorClass: "bg-green-100",
      },
      {
        icon: PlugZap,
        status: "limited",
        label: "Power Plugs",
        colorClass: "bg-yellow-100",
      },
      {
        icon: Coffee,
        status: "available",
        label: "Coffee",
        colorClass: "bg-coffee-100",
      },
    ],
  },
  {
    id: "3",
    name: "Digital Nomad Hub",
    imageUrl: "/api/placeholder/400/320?text=Cafe3",
    distance: 0.5,
    priceRange: "$$$",
    rating: 4.9,
    isOpen: false,
    openStatusLabel: "Closed",
    isFavorite: true,
    amenities: [
      {
        icon: Wifi,
        status: "available",
        label: "Wi-Fi",
        colorClass: "bg-green-100",
      },
      {
        icon: PlugZap,
        status: "available",
        label: "Power Plugs",
        colorClass: "bg-green-100",
      },
      {
        icon: Volume2,
        status: "available",
        label: "Noise Level",
        colorClass: "bg-green-100",
      },
      {
        icon: Zap,
        status: "available",
        label: "Fast Internet",
        colorClass: "bg-blue-100",
      },
    ],
  },
  {
    id: "4",
    name: "Library Lounge",
    imageUrl: "/api/placeholder/400/320?text=Library",
    distance: 1.8,
    priceRange: "Free",
    rating: 4.5,
    isOpen: true,
    openStatusLabel: "Open",
    isFavorite: false,
    amenities: [
      {
        icon: Wifi,
        status: "available",
        label: "Wi-Fi",
        colorClass: "bg-green-100",
      },
      {
        icon: Droplet,
        status: "available",
        label: "Water Station",
        colorClass: "bg-blue-100",
      },
    ],
  },
  {
    id: "5",
    name: "Coder's Brew",
    imageUrl: "/api/placeholder/400/320?text=Cafe5",
    distance: 2.3,
    priceRange: "$$",
    rating: 4.3,
    isOpen: true,
    openStatusLabel: "Open",
    isFavorite: false,
    amenities: [
      {
        icon: Wifi,
        status: "limited",
        label: "Wi-Fi",
        colorClass: "bg-yellow-100",
      },
      {
        icon: PlugZap,
        status: "available",
        label: "Power Plugs",
        colorClass: "bg-green-100",
      },
      {
        icon: Coffee,
        status: "available",
        label: "Coffee",
        colorClass: "bg-coffee-100",
      },
    ],
  },
];

interface CafeCarouselProps {
  className?: string;
}

const CafeCarousel = ({ className }: CafeCarouselProps) => {
  // TODO: Fetch cafe data using Tanstack Query
  const cafes = MOCK_CAFES;

  if (!cafes || cafes.length === 0) {
    // TODO: Add a proper loading state or empty state message
    return null;
  }

  return (
    <div className={cn("pb-2", className)}>
      {/* Using overflow-x-auto and scrollbar-hide for simple horizontal scroll */}
      {/* Alternatively, use Shadcn ScrollArea for potentially better control/styling */}
      {/* <ScrollArea className="w-full whitespace-nowrap rounded-md"> */}
      <div className="flex w-full space-x-4 overflow-x-auto pb-2 scrollbar-hide">
        {cafes.map((cafe) => (
          <CafeCard key={cafe.id} cafe={cafe} />
        ))}
      </div>
      {/* <ScrollBar orientation="horizontal" /> */}
      {/* </ScrollArea> */}
    </div>
  );
};

export default CafeCarousel;
