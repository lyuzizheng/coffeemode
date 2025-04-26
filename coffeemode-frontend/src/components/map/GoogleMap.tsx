import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
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

  useEffect(() => {
    // Define the callback function that the Google Maps script will call
    window.initMap = () => {
      if (mapRef.current && !googleMapInstanceRef.current) {
        const defaultMapOptions: google.maps.MapOptions = {
          center, // Use prop directly
          zoom, // Use prop directly
          disableDefaultUI: true, // Keep custom UI focus
          zoomControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: mapStyle as google.maps.MapTypeStyle[],
          // Let MapContainer handle location button via MapControls
          // myLocationControl: false,
        };

        // Merge default options with passed mapOptions
        const finalMapOptions = { ...defaultMapOptions, ...mapOptions };

        const map = new window.google.maps.Map(mapRef.current, finalMapOptions);
        googleMapInstanceRef.current = map;

        // --- Create the IMapProvider Adapter ---
        const providerAdapter: IMapProvider = {
          setCenter: (newCenter: LatLngLiteral) => {
            map.setCenter(newCenter);
          },
          setZoom: (newZoom: number) => {
            map.setZoom(newZoom);
          },
          getCenter: (): LatLngLiteral => {
            const currentCenter = map.getCenter();
            return {
              lat: currentCenter?.lat() ?? center.lat, // Fallback to prop
              lng: currentCenter?.lng() ?? center.lng, // Fallback to prop
            };
          },
          getZoom: (): number => {
            return map.getZoom() ?? zoom; // Fallback to prop
          },
          flyTo: (newCenter: LatLngLiteral, newZoom?: number) => {
            map.setCenter(newCenter);
            if (newZoom !== undefined) {
              map.setZoom(newZoom);
            }
          },
          destroy: () => {
            // Google Maps doesn't have a direct destroy method for the map instance itself.
            // Cleanup involves removing listeners and potentially the container,
            // which React handles on unmount. We'll clear our refs.
            googleMapInstanceRef.current = null;
            providerRef.current = null;
            console.log("Google Map provider instance conceptually destroyed.");
          },
        };
        // -----------------------------------------

        providerRef.current = providerAdapter; // Store the adapter
        if (onLoad) {
          onLoad(providerAdapter); // Pass the adapter instance up
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
  }, [onLoad, mapOptions, onViewChange]); // Add onViewChange dependency

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
