import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { ApiResponse } from "@/types/api";

// Singleton instance
let apiClientInstance: AxiosInstance | null = null;

// Get or create the API client
export const getApiClient = (baseUrl: string): AxiosInstance => {
  if (!apiClientInstance) {
    apiClientInstance = axios.create({
      baseURL: baseUrl,
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 10000, // 10 seconds
    });

    // Response interceptor to standardize all responses
    apiClientInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        // If the response is already in our expected format, return it
        if (
          response.data &&
          "code" in response.data &&
          "message" in response.data &&
          "data" in response.data
        ) {
          return response;
        }

        // Otherwise, transform the response to match our format
        const apiResponse: ApiResponse<unknown> = {
          code: response.status,
          message: response.statusText || "Success",
          data: response.data,
        };

        response.data = apiResponse;
        return response;
      },
      (error: AxiosError) => {
        // Create a standardized error response
        const apiResponse: ApiResponse<null> = {
          code: error.response?.status || 500,
          message: error.message || "Unknown error occurred",
          data: null,
        };

        // Attach our standardized response to the error object
        if (error.response) {
          error.response.data = apiResponse;
        }

        return Promise.reject(error);
      }
    );
  }

  // Update the base URL in case it changes (e.g., environment switch)
  apiClientInstance.defaults.baseURL = baseUrl;

  return apiClientInstance;
};

// For backward compatibility
export const createApiClient = getApiClient;
