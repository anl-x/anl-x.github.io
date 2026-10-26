// Cyclonic circulation: a low-pressure vortex with slow drift, sampled as a wind field.
// Style-agnostic math only; the glyph-tile chart lives in chart.js.

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}

// Deterministic integer hash to [0, 1), so cell patterns stay pinned to the grid.
export function hash3(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// One glyph per 45° of screen-space direction; "-" and "|" cover the axes.
export const DIR_GLYPHS = ["-", "\\", "|", "/", "-", "\\", "|", "/"];

/** 8-way direction index for a screen-space vector (y down). */
export function dirIndex(dx, dy) {
    return Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7;
}

export function dirGlyph(dx, dy) {
    return DIR_GLYPHS[dirIndex(dx, dy)];
}

/** Unit steps (in grid cells) for an 8-way direction, as [dx, dy] with -1/0/1. */
export function dirStep(index) {
    const steps = [
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [-1, -1],
        [0, -1],
        [1, -1],
    ];
    return steps[index & 7];
}

export class Cyclone {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.x = 0;
        this.y = 0;
        this.homeX = 0;
        this.homeY = 0;
        this.vx = 0;
        this.vy = 0;
        this.rm = 180;
        this.vmax = 260;
        this.eye = 26;
        // Inflow angle of the surface wind: air spirals in rather than circling.
        this.inflow = 0.3;

        this.roll();
        this._tmp = { x: 0, y: 0, speed: 0 };
        this._storm = { x: 0, y: 0, r: 0, angle: 0 };
        this._cos = 1;
        this._sin = 0;
    }

    /** Every load gets its own storm: tilt, spiral pitch, shear and embedded vortices. */
    roll() {
        this.driftPhase = Math.random() * TAU;
        this.tilt = (Math.random() - 0.5) * 0.9;
        this.aspect = 0.84 + Math.random() * 0.16;
        this.arms = Math.random() < 0.45 ? 2 : 3;
        this.pitch = 4.4 + Math.random() * 1.8;
        this.asymAngle = Math.random() * TAU;
        this.harmonic = Math.random() * TAU;
        this.turbulence = 0.06 + Math.random() * 0.09;
        this.vmaxFactor = 0.85 + Math.random() * 0.3;
        this.rmFactor = 0.85 + Math.random() * 0.35;
        this.flowAngle = Math.random() * TAU;
        this.flowMag = 0.04 + Math.random() * 0.05;

        // A few small embedded vortices, the tell of a ragged, evolving core.
        this.mesos = [];
        const count = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            this.mesos.push({
                angle: Math.random() * TAU,
                radius: 0.85 + Math.random() * 1.35,
                size: 0.28 + Math.random() * 0.4,
                strength: 0.14 + Math.random() * 0.2,
            });
        }
    }

    resize(width, height) {
        const first = this.width === 0;
        this.width = width;
        this.height = height;
        // The eyewall sits near a fifth of the short side, so the whole circulation reads on one screen.
        this.rm = clamp(Math.min(width, height) * 0.185 * this.rmFactor, 84, 230);
        this.eye = this.rm * 0.17;
        this.vmax = clamp(Math.min(width, height) * 0.4 * this.vmaxFactor, 150, 420);
        this._cos = Math.cos(this.tilt);
        this._sin = Math.sin(this.tilt);

        const mx = Math.min(width * 0.3, this.rm * 2.2);
        const my = Math.min(height * 0.3, this.rm * 2.2);
        if (first) {
            // Random spawn point each load, kept fully inside the frame.
            this.homeX = mx + Math.random() * Math.max(1, width - 2 * mx);
            this.homeY = my + Math.random() * Math.max(1, height - 2 * my);
            this.x = this.homeX;
            this.y = this.homeY;
        } else {
            this.homeX = clamp(this.homeX, mx, width - mx);
            this.homeY = clamp(this.homeY, my, height - my);
        }
    }

    /** Slow Lissajous wander of the low, as if steered by the surrounding flow. */
    update(dt, time) {
        const px = this.x;
        const py = this.y;
        const p = time * 0.016 + this.driftPhase;
        const spanX = Math.min(this.width * 0.09, this.rm * 0.8);
        const spanY = Math.min(this.height * 0.07, this.rm * 0.8);
        const tx = this.homeX + Math.sin(p) * spanX;
        const ty = this.homeY + Math.sin(p * 1.31 + 1.2) * spanY;
        const k = 1 - Math.exp(-dt * 0.4);
        this.x += (tx - this.x) * k;
        this.y += (ty - this.y) * k;
        this.vx = dt > 0 ? (this.x - px) / dt : 0;
        this.vy = dt > 0 ? (this.y - py) / dt : 0;
    }

    /** Storm-frame coordinates: the core is an ellipse, tilted, so it isn't a perfect circle. */
    toStorm(dx, dy, out = this._storm) {
        const ex = dx * this._cos + dy * this._sin;
        const ey = -dx * this._sin + dy * this._cos;
        const ry = ey / this.aspect;
        out.x = ex;
        out.y = ry;
        out.r = Math.hypot(ex, ry);
        out.angle = Math.atan2(ry, ex);
        return out;
    }

    /**
     * Wind at a point, px/s. Tangential speed grows through the core, peaks at the eyewall
     * and decays outside; part of it points inward, so the field is a spiral, not rings.
     * Counter-clockwise on screen (northern-hemisphere sense), with an asymmetry, a few
     * embedded vortices and a weak environmental flow.
     */
    sample(x, y, out = this._tmp) {
        const dx = x - this.x;
        const dy = y - this.y;
        const storm = this.toStorm(dx, dy);
        const r = storm.r || 1e-3;
        const u = r / this.rm;

        // Core rotation, gaussian shoulder outside the eyewall, calm inside the eye.
        const profile = u * Math.exp(0.3 * (1 - u * u));
        const eyeCut = smoothstep(0.08, 0.52, u);
        const asym = 1 + 0.18 * Math.cos(storm.angle - this.asymAngle);
        const vt = this.vmax * profile * eyeCut * asym;

        // Tangent in storm frame maps back through the tilt and the ellipse scale.
        const tx = -storm.y;
        const ty = storm.x;
        const tl = Math.hypot(tx, ty) || 1;
        const bsx = tx / tl;
        const bsy = ty / tl;
        const scaledY = bsy * this.aspect;
        const tangentX = bsx * this._cos - scaledY * this._sin;
        const tangentY = bsx * this._sin + scaledY * this._cos;

        // Inflow pulls the circulation in toward the low.
        const rl = Math.hypot(dx, dy) || 1e-3;
        const ix = -dx / rl;
        const iy = -dy / rl;

        let wx = vt * (tangentX + ix * this.inflow);
        let wy = vt * (tangentY + iy * this.inflow);

        // Embedded vortices add small local rotations along the bands.
        for (const m of this.mesos) {
            const mx = this.x + Math.cos(m.angle) * m.radius * this.rm;
            const my = this.y + Math.sin(m.angle) * m.radius * this.rm;
            const ddx = x - mx;
            const ddy = y - my;
            const d = Math.hypot(ddx, ddy);
            const span = m.size * this.rm;
            if (d > span || d < 1e-3) continue;
            const falloff = Math.exp(-((d / span) ** 2) * 2.2);
            const speed = this.vmax * m.strength * falloff * (d / span);
            wx += (-ddy / d) * speed;
            wy += (ddx / d) * speed;
        }

        // Environmental steering flow, so the storm sits in a larger field rather than still air.
        const flow = this.vmax * this.flowMag;
        wx += Math.cos(this.flowAngle) * flow + this.vx;
        wy += Math.sin(this.flowAngle) * flow + this.vy;

        out.x = wx;
        out.y = wy;
        out.speed = Math.hypot(wx, wy);
        return out;
    }

    /** Normalised wind speed 0..1, used for the colour ramp and glyph density. */
    intensity(speed) {
        return clamp(speed / (this.vmax * 1.15), 0, 1);
    }
}
