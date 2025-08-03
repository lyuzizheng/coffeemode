# Component Documentation Index

Comprehensive documentation for all components in the CoffeeMode frontend application, organized by category and functionality.

## 📁 Documentation Structure

```
components/
├── README.md                    # Overview and guidelines
├── COMPONENT_INDEX.md          # This file - complete index
├── cafe/
│   └── CAFE_COMPONENTS.md      # Cafe-related components
├── layout/
│   └── LAYOUT_COMPONENTS.md    # Layout and navigation components
├── map/
│   └── MAP_COMPONENTS.md       # Map providers and controls
└── ui/
    └── UI_COMPONENTS.md        # Design system components
```

---

## 🏗️ Component Categories

### ☕ Cafe Components
**File**: [`cafe/CAFE_COMPONENTS.md`](./cafe/CAFE_COMPONENTS.md)

Components for displaying and interacting with cafe data:

| Component | Purpose | Key Features |
|-----------|---------|-------------|
| **CafeCard** | Individual cafe display | Rating, amenities, distance, favorites |
| **CafeCarousel** | Horizontal cafe list | Scrollable, responsive, mock data |

**Key Types**:
- `CafeData` - Complete cafe information
- `AmenityStatus` - Amenity availability states
- `PriceRange` - Price level indicators
- `OpenStatus` - Operating status

---

### 🎨 Layout Components
**File**: [`layout/LAYOUT_COMPONENTS.md`](./layout/LAYOUT_COMPONENTS.md)

Structural and navigation components:

| Component | Purpose | Key Features |
|-----------|---------|-------------|
| **Header** | Main navigation bar | Search, user controls, branding |
| **AddPlaceButton** | Floating action button | Add new locations, coffee theme |

**Design Patterns**:
- Responsive design
- Absolute positioning
- Coffee-themed styling
- Accessibility focus

---

### 🗺️ Map Components
**File**: [`map/MAP_COMPONENTS.md`](./map/MAP_COMPONENTS.md)

Map providers and location-based functionality:

| Component | Purpose | Key Features |
|-----------|---------|-------------|
| **MapContainer** | Unified map wrapper | Provider switching, state management |
| **GoogleMap** | Google Maps integration | Custom styling, geolocation |
| **OpenFreeMap** | OpenStreetMap integration | MapLibre GL, custom themes |
| **LocateMeButton** | User location control | Geolocation trigger |

**Architecture**:
- Provider pattern with `IMapProvider` interface
- Unified state management
- Multiple map provider support
- Consistent API across providers

---

### 🎛️ UI Components
**File**: [`ui/UI_COMPONENTS.md`](./ui/UI_COMPONENTS.md)

Foundational design system components:

| Component | Purpose | Variants |
|-----------|---------|----------|
| **Button** | Interactive elements | default, destructive, outline, secondary, ghost, link |
| **Badge** | Status indicators | default, secondary, destructive, outline |
| **Input** | Text input fields | Standard HTML input with consistent styling |
| **Avatar** | User profile images | Image with fallback support |
| **ScrollArea** | Custom scrollbars | Vertical and horizontal scrolling |
| **Card** | Content containers | Header, content, footer sections |
| **TooltipProvider** | Tooltip context | Positioning and animation support |

**Design System**:
- Shadcn/UI foundation
- Class Variance Authority (CVA)
- Tailwind CSS utilities
- Consistent theming

---

## 🔗 Component Relationships

### Dependency Graph
```
┌─────────────────┐
│   UI Components │  ← Foundation layer
└─────────────────┘
         ↑
┌─────────────────┐
│ Layout Components│  ← Uses UI components
└─────────────────┘
         ↑
┌─────────────────┐
│  Cafe Components │  ← Uses UI + Layout
└─────────────────┘
         ↑
┌─────────────────┐
│  Map Components │  ← Independent system
└─────────────────┘
```

### Import Patterns
```typescript
// UI Components (foundation)
import { Button, Badge, Card } from '@/components/ui';

// Layout Components
import { Header } from '@/components/layout';

// Cafe Components
import { CafeCard, CafeCarousel } from '@/components/cafe';

// Map Components
import { MapContainer } from '@/components/map';
```

---

## 📋 Quick Reference

### Common Props Patterns

#### Standard Props
```typescript
// Most components accept these
interface BaseProps {
  className?: string;           // Tailwind CSS classes
  children?: React.ReactNode;   // Child elements
}

// Interactive components
interface InteractiveProps extends BaseProps {
  onClick?: () => void;         // Click handler
  disabled?: boolean;           // Disabled state
}

// Form components
interface FormProps extends BaseProps {
  value?: string;               // Current value
  onChange?: (value: string) => void; // Change handler
  placeholder?: string;         // Placeholder text
}
```

#### Variant Props
```typescript
// Button variants
type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

// Badge variants
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// Map providers
type MapProviderKey = "openfreemap" | "google";
```

### Event Handler Patterns

