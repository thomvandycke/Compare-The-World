/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { Search, Menu, X, RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { searchLocation } from "./services/nominatim";
import { LocationData, NominatimResult } from "./types";
import { calculateArea, getRelativeKilometerOffsets, offsetsToLatLngs } from "./utils/geo";

const COLORS = ["#2F6FED", "#3CB371", "#F4A261", "#7C83FD", "#F25F5C"];
const OVERLAY_FILL_OPACITY = 0.58;
const OVERLAY_STROKE_OPACITY = 0.9;
const MAX_LOCATIONS = 5;
const SESSION_HINT_KEY = "ctw-drag-hint-dismissed";

const centerHandleIcon = L.divIcon({
  className: "",
  html: '<span class="ctw-map-handle"></span>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const mapControllerPropsDefault = {
  center: null as [number, number] | null,
  zoom: 6,
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatArea(areaKm2?: number): string {
  if (!Number.isFinite(areaKm2) || !areaKm2 || areaKm2 <= 0) {
    return "Area unavailable";
  }
  return `${Math.abs(areaKm2).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`;
}

const MapController = ({
  center,
  zoom,
  draggingId,
  onDrag,
  onDragEnd,
}: {
  center: [number, number] | null;
  zoom: number;
  draggingId: string | null;
  onDrag: (latlng: L.LatLng) => void;
  onDragEnd: () => void;
}) => {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom);
    }
  }, [center, zoom, map]);

  useEffect(() => {
    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (draggingId) onDrag(e.latlng);
    };

    const handleMouseUp = () => {
      if (!draggingId) return;
      map.dragging.enable();
      onDragEnd();
    };

    if (draggingId) {
      map.on("mousemove", handleMouseMove);
      map.on("mouseup", handleMouseUp);
    }

    return () => {
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
    };
  }, [draggingId, map, onDrag, onDragEnd]);

  return null;
};

