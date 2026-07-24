import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { sessionEntry } from "./sessionEntry";
import "./theme.css";

// СИНХРОННО, до первого рендера: считать код переноса/приглашение из URL и сразу вычистить
// адрес — код восстановления не должен оставаться в урле ни на кадр (кэшируется, дальше
// useAccount/App читают тот же результат).
sessionEntry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
