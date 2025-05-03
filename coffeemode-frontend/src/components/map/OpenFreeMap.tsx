import { cn } from "@/lib/utils";
import maplibregl, {
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css"; // Import MapLibre GL CSS
import { useEffect, useRef } from "react";
// Import the custom style JSON
//import customMapStyle from "./openmapstyle.json";
import customMapStyleLight from "./openmapstyle_light.json";
// Import the new types
import type {
  BaseMapProviderProps,
  IMapProvider,
  LatLngLiteral,
} from "./types/types";

// Use BaseMapProviderProps directly as no extra props are needed for OpenFreeMap
// export interface OpenFreeMapProps extends BaseMapProviderProps {}

const OpenFreeMap = ({
  className,
  center, // Use prop directly
  zoom, // Use prop directly
  onLoad,
  onViewChange, // <-- Accept new prop
}: BaseMapProviderProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const providerRef = useRef<IMapProvider | null>(null);

  useEffect(() => {
    if (mapInstanceRef.current || !mapContainerRef.current) return;
    
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: customMapStyleLight as StyleSpecification,
      center: [center.lng, center.lat], // MapLibre uses [lng, lat]
      zoom: zoom,
      attributionControl: false,
    });

    mapInstanceRef.current = map;

    // Add default controls (optional, could be configured via props)
    //map.addControl(new maplibregl.NavigationControl(), "top-right");
    //map.addControl(new maplibregl.FullscreenControl());
    // map.addControl(new maplibregl.GeolocateControl({...}), "top-right"); // Keep controls minimal
    // map.addControl(
    //   new maplibregl.AttributionControl({
    //     customAttribution:
    //       '© <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="http://openstreetmap.org">OpenStreetMap</a> contributors',
    //     compact: true,
    //   })
    // );

    // --- Event Listeners for View Changes ---
    const handleMoveEnd = () => {
      if (!onViewChange || !mapInstanceRef.current) return;
      const newCenter = mapInstanceRef.current.getCenter();
      const newZoom = mapInstanceRef.current.getZoom();
      onViewChange({ lat: newCenter.lat, lng: newCenter.lng }, newZoom);
    };

    const handleZoomEnd = () => {
      if (!onViewChange || !mapInstanceRef.current) return;
      const newCenter = mapInstanceRef.current.getCenter();
      const newZoom = mapInstanceRef.current.getZoom();
      onViewChange({ lat: newCenter.lat, lng: newCenter.lng }, newZoom);
    };

    map.on("moveend", handleMoveEnd);
    map.on("zoomend", handleZoomEnd);
    // ------------------------------------------

    map.on("load", () => {
      // --- Create the IMapProvider Adapter ---
      const providerAdapter: IMapProvider = {
        setCenter: (newCenter: LatLngLiteral) => {
          map.setCenter([newCenter.lng, newCenter.lat]);
        },
        setZoom: (newZoom: number) => {
          map.setZoom(newZoom);
        },
        getCenter: (): LatLngLiteral => {
          const currentCenter = map.getCenter();
          return {
            lat: currentCenter.lat,
            lng: currentCenter.lng,
          };
        },
        getZoom: (): number => {
          return map.getZoom();
        },
        flyTo: (newCenter: LatLngLiteral, newZoom?: number) => {
          map.flyTo({
            center: [newCenter.lng, newCenter.lat],
            zoom: newZoom ?? map.getZoom(), // Use current zoom if newZoom not provided
            essential: true,
          });
        },
        destroy: () => {
          if (mapInstanceRef.current) {
            // Remove event listeners before removing map
            mapInstanceRef.current.off("moveend", handleMoveEnd);
            mapInstanceRef.current.off("zoomend", handleZoomEnd);
            mapInstanceRef.current.remove(); // MapLibre has a remove method
            mapInstanceRef.current = null;
            providerRef.current = null;
            console.log("OpenFreeMap provider instance destroyed.");
          }
        },
      };
      // -----------------------------------------

      providerRef.current = providerAdapter;
      if (onLoad) {
        onLoad(providerAdapter);
      }
    });

    // Error handling
    map.on("error", (e) => {
      console.error("MapLibre Error:", e);
      // Potentially destroy map or notify user
    });

    // Cleanup function for the useEffect hook
    return () => {
      // The destroy method should be called by the parent before unmounting
      // This ensures the adapter's destroy logic is executed.
      // providerRef.current?.destroy(); // Let parent handle this
    };
  }, [onLoad, onViewChange]); // Add onViewChange to dependencies

  return (
    <div
      ref={mapContainerRef}
      className={cn("w-full h-full", className)}
      aria-label="OpenFreeMap"
      tabIndex={0}
    />
  );
};

export default OpenFreeMap;
