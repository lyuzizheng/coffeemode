import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
// Import the specific map components
import GoogleMap from "./GoogleMap";
// Import the new button
import LocateMeButton from "./LocateMeButton";
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

// Define the zoom level to use when locating the user
const LOCATE_USER_ZOOM_LEVEL = 16;

// Remove forwardRef wrapper
const UnifiedMapContainer = ({
  // Remove ref parameter
  className,
  initialCenter = { lat: 1.3521, lng: 103.8198 }, // Default center Singapore
  initialZoom = 14,
  defaultProvider = "openfreemap",
}: UnifiedMapContainerProps) => {
  const [currentProviderKey, setCurrentProviderKey] =
    useState<MapProviderKey>(defaultProvider);
  const [currentCenter, setCurrentCenter] =
    useState<LatLngLiteral>(initialCenter);
  const [currentZoom, setCurrentZoom] = useState<number>(initialZoom);

  const mapProviderRef = useRef<IMapProvider | null>(null);

  // 1. Get User Geolocation ON INITIAL LOAD (only for initial map centering)
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn("Geolocation is not supported by this browser.");
      // No change if not supported, use initialCenter prop
      return;
    }
    let isMounted = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!isMounted) return;
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        console.log("Initial user location determined:", location);
        // Only update center if map hasn't loaded/moved yet
        if (!mapProviderRef.current && currentCenter === initialCenter) {
          console.log("Setting initial map center to user location.");
          setCurrentCenter(location);
        }
        // Remove setUserLocation(location);
      },
      (error) => {
        if (!isMounted) return;
        console.error("Error getting initial user location:", error);
        // No change on error, use initialCenter prop
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
    return () => {
      isMounted = false;
    };
  }, [initialCenter, currentCenter]); // Add currentCenter dependency to check if it's still the initial one

  // 2. Callback received when a map provider is loaded (Existing code - no changes)
  const handleMapLoad = useCallback(
    (provider: IMapProvider) => {
      console.log(`Map provider loaded: ${currentProviderKey}`, provider);
      mapProviderRef.current = provider;
    },
    [currentProviderKey]
  );

  // 3. Handle map view changes (Existing code - no changes)
  const handleViewChange = useCallback(
    (newCenter: LatLngLiteral, newZoom: number) => {
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
      // Optional: Log view changes if needed for debugging
      // if (centerChanged || zoomChanged) {
      //   console.log("Map view changed:", newCenter, newZoom);
      // }
    },
    [currentCenter, currentZoom]
  );

  // 4. Provider Switching Logic (Existing code - no changes)
  const toggleProvider = useCallback(() => {
    if (mapProviderRef.current) {
      mapProviderRef.current.destroy();
      mapProviderRef.current = null;
    }

    setCurrentProviderKey((prev) => {
      const nextProvider = prev === "openfreemap" ? "google" : "openfreemap";
      console.log(`Switching provider to: ${nextProvider}`);
      return nextProvider;
    });
  }, []);

  // 5. Update handleLocateMe to call provider method
  const handleLocateMe = useCallback(() => {
    console.log("[MapContainer] handleLocateMe called. Triggering provider...");
    if (mapProviderRef.current?.triggerUserLocation) {
      mapProviderRef.current.triggerUserLocation();
    } else if (mapProviderRef.current) {
      console.warn(
        `[MapContainer] Map provider (${currentProviderKey}) does not implement triggerUserLocation. Falling back to flyTo.`
      );
      // Fallback for safety, though both should implement it now
      // Need to get location manually for fallback
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            mapProviderRef.current?.flyTo(
              { lat: pos.coords.latitude, lng: pos.coords.longitude },
              LOCATE_USER_ZOOM_LEVEL
            );
          },
          (err) => {
            console.error("Fallback geolocation error:", err);
          }
        );
      }
    } else {
      console.warn("[MapContainer] Map provider ref not available.");
    }
  }, [currentProviderKey]); // Add currentProviderKey dependency for logging

  return (
    <div className={cn("relative w-full h-full", className)}>
      {/* Map Provider Rendering */}
      {currentProviderKey === "openfreemap" && (
        <OpenFreeMap
          key="openfreemap"
          center={currentCenter}
          zoom={currentZoom}
          onLoad={handleMapLoad}
          onViewChange={handleViewChange}
          className="w-full h-full"
        />
      )}
      {currentProviderKey === "google" && (
        <GoogleMap
          key="googlemap"
          center={currentCenter}
          zoom={currentZoom}
          onLoad={handleMapLoad}
          onViewChange={handleViewChange}
          className="w-full h-full"
        />
      )}

      {/* UI Controls Overlay */}
      <div className="absolute top-0 left-0 right-0 bottom-0 p-4 pointer-events-none z-10 flex flex-col justify-between">
        {/* Top Controls Area (can add more controls here later) */}
        <div className="flex justify-end pointer-events-auto">
          <LocateMeButton onClick={handleLocateMe} className="mt-16 mr-0" />
        </div>

        {/* Bottom Controls Area */}
        <div className="flex justify-start pointer-events-auto">
          {/* Temporary button to switch providers */}
          <button
            onClick={toggleProvider}
            className="bg-white p-2 rounded shadow-md text-xs border border-gray-300 hover:bg-gray-100 transition-colors"
            aria-label={`Switch to ${
              currentProviderKey === "openfreemap"
                ? "Google Maps"
                : "OpenFreeMap"
            }`}
          >
            Switch to{" "}
            {currentProviderKey === "openfreemap" ? "Google" : "OpenFreeMap"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnifiedMapContainer;
