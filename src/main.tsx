import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/i18n";
import "./app/styles/fonts.css";
import "./app/styles/app.css";

const container = document.querySelector<HTMLDivElement>("#app");

if (!container) {
  throw new Error("Root container #app not found");
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
