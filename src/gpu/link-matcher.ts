import scoreShaderCode from './link-score.compute.wgsl?raw';
import matchShaderCode from './link-match.compute.wgsl?raw';
import type { LinkConfig } from '../sim/messages';

export interface GpuMatchResult {
  connectedSatPairs: Uint32Array;
  connectedLts: Uint32Array;
  matchedCount: number;
  candidateCount: number;
  scoreMs: number;
  matchMs: number;
  rounds: number;
}

const WORKGROUP_SIZE = 256;
const MATCH_ROUNDS = 4;
const WATCHDOG_MS = 120;
const SCORE_CAP = 1e12;
const RANK_LEVELS = 1024;
const INVALID_LT = 0xffffffff;

export class WebGpuLinkMatcher {
  private readonly device: GPUDevice;
  private readonly scorePipeline: GPUComputePipeline;
  private readonly initPipeline: GPUComputePipeline;
  private readonly clearClaimsPipeline: GPUComputePipeline;
  private readonly claimPipeline: GPUComputePipeline;
  private readonly finalizePipeline: GPUComputePipeline;

  private satCount = 0;
  private positionsPacked = new Float32Array(new ArrayBuffer(0));
  private velocitiesPacked = new Float32Array(new ArrayBuffer(0));

  private posBuffer: GPUBuffer | null = null;
  private velBuffer: GPUBuffer | null = null;
  private candidateBuffer: GPUBuffer | null = null;
  private scoreBuffer: GPUBuffer | null = null;
  private packedLtBuffer: GPUBuffer | null = null;
  private activeBuffer: GPUBuffer | null = null;
  private selectedBuffer: GPUBuffer | null = null;
  private terminalMatchedBuffer: GPUBuffer | null = null;
  private claimSrcBuffer: GPUBuffer | null = null;
  private claimDstBuffer: GPUBuffer | null = null;
  private scoreParamBuffer: GPUBuffer;
  private matchParamBuffer: GPUBuffer;

  private readSelectedBuffer: GPUBuffer | null = null;
  private readPackedLtBuffer: GPUBuffer | null = null;

  private candidateCapacity = 0;
  private satCapacity = 0;
  private terminalCapacity = 0;

