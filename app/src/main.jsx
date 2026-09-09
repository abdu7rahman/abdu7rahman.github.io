import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { AUTHOR } from "./lib/author.js";

if (typeof console !== "undefined") console.log(AUTHOR);

createRoot(document.getElementById("root")).render(
  <StrictMode><App /></StrictMode>
);
