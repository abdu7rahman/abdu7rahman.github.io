import { CONTENT } from "../lib/content.js";

/* What is written in a room, as markup rather than as texture.
 *
 * Every word and number here is real DOM sitting over the canvas, which is
 * the one decision in this file worth defending. The reference this project
 * was pointed at carries almost no text -- it is interactive storytelling,
 * and its rooms are places rather than pages -- and copying that would mean
 * throwing away 2,926 words, five benchmark tables and 182 measured figures
 * whose whole point is that somebody can check them.
 *
 * Painted into the 3D scene they would be a picture of a table: unselectable,
 * unsearchable, unreadable by a screen reader, and blurred by whatever
 * mipmap the GPU picked. As markup they are a table. The building is the
 * room; the panel is the reading; neither has to pretend to be the other.
 */
function Stat({ k, v }) {
  return (
    <div className="stat"><dt>{k}</dt><dd>{v}</dd></div>
  );
}

export default function Panel({ id }) {
  if (id === "about" || id === "entry") {
    return (
      <div className="panel panel--prose">
        {CONTENT.about.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    );
  }

  if (id === "work") {
    return (
      <div className="panel panel--wide">
        <ol className="cards">
          {CONTENT.work.map((p, i) => (
            <li key={i} className="card">
              <span className="idx">{String(i + 1).padStart(2, "0")}</span>
              <div className="card__main">
                <h3>{p.title}</h3>
                <p>{p.desc}</p>
                {!!p.chips.length && (
                  <ul className="chips">{p.chips.map((c, j) => <li key={j}>{c}</li>)}</ul>
                )}
              </div>
              {!!p.stats.length && (
                <dl className="stats">{p.stats.map((s, j) => <Stat key={j} {...s} />)}</dl>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (id === "measured") {
    return (
      <div className="panel panel--wide">
        {/* No lede here. The plate above already carries it -- it is the
            stop's own note in plan.js and the section's opening line in
            written.html, which are the same sentence -- so printing both
            showed the reader "Claims I could check, checked" twice, once
            under the heading and once under the rule. */}
        {CONTENT.measured.tables.map((t, i) => (
          <figure key={i} className="bench">
            <figcaption><h3>{t.title}</h3><p>{t.note}</p></figcaption>
            <table>
              <thead><tr>{t.head.filter(h => !/relative/i.test(h)).map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
              <tbody>
                {t.rows.map((r, j) => (
                  <tr key={j}>{r.map((c, k) => k === 0 ? <th key={k} scope="row">{c}</th> : <td key={k}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {t.tail && <p className="tail">{t.tail}</p>}
          </figure>
        ))}
      </div>
    );
  }

  if (id === "stack") {
    return (
      <div className="panel">
        <dl className="stack">
          {CONTENT.stack.map((r, i) => (
            <div key={i}><dt>{r.k}</dt><dd>{r.v}</dd></div>
          ))}
        </dl>
      </div>
    );
  }

  if (id === "path") {
    return (
      <div className="panel panel--wide">
        <ol className="tl">
          {CONTENT.path.map((e, i) => (
            <li key={i}>
              <p className="when">{e.when}</p>
              <div>
                <h3>{e.title}</h3>
                {e.body.map((b, j) => <p key={j}>{b}</p>)}
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (id === "contact") {
    return (
      <div className="panel">
        <ul className="rows">
          {CONTENT.contact.map((c, i) => (
            <li key={i}><a href={c.href}>{c.label}</a></li>
          ))}
          {/* The same work as a document. Baked from it, in fact --
              tools/bake_content.py reads written.html to produce every panel
              in this building -- so it is the canonical copy and belongs in
              the list of ways to reach the author's work, not hidden behind
              a corner link. */}
          <li><a href="/written.html">The same work, written</a></li>
          <li className="where">Berkeley, California</li>
        </ul>
      </div>
    );
  }

  return null;
}