export default function App() {
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ lat: number; lng: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth >= 1024 : true)
  );
  const [resultIndex, setResultIndex] = useState(-1);
  const [showDragHint, setShowDragHint] = useState(true);

  useEffect(() => {
    const dismissed = typeof window !== "undefined" && sessionStorage.getItem(SESSION_HINT_KEY) === "1";
    if (dismissed) setShowDragHint(false);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(true);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        setResultIndex(-1);
        return;
      }

      setIsSearching(true);
      const results = await searchLocation(searchQuery);
      const filtered = results.filter((result) => result.geojson);
      setSearchResults(filtered);
      setResultIndex(filtered.length > 0 ? 0 : -1);
      setIsSearching(false);
    }, 350);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const dismissDragHint = () => {
    if (!showDragHint) return;
    setShowDragHint(false);
    sessionStorage.setItem(SESSION_HINT_KEY, "1");
  };

  const addLocation = (result: NominatimResult) => {
    if (locations.length >= MAX_LOCATIONS) {
      alert("You can only compare up to 5 locations at once.");
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const area = Math.abs(calculateArea(result.geojson));
    const safeArea = Number.isFinite(area) && area > 0 ? area : undefined;
    const offsets = getRelativeKilometerOffsets(result.geojson);
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const isPrimary = locations.length === 0;
    const primaryLoc = locations.find((location) => location.isPrimary);

    const newLocation: LocationData = {
      id,
      name: result.display_name.split(",")[0],
      displayName: result.display_name,
      geojson: result.geojson,
      offsets,
      color: COLORS[locations.length % COLORS.length],
      lat: isPrimary ? lat : (primaryLoc?.lat ?? lat),
      lng: isPrimary ? lng : (primaryLoc?.lng ?? lng),
      rotation: 0,
      visible: true,
      areaKm2: safeArea,
      isPrimary,
    };

    setLocations((prev) => [...prev, newLocation]);
    setSearchQuery("");
    setSearchResults([]);
    setResultIndex(-1);
    setSelectedId(id);

    if (isPrimary) {
      setFlyTo({ center: [lat, lng], zoom: 5 });
    }
  };

  const removeLocation = (id: string) => {
    setLocations((prev) => {
      const filtered = prev.filter((location) => location.id !== id);
      if (filtered.length > 0 && !filtered.some((location) => location.isPrimary)) {
        filtered[0].isPrimary = true;
      }
      return filtered;
    });
    if (selectedId === id) setSelectedId(null);
  };

  const removeAll = () => {
    setLocations([]);
    setSelectedId(null);
  };

  const setAsReference = (id: string) => {
    setLocations((prev) =>
      prev.map((location) => ({
        ...location,
        isPrimary: location.id === id,
      }))
    );

    const selected = locations.find((location) => location.id === id);
    if (selected) {
      setFlyTo({ center: [selected.lat, selected.lng], zoom: 5 });
    }
  };

  const toggleVisibility = (id: string) => {
    setLocations((prev) =>
      prev.map((location) =>
        location.id === id ? { ...location, visible: !location.visible } : location
      )
    );
  };

  const updateLocation = (id: string, updates: Partial<LocationData>) => {
    setLocations((prev) =>
      prev.map((location) => (location.id === id ? { ...location, ...updates } : location))
    );
  };

  const handlePolygonMouseDown = (id: string, e: L.LeafletMouseEvent) => {
    const location = locations.find((entry) => entry.id === id);
    if (!location) return;

    L.DomEvent.stop(e.originalEvent);
    dismissDragHint();
    setDraggingId(id);
    setDragOffset({
      lat: location.lat - e.latlng.lat,
      lng: location.lng - e.latlng.lng,
    });
    e.target._map.dragging.disable();
    setSelectedId(id);
  };

  const handleMapDrag = (latlng: L.LatLng) => {
    if (!draggingId || !dragOffset) return;
    updateLocation(draggingId, {
      lat: latlng.lat + dragOffset.lat,
      lng: latlng.lng + dragOffset.lng,
    });
  };

  const handleMapDragEnd = () => {
    setDraggingId(null);
    setDragOffset(null);
  };

  const handleRotate = (id: string) => {
    const location = locations.find((entry) => entry.id === id);
    if (!location) return;
    updateLocation(id, { rotation: (location.rotation + 45) % 360 });
  };

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === selectedId) ?? null,
    [locations, selectedId]
  );

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black/25 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close panel backdrop"
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          "ctw-panel fixed inset-y-0 left-0 z-40 flex flex-col transition-transform duration-150 lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="border-b border-[var(--border)] px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface)]">
                <img
                  src="/compare-the-world-logo.svg"
                  alt="Compare the World logo"
                  className="h-[30px] w-[30px] object-contain"
                />
              </div>
              <h1 className="text-[20px] font-semibold">Compare the World</h1>
            </div>
            <button
              className="ctw-action-btn inline-flex items-center justify-center lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>
          <p
            className="mt-3 text-[13px] font-semibold uppercase"
            style={{ letterSpacing: "0.08em", color: "var(--text-3)" }}
          >
            Visual Size Comparison
          </p>
        </div>

        <div className="relative px-5 pb-2 pt-4">
          <label htmlFor="location-search" className="sr-only">
            Search location
          </label>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              id="location-search"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (searchResults.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setResultIndex((prev) => Math.min(searchResults.length - 1, prev + 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setResultIndex((prev) => Math.max(0, prev - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const selected = searchResults[resultIndex] ?? searchResults[0];
                  if (selected) addLocation(selected);
                } else if (event.key === "Escape") {
                  setSearchResults([]);
                  setResultIndex(-1);
                }
              }}
              placeholder="Search a country, state, or city…"
              className="ctw-search w-full pl-11 pr-11"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-[var(--brand)] border-t-transparent animate-spin" />
            )}
          </div>

          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="ctw-results absolute left-5 right-5 top-[66px] z-50 max-h-72 overflow-y-auto"
                role="listbox"
              >
                {searchResults.map((result, index) => (
                  <button
                    key={result.place_id}
                    className={cn(
                      "flex min-h-10 w-full items-start border-b border-[var(--border)] px-4 py-3 text-left text-[14px] text-[var(--text)] last:border-b-0",
                      resultIndex === index ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"
                    )}
                    onMouseEnter={() => setResultIndex(index)}
                    onClick={() => addLocation(result)}
                    role="option"
                    aria-selected={resultIndex === index}
                  >
                    {result.display_name}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {locations.length === 0 && (
            <div className="ctw-instruction-card mt-3">
              <h2 className="text-[16px] font-semibold">How it works</h2>
              <ol className="mt-2 space-y-1 text-[14px] text-[var(--text-2)]">
                <li>1. Search for a place</li>
                <li>2. Add up to 5 locations</li>
                <li>3. Drag them to compare</li>
                <li>4. Set one as reference</li>
              </ol>
            </div>
          )}

          <div className="mt-[18px] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[var(--text-2)]">Locations Added</h3>
            <p className="text-[13px] font-semibold text-[var(--text-2)] numeric">
              {locations.length} of {MAX_LOCATIONS}
            </p>
          </div>

          {locations.length > 0 && (
            <button
              onClick={removeAll}
              className="mt-2 min-h-10 text-[14px] font-semibold text-[var(--danger)] hover:underline"
            >
              Remove All
            </button>
          )}

          {locations.length === 0 ? (
            <div className="mt-5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-[16px] font-semibold">No locations yet</p>
              <p className="mt-1 text-[14px] text-[var(--text-2)]">
                Search for a place above to start comparing.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3 pb-4">
              {locations.map((location) => (
                <motion.div
                  layout
                  key={location.id}
                  className={cn(
                    "ctw-location-card",
                    selectedId === location.id ? "border-[var(--brand)]" : "",
                    location.isPrimary ? "reference" : ""
                  )}
                  onClick={() => setSelectedId(location.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: location.color }}
                          aria-hidden="true"
                        />
                        <p className="truncate text-[16px] font-semibold">{location.name}</p>
                        {location.isPrimary && <span className="ctw-reference-badge">REFERENCE</span>}
                      </div>
                      <p className="numeric mt-1 text-[14px] text-[var(--text-2)]">
                        {formatArea(location.areaKm2)}
                      </p>
                    </div>
                    <button
                      className={cn("ctw-toggle shrink-0", location.visible ? "on" : "")}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleVisibility(location.id);
                      }}
                      aria-label="Toggle visibility"
                      aria-pressed={location.visible}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <p className="min-h-10 min-w-10 text-[14px] font-medium text-[var(--text-2)]">
                      Shown on Map
                    </p>
                    {!location.isPrimary && (
                      <button
                        className="ctw-action-btn border-[var(--border)] px-3 text-[var(--text)] hover:bg-[var(--surface-2)]"
                        onClick={(event) => {
                          event.stopPropagation();
                          setAsReference(location.id);
                        }}
                      >
                        Set as Reference
                      </button>
                    )}
                    <button
                      className="ctw-action-btn border-[var(--border)] px-3 text-[var(--text)] hover:bg-[var(--surface-2)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRotate(location.id);
                      }}
                    >
                      Rotate 45°
                    </button>
                    <button
                      className="ctw-action-btn border-[var(--border)] px-3 text-[var(--danger)] hover:bg-[var(--surface-2)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeLocation(location.id);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-5 py-4">
          <p className="text-[14px] text-[var(--text-2)]">
            All locations are draggable. Grab the shape to move it.
          </p>
        </div>
      </aside>

      <main className="h-full lg:ml-[360px]">
        <button
          className="ctw-action-btn fixed left-3 top-3 z-20 inline-flex items-center justify-center border border-[var(--border)] bg-[var(--surface)] lg:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
        >
          <Menu size={18} />
        </button>

        <MapContainer
          center={[20, 0]}
          zoom={3}
          zoomControl={false}
          attributionControl={false}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png" />
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png" opacity={0.34} />

          <MapController
            center={flyTo?.center ?? mapControllerPropsDefault.center}
            zoom={flyTo?.zoom ?? mapControllerPropsDefault.zoom}
            draggingId={draggingId}
            onDrag={handleMapDrag}
            onDragEnd={handleMapDragEnd}
          />

          {locations.map((location) => {
            if (!location.visible) return null;
            const positions = offsetsToLatLngs(
              location.offsets,
              location.lat,
              location.lng,
              location.rotation
            );
            const isSelected = selectedId === location.id;
            return (
              <React.Fragment key={location.id}>
                <Polygon
                  positions={positions}
                  bubblingMouseEvents={false}
                  pathOptions={{
                    color: location.color,
                    fillColor: location.color,
                    fillOpacity: OVERLAY_FILL_OPACITY,
                    opacity: OVERLAY_STROKE_OPACITY,
                    weight: 2,
                    className: "ctw-overlay cursor-grab active:cursor-grabbing",
                  }}
                  eventHandlers={{
                    click: (event) => {
                      L.DomEvent.stop(event.originalEvent);
                      setSelectedId(location.id);
                    },
                    mousedown: (event) => handlePolygonMouseDown(location.id, event),
                  }}
                />

                {location.isPrimary && (
                  <Polygon
                    positions={positions}
                    interactive={false}
                    pathOptions={{
                      color: "var(--accent)",
                      fillOpacity: 0,
                      opacity: 1,
                      weight: 3,
                    }}
                  />
                )}

                {isSelected && (
                  <Marker
                    position={[location.lat, location.lng]}
                    draggable
                    icon={centerHandleIcon}
                    eventHandlers={{
                      dragstart: () => dismissDragHint(),
                      dragend: (event) => {
                        const next = event.target.getLatLng();
                        updateLocation(location.id, { lat: next.lat, lng: next.lng });
                      },
                      click: () => setSelectedId(location.id),
                    }}
                  >
                    {showDragHint && (
                      <Tooltip direction="top" offset={[0, -10]} permanent opacity={1}>
                        Drag to move. Use rotate handle to rotate.
                      </Tooltip>
                    )}
                  </Marker>
                )}
              </React.Fragment>
            );
          })}
        </MapContainer>

        {selectedLocation && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-20 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-sm)]">
            <p className="text-[14px] font-semibold">{selectedLocation.name}</p>
            <p className="numeric text-[14px] text-[var(--text-2)]">{formatArea(selectedLocation.areaKm2)}</p>
            <button
              className="ctw-action-btn pointer-events-auto mt-2 inline-flex items-center justify-center gap-2 border border-[var(--border)] px-3 hover:bg-[var(--surface-2)]"
              onClick={() => handleRotate(selectedLocation.id)}
            >
              <RotateCw size={16} />
              Rotate 45°
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
