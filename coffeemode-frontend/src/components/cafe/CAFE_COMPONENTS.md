# Cafe Components Documentation

Components for displaying cafe information, cards, and interactive cafe-related UI elements.

## Components Overview

### 🏪 CafeCard
**File**: `CafeCard.tsx`
**Purpose**: Individual cafe display card with image, details, rating, and amenities

#### Props Interface
```typescript
interface CafeCardProps {
  cafe: CafeData;
  className?: string;
}

interface CafeData {
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

type PriceRange = "$" | "$$" | "$$$" | "Free" | "Unknown";
type OpenStatus = "Open" | "Closed" | "Opening Soon" | "Closing Soon";
type AmenityStatus = "available" | "limited" | "unavailable" | "unknown";
```

#### Features
- **Interactive Elements**: Clickable card with favorite toggle button
- **Visual Indicators**: Status badges with color coding
- **Amenity Display**: Up to 4 amenity icons with tooltips
- **Responsive Design**: Fixed width (w-72) with hover effects
- **Accessibility**: ARIA labels, keyboard navigation, screen reader support

#### Usage Example
```tsx
import { CafeCard } from '@/components/cafe';

const cafeData: CafeData = {
  id: "1",
  name: "Artisan Coffee Lab",
  imageUrl: "/images/cafe1.jpg",
  distance: 0.7,
  priceRange: "$$",
  rating: 4.7,
  isOpen: true,
  openStatusLabel: "Open",
  isFavorite: false,
  amenities: [/* amenity objects */]
};

<CafeCard cafe={cafeData} className="mb-4" />
```

#### Event Handlers
- `handleCardClick()`: Navigate to cafe detail page (TODO: Implementation needed)
- `handleFavoriteClick(e)`: Toggle favorite status (TODO: Implementation needed)

#### Styling Features
- **Status Colors**: Dynamic badge colors based on open status
- **Hover Effects**: Scale transform and shadow enhancement
- **Amenity Icons**: Color-coded based on availability status
- **Image Handling**: Lazy loading with fallback placeholder

#### TODO Items
- Implement favorite toggle logic with state management
- Add navigation to cafe detail page
- Replace placeholder images with actual cafe images
- Add more nuanced amenity status styling
- Implement image error handling

---

### 🎠 CafeCarousel
**File**: `CafeCarousel.tsx`
**Purpose**: Horizontal scrollable container for multiple cafe cards

#### Props Interface
```typescript
interface CafeCarouselProps {
  className?: string;
}
```

#### Features
- **Horizontal Scroll**: Native overflow-x-auto with hidden scrollbar
- **Mock Data**: Currently uses hardcoded cafe data for development
- **Responsive Layout**: Flexible spacing with proper card alignment
- **Empty State**: Graceful handling when no cafes are available

#### Usage Example
```tsx
import { CafeCarousel } from '@/components/cafe';

<CafeCarousel className="mb-6" />
```

#### Mock Data Structure
Currently includes 5 sample cafes with varied:
- Price ranges (Free, $, $$, $$$)
- Open statuses (Open, Closed)
- Amenity combinations (Wi-Fi, Power, Noise levels)
- Ratings and distances

#### Styling Features
- **Scrollbar Hidden**: Uses `scrollbar-hide` utility class
- **Card Spacing**: Consistent 4-unit spacing between cards
- **Overflow Handling**: Smooth horizontal scrolling

#### TODO Items
- Replace mock data with Tanstack Query data fetching
- Add loading state component
- Implement proper empty state message
- Consider using Shadcn ScrollArea for better control
- Add scroll indicators or navigation arrows
- Implement infinite scroll or pagination

---

## Type Definitions

### Amenity Interface
```typescript
interface Amenity {
  icon: React.ElementType; // Lucide icon component
  status: AmenityStatus;
  label: string;
  colorClass: string; // Tailwind background class
}
```

### Common Amenity Icons
- `Wifi`: Wi-Fi availability
- `PlugZap`: Power outlet availability
- `Volume1/Volume2`: Noise level indicators
- `Coffee`: Coffee quality/availability
- `Droplet`: Water station availability
- `Zap`: Fast internet indicator

## Design Patterns

### Color Coding System
- **Green**: Available/Good (bg-green-100, text-green-600)
- **Yellow**: Limited/Moderate (bg-yellow-100, text-yellow-600)
- **Red**: Unavailable/Poor (bg-red-100, text-red-600)
- **Gray**: Unknown/Neutral (bg-gray-100, text-gray-400)

### Status Badge Colors
- **Open**: Green background (bg-green-100 text-green-800)
- **Closed**: Red background (bg-red-100 text-red-800)
- **Opening Soon**: Yellow background (bg-yellow-100 text-yellow-800)
- **Closing Soon**: Orange background (bg-orange-100 text-orange-800)

## Accessibility Features

### CafeCard Accessibility
- **Role**: `button` for interactive card
- **ARIA Labels**: Descriptive labels for all interactive elements
- **Keyboard Navigation**: Enter key support for card activation
- **Screen Reader**: Proper alt text for images
- **Focus Management**: Visible focus indicators

### Tooltip Accessibility
- **Delay Duration**: 200ms for better UX
- **Keyboard Accessible**: Works with keyboard navigation
- **Screen Reader**: Proper content description

## Performance Considerations

### Image Optimization
- **Lazy Loading**: Images load only when visible
- **Placeholder**: Consistent placeholder during loading
- **Alt Text**: Descriptive alt text for accessibility

### Component Optimization
- **React.memo**: Consider memoizing CafeCard for large lists
- **Key Props**: Proper key usage in map operations
- **Event Handler Optimization**: Prevent unnecessary re-renders

## Integration Guidelines

### State Management
- **Favorite Status**: Should integrate with global user preferences
- **Navigation**: Should work with React Router or Next.js routing
- **Data Fetching**: Should integrate with Tanstack Query

### API Integration
```typescript
// Expected API response structure
interface CafeApiResponse {
  cafes: CafeData[];
  total: number;
  hasMore: boolean;
}
```

### Error Handling
- **Image Errors**: Fallback to placeholder image
- **Data Errors**: Graceful degradation with default values
- **Network Errors**: Show appropriate error states

## Future Enhancements

1. **Advanced Filtering**: Filter by amenities, price range, rating
2. **Sorting Options**: Sort by distance, rating, price
3. **Infinite Scroll**: Load more cafes as user scrolls
4. **Favorites Management**: Persistent favorite state
5. **Detailed View**: Modal or page for cafe details
6. **Reviews Integration**: Show recent reviews and ratings
7. **Real-time Data**: Live updates for open status
8. **Geolocation**: Distance calculation from user location