// Shared by the Enlarger and the harmless inspection lesson. Glass admits light.
import { G } from './state.js';
import { P } from './player.js';
import { PLAYER } from './config.js';

export function lightReachesPlayer(from, exclude = null) {
  const to = new window.THREE.Vector3(P.pos.x, P.pos.y + PLAYER.height * 0.6, P.pos.z).sub(from);
  const distance = to.length();
  if (distance < 0.001) return true;
  to.normalize();
  const hit = G.L.world.castRay(new G.R.Ray(from, to), distance, true,
    G.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, exclude, P.body,
    c => G.L.colliders.get(c.handle)?.kind !== 'glass');
  return !hit || hit.timeOfImpact >= distance - 0.3;
}
