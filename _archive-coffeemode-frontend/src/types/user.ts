export interface User {
  id: string;
  email?: string;
  name?: string;
  preferences: UserPreferences;
  onboardingStatus: OnboardingStatus;
  createdAt: Date;
  lastVisit: Date;
}

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  notifications: boolean;
  language: string;
}

export interface OnboardingStatus {
  hasCompletedOnboarding: boolean;
  hasSeenWelcome: boolean;
  hasSeenTutorial: boolean;
  completedSteps: string[];
}

export interface UserSession {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  error: Error | null;
}
