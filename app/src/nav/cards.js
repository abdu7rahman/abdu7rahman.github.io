/* What the guide holds up in the office.
 *
 * Six cards, and every line on them is already somewhere else on this site --
 * the entrance lede, the three room ledes, and the contact block. Nothing
 * here is new copy written to fill a card, because a card that says something
 * the rest of the site does not is a claim nobody checked.
 *
 * They are cards rather than a page for the reason the whole building is a
 * building: you are being shown round by something that can pick a thing up
 * and put it down, and the honest form for "here is one fact about me" is one
 * board at a time.
 */
export const CARDS = [
  {
    id: "what",
    kind: "ABOUT",
    title: "What I do",
    sub: "motion planning, manipulation, bringup",
    body: "I write the software that decides where a robot goes next, and the bringup that gets it onto real hardware."
  },
  {
    id: "now",
    kind: "ABOUT",
    title: "Right now",
    sub: "physical AI, bimanual, UR12e",
    body: "Learned policies for bimanual manipulation, moved off the simulator and onto a UR12e. Northeastern."
  },
  {
    id: "before",
    kind: "ABOUT",
    title: "Before that",
    sub: "five ABU Robocon seasons",
    body: "Team Robocon MJCET. Robots that had to work on a specific day in front of a judge, which is its own kind of benchmark."
  },
  {
    id: "method",
    kind: "ABOUT",
    title: "How I check it",
    sub: "against the paper, or not at all",
    body: "Most of it started as someone else's published method, checked against its own paper or a reference implementation, then fixed where it did not hold up."
  },
  {
    id: "tools",
    kind: "ABOUT",
    title: "What I build with",
    sub: "shipped, not read about",
    body: "Things I have shipped something with, not things I have read about."
  },
  {
    id: "where",
    kind: "ABOUT",
    title: "Where to find me",
    sub: "Berkeley, California",
    body: "mohammedabdulr.1@northeastern.edu · github.com/abdu7rahman · linkedin.com/in/abdu7rahman"
  }
];
