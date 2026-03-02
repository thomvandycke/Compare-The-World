import { NominatimResult } from "../types";

export async function searchLocation(query: string): Promise<NominatimResult[]> {
  if (!query || query.length < 2) return [];

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&polygon_geojson=1&limit=5`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "TrueSizeOverlayApp/1.0",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch from Nominatim");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
}
