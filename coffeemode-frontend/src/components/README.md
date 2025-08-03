# Components Documentation

This directory contains all reusable UI components for the Coffee Mode application, organized by functionality.

## Directory Structure

```
components/
├── cafe/           # Cafe-related components
├── layout/         # Layout and navigation components
├── map/            # Map provider components
├── ui/             # Base UI components (Shadcn/ui)
└── README.md       # This file
```

## Component Categories

### 🏪 Cafe Components (`/cafe`)
Components for displaying cafe information, cards, and carousels.
- **CafeCard**: Individual cafe display card
- **CafeCarousel**: Horizontal scrollable list of cafe cards

### 🎨 Layout Components (`/layout`)
Components for application layout, navigation, and user interface structure.
- **Header**: Main application header with search and navigation
- **AddPlaceButton**: Floating action button for adding new places

### 🗺️ Map Components (`/map`)
Map provider abstractions and map-related UI components.
- **MapContainer**: Unified map container with provider switching
- **GoogleMap**: Google Maps implementation
- **OpenFreeMap**: OpenStreetMap implementation via MapLibre
- **LocateMeButton**: User location button

### 🧩 UI Components (`/ui`)
Base UI components from Shadcn/ui library with custom styling.
- **Avatar**: User avatar display
- **Badge**: Status and category badges
- **Button**: Primary button component
- **Card**: Content card container
- **Input**: Form input field
- **ScrollArea**: Custom scrollable area
- **Tooltip**: Hover tooltip component

## Development Guidelines

### 🎯 Component Design Principles

1. **Composition over Inheritance**: Components should be composable and reusable
2. **Props Interface**: All components should have well-defined TypeScript interfaces
3. **Accessibility**: Components must include proper ARIA labels and keyboard navigation
4. **Responsive Design**: Components should work across all screen sizes
5. **Performance**: Use React.memo, useCallback, and useMemo where appropriate

### 📝 Naming Conventions

- **Components**: PascalCase (e.g., `CafeCard`, `MapContainer`)
- **Files**: PascalCase matching component name (e.g., `CafeCard.tsx`)
- **Props Interfaces**: ComponentName + "Props" (e.g., `CafeCardProps`)
- **Event Handlers**: "handle" + Action (e.g., `handleCardClick`)

### 🔧 Implementation Standards

1. **TypeScript**: All components must be fully typed
2. **Styling**: Use Tailwind CSS with `cn()` utility for conditional classes
3. **Icons**: Use Lucide React icons consistently
4. **State Management**: Use local state for component-specific state
5. **Error Handling**: Include proper error boundaries and fallbacks

### 📚 Documentation Requirements

Each component should include:
- Purpose and use cases
- Props interface with descriptions
- Usage examples
- Accessibility considerations
- Performance notes
- TODO items for future improvements

## Getting Started

Refer to the individual component documentation files:
- [Cafe Components](./cafe/CAFE_COMPONENTS.md)
- [Layout Components](./layout/LAYOUT_COMPONENTS.md)
- [Map Components](./map/MAP_COMPONENTS.md)
- [UI Components](./ui/UI_COMPONENTS.md)

## Contributing

When adding new components:
1. Follow the established patterns and conventions
2. Add comprehensive TypeScript types
3. Include accessibility features
4. Write documentation
5. Add to appropriate index.ts exports
6. Test across different screen sizes

## AI Agent Guidelines

When working with these components:
- Always check existing components before creating new ones
- Follow the established patterns and interfaces
- Maintain consistency with the design system
- Update documentation when modifying components
- Consider performance implications of changes