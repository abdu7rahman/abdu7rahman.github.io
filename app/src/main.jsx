import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { AUTHOR } from "./lib/author.js";
import { keep } from "./lib/offline.js";

if (typeof console !== "undefined") console.log(AUTHOR);

createRoot(document.getElementById("root")).render(
  <StrictMode><App /></StrictMode>
);

/* And keep the expensive half for next time. See lib/offline.js for why this
   is worth a service worker on a static site, and sw.js for what it refuses
   to cache. */
keep();
