# Temp Alarm — Project Notes

## Overview
A Temperature Alarm mobile app built with Expo React Native. Monitors real-time local temperature via GPS + Open-Meteo API and alerts users when temperature crosses user-set heat/cold limits.

## Architecture
- **Frontend**: Expo Router (single screen, no tabs), React Native
- **Backend**: Express server on port 5000 (serves landing page and Expo manifests)
- **Storage**: AsyncStorage for persisting limits and monitoring state
- **Fonts**: Outfit (Google Fonts)

## Key Features
- GPS location auto-detection (expo-location)
- Real-time temperature from Open-Meteo API (free, no API key)
- Configurable heat/cold limits
- Foreground monitoring: every 60 seconds via setInterval
- Background monitoring: expo-background-fetch + expo-task-manager
- Local push notifications for screen-off alerts (expo-notifications)
- Alarm sound: Web Audio API (web), device vibration (native)
- Dark theme UI with animated thermometer

## Background Monitoring Notes
- **iOS**: Background fetch runs at OS discretion (~15 min minimum, Apple restriction)
- **Android**: More frequent, subject to battery optimization
- Background task registered as `TEMP_MONITOR_TASK` in lib/backgroundTask.ts
- Limits/monitoring state persisted in AsyncStorage so background task can read them

## File Structure
- `app/index.tsx` — Main screen (all UI and foreground logic)
- `lib/backgroundTask.ts` — Background fetch task + notification setup
- `constants/colors.ts` — Dark theme color palette
- `server/` — Express backend (landing page + API scaffold)

## Workflows
- `Start Backend`: `npm run server:dev` (port 5000)
- `Start Frontend`: `npm run expo:dev` (port 8081)
