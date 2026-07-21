import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PixelBackground } from "./PixelBackground";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PixelBackground />
    <App />
  </React.StrictMode>
);
