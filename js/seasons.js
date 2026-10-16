// The year in Kneesall: what each crop in the Crop Map of England looks like month by month, and the leaves on the
// deciduous trees and hedges. These are the usual farming calendar for winter-sown cereals and oilseed rape and
// spring-sown beans, maize and beet in the East Midlands, not records of these particular fields.
import { PAL, PLATE } from './bricks.js';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// how a field looks at each stage: colour, a second colour dotted through it, and how high the crop stands
const STAGE = {
  soil: { c: PAL.brown, alt: PAL.reddishBrown, top: 0 },          // ploughed or drilled, nothing showing
  shoots: { c: PAL.olive, alt: PAL.brown, top: 0 },               // young cereal rows over the soil
  rosette: { c: PAL.darkGreen, alt: PAL.olive, top: 0 },          // oilseed rape through the winter
  growing: { c: PAL.green, alt: PAL.lime, top: PLATE },
  tall: { c: PAL.darkGreen, alt: PAL.green, top: PLATE },         // maize, beans
  heading: { c: PAL.green, alt: PAL.olive, top: PLATE },          // cereals in ear, still green
  flower: { c: PAL.yellow, alt: PAL.brightLightYellow, top: PLATE },
  pods: { c: PAL.olive, alt: PAL.darkGreen, top: PLATE },
  ripe: { c: PAL.tan, alt: PAL.darkTan, top: PLATE },             // golden wheat and oats
  ripeBarley: { c: PAL.darkTan, alt: PAL.tan, top: PLATE },
  ripeRape: { c: PAL.darkTan, alt: PAL.brown, top: PLATE },
  ripeBeans: { c: PAL.brown, alt: PAL.dbg, top: PLATE },          // field beans go black before harvest
  stubble: { c: PAL.tan, alt: PAL.nougat, top: 0 },
  grass: { c: PAL.green, alt: PAL.lime, top: 0 },
  winterGrass: { c: PAL.green, alt: PAL.olive, top: 0 },
};

// stage of each crop in each month, January first
const CALENDAR = {
  wheat: ['shoots', 'shoots', 'shoots', 'growing', 'growing', 'heading', 'ripe', 'stubble', 'soil', 'soil', 'shoots', 'shoots'],
  barley: ['shoots', 'shoots', 'shoots', 'growing', 'growing', 'ripeBarley', 'ripeBarley', 'stubble', 'soil', 'shoots', 'shoots', 'shoots'],
  oats: ['soil', 'soil', 'soil', 'shoots', 'growing', 'growing', 'heading', 'ripe', 'stubble', 'soil', 'soil', 'soil'],
  rape: ['rosette', 'rosette', 'rosette', 'flower', 'flower', 'pods', 'ripeRape', 'stubble', 'rosette', 'rosette', 'rosette', 'rosette'],
  beans: ['soil', 'soil', 'soil', 'shoots', 'tall', 'tall', 'tall', 'ripeBeans', 'stubble', 'soil', 'soil', 'soil'],
  maize: ['soil', 'soil', 'soil', 'soil', 'shoots', 'tall', 'tall', 'tall', 'tall', 'stubble', 'soil', 'soil'],
  beet: ['soil', 'soil', 'soil', 'soil', 'shoots', 'growing', 'growing', 'growing', 'growing', 'growing', 'soil', 'soil'],
  grass: ['winterGrass', 'winterGrass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'winterGrass'],
};

// crop name (as osm.js maps the CROME codes) and month 1..12 -> { c, alt, top }
export function cropLook(crop, month) { return STAGE[(CALENDAR[crop] ?? CALENDAR.grass)[month - 1]]; }

// deciduous crowns: the colours of their leaves and how full they are (the share of the crown's bricks kept);
// bare in winter, only twigs left
export function foliage(month) {
  if (month <= 3 || month === 12) return { greens: [PAL.brown, PAL.brown, PAL.dbg], keep: 0.15 };
  if (month === 4) return { greens: [PAL.lime, PAL.green, PAL.lime, PAL.green], keep: 0.75 };
  if (month === 5) return { greens: [PAL.green, PAL.lime, PAL.green, PAL.darkGreen], keep: 1 };
  if (month <= 8) return { greens: [PAL.green, PAL.green, PAL.darkGreen, PAL.olive], keep: 1 };
  if (month === 9) return { greens: [PAL.green, PAL.olive, PAL.darkGreen, PAL.olive], keep: 1 };
  if (month === 10) return { greens: [PAL.olive, PAL.darkOrange, PAL.green, PAL.yellow, PAL.orange], keep: 0.9 };
  return { greens: [PAL.darkOrange, PAL.orange, PAL.reddishBrown, PAL.yellow], keep: 0.5 };
}

// hedgerows, bare twigs in winter: [main colour, the occasional brick]
export function hedgeColours(month) {
  if (month <= 3 || month === 12) return [PAL.brown, PAL.olive];
  if (month === 4) return [PAL.green, PAL.lime];
  if (month >= 10) return [PAL.olive, PAL.darkOrange];
  return [PAL.darkGreen, PAL.green];
}
