/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Search, Trash2, RotateCw, Globe, Info, X, MapPin, MousePointer2, Map as MapIcon, Anchor, GripVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { MapContainer, TileLayer, Polygon, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { searchLocation } from "./services/nominatim";
import { LocationData, NominatimResult } from "./types";
import { calculateArea, getRelativeKilometerOffsets, offsetsToLatLngs } from "./utils/geo";

// Fix for Leaflet default icon paths using CDN
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const COLORS = [
  "#3B82F6", // Blue
  "#EF4444", // Red
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#8B5CF6", // Violet
  "#EC4899", // Pink
  "#06B6D4", // Cyan
];

// Helper to fly map to location and handle global map events
const MapController = ({ 
  center, 
  zoom, 
  draggingId, 
  onDrag, 
  onDragEnd 
}: { 
  center: [number, number] | null, 
  zoom: number,
  draggingId: string | null,
  onDrag: (latlng: L.LatLng) => void,
  onDragEnd: () => void
}) => {
  const map = useMap();
  
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom);
    }
  }, [center, zoom, map]);

  useEffect(() => {
    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (draggingId) {
        onDrag(e.latlng);
      }
    };

    const handleMouseUp = () => {
      if (draggingId) {
        map.dragging.enable();
        onDragEnd();
      }
    };

    if (draggingId) {
      map.on('mousemove', handleMouseMove);
      map.on('mouseup', handleMouseUp);
    }

    return () => {
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
    };
  }, [draggingId, onDrag, onDragEnd, map]);

  return null;
};

