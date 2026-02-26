export interface RenderState {
  satCount: number;
  positionsKm: Float32Array<ArrayBufferLike>;
  velocitiesKmps: Float32Array<ArrayBufferLike>;
  connectedSatPairs: Uint32Array<ArrayBufferLike>;
  connectedLts: Uint32Array<ArrayBufferLike>;
}

export interface ConstellationRenderer {
  readonly mode: 'gpu' | 'cpu';
  setSatelliteState(
    positionsKm: Float32Array<ArrayBufferLike>,
    velocitiesKmps: Float32Array<ArrayBufferLike>,
    satCount: number
  ): void;
  setLinks(
    connectedSatPairs: Uint32Array<ArrayBufferLike>,
    connectedLts: Uint32Array<ArrayBufferLike>
  ): void;
  renderFrame(simTimeSec: number): number;
}
