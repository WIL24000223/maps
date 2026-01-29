import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { RequestParameters } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Map,
  NavigationControl,
  GeolocateControl,
  Source,
  Layer,
} from '@vis.gl/react-maplibre';
import type { MapRef } from '@vis.gl/react-maplibre';
import { Protocol } from 'pmtiles';
import {
  omProtocol,
  defaultOmProtocolSettings,
  domainOptions,
  domainGroups,
  variableOptions,
  levelGroupVariables,
  GridFactory,
  updateCurrentBounds,
  LEVEL_REGEX,
  LEVEL_PREFIX,
  LEVEL_UNIT_REGEX,
} from '@openmeteo/mapbox-layer';
import type {
  Domain,
  DomainMetaDataJson,
  OmProtocolSettings,
} from '@openmeteo/mapbox-layer';

// Styles
const styles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #root { width: 100%; height: 100%; }
  .map-container { width: 100%; height: 100%; position: relative; }
  .selectors { 
    position: absolute; 
    top: 10px; 
    left: 10px; 
    z-index: 10; 
    display: flex; 
    flex-direction: column; 
    gap: 8px; 
  }
  .selector {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 4px;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
    padding: 0;
  }
  .selector select {
    appearance: none;
    background: transparent;
    border: none;
    padding: 8px 32px 8px 12px;
    font-size: 14px;
    cursor: pointer;
    min-width: 180px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
  }
  .selector select:focus { outline: none; }
  .loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255, 255, 255, 0.9);
    padding: 20px 40px;
    border-radius: 8px;
    font-size: 16px;
    z-index: 20;
  }
`;

// Helper functions
const pad = (num: number | string): string => String(num).padStart(2, '0');

const fmtModelRun = (modelRun: Date): string => {
  return `${modelRun.getUTCFullYear()}/${pad(modelRun.getUTCMonth() + 1)}/${pad(modelRun.getUTCDate())}/${pad(modelRun.getUTCHours())}${pad(modelRun.getUTCMinutes())}Z`;
};

const fmtSelectedTime = (time: Date): string => {
  return `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}T${pad(time.getUTCHours())}${pad(time.getUTCMinutes())}`;
};

const getOMUrl = (
  domain: string,
  variable: string,
  modelRun: Date,
  selectedTime: Date
): string => {
  const uri = domain.startsWith('dwd_icon')
    ? 'https://s3.servert.ch'
    : 'https://map-tiles.open-meteo.com';

  let url = `${uri}/data_spatial/${domain}`;
  url += `/${fmtModelRun(modelRun)}/${fmtSelectedTime(selectedTime)}.om`;
  url += `?variable=${variable}`;

  return url;
};

// Get style URL
const getStyleUrl = (): string => {
  return 'https://maptiler.servert.nl/styles/minimal-world-maps/style.json';
};

// Protocol settings
const omSettings: OmProtocolSettings = {
  ...defaultOmProtocolSettings,
  useSAB: true,
};

// Setup protocols once at module level (with HMR safety)
const pmtilesProtocol = new Protocol({ metadata: true });
try {
  maplibregl.addProtocol(
    'mapterhorn',
    async (params: RequestParameters, abortController: AbortController) => {
      const [z, x, y] = params.url.replace('mapterhorn://', '').split('/').map(Number);
      const name = z <= 12 ? 'planet' : `6-${x >> (z - 6)}-${y >> (z - 6)}`;
      const url = `pmtiles://https://mapterhorn.servert.ch/${name}.pmtiles/${z}/${x}/${y}.webp`;
      return await pmtilesProtocol.tile({ ...params, url }, abortController);
    }
  );
} catch {
  // Protocol already registered (e.g., during HMR)
}

try {
  maplibregl.addProtocol('om', (params: RequestParameters) =>
    omProtocol(params, undefined, omSettings)
  );
} catch {
  // Protocol already registered (e.g., during HMR)
}

// Extract level info from variable
const extractLevelInfo = (variable: string): { level: string; unit: string } | null => {
  const match = variable.match(LEVEL_UNIT_REGEX);
  if (match?.groups) {
    return { level: match.groups.level, unit: match.groups.unit };
  }
  return null;
};

