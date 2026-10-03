/**
 * The city size badge: population in the upper right corner of the city square.
 *
 * Canvas output is not readable from a unit test, so this asserts the draw calls
 * themselves — that the badge is anchored to the correct corner, grows inward as
 * the number gains digits, carries the civ colour, and is dropped when the text
 * would be too small to read.
 */
import { describe, expect, it } from 'vitest';
import { MapRenderer } from '@/game/rendering/MapRenderer';

/** A recording stand-in for CanvasRenderingContext2D. */
function stubCtx() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); };
  const ctx = {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '',
    textAlign: '', textBaseline: '',
    save: record('save'), restore: record('restore'),
    beginPath: record('beginPath'), fill: record('fill'), stroke: record('stroke'),
    fillRect: record('fillRect'), strokeRect: record('strokeRect'),
    fillText: record('fillText'), strokeText: record('strokeText'),
    arc: record('arc'), rect: record('rect'),
    measureText: (t: string) => ({ width: t.length * 6 }),
    translate: record('translate'), rotate: record('rotate'),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls };
}

const renderer = () => new MapRenderer(32) as unknown as {
  drawCitySizeBadge: (
    ctx: CanvasRenderingContext2D,
    cornerX: number, cornerY: number,
    population: number, overlayScale: number, civColor: string,
  ) => void;
};

describe('city size badge', () => {
  const CORNER_X = 100; // right edge of the city square
  const CORNER_Y = 80;  // top edge of the city square

  it('writes the population into the upper right corner', () => {
    const ctx = stubCtx();
    renderer().drawCitySizeBadge(ctx, CORNER_X, CORNER_Y, 7, 1, '#ff0000');

    const texts = ctx.calls.filter(c => c.op === 'fillText');
    expect(texts).toHaveLength(1);
    expect(texts[0].args[0]).toBe('7');
    // Right-aligned at the right edge, hanging from the top edge.
    expect(ctx.calls.find(c => c.op === 'fillText')!.args[1]).toBeLessThan(CORNER_X);
    expect(ctx.textAlign).toBe('right');
    expect(ctx.textBaseline).toBe('top');
  });

  it('grows inward, so a two-digit city stays on its tile', () => {
    const one = stubCtx();
    renderer().drawCitySizeBadge(one, CORNER_X, CORNER_Y, 7, 1, '#fff');
    const two = stubCtx();
    renderer().drawCitySizeBadge(two, CORNER_X, CORNER_Y, 12, 1, '#fff');

    const widthOf = (c: typeof one) =>
      (c.calls.find(x => x.op === 'fillRect')!.args as number[])[2];
    const leftOf = (c: typeof one) =>
      (c.calls.find(x => x.op === 'fillRect')!.args as number[])[0];

    expect(widthOf(two)).toBeGreaterThan(widthOf(one));
    // The right edge is pinned to the corner; the chip extends leftwards only.
    expect(leftOf(two) + widthOf(two)).toBeCloseTo(CORNER_X, 5);
    expect(leftOf(one) + widthOf(one)).toBeCloseTo(CORNER_X, 5);
  });

  it('rims the chip in the civ colour and keeps a dark plate', () => {
    const ctx = stubCtx();
    renderer().drawCitySizeBadge(ctx, CORNER_X, CORNER_Y, 4, 1, '#00ff00');

    const rects = ctx.calls.filter(c => c.op === 'strokeRect');
    expect(rects).toHaveLength(1);
    // strokeStyle at the moment of the rim is the civ colour.
    const plate = ctx.calls.find(c => c.op === 'fillRect')!;
    expect(plate).toBeDefined();
    expect(rects[0].args).toHaveLength(4);
  });

  it('scales with the overlay and clamps to a legible band', () => {
    const small = stubCtx();
    renderer().drawCitySizeBadge(small, CORNER_X, CORNER_Y, 5, 0.85, '#fff');
    const large = stubCtx();
    renderer().drawCitySizeBadge(large, CORNER_X, CORNER_Y, 5, 2, '#fff');

    const sizeOf = (c: typeof small) =>
      (c.calls.find(x => x.op === 'fillRect')!.args as number[])[3];
    expect(sizeOf(large)).toBeGreaterThan(sizeOf(small));
    // Never drawn at an unreadable size, even at the smallest scale.
    expect(sizeOf(small)).toBeGreaterThanOrEqual(8);
  });

  it('treats a missing population as a size of one', () => {
    const ctx = stubCtx();
    renderer().drawCitySizeBadge(ctx, CORNER_X, CORNER_Y, 0, 1, '#fff');
    expect(ctx.calls.find(c => c.op === 'fillText')!.args[0]).toBe('1');
  });

  it('saves and restores the context so it cannot leak font or fill state', () => {
    const ctx = stubCtx();
    renderer().drawCitySizeBadge(ctx, CORNER_X, CORNER_Y, 9, 1, '#fff');
    const ops = ctx.calls.map(c => c.op);
    expect(ops[0]).toBe('save');
    expect(ops[ops.length - 1]).toBe('restore');
  });
});
