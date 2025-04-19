# Coffee Mode Frontend - Project Notes

## 1. Project Overview

**Coffee Mode** is a modern web application designed to help users find suitable locations (cafes, libraries, public spaces) for working or studying remotely. Built with React, TypeScript, Vite, and styled with TailwindCSS & Shadcn UI, the project emphasizes a clean user interface, detailed location information, and community contributions.

**Core Problem:** Finding locations with specific amenities like reliable Wi-Fi, power outlets, comfortable seating, and a conducive noise level can be challenging. Existing tools like Google Maps lack this detailed, work-focused information, while alternatives like blog posts or social media (e.g., Xiaohongshu) are scattered and lack structure.

**Solution:** A map-centric web application that aggregates and displays detailed information about work-friendly locations, powered by user contributions and curated data. It prioritizes clarity, usability, and the specific needs of remote workers and students.

**Target Audience:** Initially focusing on Singapore (SG), the app targets students, remote workers, freelancers, and anyone looking for temporary places to work or study outside their home or office.

## 2. Key Features

**User-Facing:**

* **Interactive Map Display:** Browse nearby locations visually on a map.
* **Detailed Location Information:** Access specific details like power outlet availability, Wi-Fi quality, noise level, comfort ratings, price range, operating hours, etc.
* **Advanced Filtering:** Filter locations based on essential amenities (plugs, Wi-Fi) and preferences (noise, comfort, type).
* **User Contributions:** Allow users to add new places, update existing information, upload photos, and write reviews.
* **Check-ins & Ratings:** Users can "check-in" to locations and provide ratings for various aspects.
* **User Profiles:** Track contributions, check-ins, and saved/favorited locations.
* **Search Functionality:** Find specific locations or search areas.
* **Responsive Design:** Fully usable across desktop and mobile devices.
* **Dark Mode Support:** Offers a comfortable viewing experience in low-light conditions.

**Technical:**

* User Authentication and Authorization (via Firebase Auth, Logto, or Supabase - TBD).
* Environment-based Configuration Management.
* Type-safe Development with TypeScript.
* Modern React Patterns (Hooks, Context API).
* Efficient Data Fetching & Caching (using Tanstack Query).
* Clean Architecture with clear separation of concerns.

## 3. Technology Stack

* **Framework/Library:** React 18+
* **Language:** TypeScript
* **Build Tool:** Vite
* **Styling:** TailwindCSS
* **UI Components:** Shadcn UI (leveraging Radix UI + TailwindCSS)
* **State Management:**
  * React Context API (`UserProvider`, `ConfigProvider`) for global state (auth, config).
  * Tanstack Query (React Query) for server state management (fetching, caching, mutations).
  * Component-local state (useState, useReducer) for UI state.
* **Routing:** (Assumed: React Router or similar, managed within `App.tsx`)
* **Map Library:** Google Maps Platform SDK (implemented with a keyless solution stored locally)
* **Linting/Formatting:** ESLint, Prettier

## 4. Project Structure

```
coffeemode-frontend/
├── public/                  # Public static files (e.g., favicons)
│   └── js/                  # JavaScript assets served directly
│       └── mapsJavaScriptAPI.js  # Embedded Google Maps API script (keyless)
├── src/                      # Source code directory
│   ├── assets/              # Static assets (images, fonts, etc.)
│   ├── components/          # Reusable UI components (built with Shadcn UI / custom)
│   │   ├── ui/              # Shadcn UI generated components (Button, Card, etc.)
│   │   ├── map/             # Map-related components for displaying and interacting with Google Maps
│   │   └── core/            # Custom application-specific components (e.g., MapView, LocationCard)
│   ├── constants/           # Application constants (e.g., routes, config keys)
│   ├── hooks/               # Custom React hooks (e.g., useUser, useConfig)
│   ├── lib/                 # Reusable utility functions (shadcn convention, similar to utils)
│   │   └── utils.ts         # General utilities, including cn() for Tailwind class merging
│   ├── providers/           # React context providers (Providers, UserProvider, ConfigProvider)
│   ├── services/            # API integration logic (e.g., api.ts, specific service files)
│   ├── features/            # Feature-based modules (e.g., map, location, auth) - *Consider adding this layer for larger features*
│   ├── types/               # TypeScript type definitions (global or shared types)
│   │   └── google-maps.d.ts # TypeScript declaration file for Google Maps API
│   ├── App.tsx              # Main application component (layout, routing)
│   ├── main.tsx             # Application entry point
│   └── index.css            # Global styles, Tailwind directives, theme variables
├── package.json             # Project dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build configuration
├── tailwind.config.js      # TailwindCSS configuration
└── postcss.config.js       # PostCSS configuration (needed for Tailwind)
```

