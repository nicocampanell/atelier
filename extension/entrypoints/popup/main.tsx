// Adapted from Pond (MIT) apps/extension/entrypoints/popup/main.tsx @ deb305e
import "./style.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
