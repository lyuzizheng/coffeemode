import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import Map from "./Map";

export interface MapContainerProps {
  className?: string;
  initialCenter?: google.maps.LatLngLiteral;
  initialZoom?: number;
}

const MapContainer = ({
  className,
  initialCenter = { lat: 1.3521, lng: 103.8198 }, // Default center at Singapore
  initialZoom = 14,
}: MapContainerProps) => {
  const [userLocation, setUserLocation] =
    useState<google.maps.LatLngLiteral | null>(null);

  // Try to get user's geolocation when component mounts
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting user location:", error);
        }
      );
    }
  }, []);

  const handleMapLoad = (map: google.maps.Map) => {
    // If user location is available, center the map on it
    if (userLocation && map) {
      map.setCenter(userLocation);
    }
  };

  // Define map options: only enable the control here
  const mapOptions: Partial<google.maps.MapOptions> = {
    myLocationControl: true,
    // myLocationControlOptions will be set in the Map component
  };

  return (
    <div className={cn("relative w-full h-full", className)}>
      <Map
        center={userLocation || initialCenter}
        zoom={initialZoom}
        onMapLoad={handleMapLoad}
        className="w-full h-full"
        mapOptions={mapOptions} // Pass map options
      />
    </div>
  );
};

export default MapContainer;