*(Note: Added `lib/utils.ts` typical for Shadcn, `services` as a potential alternative/complement to `utils/api.ts`, and suggested `features` directory for modularity)*

## 5. Getting Started

1. **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd coffeemode-frontend
    ```

2. **Install dependencies:**

    ```bash
    pnpm install
    ```

3. **Set up environment variables:**
    * Create a `.env` file in the root directory.
    * Add necessary environment variables (e.g., API endpoints, Firebase config). Refer to `.env.example` if available.
4. **Run the development server:**

    ```bash
    pnpm dev
    ```

    The application should now be running on `http://localhost:5173` (or the port specified by Vite).

## 6. Development Scripts

* `pnpm dev`: Start the development server with Hot Module Replacement (HMR).
* `pnpm build`: Build the application for production.
* `pnpm preview`: Preview the production build locally.
* `pnpm lint`: Lint the codebase using ESLint.

## 7. Core Architectural Concepts

* **Clean Architecture:** Strive for separation of concerns. UI components, business logic (hooks, providers), and data fetching (services, Tanstack Query) should be distinct.
* **Component-Based:** Build the UI using reusable functional components. Leverage Shadcn UI components for foundational elements and create custom components for specific application needs.
* **Context for Global State:** Use `UserProvider` and `ConfigProvider` for managing authentication state and application-wide configuration. Avoid overusing context for server state.
* **Server State Management:** Utilize Tanstack Query for fetching, caching, synchronizing, and updating server state. This handles loading states, error states, and background updates effectively.

## 8. Detailed Design & UI/UX Notes

**Overall Philosophy:**

* **Information First:** Quickly surface the most critical information (plugs, Wi-Fi, noise) users need to make a decision.
* **Clarity & Simplicity:** Maintain an uncluttered interface with intuitive navigation. Avoid overwhelming the user.
* **Visual Appeal:** Utilize the defined TailwindCSS theme (see `index.css`), high-quality icons (consistent set), and good typography for a modern, pleasing aesthetic. Leverage Shadcn UI's clean style.
* **Encourage Contribution:** Make adding/editing information straightforward and low-friction.

**Key Screens & Components:**

1. **Main Map View (Core User Journey Start):**
    * **Layout:** Dominated by an interactive map. Floating Search Bar at the top. Filter icon nearby. "Find Me" / Geolocation button. Draggable Bottom Sheet for list view. Add Place FAB (Floating Action Button) for logged-in users.
    * **Map Markers:** Custom, visually distinct markers. Potentially subtle visual cues for key amenities. Clicking a marker highlights it and shows the `LocationPreviewCard`.
    * **Bottom Sheet:** Collapsed state shows handle/count. Partial state shows 2-3 `LocationCard` previews. Expanded state shows a scrollable list of `LocationCard`s.
    * **Filtering Panel:** Slides/appears on filter icon tap. Includes toggles (Plugs, Wi-Fi), sliders/segmented controls (Noise, Comfort, Price), checkboxes (Type).
    * **Components:** `MapView` (wrapping map library), `SearchBar`, `FilterPanel`, `LocationCard`, `AddPlaceButton`.

2. **Location Preview Card (Quick Info):**
    * **Purpose:** Shown on marker click or in the bottom sheet list. Provides a quick glance without navigating away.
    * **Content:** Thumbnail photo, Name, Distance, Overall Rating (Stars), Key Amenity Icons (e.g., Plug, Wi-Fi, Noise - using consistent icons). "View Details" link/button.
    * **Components:** `LocationCard` (potentially variants for preview vs. list item).

3. **Location Detail View (Full Information):**
    * **Layout:** Typically a full-screen view or large modal/slide-up panel overlaying the map.
    * **Header:** Hero image/carousel, Name, Address, Rating, Action Buttons (Check-In, Save, Directions).
    * **Information Sections:** Likely using Tabs (`Tabs` component from Shadcn) or distinct scrollable sections.
        * **Overview/Details:** Grid/list of all amenities (Plugs, Wi-Fi, Noise, Comfort, Price, AC, Water, Time Limit, Hours, Food Rating, Type) with clear icons, labels, and user-provided details/notes.
        * **Reviews:** List of user reviews (`ReviewCard` components).
        * **Photos:** Gallery of user photos.
    * **Contribution Actions:** Clearly visible buttons/links ("Add/Edit Details", "Upload Photo", "Report Issue").
    * **Components:** `LocationDetailHeader`, `AmenityGrid`, `ReviewList`, `PhotoGallery`, `TabbedSections`, `ContributionActions`.

