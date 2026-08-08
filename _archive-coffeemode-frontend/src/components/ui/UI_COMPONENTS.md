# UI Components Documentation

Foundational design system components built with Shadcn/UI and Tailwind CSS for consistent styling and behavior across the application.

## Design System Overview

The UI components follow **Shadcn/UI** patterns with **class-variance-authority (CVA)** for type-safe styling variants and **Tailwind CSS** for utility-first styling.

```
┌─────────────────────┐
│   Shadcn/UI Base    │  ← Base component patterns
├─────────────────────┤
│   CVA Variants      │  ← Type-safe style variants
├─────────────────────┤
│   Tailwind CSS      │  ← Utility-first styling
├─────────────────────┤
│   Custom Logic      │  ← App-specific behavior
└─────────────────────┘
```

---

## Core Components

### 🔘 Button
**File**: `button.tsx`
**Purpose**: Primary interactive element with multiple variants and sizes

#### Props Interface
```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}
```

#### Variants

**Visual Variants**:
- **`default`**: Primary brand button (coffee theme)
- **`destructive`**: Danger/error actions (red theme)
- **`outline`**: Secondary actions with border
- **`secondary`**: Muted secondary actions
- **`ghost`**: Minimal styling, hover effects only
- **`link`**: Text-only, link-like appearance

**Size Variants**:
- **`default`**: Standard button size (h-10 px-4 py-2)
- **`sm`**: Small button (h-9 px-3)
- **`lg`**: Large button (h-11 px-8)
- **`icon`**: Square icon button (h-10 w-10)

#### Usage Examples
```tsx
import { Button } from '@/components/ui/button';

// Primary action
<Button variant="default" size="lg">
  Find Cafes
</Button>

// Secondary action
<Button variant="outline">
  Cancel
</Button>

// Icon button
<Button variant="ghost" size="icon">
  <Heart className="h-4 w-4" />
</Button>

// Destructive action
<Button variant="destructive">
  Delete Account
</Button>

// Link-style button
<Button variant="link">
  Learn More
</Button>
```

#### Styling Implementation
```typescript
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

#### Accessibility Features
- **Keyboard Navigation**: Full keyboard support
- **Focus Management**: Visible focus indicators
- **Screen Reader**: Proper button semantics
- **Disabled State**: Proper disabled handling
- **ARIA Support**: Compatible with ARIA attributes

---

### 🏷️ Badge
**File**: `badge.tsx`
**Purpose**: Small status indicators and labels

#### Props Interface
```typescript
interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}
```

#### Variants
- **`default`**: Primary badge (coffee theme)
- **`secondary`**: Muted secondary badge
- **`destructive`**: Error/warning badge (red theme)
- **`outline`**: Outlined badge with transparent background

#### Usage Examples
```tsx
import { Badge } from '@/components/ui/badge';

// Status indicators
<Badge variant="default">Open</Badge>
<Badge variant="destructive">Closed</Badge>
<Badge variant="secondary">Busy</Badge>
<Badge variant="outline">New</Badge>

// Amenity indicators
<Badge>WiFi</Badge>
<Badge>Pet Friendly</Badge>
<Badge>Outdoor Seating</Badge>
```

#### Styling Implementation
```typescript
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
```

#### Design Patterns
- **Color Coding**: Consistent color meanings across app
- **Size Consistency**: Uniform sizing for visual harmony
- **Spacing**: Proper spacing in lists and groups
- **Contrast**: Sufficient contrast for readability

---

### 📝 Input
**File**: `input.tsx`
**Purpose**: Text input field with consistent styling

#### Props Interface
```typescript
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // Inherits all standard HTML input props
}
```

#### Features
- **Consistent Styling**: Matches design system
- **Focus States**: Clear focus indicators
- **Placeholder Support**: Styled placeholder text
- **Disabled State**: Proper disabled styling
- **Error State**: Compatible with form validation

#### Usage Examples
```tsx
import { Input } from '@/components/ui/input';

// Search input
<Input 
  type="text" 
  placeholder="Search cafes..." 
  className="w-full"
/>

// Email input
<Input 
  type="email" 
  placeholder="Enter your email"
  required
/>

// Password input
<Input 
  type="password" 
  placeholder="Password"
/>

// Disabled input
<Input 
  value="Read only value"
  disabled
/>
```

#### Styling Implementation
```typescript
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
```

#### Form Integration
```tsx
// With form libraries
<form>
  <div className="space-y-4">
    <Input 
      {...register("search")}
      placeholder="Search cafes..."
    />
    {errors.search && (
      <p className="text-sm text-destructive">
        {errors.search.message}
      </p>
    )}
  </div>
