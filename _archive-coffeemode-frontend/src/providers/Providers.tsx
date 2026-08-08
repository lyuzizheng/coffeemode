import { ReactNode } from "react";
import { ConfigProvider } from "./ConfigProvider";
import { QueryProvider } from "./QueryProvider";
import { UserProvider } from "./UserProvider";

interface ProvidersProps {
  children: ReactNode;
}

export const Providers = ({ children }: ProvidersProps) => {
  return (
    <QueryProvider>
      <ConfigProvider>
        <UserProvider>{children}</UserProvider>
      </ConfigProvider>
    </QueryProvider>
  );
};
