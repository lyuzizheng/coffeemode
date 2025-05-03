import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
// Import the specific map components
import GoogleMap from "./GoogleMap";
import OpenFreeMap from "./OpenFreeMap";
// Import the unified types
import type { IMapProvider, LatLngLiteral } from "./types/types";

// Define supported map providers keys
type MapProviderKey = "openfreemap" | "google";

export interface UnifiedMapContainerProps {
  className?: string;
  initialCenter?: LatLngLiteral;
  initialZoom?: number;
  defaultProvider?: MapProviderKey;
}

const UnifiedMapContainer = ({
  className,
  initialCenter = { lat: 1.3521, lng: 103.8198 }, // Default center Singapore
  initialZoom = 14,
  defaultProvider = "openfreemap",
}: UnifiedMapContainerProps) => {
  const [currentProviderKey, setCurrentProviderKey] =
    useState<MapProviderKey>(defaultProvider);
  const [userLocation, setUserLocation] = useState<LatLngLiteral | null>(null);
  // State to hold the current center/zoom, controlled by the map instance once loaded
  const [currentCenter, setCurrentCenter] =
    useState<LatLngLiteral>(initialCenter);
  const [currentZoom, setCurrentZoom] = useState<number>(initialZoom);

  // Ref to hold the *active* map provider adapter instance
  const mapProviderRef = useRef<IMapProvider | null>(null);

  // 1. Get User Geolocation
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn("Geolocation is not supported by this browser.");
      setCurrentCenter(initialCenter); // Use initial center if no geolocation
      return; // Early exit
    }

    let isMounted = true; // Prevent state updates on unmounted component

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!isMounted) return;

        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(location);

        // If map provider has NOT been loaded yet, update the currentCenter
        // to the user's location so the map initializes there.
        // Otherwise, do nothing - the map is already loaded and the user might have moved it.
        if (!mapProviderRef.current) {
          setCurrentCenter(location);
        }
        // We no longer need to flyTo here, the map will center on load if needed
        // or the user can click the locate button.
      },
      (error) => {
        if (!isMounted) return;
        console.error("Error getting user location:", error);
        // Keep initialCenter if geolocation fails and map hasn't loaded yet
        if (!mapProviderRef.current) {
          setCurrentCenter(initialCenter);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } // Geolocation options
    );

    return () => {
      isMounted = false; // Cleanup function
    };
  }, [initialCenter]); // Depend only on initialCenter

  // 2. Callback received when a map provider is loaded
  const handleMapLoad = useCallback(
    (provider: IMapProvider) => {
      console.log(`Map provider loaded: ${currentProviderKey}`);
      mapProviderRef.current = provider;

      // If user location was determined *before* map loaded, center on it now.
      // Otherwise, the geolocation effect will handle centering.
      if (
        userLocation &&
        currentCenter.lat === userLocation.lat &&
        currentCenter.lng === userLocation.lng
      ) {
        // This check ensures we only center on user location if it was set as the initial target
        provider.setCenter(userLocation);
      }
      // No need to update currentCenter/Zoom state here, let map drive it via onViewChange.
    },
    [currentProviderKey, userLocation, currentCenter]
  );

  // 3. Handle map view changes reported by the map component
  const handleViewChange = useCallback(
    (newCenter: LatLngLiteral, newZoom: number) => {
      // Check if the change is significant enough to warrant a state update
      // This prevents rapid state updates during smooth animations
      const centerChanged =
        newCenter.lat !== currentCenter.lat ||
        newCenter.lng !== currentCenter.lng;
      const zoomChanged = newZoom !== currentZoom;

      if (centerChanged) {
        setCurrentCenter(newCenter);
      }
      if (zoomChanged) {
        setCurrentZoom(newZoom);
      }
      if (centerChanged || zoomChanged) {
        console.log(
          "Map view changed, updating container state:",
          newCenter,
          newZoom
        );
      }
    },
    [currentCenter, currentZoom] // Depend on current state to avoid stale closures
  );

  // 4. Map Control Handlers (using the IMapProvider interface)
  // These were removed along with the MapControls component.

  // 5. Provider Switching Logic
  const toggleProvider = useCallback(() => {
    // Destroy the current map instance before switching
    if (mapProviderRef.current) {
      mapProviderRef.current.destroy();
      mapProviderRef.current = null;
    }

    setCurrentProviderKey((prev) => {
      const nextProvider = prev === "openfreemap" ? "google" : "openfreemap";
      // Reset center/zoom state to initial values when switching (or keep current?)
      // Resetting might be safer to avoid state inconsistencies between providers
      // setCurrentCenter(initialCenter);
      // setCurrentZoom(initialZoom);
      // Let's keep current center/zoom for now, as both providers receive it
      console.log(`Switching provider to: ${nextProvider}`);
      return nextProvider;
    });
  }, []); // No dependencies needed

  return (
    <div className={cn("relative w-full h-full", className)}>
      {/* Conditionally render the selected map provider component */}
      {/* Pass the handleMapLoad callback and current state */}
      {currentProviderKey === "openfreemap" && (
        <OpenFreeMap
          key="openfreemap" // Key ensures component remounts on switch
          center={currentCenter}
          zoom={currentZoom}
          onLoad={handleMapLoad}
          onViewChange={handleViewChange}
          className="w-full h-full"
        />
      )}

      {currentProviderKey === "google" && (
        <GoogleMap
          key="googlemap" // Key ensures component remounts on switch
          center={currentCenter}
          zoom={currentZoom}
          onLoad={handleMapLoad} // Pass the unified load handler
          onViewChange={handleViewChange} // Pass the handler
          className="w-full h-full"
          // No need to pass googleMapOptions here, handled internally
        />
      )}

      {/* Map Controls - Removed */}

      {/* Temporary button to switch providers */}
      <button
        onClick={toggleProvider}
        className="absolute bottom-4 left-4 z-10 bg-white p-2 rounded shadow-md text-xs border border-gray-300 hover:bg-gray-100 transition-colors"
        aria-label={`Switch to ${
          currentProviderKey === "openfreemap" ? "Google Maps" : "OpenFreeMap"
        }`}
      >
        Switch to{" "}
        {currentProviderKey === "openfreemap" ? "Google" : "OpenFreeMap"}
      </button>
    </div>
  );
};

export default UnifiedMapContainer;
