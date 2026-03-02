import * as d3 from "d3-geo";
import { LocationGeometry } from "../types";

/**
 * Ensures the polygon has the correct winding order for D3 (CCW for exterior).
 * If the area is more than half the globe, it's likely inverted.
 */
function getCorrectedGeoJSON(geojson: LocationGeometry): any {
  const area = d3.geoArea(geojson);
  if (area > 2 * Math.PI) {
    // Clone and reverse coordinates to fix winding order
    const reversed = JSON.parse(JSON.stringify(geojson));
    if (reversed.type === "Polygon") {
      reversed.coordinates = reversed.coordinates.map((ring: any[]) => [...ring].reverse());
    } else if (reversed.type === "MultiPolygon") {
      reversed.coordinates = reversed.coordinates.map((polygon: any[][]) =>
        polygon.map((ring: any[]) => [...ring].reverse())
      );
    }
    return reversed;
  }
  return geojson;
}

/**
 * Converts GeoJSON coordinates to relative kilometer offsets from its centroid.
 * This allows us to re-project the shape at any other location on a map.
 */
export function getRelativeKilometerOffsets(geojson: LocationGeometry): { x: number, y: number }[][] {
  const corrected = getCorrectedGeoJSON(geojson);
  const centroid = d3.geoCentroid(corrected);

  // Azimuthal Equidistant projection centered on the centroid
  // Scale 6371 means 1 unit = 1km
  const projection = d3
    .geoAzimuthalEquidistant()
    .rotate([-centroid[0], -centroid[1]])
    .translate([0, 0])
    .scale(6371);

  const extractCoords = (geometry: any): any[][] => {
    if (geometry.type === "Polygon") {
      return geometry.coordinates;
    } else if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.flat(1);
    }
    return [];
  };

  const rings = extractCoords(corrected);
  return rings.map(ring => 
    ring.map((coord: [number, number]) => {
      const projected = projection(coord);
      return projected ? { x: projected[0], y: -projected[1] } : { x: 0, y: 0 };
    })
  );
}

/**
 * Converts relative kilometer offsets back to LatLng coordinates at a target location.
 * This handles the "TrueSize" effect by adjusting for Mercator distortion.
 */
export function offsetsToLatLngs(
  offsets: { x: number, y: number }[][],
  targetLat: number,
  targetLng: number,
  rotation: number
): [number, number][][] {
  const rotatePoint = (x: number, y: number, angle: number) => {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos
    };
  };

  // 1 degree of latitude is approximately 111.32 km
  const kmPerDegreeLat = 111.32;
  
  return offsets.map(ring =>
    ring.map(offset => {
      const rotated = rotatePoint(offset.x, offset.y, rotation);
      
      // Latitude adjustment
      const dLat = rotated.y / kmPerDegreeLat;
      const newLat = targetLat + dLat;
      
      // Longitude adjustment (depends on latitude)
      // 1 degree of longitude = 111.32 * cos(lat) km
      const kmPerDegreeLng = 111.32 * Math.cos((newLat * Math.PI) / 180);
      const dLng = rotated.x / kmPerDegreeLng;
      const newLng = targetLng + dLng;
      
      return [newLat, newLng];
    })
  );
}

export function calculateArea(geojson: LocationGeometry): number {
  let steradians = d3.geoArea(geojson);
  // If area is more than half the globe, it's likely inverted winding order
  if (steradians > 2 * Math.PI) {
    steradians = 4 * Math.PI - steradians;
  }
  // Area = steradians * R^2
  return steradians * 6371 * 6371;
}
