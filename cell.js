/* Two panels that run no Python at all.

   Everything else on this page executes a repository's own source: the first
   four fetch it from GitHub as the page loads, the next three run a copy under
   a second Pyodide runtime. These two do neither, and saying so is the point.
   Both repositories are private, and neither figure below needs a simulator to
   re-derive -- the whole finding in each case is arithmetic over numbers that
   were already measured. So the numbers are constants here, sourced in the
   comments, and the page does the sum in front of you.

   No runtime, no worker, no fetch. Nothing here starts anything. */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  /* Wires a `seg` radiogroup and reports the chosen value. The buttons carry
     aria-checked as well as the class, because the class is styling and the
     attribute is what a screen reader reads. */
  function segGroup(attr, onPick) {
    var btns = [].slice.call(document.querySelectorAll("[" + attr + "]"));
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        btns.forEach(function (o) {
          var on = o === b;
          o.classList.toggle("is-on", on);
          o.setAttribute("aria-checked", on ? "true" : "false");
        });
        onPick(b.getAttribute(attr));
      });
    });
    return btns;
  }

  /* ── the agreement that wasn't ──────────────────────────────────────
     Source: bimanual-ur5-cell README, "The two engines do not disagree here,
     and they do not agree either". Overshoot in metres, as scored by the task's
     own detector.

     `declared` is that detector run on the poses build/layout.json DECLARES --
     no simulator, no settling, no arm, no contact. It reproduces Gazebo's whole
     column to within 0.1 mm.

     `jitterMm` is MuJoCo's measured departure from the declared column, which
     the README attributes to MujocoEnvironment.reset's rng.uniform(-0.01, 0.01)
     on x and y, projected onto each tool's direction to the toolbox. It is
     given to three decimals there, so it is carried here rather than subtracted
     out of the four-decimal overshoots, which would lose a digit. */
  var TOOLS = [
    { name: "wrench inside toolbox",      mujoco: 0.8245, gazebo: 0.8199, declared: 0.8199, jitterMm:  4.604 },
    { name: "screwdriver inside toolbox", mujoco: 0.5296, gazebo: 0.5199, declared: 0.5199, jitterMm:  9.670 },
    { name: "hammer inside toolbox",      mujoco: 0.2915, gazebo: 0.2998, declared: 0.2999, jitterMm: -8.409 }
  ];

  function agree(jitterOn) {
    var table = $("agree-table"), read = $("agree-read");
    if (!table) return;

    var head = "<thead><tr><th>condition</th><th>MuJoCo</th><th>Gazebo</th>" +
               "<th>declared poses, no physics</th><th>&ldquo;difference&rdquo;</th></tr></thead>";
    var rows = TOOLS.map(function (t) {
      /* With the jitter removed MuJoCo lands on the declared column, because
         the departure from it IS the jitter. Reconstructed, not re-run -- the
         readout says so. */
      var mj = jitterOn ? t.mujoco : t.declared;
      var deltaMm = jitterOn ? Math.abs(t.jitterMm) : 0;
      var pct = deltaMm / (t.gazebo * 1000) * 100;
      return "<tr><th>" + t.name + "</th>" +
             "<td>" + mj.toFixed(4) + "&thinsp;m</td>" +
             "<td>" + t.gazebo.toFixed(4) + "&thinsp;m</td>" +
             "<td>" + t.declared.toFixed(4) + "&thinsp;m</td>" +
             "<td>" + pct.toFixed(2) + "&thinsp;%</td></tr>";
    }).join("");
    table.innerHTML = head + "<tbody>" + rows + "</tbody>";

    read.innerHTML = jitterOn
      ? "0.56, 1.86 and 2.80&thinsp;% apart &mdash; and this was published as the agreement. " +
        "The column is one adapter&rsquo;s randomisation divided by how far an object started from the box."
      : "0.00&thinsp;% apart, because nothing moved. Reconstructed by removing the documented jitter, " +
        "not a re-run: MuJoCo&rsquo;s whole departure from the declared column was the jitter.";
  }

  /* ── what survives the trace ────────────────────────────────────────
     Source: bimanual-data-collect README, "The one number that shaped the
     design". The trace writer replaces JSON arrays of 100 or more elements with
     a readable string summary; shorter ones are inlined as lists. A command on
     this cell is (6 joints + 1 gripper) x 2 arms = 14 wide, from
     cell.wire_format.NATIVE_DOF.

     No float values are drawn here. The shape is the finding; inventing plausible
     joint angles to fill a code block would be inventing a measurement. */
  var SUMMARY_MIN = 100;
  var PER_ARM = 7;

  function trace(arms, steps) {
    var pre = $("trace-pre"), read = $("trace-read"), out = $("trace-steps-v");
    if (!pre) return;
    if (out) out.textContent = String(steps);

    var width = arms * PER_ARM;
    var elements = width * steps;
    var gone = elements >= SUMMARY_MIN;
    var ceiling = Math.floor((SUMMARY_MIN - 1) / width);

    pre.textContent = gone
      ? '"action": "<summarised: ' + elements + ' elements>"'
      : '"action": [ ' + width + " floats x " + steps + " steps = " + elements + " elements ]";

    read.innerHTML = gone
      ? "<strong>" + elements + " elements, and the trajectory is gone.</strong> Nothing errored. The key is " +
        "still there and the value is still a plausible string. At " + width + " wide the ceiling is " +
        ceiling + " step" + (ceiling === 1 ? "" : "s") + "."
      : elements + " elements, inlined and recoverable. One more step reaches " + (elements + width) +
        (elements + width >= SUMMARY_MIN
          ? " and crosses the threshold."
          : ", still under the threshold.");
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */
  var jitterOn = true;
  segGroup("data-agree-jitter", function (v) { jitterOn = v === "on"; agree(jitterOn); });
  agree(jitterOn);

  var arms = 2;
  var stepsEl = $("trace-steps");
  segGroup("data-trace-arms", function (v) {
    arms = parseInt(v, 10);
    trace(arms, stepsEl ? parseInt(stepsEl.value, 10) : 8);
  });
  if (stepsEl) {
    stepsEl.addEventListener("input", function () { trace(arms, parseInt(stepsEl.value, 10)); });
    trace(arms, parseInt(stepsEl.value, 10));
  }
})();
