import shaderCode from './edge-score.compute.wgsl?raw';

export interface CandidatePair {
  src: number;
  dst: number;
}

export interface EdgeScoreConfig {
  maxDistanceKm: number;
  cosThreshold: number;
}

export class WebGpuEdgeScorer {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;

  private constructor(device: GPUDevice, pipeline: GPUComputePipeline) {
    this.device = device;
    this.pipeline = pipeline;
  }

  static create(device: GPUDevice): WebGpuEdgeScorer {
    const module = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main'
      }
    });
    return new WebGpuEdgeScorer(device, pipeline);
  }

  async score(
    satPositionsKm: Float32Array,
    candidates: CandidatePair[],
    config: EdgeScoreConfig
  ): Promise<Float32Array> {
    if (candidates.length === 0) {
      return new Float32Array();
    }

    const candidateCount = candidates.length;

    const packedPositions = new Float32Array((satPositionsKm.length / 3) * 4);
    for (let i = 0; i < satPositionsKm.length / 3; i += 1) {
      packedPositions[i * 4 + 0] = satPositionsKm[i * 3 + 0];
      packedPositions[i * 4 + 1] = satPositionsKm[i * 3 + 1];
      packedPositions[i * 4 + 2] = satPositionsKm[i * 3 + 2];
      packedPositions[i * 4 + 3] = 0;
    }

    const candidateData = new Uint32Array(candidateCount * 2);
    for (let i = 0; i < candidateCount; i += 1) {
      candidateData[i * 2 + 0] = candidates[i].src;
      candidateData[i * 2 + 1] = candidates[i].dst;
    }

    const posBuffer = this.device.createBuffer({
      size: packedPositions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const candidateBuffer = this.device.createBuffer({
      size: candidateData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const scoreBuffer = this.device.createBuffer({
      size: candidateCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    const readBuffer = this.device.createBuffer({
      size: candidateCount * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const params = new Float32Array([
      packedPositions.length / 4,
      candidateCount,
      config.maxDistanceKm,
      config.cosThreshold
    ]);
    const paramBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.device.queue.writeBuffer(posBuffer, 0, packedPositions);
    this.device.queue.writeBuffer(candidateBuffer, 0, candidateData);
    this.device.queue.writeBuffer(paramBuffer, 0, params);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: posBuffer } },
        { binding: 1, resource: { buffer: candidateBuffer } },
        { binding: 2, resource: { buffer: scoreBuffer } },
        { binding: 3, resource: { buffer: paramBuffer } }
      ]
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(candidateCount / 256));
    pass.end();
    encoder.copyBufferToBuffer(scoreBuffer, 0, readBuffer, 0, candidateCount * 4);

    this.device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();

    posBuffer.destroy();
    candidateBuffer.destroy();
    scoreBuffer.destroy();
    readBuffer.destroy();
    paramBuffer.destroy();

    return copy;
  }
}
