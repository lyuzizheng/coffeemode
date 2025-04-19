// Cafe type definitions based on backend model

export interface CafeLocation {
  address: string;
  lat: number;
  lng: number;
}

export interface CafeFeatures {
  wifiSpeedMbps: number;
  outletsAvailable: boolean;
  quietnessLevel: string;
  seatingCapacity: number;
}

export interface Cafe {
  id: string;
  name: string;
  location: CafeLocation;
  features: CafeFeatures;
  averageRating: number;
  totalReviews: number;
  thumbnails: string[]; // URLs for thumbnail images
  images: string[]; // URLs for full-size images
  website?: string;
  openingHours: Record<string, string>;
}

// Parameters for searching cafes by location
export interface CafeSearchParams {
  lat: number;
  lng: number;
  radius?: number; // Search radius in kilometers (optional)
}

// Parameter for getting cafe details
export interface CafeDetailsParams {
  id: string;
}
