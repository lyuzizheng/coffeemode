# Layout Components Documentation

Components for application layout, navigation, and structural UI elements.

## Components Overview

### 🎯 Header
**File**: `Header.tsx`
**Purpose**: Main application header with branding, search, and user controls

#### Props Interface
```typescript
interface HeaderProps {
  className?: string;
}
```

#### Features
- **Responsive Design**: Adapts to different screen sizes with smart hiding/showing
- **Search Functionality**: Prominent search bar with icon
- **User Controls**: Filter, favorites, and login/profile buttons
- **Brand Identity**: Coffee Mode logo and branding
- **Absolute Positioning**: Overlays on top of map content

#### Layout Structure
```
┌─────────────────────────────────────────────────────────────┐
│ [Logo] ──────── [Search Bar] ──────── [Filter][♥][Profile] │
└─────────────────────────────────────────────────────────────┘
```

#### Usage Example
```tsx
import { Header } from '@/components/layout';

<Header className="custom-header-styles" />
```

#### Component Sections

##### 1. Logo and Brand Section
- **Visibility**: Hidden on small screens (`hidden sm:flex`)
- **Styling**: Semi-transparent background with shadow
- **Content**: Coffee icon + "Coffee Mode" text
- **Colors**: Uses custom coffee color palette

##### 2. Search Bar Section
- **Layout**: Flexible with max-width constraint
- **Icon**: Search icon positioned absolutely
- **Input**: Shadcn Input component with left padding
- **Placeholder**: "Find a place to work..."
- **Accessibility**: Proper aria-label

##### 3. User Controls Section
- **Filter Button**: Secondary variant with Filter icon
- **Favorites Button**: Secondary variant with Heart icon
- **Profile Button**: Default variant with conditional content
- **Responsive**: Maintains visibility across screen sizes

#### Event Handlers
```typescript
const handleFilterClick = () => {
  // TODO: Implement filter panel toggle/logic
  console.log("Filter button clicked");
};

const handleFavoritesClick = () => {
  // TODO: Implement navigation to favorites page
  console.log("Favorites button clicked");
};

const handleLoginClick = () => {
  // TODO: Implement login/profile modal or navigation
  console.log("Login/Profile button clicked");
};
```

#### Authentication States
- **Logged Out**: Shows UserCircle icon
- **Logged In**: Shows Avatar with user initials/image
- **User Data**: Currently uses mock data (TODO: Real authentication)

#### Styling Features
- **Z-Index**: High z-index (z-50) for overlay positioning
- **Background**: Semi-transparent card backgrounds
- **Shadows**: Consistent shadow system
- **Spacing**: Responsive gap system (gap-2 md:gap-4)
- **Border Radius**: Consistent rounded corners

#### TODO Items
- Implement filter panel toggle/logic
- Add navigation to favorites page or modal
- Implement login/profile modal or navigation
- Connect to real authentication system
- Add search functionality with API integration
- Implement responsive search behavior
- Add keyboard shortcuts for search

---

### ➕ AddPlaceButton
**File**: `AddPlaceButton.tsx`
**Purpose**: Floating action button for adding new places to the platform

#### Props Interface
```typescript
interface AddPlaceButtonProps {
  className?: string;
  onClick?: () => void;
}
```

#### Features
- **Floating Design**: Circular button with prominent styling
- **Coffee Theme**: Uses coffee color palette
- **Hover Effects**: Scale transform and enhanced shadow
- **Accessibility**: Proper ARIA label and keyboard support
- **Customizable**: Optional click handler and styling

#### Usage Example
```tsx
import { AddPlaceButton } from '@/components/layout';

const handleAddPlace = () => {
  // Open add place modal or navigate to form
};

<AddPlaceButton 
  onClick={handleAddPlace}
  className="fixed bottom-6 right-6"
/>
```

#### Design Specifications
- **Size**: 48px × 48px (h-12 w-12)
- **Shape**: Perfect circle (rounded-full)
- **Colors**: Coffee-600 background, white text
- **Icon**: Plus icon (6×6 units)
- **Shadow**: Large shadow for floating effect

#### Event Handling
```typescript
const handleClick = () => {
  // TODO: Implement logic to open 'add place' modal or form
  onClick?.(); // Call optional prop handler
  console.log("Add Place button clicked");
};
```

#### Styling Features
- **Base Colors**: `bg-coffee-600 hover:bg-coffee-700`
- **Transform**: `hover:scale-105` for interactive feedback
- **Shadow**: `shadow-lg` for depth perception
- **Transition**: Smooth transitions for all properties
- **Padding**: `p-3` for proper icon spacing

