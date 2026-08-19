import assert from "node:assert/strict";
import test from "node:test";
import { calculateFloatingPanelPosition } from "../floating_panel/useFloatingPanelPosition.js";

const viewport = { width: 900, height: 700 };
const padding = 16;
const gap = 8;

test("places a floating panel below an anchor when the viewport has room", () => {
    const anchorRect = {
        top: 100,
        bottom: 140,
        left: 120,
        right: 360,
        width: 240,
        height: 40,
    };

    const position = calculateFloatingPanelPosition({
        anchorRect,
        panelSize: { width: anchorRect.width, height: 180 },
        viewport,
        gap,
        padding,
    });

    assert.deepEqual(position, {
        top: 148,
        left: 120,
        width: 240,
        maxHeight: 536,
        placement: "below",
    });
});

test("places a tall floating panel above an anchor near the bottom edge", () => {
    const anchorRect = {
        top: 500,
        bottom: 540,
        left: 80,
        right: 320,
        width: 240,
        height: 40,
    };

    const position = calculateFloatingPanelPosition({
        anchorRect,
        panelSize: { width: anchorRect.width, height: 240 },
        viewport: { width: 900, height: 600 },
        gap,
        padding,
    });

    assert.equal(position.placement, "above");
    assert.equal(position.top, 252);
    assert.equal(position.left, 80);
    assert.equal(position.width, anchorRect.width);
    assert.equal(position.maxHeight, 476);
    assert.ok(position.maxHeight > 0);
});

test("clamps a floating panel inside horizontal viewport padding", () => {
    const anchorRect = {
        top: 100,
        bottom: 140,
        left: 300,
        right: 520,
        width: 220,
        height: 40,
    };

    const position = calculateFloatingPanelPosition({
        anchorRect,
        panelSize: { width: anchorRect.width, height: 180 },
        viewport: { width: 360, height: 600 },
        gap,
        padding,
    });

    assert.equal(position.width, anchorRect.width);
    assert.equal(position.left, 124);
    assert.ok(position.left >= padding);
    assert.ok(position.left + position.width <= 360 - padding);
    assert.ok(position.maxHeight > 0);
});
