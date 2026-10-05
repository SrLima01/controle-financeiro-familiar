import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A aplicação continua funcionando normalmente mesmo se o cache offline não for registrado.
    });
  });
}