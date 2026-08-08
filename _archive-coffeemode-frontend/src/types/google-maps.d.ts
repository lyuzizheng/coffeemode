declare namespace google {
  namespace maps {
    class Map {
      constructor(element: HTMLElement, options?: MapOptions);
      setCenter(center: LatLngLiteral): void;
      setZoom(zoom: number): void;
      getCenter(): LatLng;
      getZoom(): number;
      setOptions(options: MapOptions): void;
      addListener(
        eventName: string,
        handler: (...args: unknown[]) => void
      ): MapsEventListener;
    }

    interface MapOptions {
      center?: LatLngLiteral;
      zoom?: number;
      disableDefaultUI?: boolean;
      zoomControl?: boolean;
      mapTypeControl?: boolean;
      streetViewControl?: boolean;
      fullscreenControl?: boolean;
      styles?: MapTypeStyle[];
      [key: string]: unknown;
    }

    interface MapTypeStyle {
      elementType?: string;
      featureType?: string;
      stylers: { [key: string]: string | number | boolean }[];
    }

    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    class LatLng {
      constructor(lat: number, lng: number);
      lat(): number;
      lng(): number;
      toString(): string;
      equals(other: LatLng): boolean;
    }

    interface MapsEventListener {
      remove(): void;
    }

    class Marker {
      constructor(options: MarkerOptions);
      setPosition(position: LatLngLiteral): void;
      setMap(map: Map | null): void;
      setIcon(icon: string | Icon): void;
      setVisible(visible: boolean): void;
      addListener(
        eventName: string,
        handler: (...args: unknown[]) => void
      ): MapsEventListener;
    }

    interface MarkerOptions {
      position: LatLngLiteral;
      map?: Map;
      title?: string;
      icon?: string | Icon;
      visible?: boolean;
      [key: string]: unknown;
    }

    interface Icon {
      url: string;
      size?: Size;
      scaledSize?: Size;
      origin?: Point;
      anchor?: Point;
      [key: string]: unknown;
    }

    class Size {
      constructor(width: number, height: number);
      width: number;
      height: number;
      equals(other: Size): boolean;
    }

    class Point {
      constructor(x: number, y: number);
      x: number;
      y: number;
      equals(other: Point): boolean;
    }
  }
}
