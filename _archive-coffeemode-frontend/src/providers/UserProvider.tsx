import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { STORAGE_KEYS } from "../constants/storage";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { User, UserPreferences } from "../types/user";

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  updateUser: (user: User) => void;
  updatePreferences: (preferences: Partial<UserPreferences>) => void;
  logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};

interface UserProviderProps {
  children: ReactNode;
}

export const UserProvider = ({ children }: UserProviderProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useLocalStorage<User | null>(STORAGE_KEYS.USER, null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        // TODO: Replace with actual API call
        // const response = await fetch('/api/user/profile');
        // const userData = await response.json();
        // setUser(userData);
      } catch (error) {
        console.error("Failed to fetch user:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, []);

  // Update entire user object
  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
  };

  // Convenient method to update just preferences
  const updatePreferences = (newPreferences: Partial<UserPreferences>) => {
    if (!user) return;

    setUser({
      ...user,
      preferences: {
        ...user.preferences,
        ...newPreferences,
      },
    });
  };

  const logout = () => {
    setUser(null);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        isLoading,
        updateUser,
        updatePreferences,
        logout,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
