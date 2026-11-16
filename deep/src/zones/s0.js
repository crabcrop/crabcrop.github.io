// The hands-on pieces of the marina (see src/stage.js for what a zone module is; its words are
// in zones/s0.html, its styles in zones/s0.css), and the ways the world answers the visitor's
// hand along the whole dive that belong to no one zone:
//   - the dock's "Scroll to dive with Snap" while the visitor is at the very top (wide screens)
//   - the splash where Snap dives in (drops and a burst of bubbles, and its sound)
//   - rings on the water under the hand at both marinas (sea.js draws them)
//   - the heat over the vents wavering round the hand (the engine's last pass)
import { Vector3 } from 'three/webgpu';
import { smooth } from '../math.js';
import { G } from '../shaders.js';

export default {
  id: 's0',
  mount(stage, world) {
    stage.dock.ask('scroll', { verb: 'Scroll', text: 'to dive with Snap' });
    const ray = new Vector3(), at = new Vector3(), H = [0, 0];
    let lastP = stage.p, ripple = 0;
    this.tick = () => {
      const p = stage.p, cam = world.camera;
      const want = p < 0.03 && stage.wide ? 'scroll' : null;
      if (want) stage.dock.show('scroll');
      else if (stage.dock.current === 'scroll') stage.dock.show(null);

      // the splash: as he goes into the water (on the way down)
      if (lastP < 0.135 && p >= 0.135 && p - lastP < 0.1 && world.cast) {
        world.cast.snapAt(at);
        at.y = 0.02;
        stage.sparkle(at, 12, 'drop');
        if (world.audio) world.audio.cue('splash');
      }
      lastP = p;

      // rings on the water where the hand is over it, at either marina
      let on = 0;
      if ((p < 0.2 || p > 7.8) && stage.live()) {
        stage.hand(H);
        ray.set((H[0] / stage.W) * 2 - 1, 1 - (H[1] / stage.H) * 2, 0.5).unproject(cam).sub(cam.position);
        const t = Math.abs(ray.y) > 1e-4 ? -cam.position.y / ray.y : -1;
        if (t > 0 && t * ray.length() < 40) { at.copy(cam.position).addScaledVector(ray, t); G.ripple.value.x = at.x; G.ripple.value.y = at.z; on = 1; }
      }
      ripple += (on - ripple) * Math.min(1, stage.dt * 3);
      G.ripple.value.z = ripple;

      // the vents' heat round the hand
      world.engine.shimmer(smooth(6.0, 6.15, p) * (1 - smooth(6.95, 7.05, p)));
    };
  },
  frame() { if (this.tick) this.tick(); },
};
