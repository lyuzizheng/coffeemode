import { OnboardingStatus } from "../types/user";

export const DEFAULT_ONBOARDING_STATUS: OnboardingStatus = {
  hasCompletedOnboarding: false,
  hasSeenWelcome: false,
  hasSeenTutorial: false,
  completedSteps: [],
};

export const DEFAULT_USER_PREFERENCES = {
  theme: "system",
  notifications: true,
  language: "en",
} as const;

export const createTemporaryUser = () => ({
  id: `temp_${Date.now()}`,
  preferences: DEFAULT_USER_PREFERENCES,
  onboardingStatus: DEFAULT_ONBOARDING_STATUS,
  createdAt: new Date(),
  lastVisit: new Date(),
});
