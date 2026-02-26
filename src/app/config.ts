import type { LinkConfig } from '../sim/messages';

export const EARTH_RADIUS_KM = 6371;

export const DEFAULT_LINK_CONFIG: LinkConfig = {
  maxDistanceKm: 3000,
  forThetaDeg: 15,
  minViewTimeSec: 0
};

export const SIMULATION_CONFIG = {
  timeScale: 10,
  propagationHzGpu: 10,
  linkHzGpu: 2,
  propagationHzCpu: 3,
  linkHzCpu: 1,
  cameraDistance: 3.2
};

export const DATA_ENDPOINTS = {
  tleGz: './data/tle/starlink.latest.tle.gz',
  meta: './data/tle/starlink.latest.meta.json'
} as const;