  private constructor(device: GPUDevice) {
    this.device = device;
    this.scorePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: scoreShaderCode }), entryPoint: 'main' }
    });

    const matchModule = device.createShaderModule({ code: matchShaderCode });
    this.initPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: matchModule, entryPoint: 'init_state' }
    });
    this.clearClaimsPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: matchModule, entryPoint: 'clear_claims' }
    });
    this.claimPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: matchModule, entryPoint: 'claim_edges' }
    });
    this.finalizePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: matchModule, entryPoint: 'finalize_edges' }
    });

    this.scoreParamBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.matchParamBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  static create(device: GPUDevice): WebGpuLinkMatcher {
    return new WebGpuLinkMatcher(device);
  }

  updateState(
    positionsKm: Float32Array<ArrayBufferLike>,
    velocitiesKmps: Float32Array<ArrayBufferLike>,
    satCount: number
  ): void {
    this.satCount = satCount;
    this.positionsPacked = new Float32Array(packVec3ToVec4(positionsKm, satCount));
    this.velocitiesPacked = new Float32Array(packVec3ToVec4(velocitiesKmps, satCount));
    this.ensureSatBuffers(satCount);
    if (!this.posBuffer || !this.velBuffer) {
      return;
    }
    this.device.queue.writeBuffer(this.posBuffer, 0, this.positionsPacked);
    this.device.queue.writeBuffer(this.velBuffer, 0, this.velocitiesPacked);
  }

  async match(candidatesPacked: Uint32Array, config: LinkConfig): Promise<GpuMatchResult> {
    const candidateCount = Math.floor(candidatesPacked.length / 2);
    if (candidateCount === 0 || this.satCount === 0) {
      return {
        connectedSatPairs: new Uint32Array(0),
        connectedLts: new Uint32Array(0),
        matchedCount: 0,
        candidateCount,
        scoreMs: 0,
        matchMs: 0,
        rounds: MATCH_ROUNDS
      };
    }

    this.ensureCandidateBuffers(candidateCount);
    const terminalCount = this.satCount * 4;
    this.ensureTerminalBuffers(terminalCount);

    const {
      candidateBuffer,
      scoreBuffer,
      packedLtBuffer,
      activeBuffer,
      selectedBuffer,
      terminalMatchedBuffer,
      claimSrcBuffer,
      claimDstBuffer,
      posBuffer,
      velBuffer,
      readPackedLtBuffer,
      readSelectedBuffer
    } = this.mustBuffers();

    const candidateUpload = new Uint32Array(candidatesPacked);
    this.device.queue.writeBuffer(candidateBuffer, 0, candidateUpload);
    this.device.queue.writeBuffer(
      this.scoreParamBuffer,
      0,
      new ArrayBuffer(32)
    );
    {
      const params = new DataView(new ArrayBuffer(32));
      params.setUint32(0, this.satCount, true);
      params.setUint32(4, candidateCount, true);
      params.setFloat32(8, config.maxDistanceKm, true);
      params.setFloat32(12, Math.cos((config.forThetaDeg * Math.PI) / 180), true);
      params.setFloat32(16, config.minViewTimeSec, true);
      params.setFloat32(20, SCORE_CAP, true);
      params.setUint32(24, RANK_LEVELS, true);
      this.device.queue.writeBuffer(this.scoreParamBuffer, 0, params.buffer);
    }
    {
      const params = new DataView(new ArrayBuffer(16));
      params.setUint32(0, terminalCount, true);
      params.setUint32(4, candidateCount, true);
      params.setUint32(8, RANK_LEVELS, true);
      this.device.queue.writeBuffer(this.matchParamBuffer, 0, params.buffer);
    }

    const scoreBindGroup = this.device.createBindGroup({
      layout: this.scorePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: posBuffer } },
        { binding: 1, resource: { buffer: velBuffer } },
        { binding: 2, resource: { buffer: candidateBuffer } },
        { binding: 3, resource: { buffer: scoreBuffer } },
        { binding: 4, resource: { buffer: packedLtBuffer } },
        { binding: 5, resource: { buffer: activeBuffer } },
        { binding: 6, resource: { buffer: this.scoreParamBuffer } }
      ]
    });

    const matchEntries = [
      { binding: 0, resource: { buffer: scoreBuffer } },
      { binding: 1, resource: { buffer: packedLtBuffer } },
      { binding: 2, resource: { buffer: activeBuffer } },
      { binding: 3, resource: { buffer: selectedBuffer } },
      { binding: 4, resource: { buffer: terminalMatchedBuffer } },
      { binding: 5, resource: { buffer: claimSrcBuffer } },
      { binding: 6, resource: { buffer: claimDstBuffer } },
      { binding: 7, resource: { buffer: this.matchParamBuffer } }
    ] satisfies GPUBindGroupEntry[];

    const initBindGroup = this.device.createBindGroup({
      layout: this.initPipeline.getBindGroupLayout(0),
      entries: matchEntries
    });
    const clearBindGroup = this.device.createBindGroup({
      layout: this.clearClaimsPipeline.getBindGroupLayout(0),
      entries: matchEntries
    });
    const claimBindGroup = this.device.createBindGroup({
      layout: this.claimPipeline.getBindGroupLayout(0),
      entries: matchEntries
    });
    const finalizeBindGroup = this.device.createBindGroup({
      layout: this.finalizePipeline.getBindGroupLayout(0),
      entries: matchEntries
    });

    const scoreStart = performance.now();
    const scoreEncoder = this.device.createCommandEncoder();
    {
      const pass = scoreEncoder.beginComputePass();
      pass.setPipeline(this.scorePipeline);
      pass.setBindGroup(0, scoreBindGroup);
      pass.dispatchWorkgroups(Math.ceil(candidateCount / WORKGROUP_SIZE));
      pass.end();
    }
    this.device.queue.submit([scoreEncoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    const scoreMs = performance.now() - scoreStart;

    const matchStart = performance.now();
    const matchEncoder = this.device.createCommandEncoder();
    {
      const pass = matchEncoder.beginComputePass();
      pass.setPipeline(this.initPipeline);
      pass.setBindGroup(0, initBindGroup);
      pass.dispatchWorkgroups(Math.ceil(Math.max(candidateCount, terminalCount) / WORKGROUP_SIZE));

      for (let round = 0; round < MATCH_ROUNDS; round += 1) {
        pass.setPipeline(this.clearClaimsPipeline);
        pass.setBindGroup(0, clearBindGroup);
        pass.dispatchWorkgroups(Math.ceil(terminalCount / WORKGROUP_SIZE));

        pass.setPipeline(this.claimPipeline);
        pass.setBindGroup(0, claimBindGroup);
        pass.dispatchWorkgroups(Math.ceil(candidateCount / WORKGROUP_SIZE));

        pass.setPipeline(this.finalizePipeline);
        pass.setBindGroup(0, finalizeBindGroup);
        pass.dispatchWorkgroups(Math.ceil(candidateCount / WORKGROUP_SIZE));
      }
      pass.end();

      matchEncoder.copyBufferToBuffer(selectedBuffer, 0, readSelectedBuffer, 0, candidateCount * 4);
      matchEncoder.copyBufferToBuffer(packedLtBuffer, 0, readPackedLtBuffer, 0, candidateCount * 4);
    }
    this.device.queue.submit([matchEncoder.finish()]);

    await withTimeout(this.device.queue.onSubmittedWorkDone(), WATCHDOG_MS, 'GPU matching timeout');

    await withTimeout(readSelectedBuffer.mapAsync(GPUMapMode.READ), WATCHDOG_MS, 'GPU selected read timeout');
    const selected = new Uint32Array(readSelectedBuffer.getMappedRange().slice(0));
    readSelectedBuffer.unmap();

    await withTimeout(readPackedLtBuffer.mapAsync(GPUMapMode.READ), WATCHDOG_MS, 'GPU terminal read timeout');
    const packedLt = new Uint32Array(readPackedLtBuffer.getMappedRange().slice(0));
    readPackedLtBuffer.unmap();

    const satPairs: number[] = [];
    const lts: number[] = [];

    for (let i = 0; i < candidateCount; i += 1) {
      if (selected[i] === 0) {
        continue;
      }
      const packed = packedLt[i];
      if (packed === INVALID_LT) {
        continue;
      }
      const srcSat = candidatesPacked[i * 2 + 0] ?? 0;
      const dstSat = candidatesPacked[i * 2 + 1] ?? 0;
      const srcLt = packed & 0xffff;
      const dstLt = (packed >>> 16) & 0xffff;
      if (srcLt >= this.satCount * 4 || dstLt >= this.satCount * 4) {
        continue;
      }

      satPairs.push(srcSat, dstSat);
      lts.push(srcLt, dstLt);
    }

    const matchMs = performance.now() - matchStart;

    return {
      connectedSatPairs: new Uint32Array(satPairs),
      connectedLts: new Uint32Array(lts),
      matchedCount: satPairs.length / 2,
      candidateCount,
      scoreMs,
      matchMs,
      rounds: MATCH_ROUNDS
    };
  }

  private mustBuffers(): {
    posBuffer: GPUBuffer;
    velBuffer: GPUBuffer;
    candidateBuffer: GPUBuffer;
    scoreBuffer: GPUBuffer;
    packedLtBuffer: GPUBuffer;
    activeBuffer: GPUBuffer;
    selectedBuffer: GPUBuffer;
    terminalMatchedBuffer: GPUBuffer;
    claimSrcBuffer: GPUBuffer;
    claimDstBuffer: GPUBuffer;
    readSelectedBuffer: GPUBuffer;
    readPackedLtBuffer: GPUBuffer;
  } {
    if (
      !this.posBuffer ||
      !this.velBuffer ||
      !this.candidateBuffer ||
      !this.scoreBuffer ||
      !this.packedLtBuffer ||
      !this.activeBuffer ||
      !this.selectedBuffer ||
      !this.terminalMatchedBuffer ||
      !this.claimSrcBuffer ||
      !this.claimDstBuffer ||
      !this.readSelectedBuffer ||
      !this.readPackedLtBuffer
    ) {
      throw new Error('GPU matcher buffers are not initialized');
    }
    return {
      posBuffer: this.posBuffer,
      velBuffer: this.velBuffer,
      candidateBuffer: this.candidateBuffer,
      scoreBuffer: this.scoreBuffer,
      packedLtBuffer: this.packedLtBuffer,
      activeBuffer: this.activeBuffer,
      selectedBuffer: this.selectedBuffer,
      terminalMatchedBuffer: this.terminalMatchedBuffer,
      claimSrcBuffer: this.claimSrcBuffer,
      claimDstBuffer: this.claimDstBuffer,
      readSelectedBuffer: this.readSelectedBuffer,
      readPackedLtBuffer: this.readPackedLtBuffer
    };
  }

  private ensureSatBuffers(satCount: number): void {
    if (satCount <= this.satCapacity && this.posBuffer && this.velBuffer) {
      return;
    }
    this.posBuffer?.destroy();
    this.velBuffer?.destroy();

    this.satCapacity = satCount;
    const bytes = Math.max(16, satCount * 4 * 4);

    this.posBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.velBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
  }

  private ensureCandidateBuffers(candidateCount: number): void {
    if (
      candidateCount <= this.candidateCapacity &&
      this.candidateBuffer &&
      this.scoreBuffer &&
      this.packedLtBuffer &&
      this.activeBuffer &&
      this.selectedBuffer &&
      this.readSelectedBuffer &&
      this.readPackedLtBuffer
    ) {
      return;
    }

    this.candidateBuffer?.destroy();
    this.scoreBuffer?.destroy();
    this.packedLtBuffer?.destroy();
    this.activeBuffer?.destroy();
    this.selectedBuffer?.destroy();
    this.readSelectedBuffer?.destroy();
    this.readPackedLtBuffer?.destroy();

    this.candidateCapacity = candidateCount;
    const pairBytes = Math.max(8, candidateCount * 2 * 4);
    const edgeBytes = Math.max(4, candidateCount * 4);

    this.candidateBuffer = this.device.createBuffer({
      size: pairBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.scoreBuffer = this.device.createBuffer({
      size: edgeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.packedLtBuffer = this.device.createBuffer({
      size: edgeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.activeBuffer = this.device.createBuffer({
      size: edgeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.selectedBuffer = this.device.createBuffer({
      size: edgeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    this.readSelectedBuffer = this.device.createBuffer({
      size: edgeBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.readPackedLtBuffer = this.device.createBuffer({
      size: edgeBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }

  private ensureTerminalBuffers(terminalCount: number): void {
    if (
      terminalCount <= this.terminalCapacity &&
      this.terminalMatchedBuffer &&
      this.claimSrcBuffer &&
      this.claimDstBuffer
    ) {
      return;
    }

    this.terminalMatchedBuffer?.destroy();
    this.claimSrcBuffer?.destroy();
    this.claimDstBuffer?.destroy();

    this.terminalCapacity = terminalCount;
    const bytes = Math.max(4, terminalCount * 4);

    this.terminalMatchedBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE
    });
    this.claimSrcBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE
    });
    this.claimDstBuffer = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE
    });
  }
}

function packVec3ToVec4(src: Float32Array<ArrayBufferLike>, count: number): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    out[i * 4 + 0] = src[i * 3 + 0] ?? 0;
    out[i * 4 + 1] = src[i * 3 + 1] ?? 0;
    out[i * 4 + 2] = src[i * 3 + 2] ?? 0;
    out[i * 4 + 3] = 0;
  }
  return out;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
