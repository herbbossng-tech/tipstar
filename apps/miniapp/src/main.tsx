import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { bootstrapTelegram } from "./telegram/bootstrap.js";
import "./styles.css";

const telegram = bootstrapTelegram();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App telegram={telegram} />
    </BrowserRouter>
  </React.StrictMode>,
);
