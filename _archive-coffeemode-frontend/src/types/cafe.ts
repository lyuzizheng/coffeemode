// Cafe type definitions based on backend model

import React from "react";

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
  imageUrl: string; // Placeholder for image URL
  distance: number; // in km
  priceRange: PriceRange;
  rating: number; // e.g., 4.7
  isOpen: boolean;
  openStatusLabel: OpenStatus;
  isFavorite: boolean;
  amenities: Amenity[];
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

export type AmenityStatus = "available" | "limited" | "unavailable" | "unknown";
export type PriceRange = "$" | "$$" | "$$$" | "Free" | "Unknown";
export type OpenStatus = "Open" | "Closed" | "Opening Soon" | "Closing Soon";

export interface Amenity {
  icon: React.ElementType; // Use Lucide icon component
  status: AmenityStatus;
  label: string;
  colorClass: string; // Tailwind color class for background/icon
}
