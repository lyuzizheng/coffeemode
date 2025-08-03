# Map Components Documentation

Map provider abstractions and map-related UI components for unified map functionality across different providers.

## Architecture Overview

The map system uses a **Provider Pattern** with a unified interface (`IMapProvider`) that abstracts different map implementations (Google Maps, OpenStreetMap via MapLibre).

```
┌─────────────────────┐
│   MapContainer      │  ← Unified container with provider switching
├─────────────────────┤
│   IMapProvider      │  ← Common interface
├─────────────────────┤
│ GoogleMap │ OpenMap │  ← Concrete implementations
└─────────────────────┘
```

## Core Types and Interfaces

### 📍 LatLngLiteral
```typescript
interface LatLngLiteral {
  lat: number;
  lng: number;
}
```

### 🗺️ IMapProvider Interface
```typescript
interface IMapProvider {
  setCenter(center: LatLngLiteral): void;
  setZoom(zoom: number): void;
  getCenter(): LatLngLiteral;
  getZoom(): number;
  flyTo(center: LatLngLiteral, zoom?: number): void;
  destroy(): void;
  triggerUserLocation?: () => void;
}
```

### 🎛️ BaseMapProviderProps
```typescript
interface BaseMapProviderProps {
  className?: string;
  center: LatLngLiteral;
  zoom: number;
  onLoad: (provider: IMapProvider) => void;
  onViewChange?: (newCenter: LatLngLiteral, newZoom: number) => void;
}
```

---

## Components Overview

### 🗺️ MapContainer
**File**: `MapContainer.tsx`
**Purpose**: Unified map container with provider switching and state management

#### Props Interface
```typescript
interface UnifiedMapContainerProps {
  className?: string;
  initialCenter?: LatLngLiteral;
  initialZoom?: number;
  defaultProvider?: MapProviderKey;
}

type MapProviderKey = "openfreemap" | "google";
```

#### Features
- **Provider Switching**: Runtime switching between map providers
- **State Management**: Manages center, zoom, and current provider
- **Geolocation**: Automatic user location detection on load
- **UI Controls**: Integrated locate button and provider switcher
- **Event Handling**: Unified event handling across providers

#### Usage Example
```tsx
import { MapContainer } from '@/components/map';

<MapContainer
  initialCenter={{ lat: 1.321226, lng: 103.819146 }}
  initialZoom={10.76}
  defaultProvider="openfreemap"
  className="w-full h-screen"
/>
```

#### State Management
```typescript
const [currentProviderKey, setCurrentProviderKey] = useState<MapProviderKey>(defaultProvider);
const [currentCenter, setCurrentCenter] = useState<LatLngLiteral>(initialCenter);
const [currentZoom, setCurrentZoom] = useState<number>(initialZoom);
const mapProviderRef = useRef<IMapProvider | null>(null);
```

#### Geolocation Behavior
- **Initial Load**: Attempts to get user location and center map
- **Fallback**: Uses `initialCenter` if geolocation fails
- **Timeout**: 10-second timeout for location requests
- **Accuracy**: High accuracy enabled for better precision

#### Event Handlers
```typescript
const handleMapLoad = useCallback((provider: IMapProvider) => {
  mapProviderRef.current = provider;
}, [currentProviderKey]);

const handleViewChange = useCallback((newCenter: LatLngLiteral, newZoom: number) => {
  setCurrentCenter(newCenter);
  setCurrentZoom(newZoom);
}, []);

const handleLocateMe = useCallback(() => {
  mapProviderRef.current?.triggerUserLocation();
}, []);
```

#### UI Layout
```
┌─────────────────────────────────────┐
│                                [📍] │  ← Locate button (top-right)
│                                     │
│            MAP CONTENT              │
│                                     │
│                                     │
│ [Switch Provider]                   │  ← Provider switcher (bottom-left)
└─────────────────────────────────────┘
```

---

### 🌍 GoogleMap
**File**: `GoogleMap.tsx`
**Purpose**: Google Maps implementation with custom styling and controls

#### Props Interface
```typescript
interface GoogleMapProps extends BaseMapProviderProps {
  mapOptions?: Partial<google.maps.MapOptions>;
  onViewChange?: (center: LatLngLiteral, zoom: number) => void;
}
```

#### Features
- **Custom Styling**: Uses imported JSON style configuration
- **User Location**: Manual marker creation for user location
- **Event Handling**: Idle event listener for view changes
- **Geolocation**: Built-in geolocation with visual marker
- **Cleanup**: Proper resource cleanup on unmount

