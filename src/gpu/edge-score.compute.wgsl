struct Candidate {
  src: u32,
  dst: u32,
};

struct Params {
  satCount: u32,
  candidateCount: u32,
  maxDistanceKm: f32,
  cosThreshold: f32,
};

@group(0) @binding(0)
var<storage, read> positions: array<vec4<f32>>;

@group(0) @binding(1)
var<storage, read> candidates: array<Candidate>;

@group(0) @binding(2)
var<storage, read_write> scores: array<f32>;

@group(0) @binding(3)
var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.candidateCount) {
    return;
  }

  let c = candidates[idx];
  let a = positions[c.src].xyz;
  let b = positions[c.dst].xyz;
  let d = b - a;
  let dist = length(d);

  if (dist > params.maxDistanceKm) {
    scores[idx] = -1.0;
    return;
  }

  // This v1 kernel provides distance-based scoring only.
  // The CPU link worker remains source-of-truth for full FOR and matching logic.
  scores[idx] = 1.0 / max(1.0, dist);
}