#### Cafe Events
```typescript
// Cafe card interactions
interface CafeEventHandlers {
  onCardClick?: (cafe: CafeData) => void;
  onFavoriteToggle?: (cafeId: string, isFavorite: boolean) => void;
}

// Carousel events
interface CarouselEventHandlers {
  onCafeSelect?: (cafe: CafeData) => void;
  onLoadMore?: () => void;
}
```

#### Map Events
```typescript
// Map interactions
interface MapEventHandlers {
  onViewChange?: (center: LatLngLiteral, zoom: number) => void;
  onLoad?: (provider: IMapProvider) => void;
  onLocationFound?: (location: LatLngLiteral) => void;
}

// Location events
interface LocationEventHandlers {
  onLocateMe?: () => void;
  onLocationError?: (error: GeolocationPositionError) => void;
}
```

#### UI Events
```typescript
// Form events
interface FormEventHandlers {
  onSubmit?: (data: FormData) => void;
  onInputChange?: (field: string, value: string) => void;
  onValidationError?: (errors: ValidationErrors) => void;
}

// Navigation events
interface NavigationEventHandlers {
  onSearch?: (query: string) => void;
  onFilterToggle?: () => void;
  onProfileClick?: () => void;
}
```

---

## 🎯 Usage Guidelines

### Component Selection

#### When to Use Each Component

**UI Components** (Always use for consistency):
- `Button` - Any interactive action
- `Input` - Text input fields
- `Card` - Grouped content
- `Badge` - Status indicators
- `Avatar` - User representations

**Layout Components** (App structure):
- `Header` - Main navigation
- `AddPlaceButton` - Primary floating action

**Cafe Components** (Domain-specific):
- `CafeCard` - Individual cafe display
- `CafeCarousel` - Multiple cafe browsing

**Map Components** (Location features):
- `MapContainer` - Any map functionality
- `LocateMeButton` - User location features

### Styling Guidelines

#### Consistent Spacing
```typescript
// Standard spacing scale
const spacing = {
  xs: "0.25rem",    // 4px
  sm: "0.5rem",     // 8px
  md: "1rem",       // 16px
  lg: "1.5rem",     // 24px
  xl: "2rem",       // 32px
  "2xl": "3rem",    // 48px
};

// Usage in components
<div className="space-y-4">        {/* 16px vertical spacing */}
<div className="gap-2">           {/* 8px gap in flex/grid */}
<div className="p-6">             {/* 24px padding */}
```

#### Color Usage
```typescript
// Semantic colors
const colors = {
  primary: "Coffee theme (brown/amber)",
  secondary: "Muted gray",
  destructive: "Error red",
  success: "Success green",
  warning: "Warning yellow",
  info: "Info blue",
};

// Status colors for cafes
const cafeColors = {
  open: "text-green-600",
  closed: "text-red-600",
  busy: "text-yellow-600",
  unknown: "text-gray-500",
};
```

#### Responsive Design
```typescript
// Breakpoint usage
const responsive = {
  mobile: "default (no prefix)",
  tablet: "md: (768px+)",
  desktop: "lg: (1024px+)",
  wide: "xl: (1280px+)",
};

// Example responsive component
<div className="
  grid 
  grid-cols-1 
  md:grid-cols-2 
  lg:grid-cols-3 
  gap-4
">
```

---

## 🧪 Testing Strategies

### Component Testing

#### Unit Tests
```typescript
// Test component rendering
it('renders with correct props', () => {
  render(<CafeCard cafe={mockCafe} />);
  expect(screen.getByText(mockCafe.name)).toBeInTheDocument();
});

// Test interactions
it('handles click events', async () => {
  const handleClick = jest.fn();
  render(<Button onClick={handleClick}>Click me</Button>);
  await userEvent.click(screen.getByRole('button'));
  expect(handleClick).toHaveBeenCalled();
});

// Test accessibility
it('is accessible', () => {
  render(<Button>Accessible button</Button>);
  const button = screen.getByRole('button');
  expect(button).toHaveAccessibleName('Accessible button');
});
```

#### Integration Tests
```typescript
// Test component interactions
it('updates map when cafe is selected', async () => {
  render(<CafeMapView />);
  
  const cafeCard = screen.getByTestId('cafe-card-1');
  await userEvent.click(cafeCard);
  
  expect(screen.getByTestId('map')).toHaveAttribute(
    'data-center', 
    expect.stringContaining('1.234,103.567')
  );
});
```

#### Visual Tests
```typescript
// Storybook stories for visual testing
export const AllCafeStates: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <CafeCard cafe={openCafe} />
      <CafeCard cafe={closedCafe} />
      <CafeCard cafe={busyCafe} />
      <CafeCard cafe={unknownCafe} />
    </div>
  ),
};
```

### Performance Testing

#### Bundle Size Analysis
```bash
# Analyze component bundle sizes
npm run build:analyze

# Check individual component sizes
npm run bundle-analyzer
```

