// Glyph-tile wind chart: isobars, station barbs, an airflow field and orbiting tracers,
// all etched as monospace tiles. Same visual language as the original koi-pond canvas.

import { clamp, dirGlyph, dirIndex, dirStep, hash3, smoothstep, TAU } from "./field.js";

const DARK = {
    bg: [8, 14, 27],
    // Wind-speed ramp for the tiles: deep water at calm, then blue, then icy gust light.
    flow: [
        [20, 66, 136],
        [30, 128, 232],
        [86, 192, 255],
        [198, 238, 255],
    ],
    pale: [186, 226, 255],
    etch: [150, 210, 255],
    accent: [122, 214, 255],
    isobar: [86, 142, 214],
    station: [168, 216, 255],
    label: [140, 194, 244],
    // How far a tile is washed from the page colour toward its wind colour.
    wash: [0.16, 0.55],
};

// Pale paper: dark ink glyphs on pale blue washes.
const LIGHT = {
    bg: [240, 244, 250],
    flow: [
        [172, 196, 226],
        [92, 148, 212],
        [28, 92, 176],
        [6, 34, 84],
    ],
    pale: [14, 42, 88],
    etch: [12, 46, 104],
    accent: [10, 94, 178],
    isobar: [70, 118, 186],
    station: [36, 88, 154],
    label: [38, 88, 154],
    wash: [0.12, 0.5],
};

const packRgb = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
const mix = (a, b, k) => [
    (a[0] + (b[0] - a[0]) * k) | 0,
    (a[1] + (b[1] - a[1]) * k) | 0,
    (a[2] + (b[2] - a[2]) * k) | 0,
];

function ramp(stops, t) {
    const x = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    return mix(stops[i], stops[i + 1], x - i);
}

function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
}

// Isobar levels: pressure rises outward from the low, closer together near the eyewall.
const ISOBARS = [
    { radius: 0.42, pressure: 986 },
    { radius: 0.72, pressure: 990 },
    { radius: 1.08, pressure: 994 },
    { radius: 1.55, pressure: 998 },
    { radius: 2.06, pressure: 1002 },
];

const TRACERS = 220;

export class WindChart {
    constructor(canvas) {
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2D canvas unavailable");
        this.ctx = ctx;
        this.palette = DARK;
        this.dpr = 1;
        this.cw = 12;
        this.ch = 14;
        this.cols = 0;
        this.rows = 0;
        this.styles = new Map();
        this.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
        this.annotations = [];
        this.tracers = [];
        this.stormScratch = { x: 0, y: 0, r: 0, angle: 0 };
    }

    setTheme(isLight) {
        this.palette = isLight ? LIGHT : DARK;
    }

    resize(width, height, dpr) {
        this.dpr = dpr;
        // Near-square tiles, large enough to read each etched glyph.
        this.cw = clamp(Math.round(width / 108), 10, 14);
        this.ch = this.cw + 2;
        this.cols = Math.ceil(width / this.cw);
        this.rows = Math.ceil(height / this.ch);
        this.ctx.canvas.width = Math.round(width * dpr);
        this.ctx.canvas.height = Math.round(height * dpr);

        const n = this.cols * this.rows;
        this.cellGlyph = new Uint16Array(n);
        this.cellColor = new Uint32Array(n);
        this.cellAlpha = new Float32Array(n);
        this.cellTile = new Uint32Array(n);
        this.cellTileAlpha = new Float32Array(n);
        this.seedTracers();
    }

    // ── cell helpers ────────────────────────────────────────────────────