</form>
```

---

### 👤 Avatar
**File**: `avatar.tsx`
**Purpose**: User profile image with fallback support

#### Component Structure
```typescript
// Root container
const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, ...props }, ref) => (
    <span className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)} ref={ref} {...props} />
  )
);

// Image component
const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, ...props }, ref) => (
    <img className={cn("aspect-square h-full w-full", className)} ref={ref} {...props} />
  )
);

// Fallback component
const AvatarFallback = React.forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  ({ className, ...props }, ref) => (
    <span className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className)} ref={ref} {...props} />
  )
);
```

#### Usage Examples
```tsx
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// With image and fallback
<Avatar>
  <AvatarImage src="/avatars/user.jpg" alt="User" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>

// Fallback only (initials)
<Avatar>
  <AvatarFallback>AB</AvatarFallback>
</Avatar>

// Different sizes
<Avatar className="h-8 w-8">
  <AvatarImage src="/avatars/small.jpg" />
  <AvatarFallback>SM</AvatarFallback>
</Avatar>

<Avatar className="h-16 w-16">
  <AvatarImage src="/avatars/large.jpg" />
  <AvatarFallback>LG</AvatarFallback>
</Avatar>
```

#### Fallback Patterns
```tsx
// User initials
const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Icon fallback
<Avatar>
  <AvatarImage src={user.avatar} />
  <AvatarFallback>
    <User className="h-4 w-4" />
  </AvatarFallback>
</Avatar>
```

---

### 📜 ScrollArea
**File**: `scroll-area.tsx`
**Purpose**: Custom scrollable area with styled scrollbars

#### Component Structure
```typescript
const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
);
```

#### Usage Examples
```tsx
import { ScrollArea } from '@/components/ui/scroll-area';

// Vertical scrolling
<ScrollArea className="h-72 w-48 rounded-md border">
  <div className="p-4">
    {items.map((item) => (
      <div key={item.id} className="text-sm">
        {item.name}
      </div>
    ))}
  </div>
</ScrollArea>

// Horizontal scrolling
<ScrollArea className="w-96 whitespace-nowrap rounded-md border">
  <div className="flex w-max space-x-4 p-4">
    {images.map((image) => (
      <img key={image.id} src={image.src} className="h-20 w-28 rounded-md" />
    ))}
  </div>
  <ScrollBar orientation="horizontal" />
</ScrollArea>
```

#### Scrollbar Customization
```typescript
const ScrollBar = React.forwardRef<HTMLDivElement, ScrollBarProps>(
  ({ className, orientation = "vertical", ...props }, ref) => (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent p-[1px]",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent p-[1px]",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
);
```

---

### 🃏 Card
**File**: `card.tsx`
**Purpose**: Container component for grouped content

#### Component Structure
```typescript
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  )
);

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);

const CardTitle = React.forwardRef<HTMLParagraphElement, CardTitleProps>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  )
);

const CardDescription = React.forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
```

#### Usage Examples
```tsx
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// Basic card
<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description goes here.</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card content...</p>
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>

// Cafe card example
<Card className="w-80">
  <CardHeader>
    <CardTitle>Blue Bottle Coffee</CardTitle>
    <CardDescription>0.2 km away</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="flex items-center space-x-2">
      <Badge>WiFi</Badge>
      <Badge>Pet Friendly</Badge>
    </div>
  </CardContent>
  <CardFooter className="justify-between">
    <span className="text-sm text-muted-foreground">$$</span>
    <Button size="sm">View Details</Button>
  </CardFooter>
</Card>
```

#### Layout Patterns
```tsx
// Grid layout
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {cafes.map((cafe) => (
    <Card key={cafe.id}>
      {/* Card content */}
    </Card>
  ))}
</div>

// List layout
<div className="space-y-4">
  {items.map((item) => (
    <Card key={item.id} className="flex items-center p-4">
      {/* Horizontal card content */}
    </Card>
  ))}
</div>
```

---

### 💡 TooltipProvider
**File**: `tooltip.tsx`
**Purpose**: Context provider for tooltip functionality

#### Component Structure
```typescript
const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  )
);
```

#### Usage Examples
```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// App-level provider
<TooltipProvider>
  <App />
</TooltipProvider>

// Individual tooltip
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="outline" size="icon">
      <Heart className="h-4 w-4" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>
    <p>Add to favorites</p>
  </TooltipContent>
</Tooltip>

// With delay
<Tooltip delayDuration={300}>
  <TooltipTrigger>Hover me</TooltipTrigger>
  <TooltipContent side="top">
    <p>Tooltip content</p>
  </TooltipContent>
