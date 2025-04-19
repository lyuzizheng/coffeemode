import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
// Import the map style
import mapStyle from "./style.json";

declare global {
  interface Window {
    google: typeof google;
    initMap: () => void;
  }
}

export interface MapProps {
  className?: string;
  center?: google.maps.LatLngLiteral;
  zoom?: number;
  onMapLoad?: (map: google.maps.Map) => void;
  mapOptions?: Partial<google.maps.MapOptions>;
}

const Map = ({
  className,
  center = { lat: 1.3521, lng: 103.8198 }, // Default center at Singapore
  zoom = 15,
  onMapLoad,
  mapOptions,
}: MapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  useEffect(() => {
    // Define the callback function that the Google Maps script will call
    window.initMap = () => {
      if (mapRef.current && !mapInstance) {
        // Define default options
        const defaultMapOptions: google.maps.MapOptions = {
          center,
          zoom,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          styles: mapStyle as google.maps.MapTypeStyle[],
        };

        // Merge default options with passed mapOptions
        const finalMapOptions = { ...defaultMapOptions, ...mapOptions };

        const map = new window.google.maps.Map(
          mapRef.current,
          finalMapOptions // Use merged options
        );

        // Set control options after map is created
        if (
          finalMapOptions.myLocationControl &&
          window.google?.maps?.ControlPosition
        ) {
          map.setOptions({
            myLocationControlOptions: {
              position: window.google.maps.ControlPosition.RIGHT_BOTTOM,
            },
          });
        }

        setMapInstance(map);
        if (onMapLoad) onMapLoad(map);
      }
    };

    // Load Google Maps API if it hasn't been loaded yet
    if (!window.google) {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/gh/somanchiu/Keyless-Google-Maps-API@v6.8/mapsJavaScriptAPI.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (!mapInstance) {
      // If Google Maps API is already loaded, initialize the map
      window.initMap();
    }

    return () => {
      // Cleanup
      window.initMap = () => {};
    };
  }, [center, zoom, mapInstance, onMapLoad, mapOptions]);

  // Update map center and zoom if props change
  useEffect(() => {
    if (mapInstance) {
      mapInstance.setCenter(center);
      mapInstance.setZoom(zoom);
    }
  }, [center, zoom, mapInstance]);

  return (
    <div
      ref={mapRef}
      className={cn("w-full h-screen", className)}
      aria-label="Google Map"
      tabIndex={0}
    />
  );
};

export default Map;