4. **Contribution Flow (Adding/Editing Data):**
    * **Check-in:** Simple action, possibly with a quick context question (e.g., current busyness).
    * **Add/Edit Details:** Form using standard Shadcn input components (Switch, Slider, Input, Select, Textarea) corresponding to the amenity fields. Prioritize ease of updating single pieces of info.
    * **Add New Place:** Multi-step process: Map placement/search -> Basic info (Name, Type) -> Detailed info form -> Photo upload (optional).
    * **Components:** `CheckInButton`, `EditDetailsForm`, `AddNewPlaceWizard`.

5. **User Profile Page:**
    * **Layout:** Clean dashboard style.
    * **Content:** User info, Key Stats (Check-ins, Contributions), Tabs for My Check-ins, My Contributions, Saved Places.
    * **Components:** `UserProfileHeader`, `StatsDisplay`, `UserActivityTabs`.

**Visual Style & Interaction:**

* **Theme:** Adhere to the light/dark themes defined in `index.css` using CSS variables. Utilize `bg-background`, `text-foreground`, `bg-card`, `text-primary`, etc., consistently.
* **Components:** Leverage Shadcn UI components (`Button`, `Card`, `Input`, `Tabs`, `Sheet`, `Dialog`, `Avatar`, etc.) for a consistent look and feel and accessibility.
* **Responsiveness:** Use Tailwind's responsive modifiers (`sm:`, `md:`, `lg:`) extensively.
* **Interactions:** Employ subtle transitions and animations (e.g., sheet sliding, button presses) for a polished feel. Use libraries like `framer-motion` if complex animations are needed, but start simple.

## 9. Development Guidelines