#### Implementation Details
```typescript
// Global window interface extension
declare global {
  interface Window {
    google: typeof google;
    initMap: () => void;
  }
}
```

#### Map Configuration
```typescript
const defaultMapOptions: google.maps.MapOptions = {
  center,
  zoom,
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  styles: mapStyle as google.maps.MapTypeStyle[],
};
```

#### User Location Handling
- **Marker Creation**: Creates custom marker for user location
- **Position Updates**: Updates existing marker position
- **Zoom Level**: Uses `LOCATE_USER_ZOOM_LEVEL` constant (16)
- **Error Handling**: Graceful handling of geolocation errors

#### Provider Adapter Implementation
```typescript
const createProviderAdapter = useCallback((map: google.maps.Map): IMapProvider => {
  return {
    setCenter: (newCenter) => map.setCenter(newCenter),
    setZoom: (newZoom) => map.setZoom(newZoom),
    getCenter: () => {
      const center = map.getCenter();
      return { lat: center?.lat() ?? 0, lng: center?.lng() ?? 0 };
    },
    getZoom: () => map.getZoom() ?? 0,
    flyTo: (newCenter, newZoom) => {
      map.setCenter(newCenter);
      if (newZoom !== undefined) map.setZoom(newZoom);
    },
    triggerUserLocation: () => { /* geolocation implementation */ },
    destroy: () => { /* cleanup implementation */ }
  };
}, []);
```

---

### 🗺️ OpenFreeMap
**File**: `OpenFreeMap.tsx`
**Purpose**: OpenStreetMap implementation using MapLibre GL JS

#### Props Interface
```typescript
// Uses BaseMapProviderProps directly
type OpenFreeMapProps = BaseMapProviderProps;
```

#### Features
- **MapLibre GL**: Uses MapLibre GL JS for OpenStreetMap rendering
- **Custom Styling**: Light theme with custom JSON configuration
- **Geolocation Control**: Built-in MapLibre geolocation control
- **Event Handling**: Move and zoom event listeners
- **Performance**: Hardware-accelerated rendering

#### Dependencies
```typescript
import maplibregl, {
  GeolocateControl,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
```

#### Map Initialization
```typescript
const map = new maplibregl.Map({
  container: mapContainerRef.current,
  style: customMapStyleLight as StyleSpecification,
  center: [center.lng, center.lat], // MapLibre uses [lng, lat]
  zoom: zoom,
  attributionControl: false,
});
```

#### Geolocation Control
```typescript
const geolocateControl = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  showUserLocation: true,
  showAccuracyCircle: true,
});
```

#### Event Handling
```typescript
const handleMoveEnd = () => {
  if (!onViewChange || !mapInstanceRef.current) return;
  const newCenter = mapInstanceRef.current.getCenter();
  const newZoom = mapInstanceRef.current.getZoom();
  onViewChange({ lat: newCenter.lat, lng: newCenter.lng }, newZoom);
};

map.on("moveend", handleMoveEnd);
map.on("zoomend", handleZoomEnd);
```

---

### 📍 LocateMeButton
**File**: `LocateMeButton.tsx`
**Purpose**: User location button for centering map on user's position

#### Props Interface
```typescript
interface LocateMeButtonProps {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}
```

#### Features
- **Accessibility**: Proper ARIA label and keyboard support
- **Visual Design**: Consistent with app design system
- **State Management**: Disabled state support
- **Icon**: LocateFixed icon from Lucide React

#### Usage Example
```tsx
import { LocateMeButton } from '@/components/map';

const handleLocate = () => {
  mapProvider.triggerUserLocation();
};

<LocateMeButton 
  onClick={handleLocate}
  className="absolute top-4 right-4"
  disabled={!mapProvider}
/>
```

#### Styling
- **Variant**: Secondary button variant
- **Size**: Icon size (h-10 w-10)
- **Shape**: Rounded full circle
- **Shadow**: Medium shadow for depth
- **Border**: Subtle border for definition

---

## Configuration Files

### 🎨 Map Styles
- **`style.json`**: Google Maps custom style
- **`openmapstyle.json`**: OpenStreetMap dark style
- **`openmapstyle_light.json`**: OpenStreetMap light style

### 📁 Type Definitions
**File**: `types/types.ts`
- Core interfaces and types
- Provider abstractions
- Coordinate systems
- Event handler types