// Get level group prefix from variable
const getLevelPrefix = (variable: string): string | null => {
  const match = variable.match(LEVEL_PREFIX);
  return match?.groups?.prefix || null;
};

// Check if variable has levels
const hasLevels = (variable: string): boolean => {
  return LEVEL_REGEX.test(variable);
};

// Fetch metadata for domain
const fetchMetaData = async (domainValue: string): Promise<DomainMetaDataJson> => {
  const uri = domainValue.startsWith('dwd_icon')
    ? 'https://s3.servert.ch'
    : 'https://map-tiles.open-meteo.com';

  const response = await fetch(`${uri}/data_spatial/${domainValue}/latest.json`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

export default function App() {
  const mapRef = useRef<MapRef>(null);

  const [loading, setLoading] = useState(true);
  const [mapStyle, setMapStyle] = useState<maplibregl.StyleSpecification | null>(null);
  const [domain, setDomain] = useState('dwd_icon');
  const [variable, setVariable] = useState('temperature_2m');
  const [metaJson, setMetaJson] = useState<DomainMetaDataJson | null>(null);
  const [modelRun, setModelRun] = useState<Date | null>(null);
  const [selectedTime] = useState<Date>(() => {
    const now = new Date();
    now.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
    return now;
  });

  // Get current domain object
  const selectedDomain = domainOptions.find((d) => d.value === domain) as Domain;

  // Get filtered variables list from metadata (excluding level variants)
  const variableList = useCallback(() => {
    if (!metaJson) return [];
    const variables: string[] = [];
    for (const mjVariable of metaJson.variables) {
      if (hasLevels(mjVariable)) {
        const prefix = getLevelPrefix(mjVariable);
        if (prefix && !variables.includes(prefix)) {
          variables.push(prefix);
        }
      } else {
        variables.push(mjVariable);
      }
    }
    return variables;
  }, [metaJson]);

  // Get level groups from metadata
  const levelGroupsList = useCallback(() => {
    if (!metaJson) return {};
    const groups: Record<string, Array<{ value: string; label: string }>> = {};
    for (const mjVariable of metaJson.variables) {
      if (hasLevels(mjVariable)) {
        const prefix = getLevelPrefix(mjVariable);
        if (prefix) {
          const varOption = variableOptions.find((v) => v.value === mjVariable) || {
            value: mjVariable,
            label: mjVariable,
          };
          if (!groups[prefix]) {
            groups[prefix] = [];
          }
          groups[prefix].push(varOption);
        }
      }
    }
    return groups;
  }, [metaJson]);

  // Get current level group (if variable has levels)
  const currentLevelGroup = useCallback(() => {
    const prefix = getLevelPrefix(variable);
    if (prefix && levelGroupVariables.includes(prefix)) {
      return prefix;
    }
    return null;
  }, [variable]);

  // Get levels for current variable group
  const currentLevels = useCallback(() => {
    const groups = levelGroupsList();
    const levelGroup = currentLevelGroup();
    if (levelGroup && groups[levelGroup]) {
      return groups[levelGroup];
    }
    return [];
  }, [levelGroupsList, currentLevelGroup]);

  // Initialize: fetch metadata and style
  useEffect(() => {
    const init = async () => {
      try {
        // Fetch metadata
        const meta = await fetchMetaData(domain);
        setMetaJson(meta);
        setModelRun(new Date(meta.reference_time));

        // Fetch style
        const styleResponse = await fetch(getStyleUrl());
        const style = await styleResponse.json();
        setMapStyle(style);

        setLoading(false);
      } catch (error) {
        console.error('Failed to initialize:', error);
        setLoading(false);
      }
    };

    init();
  }, []); // Only run once on mount

  // Handle data loading event to update bounds
  const handleData = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      updateCurrentBounds(map.getBounds());
    }
  }, []);

  // Handle domain change
  const handleDomainChange = async (newDomain: string) => {
    setLoading(true);
    setDomain(newDomain);

    try {
      const meta = await fetchMetaData(newDomain);
      setMetaJson(meta);
      setModelRun(new Date(meta.reference_time));

      // Check if current variable exists in new domain
      if (!meta.variables.includes(variable)) {
        // Try to find a similar variable
        const prefix = getLevelPrefix(variable);
        let newVariable = meta.variables[0];
        if (prefix) {
          for (const v of meta.variables) {
            if (v.startsWith(prefix)) {
              newVariable = v;
              break;
            }
          }
        }
        setVariable(newVariable);
      }
    } catch (error) {
      console.error('Failed to fetch metadata:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle variable change
  const handleVariableChange = (newVariable: string) => {
    // Check if this is a level group prefix
    const groups = levelGroupsList();
    if (groups[newVariable]) {
      // Select a default level (prefer 2m, 10m, 100m, or first)
      const levels = groups[newVariable];
      let defaultLevel = levels[0].value;
      for (const level of levels) {
        if (level.value.includes('2m') || level.value.includes('10m') || level.value.includes('100m')) {
          defaultLevel = level.value;
          break;
        }
      }
      setVariable(defaultLevel);
    } else {
      setVariable(newVariable);
    }
  };

  // Handle level change
  const handleLevelChange = (newLevel: string) => {
    setVariable(newLevel);
  };

  // Get variable label
  const getVariableLabel = (value: string): string => {
    const option = variableOptions.find((v) => v.value === value);
    return option?.label || value;
  };

  // Compute OM URL
  const omUrl = modelRun
    ? 'om://' + getOMUrl(domain, variable, modelRun, selectedTime)
    : null;

  // Memoize initial center from grid
  const initialCenter = useMemo((): [number, number] => {
    const grid = GridFactory.create(selectedDomain.grid);
    const center = grid.getCenter();
    return [center.lng, center.lat];
  }, [selectedDomain.grid]);

  // Current levels info
  const levels = currentLevels();
  const levelGroup = currentLevelGroup();

  return (
    <>
      <style>{styles}</style>
      <div className="map-container">
        {mapStyle && (
          <Map
            ref={mapRef}
            mapStyle={mapStyle}
            initialViewState={{
              longitude: initialCenter[0],
              latitude: initialCenter[1],
              zoom: selectedDomain.grid.zoom || 3,
            }}
            keyboard={false}
            hash={true}
            maxPitch={85}
            style={{ width: '100%', height: '100%' }}
            onData={handleData}
          >
            <NavigationControl visualizePitch={true} />
            <GeolocateControl
              fitBoundsOptions={{ maxZoom: 13.5 }}
              positionOptions={{ enableHighAccuracy: true }}
              trackUserLocation={true}
            />
            {omUrl && (
              <Source
                id="omRasterSource"
                type="raster"
                url={omUrl}
                tileSize={256}
                maxzoom={14}
              >
                <Layer
                  id="omRasterLayer"
                  type="raster"
                  paint={{ 'raster-opacity': 0.75 }}
                  beforeId="waterway-tunnel"
                />
              </Source>
            )}
          </Map>
        )}
        
        {loading && <div className="loading">Loading...</div>}
        
        <div className="selectors">
          {/* Domain Selector */}
          <div className="selector">
            <select
              value={domain}
              onChange={(e) => handleDomainChange(e.target.value)}
              disabled={loading}
            >
              {domainGroups.map((group) => (
                <optgroup key={group.value} label={group.label}>
                  {domainOptions
                    .filter((d) => d.value.startsWith(group.value))
                    .map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Variable Selector */}
          <div className="selector">
            <select
              value={levelGroup || variable}
              onChange={(e) => handleVariableChange(e.target.value)}
              disabled={loading || !metaJson}
            >
              {variableList()
                .filter((v) => !v.includes('_v_') && !v.includes('_direction'))
                .map((v) => (
                  <option key={v} value={v}>
                    {levelGroupVariables.includes(v)
                      ? getVariableLabel(v)
                      : getVariableLabel(v)}
                  </option>
                ))}
            </select>
          </div>

          {/* Level Selector (only shown when variable has levels) */}
          {levels.length > 0 && (
            <div className="selector">
              <select
                value={variable}
                onChange={(e) => handleLevelChange(e.target.value)}
                disabled={loading}
              >
                {levels
                  .filter((l) => !l.value.includes('v_component') && !l.value.includes('_direction'))
                  .map((l) => {
                    const info = extractLevelInfo(l.value);
                    return (
                      <option key={l.value} value={l.value}>
                        {info ? `${info.level} ${info.unit}` : l.label}
                      </option>
                    );
                  })}
              </select>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
