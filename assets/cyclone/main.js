// Cyclone wind chart: sizing, theme, drift and the frame loop.
// Ambient by design: the page never reacts to the pointer, touch or scroll.

import { Cyclone } from "./field.js";
import { WindChart } from "./chart.js";

const MAX_DT = 1 / 20;
// The chart is a slow-moving diagram; a 30 Hz repaint is indistinguishable from 60 and half the glyph work.
const MIN_FRAME_MS = 1000 / 30;

class Engine {
    constructor(canvas) {
        this.canvas = canvas;
        this.cyclone = new Cyclone();
        this.chart = new WindChart(canvas);
        this.time = 0;
        this.last = 0;
        this.lastPaint = 0;
        this.raf = 0;
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.light = window.matchMedia("(prefers-color-scheme: light)");
        this.chart.setTheme(this.light.matches);

        this.onResize = this.onResize.bind(this);
        this.onFrame = this.onFrame.bind(this);
        this.onVisibility = this.onVisibility.bind(this);

        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(canvas);
        window.addEventListener("resize", this.onResize);
        document.addEventListener("visibilitychange", this.onVisibility);
        this.light.addEventListener("change", (e) => {
            this.chart.setTheme(e.matches);
            if (this.reducedMotion.matches) this.paintStill();
        });
        this.reducedMotion.addEventListener("change", () => this.schedule());

        this.onResize();
        this.schedule();
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
        if (this.reducedMotion.matches) {
            this.paintStill();
        } else {
            this.schedule();
        }
    }

    schedule() {
        cancelAnimationFrame(this.raf);
        if (this.reducedMotion.matches) {
            this.paintStill();
            return;
        }
        this.last = performance.now();
        this.lastPaint = 0;
        this.raf = requestAnimationFrame(this.onFrame);
    }

    onVisibility() {
        if (document.hidden) {
            cancelAnimationFrame(this.raf);
            this.raf = 0;
        } else if (!this.reducedMotion.matches) {
            this.schedule();
        }
    }

    onFrame(now) {
        const dt = Math.min(MAX_DT, (now - this.last) / 1000);
        this.last = now;
        this.time += dt;
        this.cyclone.update(dt, this.time);
        if (now - this.lastPaint >= MIN_FRAME_MS) {
            this.chart.render(this.cyclone, this.time, dt);
            this.lastPaint = now;
            // TEMP instrumentation for verification; removed before delivery.
            this.frames = (this.frames || 0) + 1;
            document.documentElement.dataset.stats = `${this.frames}:${Math.round(performance.now())}`;
            document.documentElement.dataset.centre = `${Math.round(this.cyclone.x)},${Math.round(this.cyclone.y)}`;
        }
        this.raf = requestAnimationFrame(this.onFrame);
    }

    // Reduced motion: settle the low, then hold a single frame.
    paintStill() {
        this.time = 0;
        this.cyclone.update(0, 0);
        for (let i = 0; i < 240; i++) {
            this.time += 1 / 60;
            this.cyclone.update(1 / 60, this.time);
        }
        for (let i = 0; i < 40; i++) this.chart.render(this.cyclone, this.time, 1 / 30);
    }
}

const canvas = document.getElementById("chart");
if (canvas) new Engine(canvas);
