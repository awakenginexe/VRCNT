import assert from "node:assert/strict";
import test from "node:test";

import * as onboardingTourGeometry from "../onboardingTourGeometry.js";

const {
    getOnboardingTourPortalRoot,
    getVisibleSpotlightRect,
} = onboardingTourGeometry;

const rect = (left, top, right, bottom) => ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
});

const element = ({
    bounds,
    parentElement = null,
    overflowX = "visible",
    overflowY = "visible",
    clientHeight = 0,
    scrollHeight = 0,
    scrollTop = 0,
}) => ({
    parentElement,
    getBoundingClientRect: () => bounds,
    style: { overflowX, overflowY },
    clientHeight,
    scrollHeight,
    scrollTop,
});

test("the tour portal uses the document body outside transformed page content", () => {
    const body = {};

    assert.equal(getOnboardingTourPortalRoot({ body }), body);
});

test("the tour viewport starts below the native title bar and maps spotlights into that content area", () => {
    const contentViewport = onboardingTourGeometry.getOnboardingTourContentViewport({
        viewport: { width: 1920, height: 1020 },
        titleBarBounds: rect(0, 0, 1920, 32),
    });

    assert.deepEqual(contentViewport, {
        left: 0,
        top: 32,
        right: 1920,
        bottom: 1020,
        width: 1920,
        height: 988,
    });
    assert.deepEqual(
        onboardingTourGeometry.toOnboardingTourContentCoordinates({
            bounds: rect(4, 588, 376, 824),
            contentViewport,
        }),
        {
            left: 4,
            top: 556,
            right: 376,
            bottom: 792,
            width: 372,
            height: 236,
        },
    );
    assert.deepEqual(
        getVisibleSpotlightRect({
            target: element({ bounds: rect(4, 8, 376, 86) }),
            viewport: contentViewport,
            getComputedStyle: (node) => node.style,
            padding: 12,
        }),
        {
            left: 0,
            top: 32,
            right: 388,
            bottom: 98,
            width: 388,
            height: 66,
        },
    );
});

test("the spotlight is limited to the target area visible inside its scroll container", () => {
    const scrollContainer = element({
        bounds: rect(0, 500, 360, 760),
        overflowY: "auto",
    });
    const target = element({
        bounds: rect(12, 420, 300, 700),
        parentElement: scrollContainer,
    });

    assert.deepEqual(
        getVisibleSpotlightRect({
            target,
            viewport: { width: 1200, height: 800 },
            getComputedStyle: (node) => node.style,
            padding: 12,
        }),
        {
            top: 500,
            right: 312,
            bottom: 712,
            left: 0,
            width: 312,
            height: 212,
        },
    );
});

test("the spotlight is omitted when the target is fully clipped out of view", () => {
    const scrollContainer = element({
        bounds: rect(0, 100, 360, 300),
        overflowY: "auto",
    });
    const target = element({
        bounds: rect(20, 340, 300, 480),
        parentElement: scrollContainer,
    });

    assert.equal(
        getVisibleSpotlightRect({
            target,
            viewport: { width: 1200, height: 800 },
            getComputedStyle: (node) => node.style,
            padding: 12,
        }),
        null,
    );
});

test("the tour scrolls only its nearest internal panel without moving document scroll", () => {
    const documentElement = { scrollTop: 145 };
    const body = { parentElement: documentElement, scrollTop: 145 };
    const scrollPanel = element({
        bounds: rect(0, 100, 360, 400),
        parentElement: body,
        overflowY: "auto",
        clientHeight: 300,
        scrollHeight: 1200,
    });
    const target = element({
        bounds: rect(20, 600, 320, 700),
        parentElement: scrollPanel,
    });

    const didScroll = onboardingTourGeometry.scrollOnboardingTargetIntoView({
        target,
        documentRef: { body, documentElement },
        getComputedStyle: (node) => node.style,
    });

    assert.equal(didScroll, true);
    assert.equal(scrollPanel.scrollTop, 400);
    assert.equal(body.scrollTop, 145);
    assert.equal(documentElement.scrollTop, 145);
});

test("finishing the tour resets any root scroll that could hide the title bar", () => {
    const documentElement = { scrollTop: 145, scrollLeft: 24 };
    const body = { scrollTop: 145, scrollLeft: 24 };
    const scrollingElement = { scrollTop: 145, scrollLeft: 24 };
    const scrollCalls = [];

    onboardingTourGeometry.resetOnboardingRootScroll({
        documentRef: { documentElement, body, scrollingElement },
        windowRef: {
            scrollTo: (...args) => scrollCalls.push(args),
        },
    });

    assert.equal(documentElement.scrollTop, 0);
    assert.equal(documentElement.scrollLeft, 0);
    assert.equal(body.scrollTop, 0);
    assert.equal(body.scrollLeft, 0);
    assert.equal(scrollingElement.scrollTop, 0);
    assert.equal(scrollingElement.scrollLeft, 0);
    assert.deepEqual(scrollCalls, [[0, 0]]);
});
