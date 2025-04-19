import axios, { AxiosError, AxiosResponse } from "axios";

// General API response structure
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

// Create API client function
export const createApiClient = (baseUrl: string) => {
  const apiClient = axios.create({
    baseURL: baseUrl,
    headers: {
      "Content-Type": "application/json",
    },
    timeout: 10000, // 10 seconds
  });

  // Response interceptor to standardize all responses
  apiClient.interceptors.response.use(
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

  return apiClient;
};