---

## Integration Patterns

### Provider Switching
```typescript
const toggleProvider = useCallback(() => {
  // Cleanup current provider
  if (mapProviderRef.current) {
    mapProviderRef.current.destroy();
    mapProviderRef.current = null;
  }
  
  // Switch to next provider
  setCurrentProviderKey(prev => 
    prev === "openfreemap" ? "google" : "openfreemap"
  );
}, []);
```

### State Synchronization
```typescript
const handleViewChange = useCallback(
  (newCenter: LatLngLiteral, newZoom: number) => {
    const centerChanged = 
      newCenter.lat !== currentCenter.lat || 
      newCenter.lng !== currentCenter.lng;
    const zoomChanged = newZoom !== currentZoom;
    
    if (centerChanged) setCurrentCenter(newCenter);
    if (zoomChanged) setCurrentZoom(newZoom);
  },
  [currentCenter, currentZoom]
);
```

### Geolocation Integration
```typescript
const handleInitialGeolocation = useEffect(() => {
  if (!navigator.geolocation) return;
  
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      setCurrentCenter(location);
    },
    (error) => console.error("Geolocation error:", error),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}, []);
```

## Performance Considerations

### Memory Management
- **Provider Cleanup**: Proper cleanup on provider switch
- **Event Listeners**: Remove listeners on unmount
- **Map Instances**: Destroy map instances properly
- **Marker Management**: Clean up custom markers

### Optimization Strategies
- **Lazy Loading**: Load map providers only when needed
- **Debouncing**: Debounce view change events
- **Memoization**: Memoize expensive calculations
- **Bundle Splitting**: Separate map provider bundles

### Resource Loading
```typescript
// Google Maps script loading
window.initMap = () => {
  // Initialize only when script is loaded
};

// MapLibre CSS import
import "maplibre-gl/dist/maplibre-gl.css";
```

## Error Handling

### Geolocation Errors
```typescript
navigator.geolocation.getCurrentPosition(
  successCallback,
  (error) => {
    switch(error.code) {
      case error.PERMISSION_DENIED:
        console.error("User denied geolocation");
        break;
      case error.POSITION_UNAVAILABLE:
        console.error("Location information unavailable");
        break;
      case error.TIMEOUT:
        console.error("Location request timed out");
        break;
    }
  },
  options
);
```

### Map Loading Errors
```typescript
map.on("error", (e) => {
  console.error("Map Error:", e);
  // Potentially switch to fallback provider
  // Show user-friendly error message
});
```

### Provider Fallbacks
```typescript
const initializeWithFallback = async () => {
  try {
    await initializeGoogleMaps();
  } catch (error) {
    console.warn("Google Maps failed, falling back to OpenStreetMap");
    await initializeOpenStreetMap();
  }
};
```

## Accessibility Features

### Keyboard Navigation
- **Tab Navigation**: Proper tab order for controls
- **Enter/Space**: Activate buttons
- **Arrow Keys**: Pan map (native browser support)
- **+/- Keys**: Zoom in/out (native browser support)

### Screen Reader Support
- **ARIA Labels**: Descriptive labels for all controls
- **Live Regions**: Announce location changes
- **Landmarks**: Proper map landmark identification
- **Alternative Text**: Describe map content

### Focus Management
- **Visible Indicators**: Clear focus outlines
- **Focus Trapping**: Keep focus within map controls
- **Skip Links**: Allow skipping map content

## Future Enhancements

### Map Features
1. **Markers**: Cafe location markers with clustering
2. **Popups**: Information popups for locations
3. **Routing**: Directions to selected cafes
4. **Layers**: Toggle different map layers
5. **Offline**: Offline map support
6. **3D**: 3D building visualization

### Provider Enhancements
1. **Bing Maps**: Additional map provider
2. **Apple Maps**: iOS-specific integration
3. **Custom Tiles**: Self-hosted tile server
4. **Satellite**: Satellite imagery support
5. **Street View**: Integrated street view

### Performance
1. **Virtualization**: Virtualize large marker sets
2. **Clustering**: Smart marker clustering
3. **Lazy Loading**: Progressive map loading
4. **Caching**: Intelligent tile caching
5. **Compression**: Optimized asset delivery

### User Experience
1. **Gestures**: Touch gesture improvements
2. **Animation**: Smooth transitions
3. **Themes**: Multiple map themes
4. **Customization**: User preference settings
5. **Search**: Map-based search integration