    put(c, r, glyph, color, alpha, tile, tileAlpha) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
        const i = r * this.cols + c;
        this.cellGlyph[i] = glyph.charCodeAt(0);
        this.cellColor[i] = packRgb(color);
        this.cellAlpha[i] = alpha;
        this.cellTile[i] = tile ? packRgb(tile) : 0;
        this.cellTileAlpha[i] = tileAlpha || 0;
    }

    cellAt(x, y) {
        const c = Math.floor(x / this.cw);
        const r = Math.floor(y / this.ch);
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
        return r * this.cols + c;
    }

    style(rgb) {
        let s = this.styles.get(rgb);
        if (!s) {
            s = `rgb(${rgb >>> 16},${(rgb >>> 8) & 255},${rgb & 255})`;
            this.styles.set(rgb, s);
        }
        return s;
    }

    // ── field ───────────────────────────────────────────────────────────

    /** Map a point in storm-frame polar coordinates back to screen space. */
    stormPoint(cyclone, radius, angle) {
        const ex = Math.cos(angle) * radius;
        const ey = Math.sin(angle) * radius * cyclone.aspect;
        return {
            x: cyclone.x + ex * cyclone._cos - ey * cyclone._sin,
            y: cyclone.y + ex * cyclone._sin + ey * cyclone._cos,
        };
    }

    /**
     * The wind field as glyphed tiles, shaped into sheared log-spiral bands around a
     * tilted, slightly elliptical core with a tight eyewall: an organised storm, not a
     * clean circle of concentric rings.
     */
    paintField(cyclone, time) {
        const { cols, rows, cw, ch, palette } = this;
        const ref = cyclone.vmax * 1.15;
        const scratch = this.stormScratch;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = c * cw + cw / 2;
                const y = r * ch + ch / 2;
                const storm = cyclone.toStorm(x - cyclone.x, y - cyclone.y, scratch);
                const u = storm.r / cyclone.rm;
                if (u < 0.07 || u > 4.2) continue;

                const s = cyclone.sample(x, y);
                const t = clamp(s.speed / ref, 0, 1);
                if (t < 0.05) continue;

                // Log-spiral bands, wrinkled by a couple of angular harmonics and sheared
                // harder on one side, the way a real storm is deformed by its environment.
                const phase =
                    cyclone.arms * storm.angle +
                    cyclone.pitch * Math.log(Math.max(0.2, u)) -
                    time * 0.24 +
                    cyclone.turbulence * 3.4 * Math.sin(3 * storm.angle + cyclone.harmonic) +
                    cyclone.turbulence * 1.7 * Math.sin(7 * storm.angle - cyclone.harmonic * 1.7);
                const band = Math.pow(0.5 + 0.5 * Math.sin(phase), 1.7);
                const asym = 0.55 + 0.45 * Math.cos(storm.angle - cyclone.asymAngle);

                // A tight, near-continuous eyewall ring hugging the eye.
                const wall = smoothstep(cyclone.rm * 0.42, cyclone.rm * 0.06, Math.abs(storm.r - cyclone.rm * 1.02));
                // Fade the whole field past the outer bands, so the chart has a calm edge.
                const reach = smoothstep(cyclone.rm * 3.0, cyclone.rm * 0.95, storm.r);
                const strength = clamp(
                    t * reach * (0.16 + 0.84 * band) * (0.5 + 0.55 * asym) + t * wall * 0.75,
                    0,
                    1
                );
                if (strength < 0.06) continue;
                if (hash3(c, r, 11) > 0.1 + 0.88 * strength) continue;

                const tile = mix(palette.bg, ramp(palette.flow, Math.min(1, strength * 1.25)), 0.42 + 0.44 * strength);
                // Each rounded cell carries a dot: pale on the dark cells, dark on the lit ones.
                const ink =
                    strength > 0.55 ? mix(tile, palette.bg, 0.55) : mix(tile, palette.etch, 0.5 + 0.3 * strength);
                this.put(c, r, ".", ink, 0.35 + 0.35 * strength, tile, 0.1 + 0.3 * strength);
            }
        }
    }

    /** Orbiting air parcels, drawn as a bright glyph with two dotted trail cells. */
    paintTracers(cyclone, time, dt) {
        const { cw, ch, palette } = this;
        const tmp = { x: 0, y: 0, speed: 0 };
        for (const t of this.tracers) {
            // Midpoint step, so parcels near the eye don't cut across the eyewall.
            const s1 = cyclone.sample(t.x, t.y, tmp);
            const s2 = cyclone.sample(t.x + s1.x * dt * 0.5, t.y + s1.y * dt * 0.5, tmp);
            t.x += s2.x * dt;
            t.y += s2.y * dt;
            t.age += dt;

            const radius = Math.hypot(t.x - cyclone.x, t.y - cyclone.y);
            const offScreen = t.x < -cw * 4 || t.y < -ch * 4 || t.x > this.cols * cw + cw * 4 || t.y > this.rows * ch + ch * 4;
            if (radius < cyclone.eye * 1.15 || offScreen || t.age > 26) {
                this.respawnTracer(cyclone, t);
                continue;
            }

            const index = this.cellAt(t.x, t.y);
            if (index < 0) continue;
            // Parcels far from the low are the chart's quiet fringe: fade them out.
            const far = smoothstep(3.2 * cyclone.rm, 1.8 * cyclone.rm, radius);
            if (index !== t.last) {
                t.prev2 = t.prev1;
                t.prev1 = t.last;
                t.last = index;
            }

            const bright = mix(palette.bg, palette.accent, 1);
            const mid = mix(palette.bg, palette.accent, 0.9);
            const dim = mix(palette.bg, palette.accent, 0.55);
            const glyph = dirGlyph(s2.x, s2.y);
            // The parcel itself, then the cell it just left, so motion reads as a streak.
            this.put(index % this.cols, (index / this.cols) | 0, glyph, bright, 0.72 * far, null, 0);
            if (t.prev1 >= 0) this.put(t.prev1 % this.cols, (t.prev1 / this.cols) | 0, glyph, mid, 0.42 * far, null, 0);
            if (t.prev2 >= 0) this.put(t.prev2 % this.cols, (t.prev2 / this.cols) | 0, ".", dim, 0.2 * far, null, 0);
        }
    }

    // ── chart ───────────────────────────────────────────────────────────

    /** Isobars as faint chains of tangent glyphs, with the pressure printed in the gap. */
    paintIsobars(cyclone, time) {
        const { cols, rows, cw, ch, palette } = this;
        const swing = Math.sin(time * 0.05) * 0.05;
        const color = mix(palette.bg, palette.isobar, 0.8);
        const seen = new Set();

        ISOBARS.forEach((ring, index) => {
            const labelAngle = -2.4 + index * 0.62 + swing;
            const R = cyclone.rm * ring.radius * (1 + Math.sin(time * 0.07 + index) * 0.01);
            if (R > Math.hypot(cols * cw, rows * ch)) return;
            seen.clear();
            const seed = index * 3.7;
            for (let i = 0; i < 720; i++) {
                const a = (i / 720) * TAU;
                if (Math.abs(angleDiff(a, labelAngle)) < 0.1) continue;
                const wob = 1 + 0.035 * Math.sin(3 * a + seed) + 0.02 * Math.sin(5 * a - seed * 1.7);
                const rr = R * wob;
                const p = this.stormPoint(cyclone, rr, a);
                const x = p.x;
                const y = p.y;
                const c = Math.floor(x / cw);
                const r = Math.floor(y / ch);
                if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
                const key = r * cols + c;
                if (seen.has(key)) continue;
                seen.add(key);
                // Glyph follows the contour's tangent, mapped through the ellipse.
                const dxa = -Math.sin(a);
                const dya = Math.cos(a) * cyclone.aspect;
                this.put(
                    c,
                    r,
                    dirGlyph(dxa * cyclone._cos - dya * cyclone._sin, dxa * cyclone._sin + dya * cyclone._cos),
                    color,
                    0.3,
                    null,
                    0
                );
            }

            if (index >= ISOBARS.length - 2 && R < Math.hypot(cols * cw, rows * ch) * 0.98) {
                const labelPoint = this.stormPoint(cyclone, R, labelAngle);
                this.annotations.push({
                    x: labelPoint.x,
                    y: labelPoint.y,
                    text: String(ring.pressure),
                    size: ch * 0.62,
                    color: palette.label,
                    alpha: 0.3,
                    weight: 500,
                });
            }
        });
    }

    // ── frame ───────────────────────────────────────────────────────────

    render(cyclone, time, dt) {
        if (this.cols === 0) return;
        this.cellGlyph.fill(0);
        this.cellTileAlpha.fill(0);
        this.annotations.length = 0;

        this.paintField(cyclone, time);
        this.paintIsobars(cyclone, time);
        this.paintTracers(cyclone, time, dt);
        this.blit();
    }

    blit() {
        const { ctx, dpr, cw, ch, cols, cellGlyph, cellColor, cellAlpha, cellTile, cellTileAlpha } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = `600 ${Math.round(ch * 0.72)}px ${this.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Cells are rounded dots, not tiles: the chart reads as a dot matrix with glyphs etched in.
        const dot = Math.min(cw, ch) * 0.5 - 0.4;

        for (let i = 0; i < cellGlyph.length; i++) {
            const code = cellGlyph[i];
            if (!code) continue;
            const x = (i % cols) * cw;
            const y = ((i / cols) | 0) * ch;
            if (cellTileAlpha[i] > 0) {
                ctx.globalAlpha = cellTileAlpha[i];
                ctx.fillStyle = this.style(cellTile[i]);
                // A hair of per-cell variation keeps the dot field from looking stamped.
                const radius = dot * (0.88 + 0.12 * hash3(i, 3, 7));
                ctx.beginPath();
                ctx.arc(x + cw / 2, y + ch / 2, radius, 0, TAU);
                ctx.fill();
            }
            if (code === 32) continue;
            ctx.globalAlpha = cellAlpha[i];
            ctx.fillStyle = this.style(cellColor[i]);
            // A period is drawn as a true dot at the cell centre; as text it sits on the baseline,
            // which reads as a smudge at the bottom of the rounded cell.
            if (code === 46) {
                ctx.beginPath();
                ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.13, 0, TAU);
                ctx.fill();
                continue;
            }
            ctx.fillText(String.fromCharCode(code), x + cw / 2, y + ch / 2 + 1);
        }

        for (const a of this.annotations) {
            ctx.globalAlpha = a.alpha;
            ctx.fillStyle = this.style(packRgb(a.color));
            ctx.font = `${a.weight} ${Math.round(a.size)}px ${this.fontFamily}`;
            ctx.fillText(a.text, a.x, a.y);
        }
        ctx.globalAlpha = 1;
    }

    // ── tracers ─────────────────────────────────────────────────────────

    seedTracers() {
        this.tracers = [];
        for (let i = 0; i < TRACERS; i++) this.tracers.push(this.newTracer(null));
    }

    newTracer(cyclone) {
        const w = this.cols * this.cw;
        const h = this.rows * this.ch;
        let x;
        let y;
        if (cyclone && Math.random() < 0.78) {
            // Bias toward the eyewall, where the circulation is most legible.
            const a = Math.random() * TAU;
            const r = cyclone.rm * (0.5 + Math.random() * 1.6);
            x = cyclone.x + Math.cos(a) * r;
            y = cyclone.y + Math.sin(a) * r;
        } else {
            x = Math.random() * w;
            y = Math.random() * h;
        }
        return { x, y, age: 0, last: -1, prev1: -1, prev2: -1 };
    }

    respawnTracer(cyclone, tracer) {
        const next = this.newTracer(cyclone);
        tracer.x = next.x;
        tracer.y = next.y;
        tracer.age = 0;
        tracer.last = -1;
        tracer.prev1 = -1;
        tracer.prev2 = -1;
    }
}
