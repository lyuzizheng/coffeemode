import { useConfig } from "@/providers/ConfigProvider";
import { getApiClient } from "@/services/api";
import { ApiResponse } from "@/types/api";
import {
  ResolvePlaceRequestDto,
  ResolvePlaceResponseDto,
} from "@/types/googleMaps";
import { useQuery } from "@tanstack/react-query";

// Hook providing Google Maps related API calls
export const useResolvePlace = () => {
  const { apiUrl } = useConfig();
  const client = getApiClient(apiUrl);

  const resolvePlace = async (
    payload: ResolvePlaceRequestDto
  ): Promise<ApiResponse<ResolvePlaceResponseDto>> => {
    const res = await client.post("/api/google-maps/resolve", payload);
    return res.data as ApiResponse<ResolvePlaceResponseDto>;
  };

  const useResolvePlaceQuery = (
    payload: ResolvePlaceRequestDto | null,
    enabled = true
  ) => {
    return useQuery<ApiResponse<ResolvePlaceResponseDto>>({
      queryKey: ["googleMaps", "resolve", payload],
      queryFn: async () => {
        if (!payload) {
          return { code: 400, message: "No payload", data: null };
        }
        const res = await client.post("/api/google-maps/resolve", payload);
        return res.data as ApiResponse<ResolvePlaceResponseDto>;
      },
      enabled: enabled && !!payload,
      retry: 1,
      staleTime: 0,
    });
  };

  return { resolvePlace, useResolvePlaceQuery };
};