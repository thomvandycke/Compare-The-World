export interface LocationGeometry {
  type: string;
  coordinates: any;
}

export interface LocationData {
  id: string;
  name: string;
  displayName: string;
  geojson: LocationGeometry;
  offsets: { x: number, y: number }[][]; // Pre-calculated relative km offsets
  color: string;
  lat: number; // Anchor latitude
  lng: number; // Anchor longitude
  rotation: number;
  visible: boolean;
  areaKm2?: number;
  isPrimary?: boolean;
}

export interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  boundingbox: string[];
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance: number;
  icon?: string;
  geojson: LocationGeometry;
}
