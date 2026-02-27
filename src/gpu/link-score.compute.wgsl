struct Candidate {
  src: u32,
  dst: u32,
};

struct ScoreParams {
  satCount: u32,
  candidateCount: u32,
  maxDistanceKm: f32,
  cosThreshold: f32,
  minViewTimeSec: f32,
  scoreCap: f32,
  rankLevels: u32,
  _pad0: u32,
};

@group(0) @binding(0)
var<storage, read> positions: array<vec4<f32>>;

@group(0) @binding(1)
var<storage, read> velocities: array<vec4<f32>>;

@group(0) @binding(2)
var<storage, read> candidates: array<Candidate>;

@group(0) @binding(3)
var<storage, read_write> scores: array<f32>;

@group(0) @binding(4)
var<storage, read_write> packedLts: array<u32>;

@group(0) @binding(5)
var<storage, read_write> active: array<u32>;

@group(0) @binding(6)
var<uniform> params: ScoreParams;

fn clamp_signed01(v: f32) -> f32 {
  return clamp(v, -1.0, 1.0);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.candidateCount) {
    return;
  }

  let c = candidates[idx];
  if (c.src >= params.satCount || c.dst >= params.satCount || c.src == c.dst) {
    scores[idx] = -1.0;
    packedLts[idx] = 0xffffffffu;
    active[idx] = 0u;
    return;
  }

  let pa = positions[c.src].xyz;
  let pb = positions[c.dst].xyz;
  let d = pb - pa;
  let dist = length(d);
  if (dist <= 0.0 || dist > params.maxDistanceKm) {
    scores[idx] = -1.0;
    packedLts[idx] = 0xffffffffu;
    active[idx] = 0u;
    return;
  }

  let dir = d / dist;

  let va = velocities[c.src].xyz;
  let vb = velocities[c.dst].xyz;

  let vaN = max(length(va), 1e-9);
  let vbN = max(length(vb), 1e-9);

  let frontA = va / vaN;
  let backA = -frontA;
  let frontB = vb / vbN;
  let backB = -frontB;

  let paN = pa / max(length(pa), 1e-9);
  let pbN = pb / max(length(pb), 1e-9);

  let rightA = cross(paN, frontA);
  let leftA = -rightA;
  let rightB = cross(pbN, frontB);
  let leftB = -rightB;

  let from0 = dot(frontA, dir);
  let from1 = dot(backA, dir);
  let from2 = dot(rightA, dir);
  let from3 = dot(leftA, dir);

  let negDir = -dir;
  let to0 = dot(frontB, negDir);
  let to1 = dot(backB, negDir);
  let to2 = dot(rightB, negDir);
  let to3 = dot(leftB, negDir);

  var bestFrom: i32 = -1;
  var bestTo: i32 = -1;
  var bestMinCos: f32 = -2.0;

  let fromArr = array<f32, 4>(from0, from1, from2, from3);
  let toArr = array<f32, 4>(to0, to1, to2, to3);

  for (var a: i32 = 0; a < 4; a = a + 1) {
    let fv = fromArr[u32(a)];
    if (fv <= params.cosThreshold) {
      continue;
    }
    for (var b: i32 = 0; b < 4; b = b + 1) {
      let tv = toArr[u32(b)];
      if (tv <= params.cosThreshold) {
        continue;
      }
      let minCos = min(fv, tv);
      if (minCos > bestMinCos) {
        bestMinCos = minCos;
        bestFrom = a;
        bestTo = b;
      }
    }
  }

  if (bestFrom < 0 || bestTo < 0) {
    scores[idx] = -1.0;
    packedLts[idx] = 0xffffffffu;
    active[idx] = 0u;
    return;
  }

  let rv = vb - va;
  let cx = rv.y * d.z - rv.z * d.y;
  let cy = rv.z * d.x - rv.x * d.z;
  let cz = rv.x * d.y - rv.y * d.x;
  let angularSpeed = length(vec3<f32>(cx, cy, cz)) / dist;

  let theta = acos(params.cosThreshold);
  let acosVal = acos(clamp_signed01(bestMinCos));

  var viewTime: f32;
  if (angularSpeed <= 1e-9) {
    viewTime = params.scoreCap;
  } else {
    viewTime = (theta - acosVal) / abs(angularSpeed);
  }

  if (viewTime <= params.minViewTimeSec) {
    scores[idx] = -1.0;
    packedLts[idx] = 0xffffffffu;
    active[idx] = 0u;
    return;
  }

  let score = min(viewTime, params.scoreCap);
  scores[idx] = score;
  let srcLt = c.src * 4u + u32(bestFrom);
  let dstLt = c.dst * 4u + u32(bestTo);
  packedLts[idx] = (dstLt << 16u) | srcLt;
  active[idx] = 1u;
}