1. **Functional Components & Hooks:** Use functional components and React Hooks exclusively.
2. **TypeScript:** Maintain strict type safety. Define clear interfaces (`src/types/`) for data structures (API responses, component props, context values). Use utility types where helpful.
3. **Project Structure:** Adhere to the defined project structure. Consider creating feature directories (`src/features/`) as the application grows.
4. **Error Handling:** Implement robust error handling for API calls (using Tanstack Query's error state) and within components (Error Boundaries if necessary).
5. **Code Style:** Maintain clean, readable, and maintainable code. Follow ESLint/Prettier rules (`pnpm lint`).
6. **Styling:** Use TailwindCSS utility classes for styling. Leverage `@apply` in `index.css` sparingly for base styles or complex component layers. Use `cn` utility from `lib/utils` for conditional class merging.
7. **Accessibility (a11y):** Follow accessibility best practices. Use semantic HTML. Ensure interactive elements are keyboard-navigable and focusable. Use ARIA attributes where appropriate. Leverage Shadcn UI's built-in accessibility.
8. **Reusability:** Create reusable components (`src/components/`) and hooks (`src/hooks/`) where applicable.
9. **API Calls:** Centralize API interaction logic within `src/services/` or `src/utils/api.ts`. Use Tanstack Query hooks for data fetching/mutation in components or custom hooks.

## 10. State Management

* **User State:** Managed globally via `UserProvider` and accessed via the `useUser` hook. Handles authentication status, user profile data.
* **Configuration State:** Managed globally via `ConfigProvider` and accessed via the `useConfig` hook. Handles environment-specific settings (API keys, feature flags).
* **Server Cache State:** Managed by Tanstack Query. Use query keys strategically to manage cache invalidation and updates.
* **UI State:** Managed locally within components using `useState`, `useReducer`, or through props drilling for simple cases. For complex local state shared between a few components, consider composition or custom hooks.

## 11. API Integration

* **Client:** A pre-configured Axios instance or `fetch`-based client likely exists in `src/services/api.ts` or `src/utils/api.ts`.
* **Data Fetching:** Use Tanstack Query's `useQuery` hook for fetching data. Define query keys carefully.
* **Data Mutation:** Use Tanstack Query's `useMutation` hook for creating, updating, or deleting data. Implement `onSuccess` and `onError` handlers for feedback and cache updates.
* **Loading/Error States:** Leverage Tanstack Query's `isLoading`, `isError`, `error` states to provide feedback in the UI.
* **Types:** Ensure API request/response payloads are strongly typed using interfaces defined in `src/types/`.

## 12. Styling

* **TailwindCSS:** Primary styling method using utility classes. Configure custom styles/variants in `tailwind.config.js`.
* **Shadcn UI:** Provides pre-built, unstyled components accessible via the CLI (`pnpm dlx shadcn-ui@latest add [component]`). Style these using Tailwind utilities.
* **Theme:** Light and Dark modes are configured in `src/index.css` using CSS variables. Apply the `dark` class to the root element to toggle modes (likely handled in `Providers.tsx` or `App.tsx`).
* **Class Merging:** Use the `cn` utility function (imported from `@/lib/utils`) for merging Tailwind classes, especially for conditional styling in components.
* **Global Styles:** Minimal global styles are defined in `src/index.css` using `@layer base`. Avoid adding many custom CSS classes; prefer Tailwind utilities.

## 13. Testing

* **Unit Tests:** Use Vitest or Jest with React Testing Library (`@testing-library/react`) to test individual components, hooks, and utility functions. Focus on testing behavior from the user's perspective.
* **Integration Tests:** Test critical user flows involving multiple components and context interaction (e.g., login flow, adding a location).
* **Mocking:** Use libraries like `msw` (Mock Service Worker) or Vitest/Jest mocking capabilities to mock API requests during tests.

## 14. Dependencies

*(Refer to `package.json` for the full, up-to-date list)*

* **Core:** `react`, `react-dom`, `typescript`
* **Build:** `vite`
* **Styling:** `tailwindcss`, `postcss`, `autoprefixer`
* **UI:** `shadcn-ui` (meta-package/CLI), `@radix-ui/*`, `lucide-react` (icons)
* **Data Fetching:** `@tanstack/react-query`
* **Utilities:** `clsx`, `tailwind-merge` (used by `cn` utility)
* **(Potential):** `react-router-dom` (routing), map library (`mapbox-gl`, `react-map-gl`, `leaflet`), state management helpers (`zustand` if context becomes complex), animation (`framer-motion`).

## 15. Notes for AI Assistance

When assisting with development on this codebase:

1. **Check Types:** Always refer to `src/types/` and existing interfaces/types before implementing new functionality. Ensure strong typing.
2. **Follow Patterns:** Observe existing patterns in components, hooks, and services. Maintain consistency (e.g., how data is fetched, how state is managed, how components are structured).
3. **Code Style:** Adhere to the established code style enforced by ESLint/Prettier.
4. **Context Providers:** Be mindful of `UserProvider` and `ConfigProvider`. Use the associated hooks (`useUser`, `useConfig`) to access global state.
5. **TypeScript:** Ensure all new code, props, variables, and functions have proper TypeScript types. Use `unknown` or `any` sparingly and only when absolutely necessary with justification.
6. **Accessibility:** Implement UI elements with accessibility in mind. Leverage Shadcn UI's accessible components.
7. **Utilities:** Utilize existing helper functions in `src/lib/utils.ts` or other utility modules where appropriate (e.g., `cn` for class names).
8. **Shadcn UI:** Prefer using or customizing Shadcn UI components over building primitive elements from scratch unless there's a specific need.

## 16. Map Implementation

The application uses Google Maps JavaScript API for displaying and interacting with maps. We're using a keyless implementation based on the [Keyless-Google-Maps-API](https://github.com/somanchiu/Keyless-Google-Maps-API) library, which allows us to use Google Maps without requiring an API key. We have also installed `@types/google.maps` for TypeScript support.

**Key Components:**

1. **Map Component** (`src/components/map/Map.tsx`):
   * Core map component that loads the Google Maps API and renders the map.
   * Accepts `mapOptions` prop to allow customization of Google Maps settings (e.g., controls, styles).
   * Handles map initialization and updates.
   * Sets the position for the `myLocationControl` if it is enabled via `mapOptions`.
   * Responsive to prop changes (center, zoom).

2. **Map Container** (`src/components/map/MapContainer.tsx`):
   * Wrapper component that handles map-related state and logic, such as user geolocation.
   * Fetches the user's current location and centers the map initially if available.
   * Passes necessary options (`myLocationControl: true`) to the `Map` component to enable the default Google Maps "My Location" button.
   * Previously had a custom "Find Me" button, which has been removed in favour of the default Google Maps control.

## 17. Future Considerations / To-Do

* **API Key Implementation:** For production use and access to more Google Maps Platform features, transition from the keyless implementation to a proper API key setup, managed securely.
* **Place Details Integration:** Fetch and display detailed place information from a backend API onto the map/location details view.
* **Advanced Map Features:** Consider implementing clustering for markers, drawing tools for selecting areas, or integration with Directions service.

---

This expanded document provides a comprehensive overview for developers joining the project, combining the technical foundation with the product vision and design details.
