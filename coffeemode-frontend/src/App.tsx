import { CafeCarousel } from "./components/cafe";
import { Header } from "./components/layout";
import { MapContainer, MapControls } from "./components/map";
import { AddPlaceButton } from "./components/ui";

function App() {
  return (
    <div className="relative h-screen overflow-hidden bg-background">
      {/* Map Background - Takes full space */}
      <MapContainer className="absolute inset-0 w-full h-full z-0" />

      {/* Floating Header - Stays at the top */}
      <Header className="absolute top-4 left-4 right-4 z-20" />

      {/* Map Controls - Positioned on the right */}
      <MapControls className="absolute top-20 right-4 z-10" />

      {/* Cafe Carousel - Positioned at the bottom */}
      <div className="absolute bottom-4 left-0 right-0 px-4 z-10">
        <CafeCarousel />
      </div>

      {/* Add New Place FAB - Positioned bottom-right */}
      {/* TODO: Add logic to only show FAB for logged-in users */}
      <AddPlaceButton className="absolute bottom-28 right-4 z-10" />
    </div>
  );
}

export default App;