#### Accessibility Features
- **ARIA Label**: "Add new place" for screen readers
- **Keyboard Support**: Standard button keyboard interaction
- **Focus Indicators**: Visible focus states
- **Color Contrast**: High contrast for visibility

#### TODO Items
- Implement add place modal or form
- Connect to place submission API
- Add form validation for new places
- Implement image upload functionality
- Add success/error feedback states
- Consider permission checks for adding places

---

## Layout Patterns

### Positioning Strategy
- **Header**: Absolute positioning with top/left/right constraints
- **AddPlaceButton**: Typically positioned fixed in bottom-right corner
- **Z-Index Management**: Header uses z-50 for proper layering

### Responsive Behavior

#### Header Responsiveness
```css
/* Small screens */
.header {
  gap: 0.5rem; /* gap-2 */
}

/* Medium screens and up */
@media (min-width: 768px) {
  .header {
    gap: 1rem; /* md:gap-4 */
  }
}
```

#### Brand Visibility
- **Mobile**: Logo hidden to save space
- **Tablet+**: Logo visible with full branding

### Color System

#### Coffee Theme Colors
```css
:root {
  --coffee-600: /* Primary coffee color */;
  --coffee-700: /* Darker coffee color */;
  --coffee-800: /* Text coffee color */;
}
```

#### Background Treatments
- **Semi-transparent**: `bg-opacity-95` for overlay effects
- **Card Backgrounds**: `bg-card` for consistent theming
- **Shadow System**: Consistent shadow depths

## Integration Guidelines

### State Management
- **Authentication**: Should connect to auth context/store
- **Search State**: Should manage search query and results
- **Filter State**: Should manage active filters
- **Navigation**: Should integrate with routing system

### API Integration
```typescript
// Search API integration
interface SearchParams {
  query: string;
  location?: LatLngLiteral;
  filters?: FilterOptions;
}

// Add place API integration
interface NewPlaceData {
  name: string;
  location: LatLngLiteral;
  amenities: string[];
  images?: File[];
}
```

### Event System
```typescript
// Global event handlers that components should use
interface LayoutEventHandlers {
  onSearch: (query: string) => void;
  onFilterToggle: () => void;
  onFavoritesView: () => void;
  onProfileAction: () => void;
  onAddPlace: () => void;
}
```

## Accessibility Standards

### Keyboard Navigation
- **Tab Order**: Logical tab sequence through controls
- **Enter/Space**: Activate buttons and controls
- **Escape**: Close modals and overlays
- **Arrow Keys**: Navigate through search results

### Screen Reader Support
- **Landmarks**: Proper header landmark
- **Labels**: Descriptive ARIA labels for all controls
- **Live Regions**: Announce search results and status changes
- **Skip Links**: Allow skipping to main content

### Focus Management
- **Visible Indicators**: Clear focus outlines
- **Focus Trapping**: In modals and overlays
- **Initial Focus**: Proper focus on modal open
- **Return Focus**: Restore focus on modal close

## Performance Considerations

### Search Optimization
- **Debouncing**: Delay API calls during typing
- **Caching**: Cache recent search results
- **Lazy Loading**: Load search results progressively

### Component Optimization
- **Memoization**: Use React.memo for stable props
- **Callback Optimization**: Use useCallback for event handlers
- **Bundle Splitting**: Lazy load heavy components

## Future Enhancements

### Header Enhancements
1. **Advanced Search**: Autocomplete, suggestions, recent searches
2. **Voice Search**: Speech-to-text integration
3. **Search Filters**: Quick filter chips in search bar
4. **Notifications**: Bell icon with notification count
5. **Theme Toggle**: Dark/light mode switcher
6. **Language Selector**: Multi-language support

### AddPlaceButton Enhancements
1. **Multi-step Form**: Wizard-style place addition
2. **Image Upload**: Drag-and-drop image handling
3. **Location Picker**: Interactive map for location selection
4. **Validation**: Real-time form validation
5. **Progress Indicator**: Show submission progress
6. **Success Animation**: Celebratory feedback on success

### Layout System
1. **Sidebar Navigation**: Collapsible side navigation
2. **Breadcrumbs**: Navigation breadcrumb system
3. **Footer**: Informational footer component
4. **Loading States**: Skeleton loading for all components
5. **Error Boundaries**: Graceful error handling
6. **Offline Support**: Offline-first functionality