#### Runtime Performance
```typescript
// Performance monitoring
const CafeCardWithPerfMonitoring = React.memo(CafeCard);

// Measure render performance
const measureRenderTime = (componentName: string) => {
  const start = performance.now();
  // Component render
  const end = performance.now();
  console.log(`${componentName} render time: ${end - start}ms`);
};
```

---

## 🚀 Development Workflow

### Adding New Components

1. **Create Component File**
   ```typescript
   // components/category/NewComponent.tsx
   export interface NewComponentProps {
     // Define props
   }
   
   export const NewComponent: React.FC<NewComponentProps> = (props) => {
     // Implementation
   };
   ```

2. **Add to Index**
   ```typescript
   // components/category/index.ts
   export { NewComponent } from './NewComponent';
   ```

3. **Create Tests**
   ```typescript
   // components/category/__tests__/NewComponent.test.tsx
   describe('NewComponent', () => {
     // Test cases
   });
   ```

4. **Add Stories**
   ```typescript
   // components/category/NewComponent.stories.tsx
   export default {
     title: 'Category/NewComponent',
     component: NewComponent,
   };
   ```

5. **Update Documentation**
   - Add to appropriate `*_COMPONENTS.md` file
   - Update this index file
   - Add usage examples

### Modifying Existing Components

1. **Backward Compatibility**
   - Maintain existing prop interfaces
   - Add new props as optional
   - Deprecate old props gradually

2. **Testing Updates**
   - Update existing tests
   - Add tests for new functionality
   - Ensure visual regression tests pass

3. **Documentation Updates**
   - Update component documentation
   - Add migration guides if needed
   - Update usage examples

---

## 🔧 Troubleshooting

### Common Issues

#### Styling Problems
```typescript
// Issue: Styles not applying
// Solution: Check Tailwind CSS purging
// Ensure classes are not being purged

// Issue: Inconsistent spacing
// Solution: Use design system spacing
const correctSpacing = "space-y-4 p-6 gap-2";
const incorrectSpacing = "mt-3 mb-5 pl-7"; // Avoid arbitrary values
```

#### TypeScript Errors
```typescript
// Issue: Props interface conflicts
// Solution: Extend base interfaces properly
interface CustomButtonProps extends ButtonProps {
  customProp?: string;
}

// Issue: Missing ref forwarding
// Solution: Use React.forwardRef
const CustomComponent = React.forwardRef<HTMLDivElement, Props>(
  (props, ref) => <div ref={ref} {...props} />
);
```

#### Performance Issues
```typescript
// Issue: Unnecessary re-renders
// Solution: Use React.memo and useCallback
const OptimizedComponent = React.memo(Component);

const handleClick = useCallback(() => {
  // Handler logic
}, [dependencies]);
```

#### Accessibility Issues
```typescript
// Issue: Missing ARIA labels
// Solution: Add proper accessibility attributes
<Button aria-label="Add to favorites">
  <Heart className="h-4 w-4" />
</Button>

// Issue: Poor keyboard navigation
// Solution: Ensure proper tab order and focus management
<div role="button" tabIndex={0} onKeyDown={handleKeyDown}>
```

### Debug Tools

#### React Developer Tools
- Component tree inspection
- Props and state debugging
- Performance profiling

#### Accessibility Tools
- axe-core browser extension
- WAVE accessibility checker
- Screen reader testing

#### Performance Tools
- Chrome DevTools Performance tab
- React Profiler
- Bundle analyzer

---

## 📚 Additional Resources

### Documentation Links
- [Shadcn/UI Documentation](https://ui.shadcn.com/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

### Design Resources
- [Figma Design System](# TODO: Add Figma link)
- [Color Palette](# TODO: Add color palette)
- [Typography Scale](# TODO: Add typography)
- [Spacing System](# TODO: Add spacing guide)

### Development Tools
- [Storybook](# TODO: Add Storybook link)
- [Testing Library](https://testing-library.com/)
- [ESLint Configuration](# TODO: Add ESLint config)
- [Prettier Configuration](# TODO: Add Prettier config)

---

## 🎯 Next Steps

### Immediate Priorities
1. **Complete Component Coverage** - Document any missing components
2. **Add Visual Examples** - Include screenshots in documentation
3. **Create Usage Videos** - Record component usage demonstrations
4. **Set Up Automated Testing** - Implement visual regression testing

### Future Enhancements
1. **Interactive Documentation** - Build interactive component playground
2. **Design Token Integration** - Sync with design system tokens
3. **Performance Monitoring** - Add component performance metrics
4. **Accessibility Auditing** - Automated accessibility testing

### Maintenance Tasks
1. **Regular Updates** - Keep documentation in sync with code
2. **Dependency Updates** - Update Shadcn/UI and other dependencies
3. **Performance Reviews** - Regular performance audits
4. **Accessibility Reviews** - Regular accessibility audits

---

*This documentation is maintained by the CoffeeMode development team. For questions or contributions, please refer to the project's contribution guidelines.*