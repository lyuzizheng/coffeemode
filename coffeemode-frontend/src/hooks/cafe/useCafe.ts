import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../../providers/ConfigProvider";
import { getApiClient } from "../../services/api";
import { ApiResponse } from "@/types/api";
import { Cafe, CafeDetailsParams, CafeSearchParams } from "../../types/cafe";

// Query keys for caching
export const cafeKeys = {
  all: ["cafes"] as const,
  lists: () => [...cafeKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...cafeKeys.lists(), filters] as const,
  details: () => [...cafeKeys.all, "detail"] as const,
  detail: (id: string) => [...cafeKeys.details(), id] as const,
};

/**
 * Hook for fetching cafes near a specified location
 */
export const useNearbyLocations = (params: CafeSearchParams) => {
  const config = useConfig();
  const apiClient = getApiClient(config.apiUrl);

  return useQuery<ApiResponse<Cafe[]>>({
    queryKey: cafeKeys.list({
      lat: params.lat,
      lng: params.lng,
      radius: params.radius,
    }),
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Cafe[]>>(
        "/api/cafes/nearby",
        {
          params: {
            lat: params.lat,
            lng: params.lng,
            radius: params.radius || 5, // Default 5km radius if not specified
          },
        }
      );
      return response.data;
    },
    retry: 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!params.lat && !!params.lng, // Only run when coordinates are provided
  });
};

/**
 * Hook for fetching a cafe by ID
 */
export const useCafeById = (params: CafeDetailsParams) => {
  const config = useConfig();
  const apiClient = getApiClient(config.apiUrl);

  return useQuery<ApiResponse<Cafe>>({
    queryKey: cafeKeys.detail(params.id),
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Cafe>>(
        `/api/cafes/${params.id}`
      );
      return response.data;
    },
    retry: 2,
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!params.id, // Only run when ID is provided
  });
};

/**
 * Hook to get the user's current geolocation
 */
export const useCurrentLocation = () => {
  const requestLocation = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by your browser"));
        return;
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      });
    });
  };

  return { requestLocation };
};

/**
 * Hook to search cafes by current location
 */
export const useNearbyLocationsFromCurrentPosition = (radius?: number) => {
  const { requestLocation } = useCurrentLocation();
  const config = useConfig();
  const apiClient = getApiClient(config.apiUrl);

  return useQuery<ApiResponse<Cafe[]>>({
    queryKey: cafeKeys.list({ currentLocation: true, radius }),
    queryFn: async () => {
      try {
        const position = await requestLocation();
        const { latitude, longitude } = position.coords;

        const response = await apiClient.get<ApiResponse<Cafe[]>>(
          "/api/cafes/nearby",
          {
            params: {
              lat: latitude,
              lng: longitude,
              radius: radius || 5, // Default 5km radius if not specified
            },
          }
        );
        return response.data;
      } catch (error) {
        throw new Error(
          "Failed to get nearby cafes: " +
            (error instanceof Error ? error.message : "Unknown error")
        );
      }
    },
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
