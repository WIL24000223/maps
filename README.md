# Open-Meteo Maps

Minimal Vite + TanStack React example for [Open-Meteo MapLibre/Mapbox protocol](https://github.com/open-meteo/mapbox-layer).

## About this Repository

This is a minimal single-file React application that demonstrates how to use the Open-Meteo maps protocol with MapLibre GL JS. It includes:

- **Map**: MapLibre GL JS map with Open-Meteo weather data overlay
- **Domain Selector**: Choose from various weather models (DWD ICON, ECMWF, GFS, etc.)
- **Variable Selector**: Select weather variables (temperature, wind, precipitation, etc.)
- **Level Selector**: For pressure-level variables, select the altitude/pressure level

All functionality is contained in a single `src/App.tsx` file for easy understanding and customization.

## Development

Install and run dev server:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

## Tech Stack

- **React 19** - UI framework
- **Vite 7** - Build tool
- **TanStack Router** - Routing (available for extension)
- **MapLibre GL JS** - Map rendering
- **@openmeteo/mapbox-layer** - Open-Meteo protocol for weather data

## Issues & Contributing

- Open issues/PRs in this repository for UI/demo changes.
- For protocol-specific issues, see https://github.com/open-meteo/mapbox-layer/issues.
