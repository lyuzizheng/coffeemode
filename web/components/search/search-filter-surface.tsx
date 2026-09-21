"use client";

/**
 * The filter surface (search-filters-v1 §3) — one control set, two
 * presentations: mobile gets the HeroUI bottom sheet, desktop the inline
 * collapsible section. Split out of `unified-search-panel.tsx` to keep the
 * panel under the 400-line budget (spec 0009 §3).
 */
import { Drawer } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { EMPTY_FILTERS, type SearchFilterState } from "@/lib/search/search-filters";
import { SearchFilterControls } from "./search-filter-ui";

export function FilterSurface({
  isDesktop,
  open,
  onOpenChange,
  filters,
  resultCount,
  onFiltersChange,
}: {
  isDesktop: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: SearchFilterState;
  resultCount: number | null;
  onFiltersChange: (next: SearchFilterState) => void;
}) {
  const t = useTranslations("search");
  const reduced = useReducedMotion() ?? false;
  const controls = (
    <SearchFilterControls
      filters={filters}
      resultCount={resultCount}
      onFiltersChange={onFiltersChange}
      onReset={() => onFiltersChange(EMPTY_FILTERS)}
    />
  );

  if (isDesktop) {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="filters"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-separator px-1 pt-2">{controls}</div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <Drawer.Root isOpen={open} onOpenChange={onOpenChange}>
      {/* Content MUST nest inside Backdrop — sibling placement leaks the
          backdrop (BRAWUKA-371, see checkin-drawer.tsx). */}
      <Drawer.Backdrop>
        <Drawer.Content placement="bottom" className="max-h-[85dvh] bg-overlay text-foreground">
          <Drawer.Dialog
            aria-label={t("filters")}
            className="flex max-h-[85dvh] flex-col"
          >
            <Drawer.Handle />
            <Drawer.Body className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {controls}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  );
}
