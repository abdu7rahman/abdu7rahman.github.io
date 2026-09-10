/* Where the baked robots live, as one path that is right from anywhere.
 *
 * They sit in the repository root's assets/, next to the document site that
 * baked them, and they are shared -- there is one UR12e in this project and
 * both halves of it fetch the same file.
 *
 * Root-absolute rather than relative, because the app is served from more
 * than one place: a preview build under /lab/, and eventually the site root.
 * A relative "assets/ur12e-hero.json" resolves against whichever directory
 * the page happens to be in, so under /lab/ it asks for /lab/assets/ and gets
 * a 404 and a building with no machines in it -- and nothing else about the
 * page looks wrong, which is the worst kind of break.
 */
export const ASSET = (name) => `/assets/${name}`;
