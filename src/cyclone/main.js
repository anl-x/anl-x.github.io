// Cyclone wind chart, animated with anime.js v4.
// Ambient by design: the page never reacts to the pointer, touch or scroll.
//
// anime.js owns every time-driven value in the scene:
//   • phase   — the slow rotation of the spiral bands
//   • drift   — the wander of the low across the frame
//   • breathe — a long, gentle pulse of the dot field's brightness
//   • fade    — the intro reveal
// and its timer drives the 30 Hz canvas repaint.

import { animate, createTimer, engine } from "../vendor/anime.esm.min.js";
import { Cyclone, TAU } from "./field.js";
import { WindChart } from "./chart.js";

// The chart is a slow diagram: 30 fps is indistinguishable from 60 and half the glyph work.
engine.fps = 30;
engine.pauseOnDocumentHidden = true;

class Scene {
    constructor(canvas) {
        this.canvas = canvas;
        this.cyclone = new Cyclone();
        this.chart = new WindChart(canvas);
        this.time = 0;
        this.last = performance.now();
        this.started = false;
        // anime.js writes these values every frame; the renderer only reads them.
        this.values = { phase: 0, evolve: 0, drift: 0, breathe: 1, fade: 1, tone: 0, sheen: 0 };

        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(canvas);
        window.addEventListener("resize", () => this.onResize());

        this.resize();
        this.paint();
        this.start();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.chart.resize(rect.width, rect.height, dpr);
        this.cyclone.resize(rect.width, rect.height);
    }

    onResize() {
        this.resize();
        this.paint();
    }

    paint() {
        this.chart.render(this.cyclone, this.time, 1 / 30, {
            phase: this.values.phase,
            evolve: this.values.evolve,
            fade: this.values.fade || 1,
            breathe: this.values.breathe,
            tone: this.values.tone,
            sheen: this.values.sheen,
        });
    }

    start() {
        if (this.started) return;
        this.started = true;

        // Weather pace: one turn of the bands every two minutes, the low drifting on a
        // five-minute loop, and the pattern itself morphing over three minutes.
        animate(this.values, { phase: TAU, duration: 120000, loop: true, ease: "linear" });
        animate(this.values, { evolve: TAU, duration: 200000, loop: true, ease: "linear" });
        animate(this.values, { drift: TAU, duration: 300000, loop: true, ease: "linear" });

        // The whole frame breathes: brightness, tone and sheen on long, offset loops.
        this.values.breathe = 0.94;
        animate(this.values, { breathe: 1, duration: 26000, loop: true, alternate: true, ease: "inOutSine" });
        animate(this.values, { tone: 1, duration: 110000, loop: true, alternate: true, ease: "inOutSine" });
        animate(this.values, { sheen: 1, duration: 78000, loop: true, alternate: true, ease: "inOutSine" });

        // anime.js' timer is the render clock.
        createTimer({
            duration: 1000,
            loop: true,
            onUpdate: () => this.tick(),
        });
    }

    tick() {
        const now = performance.now();
        const dt = Math.min(1 / 20, (now - this.last) / 1000);
        this.last = now;
        this.time += dt;
        this.cyclone.update(dt, this.values.drift);
        this.paint();
    }
}

const canvas = document.getElementById("chart");
if (canvas) new Scene(canvas);
