struct MatchParams {
  terminalCount: u32,
  candidateCount: u32,
  rankLevels: u32,
  _pad0: u32,
};

@group(0) @binding(0)
var<storage, read> scores: array<f32>;

@group(0) @binding(1)
var<storage, read> packedLts: array<u32>;

@group(0) @binding(2)
var<storage, read_write> active: array<u32>;

@group(0) @binding(3)
var<storage, read_write> selected: array<u32>;

@group(0) @binding(4)
var<storage, read_write> terminalMatched: array<atomic<u32>>;

@group(0) @binding(5)
var<storage, read_write> claimSrc: array<atomic<u32>>;

@group(0) @binding(6)
var<storage, read_write> claimDst: array<atomic<u32>>;

@group(0) @binding(7)
var<uniform> params: MatchParams;

const INVALID_KEY: u32 = 0xffffffffu;

fn make_claim_key(score: f32, edgeIdx: u32, rankLevels: u32) -> u32 {
  let clamped = clamp(score, 0.0, 1e12);
  let normalized = clamp(log2(1.0 + clamped) / log2(1.0 + 1e12), 0.0, 1.0);
  let rankMax = max(1u, rankLevels) - 1u;
  let rank = u32((1.0 - normalized) * f32(rankMax));
  return (rank << 22u) | (edgeIdx & 0x003fffffu);
}

@compute @workgroup_size(256)
fn init_state(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx < params.terminalCount) {
    atomicStore(&terminalMatched[idx], 0u);
    atomicStore(&claimSrc[idx], INVALID_KEY);
    atomicStore(&claimDst[idx], INVALID_KEY);
  }
  if (idx < params.candidateCount) {
    selected[idx] = 0u;
  }
}

@compute @workgroup_size(256)
fn clear_claims(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.terminalCount) {
    return;
  }
  atomicStore(&claimSrc[idx], INVALID_KEY);
  atomicStore(&claimDst[idx], INVALID_KEY);
}

@compute @workgroup_size(256)
fn claim_edges(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.candidateCount || active[idx] == 0u) {
    return;
  }

  let packed = packedLts[idx];
  if (packed == 0xffffffffu || scores[idx] < 0.0) {
    return;
  }

  let srcLt = packed & 0xffffu;
  let dstLt = (packed >> 16u) & 0xffffu;

  if (srcLt >= params.terminalCount || dstLt >= params.terminalCount) {
    return;
  }

  if (atomicLoad(&terminalMatched[srcLt]) != 0u || atomicLoad(&terminalMatched[dstLt]) != 0u) {
    return;
  }

  let key = make_claim_key(scores[idx], idx, params.rankLevels);
  atomicMin(&claimSrc[srcLt], key);
  atomicMin(&claimDst[dstLt], key);
}

@compute @workgroup_size(256)
fn finalize_edges(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.candidateCount || active[idx] == 0u) {
    return;
  }

  let packed = packedLts[idx];
  if (packed == 0xffffffffu || scores[idx] < 0.0) {
    active[idx] = 0u;
    return;
  }

  let srcLt = packed & 0xffffu;
  let dstLt = (packed >> 16u) & 0xffffu;

  if (srcLt >= params.terminalCount || dstLt >= params.terminalCount) {
    active[idx] = 0u;
    return;
  }

  let srcMatched = atomicLoad(&terminalMatched[srcLt]);
  let dstMatched = atomicLoad(&terminalMatched[dstLt]);
  if (srcMatched != 0u || dstMatched != 0u) {
    active[idx] = 0u;
    return;
  }

  let key = make_claim_key(scores[idx], idx, params.rankLevels);
  if (atomicLoad(&claimSrc[srcLt]) == key && atomicLoad(&claimDst[dstLt]) == key) {
    selected[idx] = 1u;
    atomicStore(&terminalMatched[srcLt], 1u);
    atomicStore(&terminalMatched[dstLt], 1u);
    active[idx] = 0u;
    return;
  }
}