export default function App() {
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ center: [number, number], zoom: number } | null>(null);
  
  // Dragging state for polygons
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ lat: number, lng: number } | null>(null);

  // Search logic
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        setIsSearching(true);
        const results = await searchLocation(searchQuery);
        setSearchResults(results.filter(r => r.geojson));
        setIsSearching(false);
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const addLocation = (result: NominatimResult) => {
    if (locations.length >= 5) {
      alert("You can only compare up to 5 locations at once.");
      return;
    }

    const id = Math.random().toString(36).substring(7);
    const color = COLORS[locations.length % COLORS.length];
    const area = calculateArea(result.geojson);
    const offsets = getRelativeKilometerOffsets(result.geojson);
    
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);

    const isPrimary = locations.length === 0;
    const primaryLoc = locations.find(l => l.isPrimary);

    const newLocation: LocationData = {
      id,
      name: result.display_name.split(",")[0],
      displayName: result.display_name,
      geojson: result.geojson,
      offsets,
      color,
      lat: isPrimary ? lat : (primaryLoc?.lat ?? lat),
      lng: isPrimary ? lng : (primaryLoc?.lng ?? lng),
      rotation: 0,
      visible: true,
      areaKm2: area,
      isPrimary,
    };

    setLocations([...locations, newLocation]);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedId(id);

    // If it's the first location, fly to it
    if (isPrimary) {
      setFlyTo({ center: [lat, lng], zoom: 6 });
    }
  };

  const removeLocation = (id: string) => {
    const filtered = locations.filter((l) => l.id !== id);
    if (filtered.length > 0 && !filtered.some(l => l.isPrimary)) {
      filtered[0].isPrimary = true;
    }
    setLocations(filtered);
    if (selectedId === id) setSelectedId(null);
  };

  const toggleVisibility = (id: string) => {
    setLocations(
      locations.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  const updateLocation = (id: string, updates: Partial<LocationData>) => {
    setLocations(locations.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const handleDragEnd = (id: string, e: any) => {
    const marker = e.target;
    const position = marker.getLatLng();
    updateLocation(id, { lat: position.lat, lng: position.lng });
  };

  const handlePolygonMouseDown = (id: string, e: L.LeafletMouseEvent) => {
    const loc = locations.find(l => l.id === id);
    if (!loc) return;
    
    // Stop the DOM event from reaching the map container
    L.DomEvent.stop(e.originalEvent);
    
    const mouseLatLng = e.latlng;
    setDraggingId(id);
    setDragOffset({
      lat: loc.lat - mouseLatLng.lat,
      lng: loc.lng - mouseLatLng.lng,
    });
    
    // Disable map dragging while dragging polygon
    e.target._map.dragging.disable();
    setSelectedId(id);
  };

  const handleMapDrag = (latlng: L.LatLng) => {
    if (draggingId && dragOffset) {
      updateLocation(draggingId, {
        lat: latlng.lat + dragOffset.lat,
        lng: latlng.lng + dragOffset.lng,
      });
    }
  };

  const handleMapDragEnd = () => {
    setDraggingId(null);
    setDragOffset(null);
  };

  const handleRotate = (id: string) => {
    const loc = locations.find((l) => l.id === id);
    if (loc) {
      updateLocation(id, { rotation: (loc.rotation + 45) % 360 });
    }
  };

  const clearAll = () => {
    setLocations([]);
    setSelectedId(null);
  };

  const setAsPrimary = (id: string) => {
    setLocations(locations.map(l => ({
      ...l,
      isPrimary: l.id === id
    })));
    
    const loc = locations.find(l => l.id === id);
    if (loc) {
      setFlyTo({ center: [loc.lat, loc.lng], zoom: 6 });
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#f8fafc] text-slate-900 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-80 bg-white border-r border-slate-200 flex flex-col z-20 shadow-xl">
        <div className="p-6 border-bottom border-slate-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-blue-600 rounded-lg text-white">
              <Globe size={20} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Compare the World</h1>
          </div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Compare Relative Sizes</p>
        </div>

        <div className="px-4 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search country, state, city..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>

          {/* Search Results */}
          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute left-4 right-4 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-30 max-h-64 overflow-y-auto"
              >
                {searchResults.map((result) => (
                  <button
                    key={result.place_id}
                    onClick={() => addLocation(result)}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 flex items-start gap-3"
                  >
                    <MapPin size={16} className="mt-0.5 text-slate-400 shrink-0" />
                    <span className="text-sm text-slate-700 line-clamp-2">{result.display_name}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Layers ({locations.length}/5)</h2>
            {locations.length > 0 && (
              <button onClick={clearAll} className="text-[10px] font-bold text-red-500 hover:text-red-600 uppercase tracking-wider">Clear All</button>
            )}
          </div>

          {locations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                <MousePointer2 size={24} />
              </div>
              <p className="text-sm text-slate-500 font-medium">No locations added yet.</p>
              <p className="text-xs text-slate-400 mt-1">Search for a place above to start comparing.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {locations.map((loc) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={loc.id}
                  onClick={() => setSelectedId(loc.id)}
                  className={cn(
                    "p-3 rounded-xl border transition-all cursor-pointer group",
                    selectedId === loc.id
                      ? "bg-white border-blue-200 shadow-md ring-1 ring-blue-100"
                      : "bg-slate-50 border-transparent hover:border-slate-200"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="relative">
                        <div 
                          className="w-3 h-3 rounded-full shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-slate-300 transition-all" 
                          style={{ backgroundColor: loc.color }}
                          title="Change Color"
                          onClick={(e) => {
                            e.stopPropagation();
                            const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                            input.click();
                          }}
                        />
                        <input 
                          type="color" 
                          className="absolute opacity-0 w-0 h-0 pointer-events-none"
                          value={loc.color}
                          onChange={(e) => {
                            updateLocation(loc.id, { color: e.target.value });
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <span className="text-sm font-semibold truncate text-slate-700">{loc.name}</span>
                      {loc.isPrimary && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[8px] font-bold rounded uppercase tracking-tighter flex items-center gap-0.5">
                          <Anchor size={8} /> Primary
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!loc.isPrimary && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setAsPrimary(loc.id); }}
                          className="p-1.5 hover:bg-blue-50 text-blue-400 hover:text-blue-600 rounded-lg transition-colors"
                          title="Set as Primary"
                        >
                          <Anchor size={14} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRotate(loc.id); }}
                        className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors"
                        title="Rotate 45°"
                      >
                        <RotateCw size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeLocation(loc.id); }}
                        className="p-1.5 hover:bg-red-100 hover:text-red-600 rounded-lg text-slate-500 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>{loc.areaKm2?.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleVisibility(loc.id); }}
                        className={cn("hover:underline", loc.visible ? "text-blue-500" : "text-slate-400")}
                      >
                        {loc.visible ? "Visible" : "Hidden"}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100">
          <div className="flex items-center gap-2 text-slate-500 mb-3">
            <Info size={14} />
            <p className="text-[10px] leading-tight">
              All locations are draggable. Grab the shape or the center handle to move them.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Map */}
      <main className="flex-1 relative bg-[#e2e8f0] overflow-hidden">
        <MapContainer
          center={[20, 0]}
          zoom={3}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController 
            center={flyTo?.center || null} 
            zoom={flyTo?.zoom || 6} 
            draggingId={draggingId}
            onDrag={handleMapDrag}
            onDragEnd={handleMapDragEnd}
          />

          {locations.map((loc) => (
            <React.Fragment key={loc.id}>
              {loc.visible && (
                <Polygon
                  positions={offsetsToLatLngs(loc.offsets, loc.lat, loc.lng, loc.rotation)}
                  bubblingMouseEvents={false}
                  pathOptions={{
                    color: loc.color,
                    fillColor: loc.color,
                    fillOpacity: selectedId === loc.id ? 0.3 : 0.15,
                    weight: 2,
                    className: "cursor-grab active:cursor-grabbing",
                  }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stop(e.originalEvent);
                      setSelectedId(loc.id);
                    },
                    mousedown: (e) => {
                      handlePolygonMouseDown(loc.id, e);
                    },
                  }}
                >
                  <Tooltip sticky>{loc.name}</Tooltip>
                </Polygon>
              )}
              
              {/* Draggable handle for shapes */}
              {loc.visible && (
                <Marker
                  position={[loc.lat, loc.lng]}
                  draggable={true}
                  eventHandlers={{
                    dragend: (e) => handleDragEnd(loc.id, e),
                    click: () => setSelectedId(loc.id),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -20]} opacity={1}>
                    Drag to move {loc.name}
                  </Tooltip>
                </Marker>
              )}
            </React.Fragment>
          ))}
        </MapContainer>

        {/* Selected Info Overlay */}
        <AnimatePresence>
          {selectedId && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md px-6 py-3 rounded-2xl shadow-2xl border border-white/20 flex items-center gap-4 z-30"
            >
              {(() => {
                const loc = locations.find(l => l.id === selectedId);
                if (!loc) return null;
                return (
                  <>
                    <div className="relative">
                      <div 
                        className="w-4 h-4 rounded-full cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-slate-300 transition-all" 
                        style={{ backgroundColor: loc.color }}
                        title="Change Color"
                        onClick={(e) => {
                          e.stopPropagation();
                          const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                          input.click();
                        }}
                      />
                      <input 
                        type="color" 
                        className="absolute opacity-0 w-0 h-0 pointer-events-none"
                        value={loc.color}
                        onChange={(e) => {
                          updateLocation(loc.id, { color: e.target.value });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">{loc.name}</h3>
                      <p className="text-[10px] text-slate-500 font-mono">{loc.areaKm2?.toLocaleString()} km²</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="flex items-center gap-2">
                      {!loc.isPrimary && (
                        <button onClick={() => setAsPrimary(loc.id)} className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors" title="Set as Primary">
                          <Anchor size={16} />
                        </button>
                      )}
                      <button onClick={() => handleRotate(loc.id)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors">
                        <RotateCw size={16} />
                      </button>
                      <button onClick={() => setSelectedId(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
