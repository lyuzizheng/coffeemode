import { createContext, ReactNode, useContext } from "react";

interface AppConfig {
  apiUrl: string;
  environment: "development" | "production" | "staging";
  features: {
    enableAnalytics: boolean;
    enableNotifications: boolean;
  };
}

const defaultConfig: AppConfig = {
  apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3000",
  environment:
    (import.meta.env.MODE as AppConfig["environment"]) || "development",
  features: {
    enableAnalytics: import.meta.env.VITE_ENABLE_ANALYTICS === "true",
    enableNotifications: import.meta.env.VITE_ENABLE_NOTIFICATIONS === "true",
  },
};

const ConfigContext = createContext<AppConfig>(defaultConfig);

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }
  return context;
};

interface ConfigProviderProps {
  children: ReactNode;
  config?: Partial<AppConfig>;
}

export const ConfigProvider = ({ children, config }: ConfigProviderProps) => {
  const mergedConfig = {
    ...defaultConfig,
    ...config,
  };

  return (
    <ConfigContext.Provider value={mergedConfig}>
      {children}
    </ConfigContext.Provider>
  );
};
