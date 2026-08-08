import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Coffee, Filter, Heart, Search, UserCircle } from "lucide-react";

interface HeaderProps {
  className?: string;
}

const Header = ({ className }: HeaderProps) => {
  // TODO: Replace with actual user data and authentication status
  const isLoggedIn = false;
  const userInitials = "JS";
  const userImageUrl = ""; // Optional: Add user avatar URL

  const handleFilterClick = () => {
    // TODO: Implement filter panel toggle/logic
    console.log("Filter button clicked");
  };

  const handleFavoritesClick = () => {
    // TODO: Implement navigation to favorites page or show favorites
    console.log("Favorites button clicked");
  };

  const handleLoginClick = () => {
    // TODO: Implement login/profile modal or navigation
    console.log("Login/Profile button clicked");
  };

  return (
    <header
      className={cn(
        "absolute top-4 left-4 right-4 flex items-center justify-between z-50 gap-2 md:gap-4",
        className
      )}
    >
      {/* Logo and Brand - Adjusted styling */}
      <div className="hidden sm:flex items-center space-x-2 bg-card bg-opacity-95 py-2 px-3 rounded-lg shadow-md flex-shrink-0">
        <Coffee className="w-6 h-6 text-coffee-600" />
        <h1 className="text-lg font-bold text-coffee-800 whitespace-nowrap">
          Coffee Mode
        </h1>
      </div>

      {/* Search Bar - Using Shadcn Input */}
      <div className="flex-1 min-w-0 max-w-xl mx-auto">
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="w-4 h-4 text-muted-foreground" />
          </div>
          <Input
            type="text"
            placeholder="Find a place to work..."
            className="pl-10"
            aria-label="Search for places"
          />
        </div>
      </div>

      {/* User Controls - Using Shadcn Button & Avatar */}
      <div className="flex items-center space-x-2 flex-shrink-0">
        {/* Filter Button */}
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full hover:bg-accent h-10 w-10"
          onClick={handleFilterClick}
          aria-label="Open filters"
        >
          <Filter className="w-5 h-5" />
        </Button>

        {/* Favorites Button */}
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full hover:bg-primary/90 h-10 w-10"
          onClick={handleFavoritesClick}
          aria-label="View favorites"
        >
          <Heart className="w-5 h-5" />
        </Button>

        {/* Login/Avatar Button */}
        <Button
          variant="default"
          size="icon"
          className="rounded-full hover: h-10 w-10"
          onClick={handleLoginClick}
          aria-label={isLoggedIn ? "View profile" : "Login or Sign up"}
        >
          {isLoggedIn ? (
            <Avatar>
              {userImageUrl && (
                <AvatarImage src={userImageUrl} alt="User avatar" />
              )}
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
          ) : (
            <UserCircle className="w-5 h-5" />
          )}
        </Button>
      </div>
    </header>
  );
};

export default Header;