</Tooltip>
```

#### Positioning Options
```tsx
// Different sides
<TooltipContent side="top">Top tooltip</TooltipContent>
<TooltipContent side="bottom">Bottom tooltip</TooltipContent>
<TooltipContent side="left">Left tooltip</TooltipContent>
<TooltipContent side="right">Right tooltip</TooltipContent>

// Custom offset
<TooltipContent sideOffset={10}>
  Tooltip with custom offset
</TooltipContent>

// Alignment
<TooltipContent align="start">Start aligned</TooltipContent>
<TooltipContent align="center">Center aligned</TooltipContent>
<TooltipContent align="end">End aligned</TooltipContent>
```

---

## Design System Integration

### Theme Configuration
```typescript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
    },
  },
};
```

### CSS Variables
```css
/* globals.css */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222.2 84% 4.9%;
  --muted: 210 40% 96%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96%;
  --accent-foreground: 222.2 84% 4.9%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
  --radius: 0.5rem;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... dark theme variables */
}
```

### Utility Functions
```typescript
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## Accessibility Standards

### Keyboard Navigation
- **Tab Order**: Logical tab sequence
- **Focus Indicators**: Visible focus outlines
- **Keyboard Shortcuts**: Standard shortcuts (Enter, Space, Escape)
- **Focus Management**: Proper focus trapping in modals

### Screen Reader Support
- **Semantic HTML**: Proper HTML elements
- **ARIA Labels**: Descriptive labels
- **Live Regions**: Dynamic content announcements
- **Landmarks**: Navigation landmarks

### Color and Contrast
- **WCAG AA**: Minimum 4.5:1 contrast ratio
- **Color Independence**: Information not conveyed by color alone
- **High Contrast**: Support for high contrast mode
- **Dark Mode**: Full dark theme support

### Motion and Animation
- **Reduced Motion**: Respect `prefers-reduced-motion`
- **Animation Duration**: Reasonable animation timing
- **Focus Animations**: Smooth focus transitions
- **Loading States**: Clear loading indicators

## Performance Considerations

### Bundle Size
- **Tree Shaking**: Only import used components
- **Code Splitting**: Lazy load heavy components
- **CSS Optimization**: Purge unused CSS
- **Icon Optimization**: Use icon libraries efficiently

### Runtime Performance
- **Memoization**: Memoize expensive calculations
- **Event Handling**: Debounce frequent events
- **DOM Updates**: Minimize DOM manipulations
- **Memory Leaks**: Clean up event listeners

### Loading Performance
- **Critical CSS**: Inline critical styles
- **Font Loading**: Optimize font loading
- **Image Optimization**: Responsive images
- **Preloading**: Preload important resources

## Testing Strategies

### Unit Testing
```typescript
// Button.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('renders with correct variant', () => {
    render(<Button variant="destructive">Delete</Button>);
    const button = screen.getByRole('button', { name: /delete/i });
    expect(button).toHaveClass('bg-destructive');
  });

  it('handles click events', async () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    
    await userEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is accessible', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});
```

### Visual Testing
```typescript
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Button',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};
```

### Integration Testing
```typescript
// Form integration test
it('submits form with button click', async () => {
  const handleSubmit = jest.fn();
  render(
    <form onSubmit={handleSubmit}>
      <Input name="email" placeholder="Email" />
      <Button type="submit">Submit</Button>
    </form>
  );

  await userEvent.type(screen.getByPlaceholderText('Email'), 'test@example.com');
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));
  
  expect(handleSubmit).toHaveBeenCalled();
});
```

## Future Enhancements

### Component Additions
1. **Dialog/Modal**: Modal dialogs and overlays
2. **Dropdown Menu**: Context menus and dropdowns
3. **Select**: Custom select components
4. **Checkbox/Radio**: Form input components
5. **Tabs**: Tabbed navigation
6. **Accordion**: Collapsible content
7. **Progress**: Progress indicators
8. **Skeleton**: Loading placeholders

### Feature Enhancements
1. **Animation Library**: Framer Motion integration
2. **Form Library**: React Hook Form integration
3. **Validation**: Zod schema validation
4. **Internationalization**: i18n support
5. **Theme Switching**: Dynamic theme switching
6. **Component Variants**: More style variants
7. **Size Variants**: Additional size options
8. **Custom Hooks**: Reusable component logic

### Developer Experience
1. **Documentation**: Interactive documentation
2. **Code Generation**: Component generators
3. **Design Tokens**: Automated design token sync
4. **Testing Utilities**: Component testing helpers
5. **Performance Monitoring**: Component performance metrics
6. **Accessibility Auditing**: Automated a11y testing
7. **Visual Regression**: Automated visual testing
8. **Bundle Analysis**: Component bundle analysis