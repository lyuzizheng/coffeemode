import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef } from "react";
// Import the new types
import type {
  BaseMapProviderProps,
  IMapProvider,
  LatLngLiteral,
} from "./types/types";
// Import the map style
import mapStyle from "./style.json";

declare global {
  interface Window {
    google: typeof google;
    initMap: () => void;
  }
}

// Define zoom level (could also be passed from MapContainer if needed)
const LOCATE_USER_ZOOM_LEVEL = 16;

// Combine specific Google props with base provider props
export interface GoogleMapProps extends BaseMapProviderProps {
  mapOptions?: Partial<google.maps.MapOptions>;
  onViewChange?: (center: LatLngLiteral, zoom: number) => void;
}

// Rename center/zoom props to initialCenter/initialZoom to avoid conflict
// with internal state management if needed, though direct prop usage is fine here.
const Map = ({
  className,
  center, // Use center directly from props
  zoom, // Use zoom directly from props
  onLoad,
  mapOptions,
  onViewChange, // <-- Accept new prop
}: GoogleMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  // Store the raw google map instance internally
  const googleMapInstanceRef = useRef<google.maps.Map | null>(null);
  // Store the provider adapter instance
  const providerRef = useRef<IMapProvider | null>(null);
  // Ref to store the event listener to easily remove it
  const idleListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  // Ref to store the manually created user location marker
  const userLocationMarkerRef = useRef<google.maps.Marker | null>(null);

  // --- Create or Update User Location Marker ---
  const createOrUpdateUserMarker = useCallback((location: LatLngLiteral) => {
    if (!googleMapInstanceRef.current) return; // Need map instance


    if (userLocationMarkerRef.current) {
      // Marker exists, update position
      userLocationMarkerRef.current.setPosition(location);
    } else {
      // Marker doesn't exist, create it
      const marker = new google.maps.Marker({
        position: location,
        map: googleMapInstanceRef.current,
        title: "Your Location",
        clickable: false, // Usually not clickable
      });
      userLocationMarkerRef.current = marker; // Store it
    }
  }, []); // No dependencies needed, uses refs

  // --- IMapProvider Adapter Creation (within useEffect/initMap) ---
  const createProviderAdapter = useCallback(
    (map: google.maps.Map): IMapProvider => {
      return {
        setCenter: (newCenter: LatLngLiteral) => {
          map.setCenter(newCenter);
        },
        setZoom: (newZoom: number) => {
          map.setZoom(newZoom);
        },
        getCenter: (): LatLngLiteral => {
          const currentCenter = map.getCenter();
          return {
            lat: currentCenter?.lat() ?? center.lat,
            lng: currentCenter?.lng() ?? center.lng,
          };
        },
        getZoom: (): number => {
          return map.getZoom() ?? zoom;
        },
        flyTo: (newCenter: LatLngLiteral, newZoom?: number) => {
          console.log(
            "[GoogleMap adapter] flyTo called (using setCenter/setZoom):",
            newCenter,
            newZoom
          );
          map.setCenter(newCenter);
          if (newZoom !== undefined) {
            map.setZoom(newZoom);
          }
          // For potential future animation:
          // const cameraOptions: google.maps.CameraOptions = { center: newCenter, zoom: newZoom };
          // map.moveCamera(cameraOptions);
        },
        // Implement triggerUserLocation for Google Maps
        triggerUserLocation: () => {
          if (!navigator.geolocation) {
            console.error("[GoogleMap adapter] Geolocation not supported.");
            // TODO: User feedback
            return;
          }
          if (!googleMapInstanceRef.current) {
            console.warn(
              "[GoogleMap adapter] Map instance not ready for triggerUserLocation."
            );
            return;
          }

          console.log("[GoogleMap adapter] Attempting geolocation...");

          navigator.geolocation.getCurrentPosition(
            (position) => {
              const currentLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              };
              console.log(
                "[GoogleMap adapter] Geolocation success:",
                currentLocation
              );

              createOrUpdateUserMarker(currentLocation); // Show/update blue dot

              // Center and zoom the map
              map.setCenter(currentLocation);
              map.setZoom(LOCATE_USER_ZOOM_LEVEL);
            },
            (error) => {
              console.error("[GoogleMap adapter] Geolocation error:", error);
              // TODO: User feedback
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
          );
        },
        destroy: () => {
          // Remove the manual marker if it exists
          if (userLocationMarkerRef.current) {
            userLocationMarkerRef.current.setMap(null);
            userLocationMarkerRef.current = null;
          }
          googleMapInstanceRef.current = null;
          providerRef.current = null;
          console.log("Google Map provider instance conceptually destroyed.");
        },
      };
    },
    [center.lat, center.lng, zoom, createOrUpdateUserMarker]
  ); // Add dependencies

  useEffect(() => {
    // Define the callback function that the Google Maps script will call
    window.initMap = () => {
      if (mapRef.current && !googleMapInstanceRef.current) {
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

        // Merge default options with passed mapOptions
        const finalMapOptions = { ...defaultMapOptions, ...mapOptions };

        const map = new window.google.maps.Map(mapRef.current, finalMapOptions);
        googleMapInstanceRef.current = map;

        // Create and store adapter
        const providerAdapter = createProviderAdapter(map); // Use callback
        providerRef.current = providerAdapter;
        if (onLoad) {
          onLoad(providerAdapter);
        }

        // --- Add event listener for view changes ---
        // Remove existing listener before adding a new one
        if (idleListenerRef.current) {
          idleListenerRef.current.remove();
        }
        idleListenerRef.current = map.addListener("idle", () => {
          if (!onViewChange) return;
          const newCenter = map.getCenter();
          const newZoom = map.getZoom();
          if (newCenter && newZoom !== undefined) {
            onViewChange(
              { lat: newCenter.lat(), lng: newCenter.lng() },
              newZoom
            );
          }
        });
        // ------------------------------------------
      }
    };

    // Load Google Maps API if it hasn't been loaded yet
    if (!window.google) {
      const script = document.createElement("script");
      script.src = "/js/mapsJavaScriptAPI.js";
      script.async = true;
      script.defer = true;
      // Ensure initMap is globally available before script execution
      script.onload = () => {
        if (!googleMapInstanceRef.current && window.initMap) {
          window.initMap();
        }
      };
      script.onerror = () =>
        console.error("Google Maps script failed to load.");
      document.head.appendChild(script);
    } else if (!googleMapInstanceRef.current) {
      // If Google Maps API is already loaded, initialize the map
      window.initMap();
    }

    // Cleanup function for the useEffect hook
    return () => {
      // Cleanup the idle listener when the component unmounts or effect re-runs
      if (idleListenerRef.current) {
        idleListenerRef.current.remove();
        idleListenerRef.current = null;
      }
      // Remove the initMap callback to prevent potential issues on fast re-renders/unmounts
      // window.initMap = () => {}; // Keep it simple, React unmounting handles element removal
      // The actual map instance cleanup is handled within the adapter's destroy method
      // which should be called by the parent component (UnifiedMapContainer) before unmounting the provider.
    };
    // Depend on onLoad, mapOptions and onViewChange for setup.
  }, [onLoad, mapOptions, onViewChange, center, zoom, createProviderAdapter]); // Add createProviderAdapter, center, zoom

  return (
    <div
      ref={mapRef}
      className={cn("w-full h-full", className)} // Use h-full from parent
      aria-label="Google Map"
      tabIndex={0}
    />
  );
};

export default Map;
