/**
 * @license
 * The fragment shader below is adapted from React Bits' Radar component.
 * Copyright (c) React Bits (David Haz), https://reactbits.dev
 * SPDX-License-Identifier: MIT
 */

/* A radar sweep, behind the page that could not find a path.
 *
 * The shader is React Bits' Radar (reactbits.dev, MIT, David Haz), used under
 * that licence and adapted rather than dropped in: React Bits ships React
 * components that mount an OGL renderer from a useEffect, and this site has
 * neither React nor a bundler nor OGL. What is worth having is the fragment
 * shader, so that is what was taken -- rings, spokes and a rotating lobe --
 * and hung on the same raw-WebGL scaffold field.js already uses, with the
 * same three ways down and the same fill-rate budget.
 *
 * It is on 404.html and nowhere else. The page's own copy is "the planner
 * returned empty", and a sweep turning over a field with nothing in it is
 * that sentence rather than a decoration of it. The rest of the site has a
 * world of its own or seven live demos, and neither wants a second thing
 * moving behind it.
 *
 * Changed from the original: the purple is the page's accent, the background
 * is the page's own, and the brightness is held where the contrast gate needs
 * it -- the brightest pixel this draws is measured against --landing-mut,
 * which is the most fragile text on the page.
 */
(function () {
  "use strict";

  if (!document.body) return;

  var reduce = window.matchMedia &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var canvas = document.createElement("canvas");
  canvas.className = "bg-field";
  canvas.setAttribute("aria-hidden", "true");

  var gl = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false })
      || canvas.getContext("experimental-webgl", { alpha: false, antialias: false, depth: false });
  } catch (e) { gl = null; }
  if (!gl) return;

  var VERT = [
    "attribute vec2 a_pos;",
    "void main(){ gl_Position=vec4(a_pos,0.0,1.0); }"
  ].join("\n");

  /* React Bits' Radar fragment, trimmed to what this page uses: the light
     mode, the mouse offset and the tone map are gone, because the page is
     dark, the sweep is not something to point at, and the colour is one
     accent rather than an arbitrary hex. */
  var FRAG = [
    "precision highp float;",
    "uniform float u_time;",
    "uniform vec2  u_res;",
    "uniform vec3  u_ink;",
    "uniform vec3  u_bg;",
    "uniform float u_gain;",
    "void main(){",
    "  vec2 st=gl_FragCoord.xy/u_res;",
    "  st=st*2.0-1.0;",
    "  st.x*=u_res.x/u_res.y;",
    // Half a screen across, so the sweep reads as an instrument the page is
    // sitting on rather than a badge behind the headline.
    "  st*=0.62;",
    "  float dist=length(st);",
    "  float th=atan(st.y,st.x);",
    "  float t=u_time*0.22;",
    // Rings marching outward and spokes standing still: range and bearing,
    // which is the whole of what a radar display is.
    "  float ring=1.0-smoothstep(0.0,0.055,abs(fract(dist*9.0-t)-0.5));",
    "  float sa=abs(fract(th*12.0/6.28318530718+0.5)-0.5)*6.28318530718/12.0;",
    "  float spoke=(1.0-smoothstep(0.0,0.012,sa*dist))*smoothstep(0.0,0.10,dist);",
    // One lobe, turning slowly. Two looked like a fan and three like a flower.
    "  float sweep=pow(max(0.5*sin(th+t*2.4)+0.5,0.0),7.0);",
    "  float fade=smoothstep(1.05,0.80,dist)*pow(max(1.0-dist,0.0),2.2);",
    "  float i=max((ring*0.55+spoke*0.5+sweep*0.8)*fade,0.0)*u_gain;",
    "  vec3 col=u_bg+u_ink*i;",
    "  float vig=smoothstep(1.20,0.20,length(gl_FragCoord.xy/u_res-vec2(0.5)));",
    "  col*=mix(0.55,1.0,vig);",
    "  gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }
  var vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  // One triangle over the clip cube: cheaper than two, and no seam.
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uTime = gl.getUniformLocation(prog, "u_time");
  var uRes = gl.getUniformLocation(prog, "u_res");

  function hex01(h) {
    h = (h || "").trim().replace("#", "");
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16) / 255,
            parseInt(h.slice(2, 4), 16) / 255,
            parseInt(h.slice(4, 6), 16) / 255];
  }
  var cs = getComputedStyle(document.documentElement);
  var ink = hex01(cs.getPropertyValue("--landing-accent")) || [1, 0.54, 0.36];
  var bg  = hex01(cs.getPropertyValue("--landing-bg")) || [0.039, 0.039, 0.039];
  gl.uniform3f(gl.getUniformLocation(prog, "u_ink"), ink[0], ink[1], ink[2]);
  gl.uniform3f(gl.getUniformLocation(prog, "u_bg"), bg[0], bg[1], bg[2]);
  /* The one number here that is not taste, and it was solved rather than
     picked. The rings, the spokes and the lobe can all crest on the same
     pixel, so the raw intensity reaches about 1.4 and the crest is the accent
     at full strength; --landing-mut over that reads 1.02:1. 0.34 was a guess
     and measured 2.93:1, still under the floor. At 0.20 the brightest pixel
     the shader can produce is #4f2f22, which is where the page's own muted
     text clears 4.5:1 with room to spare -- read straight off the shader's
     framebuffer over forty frames, so the sweep has been at every bearing,
     rather than reasoned about. tools/check_contrast.py carries that peak. */
  gl.uniform1f(gl.getUniformLocation(prog, "u_gain"), 0.20);

  document.body.appendChild(canvas);

  // Half resolution. Rings and a lobe have no edge worth the other half.
  var SCALE = 0.5;
  function resize() {
    var w = Math.max(1, Math.round(window.innerWidth * SCALE));
    var h = Math.max(1, Math.round(window.innerHeight * SCALE));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }
  window.addEventListener("resize", resize, { passive: true });

  var raf = null, start = 0, drewAt = 0;
  // A sweep is a slow thing and nobody times it. Twenty a second is the same
  // animation for a twentieth of the fill.
  var MIN_DT = 1000 / 20;
  function frame(now) {
    if (now - drewAt < MIN_DT) { raf = requestAnimationFrame(frame); return; }
    drewAt = now;
    if (!start) start = now;
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }

  resize();
  if (reduce) {
    // One settled frame and no loop, same as the weather: the page is still
    // lit, nothing on it moves.
    gl.uniform1f(uTime, 6.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else {
    raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { if (raf != null) { cancelAnimationFrame(raf); raf = null; } }
      else if (raf == null) { drewAt = 0; raf = requestAnimationFrame(frame); }
    });
  }
})();
