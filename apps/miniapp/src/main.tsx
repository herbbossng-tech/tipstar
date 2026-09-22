import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { AuthProvider } from "./auth/AuthProvider.js";
import { TelegramProvider } from "./telegram/TelegramProvider.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <TelegramProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </TelegramProvider>
  </React.StrictMode>,
);
